import {
  CONNECTIONS_FIELD,
  DAGGERHEART_SYSTEM_ID,
  LOG_PREFIX,
  MODULE_ID,
  SETTINGS,
} from "../constants.js";
import type {
  ConnectionAnswerRecord,
  ConnectionsRound,
  PendingConnection,
} from "../models/session.js";
import { SessionStore } from "../stores/session-store.js";
import {
  clearConnectionAnswers,
  parseConnections,
  writeConnectionAnswer,
  type ParsedConnection,
} from "./connections-html.js";
import { escapeHtml } from "../utils/escape-html.js";
import { getUsers, userName } from "./foundry-users.js";
import { emitConnectionAnswerRequest, emitConnectionAskRequest } from "./socket.js";
import {
  clearPortraits,
  releasePortraitAfterAnswer,
  spotlightPortraits,
} from "./portrait-bridge.js";

/**
 * The **connections round**: the Session 0 pass where each character's connection
 * questions are answered by the *other* players, one question at a time.
 *
 * ## A round is a session, not a mode
 *
 * The GM **starts** the round explicitly, the same way they start a Story Deck:
 * it announces itself with a banner on every client, puts the shared HUD on
 * screen for the whole table, and only then can questions be handed out. Without
 * that framing the tab would be a set of buttons that are always live, with no
 * moment where the table is told the round has begun — and the players, who see
 * no tab, would have nothing at all.
 *
 * ## Shape of the hand-off
 *
 * A question belongs to a character, but is answered by somebody else — so a
 * single question takes two hops:
 *
 *   1. the GM starts a question from the Connections tab,
 *   2. its owner (the **asker**) is prompted to choose who answers it,
 *   3. that player (the **answerer**) writes the answer,
 *   4. the GM's client records it and writes it onto the asker's sheet.
 *
 * Every write happens on the GM client. Players cannot write world settings, and
 * the answerer usually has no permission on the asker's actor — routing both
 * through the GM avoids needing either.
 *
 * ## Fairness
 *
 * Two rules keep the round from collapsing onto whoever answers fastest:
 *
 *   - a player who has already answered one of *your* questions drops off your
 *     candidate list, so your connections spread across the table; and
 *   - the picker shows how many questions each player has answered tonight
 *     *for anybody*, so the asker can see who is carrying the round.
 *
 * When the first rule exhausts the list — a small table with more questions than
 * players — everyone becomes eligible again rather than stranding the question.
 */

/** A character taking part in the round, with its questions and their state. */
export interface ConnectionRow {
  actorId: string;
  actorName: string;
  /** The player who owns the character; questions on it are theirs to hand out. */
  askerUserId: string;
  askerName: string;
  online: boolean;
  questions: ConnectionQuestionRow[];
}

export interface ConnectionQuestionRow extends ParsedConnection {
  /** Display name of whoever answered, or null while unanswered. */
  answeredBy: string | null;
  /** True while this exact question is the one out for an answer. */
  pending: boolean;
}

/** A candidate answerer, with the tally that justifies picking them. */
export interface AnswererCandidate {
  id: string;
  name: string;
  /** Questions they have answered tonight, for anyone. */
  answered: number;
}

// --- configuration -----------------------------------------------------------

export function isDaggerheart(): boolean {
  return game.system?.id === DAGGERHEART_SYSTEM_ID;
}

/**
 * Whether the connections round is live.
 *
 * Both halves matter: the setting is the GM's choice, and the system check means
 * a value carried into a non-Daggerheart world can never switch on a feature that
 * would have no field to read.
 */
export function connectionsEnabled(): boolean {
  if (!isDaggerheart()) return false;
  return game.settings.get(MODULE_ID, SETTINGS.connections) !== false;
}

// --- the round ---------------------------------------------------------------

/** The round currently running, or `null` between rounds. Readable by everyone. */
export function currentRound(): ConnectionsRound | null {
  if (!connectionsEnabled()) return null;
  return SessionStore.load().connections.round;
}

/**
 * How far through the round the table is, counted over the characters taking
 * part right now.
 *
 * Answers are matched against the questions actually on the sheets rather than
 * simply counted, so an answer to a question that has since been edited away
 * can't push the total past 100%.
 */
export function roundProgress(): { answered: number; total: number; percent: number } {
  const rows = connectionRoster();
  let answered = 0;
  let total = 0;
  for (const row of rows) {
    total += row.questions.length;
    answered += row.questions.filter((q) => q.answer !== "").length;
  }
  return { answered, total, percent: total > 0 ? Math.round((answered / total) * 100) : 0 };
}

/**
 * GM: open the round.
 *
 * Needs at least two players online — a connection is one character answering
 * for another, so a table of one has nobody to ask.
 */
export async function startRound(): Promise<boolean> {
  if (!game.user?.isGM || !connectionsEnabled()) return false;

  const session = SessionStore.load();
  if (session.connections.round) return false;

  const online = getUsers().filter((u) => u.active && !u.isGM);
  if (online.length < 2) {
    ui.notifications?.warn(game.i18n.localize("FSD.Connections.NeedsTwo"));
    return false;
  }

  await SessionStore.save({
    ...session,
    connections: { ...session.connections, round: { startedAt: Date.now() }, pending: null },
  });
  return true;
}

/**
 * GM: close the round, dropping any question still in flight.
 *
 * Answers already given are left exactly where they are — on the sheets and in
 * the session. Ending is about stopping, not undoing; `resetConnections()` is
 * the destructive one.
 */
export async function endRound(): Promise<void> {
  if (!game.user?.isGM) return;
  const session = SessionStore.load();
  await SessionStore.save({
    ...session,
    connections: { ...session.connections, round: null, pending: null },
  });
  // Same reasoning as a card run ending: nothing is being spotlighted any more.
  await clearPortraits();
}

// --- reading the table -------------------------------------------------------

/**
 * Every player character in the round, in roster order.
 *
 * Built from *users* rather than actors: a question is handed out by the person
 * playing the character, so a character nobody is assigned to has no asker and
 * takes no part. Users without an assigned character are skipped for the same
 * reason.
 */
export function connectionRoster(): ConnectionRow[] {
  const { answers, pending } = SessionStore.load().connections;
  const rows: ConnectionRow[] = [];

  for (const user of getUsers()) {
    if (user.isGM) continue;
    const actor = actorForUser(user.id);
    if (!actor) continue;

    // Hoisted so the narrowing survives into the closure below.
    const inFlight =
      pending !== null && pending.actorId === actor.id ? pending.questionIndex : null;

    const questions = parseConnections(connectionsHtml(actor)).map((q) => {
      const record = answers.find(
        (a) => a.actorId === actor.id && a.questionIndex === q.index,
      );
      return {
        ...q,
        answeredBy: record ? userName(record.answererUserId) : null,
        pending: inFlight === q.index,
      };
    });

    rows.push({
      actorId: String(actor.id),
      actorName: String(actor.name ?? ""),
      askerUserId: user.id,
      askerName: user.name,
      online: user.active,
      questions,
    });
  }

  return rows;
}

/** How many questions each player has answered tonight, keyed by user id. */
export function answeredCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of SessionStore.load().connections.answers) {
    counts.set(record.answererUserId, (counts.get(record.answererUserId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Who may answer the next question on `actorId`, ordered by how little they have
 * answered so far — the fair pick is the one at the top.
 *
 * Anyone who has already answered for this character is excluded, unless that
 * would leave nobody: with more questions than players, a second pass beats a
 * dead end, and the counts shown alongside keep it honest.
 */
export function eligibleAnswerers(actorId: string, askerUserId: string): AnswererCandidate[] {
  const { answers } = SessionStore.load().connections;
  const counts = answeredCounts();

  const online = getUsers()
    .filter((u) => u.active && !u.isGM && u.id !== askerUserId)
    .map((u) => ({ id: u.id, name: u.name, answered: counts.get(u.id) ?? 0 }));

  const spokenFor = new Set(
    answers.filter((a) => a.actorId === actorId).map((a) => a.answererUserId),
  );
  const fresh = online.filter((u) => !spokenFor.has(u.id));

  return (fresh.length > 0 ? fresh : online).sort(
    (a, b) => a.answered - b.answered || a.name.localeCompare(b.name),
  );
}

// --- running a question ------------------------------------------------------

/**
 * GM: put one question out to its owner, who will choose who answers it.
 *
 * Refuses while another question is already out — two open questions would race
 * for the same answerers and quietly break the fairness rules.
 */
export async function startConnection(actorId: string, questionIndex: number): Promise<void> {
  if (!game.user?.isGM || !connectionsEnabled()) return;

  const session = SessionStore.load();
  if (!session.connections.round) {
    ui.notifications?.warn(game.i18n.localize("FSD.Connections.NotStarted"));
    return;
  }
  if (session.connections.pending) {
    ui.notifications?.warn(game.i18n.localize("FSD.Connections.AlreadyRunning"));
    return;
  }

  const row = connectionRoster().find((r) => r.actorId === actorId);
  const question = row?.questions.find((q) => q.index === questionIndex);
  if (!row || !question) return;

  if (!row.online) {
    ui.notifications?.warn(game.i18n.format("FSD.Connections.AskerOffline", { name: row.askerName }));
    return;
  }

  const candidates = eligibleAnswerers(actorId, row.askerUserId);
  if (candidates.length === 0) {
    ui.notifications?.warn(game.i18n.localize("FSD.Connections.NoCandidates"));
    return;
  }

  const pending: PendingConnection = {
    actorId,
    askerUserId: row.askerUserId,
    questionIndex,
    question: question.question,
    answererUserId: null,
  };
  await savePending(pending);

  emitConnectionAskRequest(row.askerUserId, {
    actorId,
    questionIndex,
    question: question.question,
    candidates,
  });
  void spotlightPortraits([row.askerUserId]);
  ui.notifications?.info(
    game.i18n.format("FSD.Connections.SentToAsker", { name: row.askerName }),
  );
}

/**
 * GM: the asker has chosen — pass the question to the player they picked.
 *
 * The pick is re-validated against the eligibility rules rather than trusted:
 * the payload came off the wire, and the table may have changed while the
 * asker's dialog sat open.
 */
export async function recordAskerChoice(
  askerUserId: string,
  answererUserId: string,
): Promise<void> {
  if (!game.user?.isGM) return;

  const session = SessionStore.load();
  const pending = session.connections.pending;

  // These three used to return in silence, which is indistinguishable at the
  // table from the message never arriving. Say what was dropped and why.
  if (!pending) {
    console.warn(`${LOG_PREFIX} Ignoring a connection pick: no question is pending.`);
    return;
  }
  if (pending.askerUserId !== askerUserId) {
    console.warn(
      `${LOG_PREFIX} Ignoring a connection pick from ${userName(askerUserId)} (${askerUserId}):`,
      `the pending question belongs to ${userName(pending.askerUserId)} (${pending.askerUserId}).`,
    );
    return;
  }
  if (pending.answererUserId) {
    console.warn(`${LOG_PREFIX} Ignoring a connection pick: an answerer was already chosen.`);
    return;
  }

  const allowed = eligibleAnswerers(pending.actorId, pending.askerUserId);
  if (!allowed.some((c) => c.id === answererUserId)) {
    ui.notifications?.warn(game.i18n.localize("FSD.Connections.PickUnavailable"));
    return;
  }

  await savePending({ ...pending, answererUserId });

  emitConnectionAnswerRequest(answererUserId, {
    question: pending.question,
    askerName: characterName(pending.askerUserId),
  });
  void spotlightPortraits([answererUserId]);
  ui.notifications?.info(
    game.i18n.format("FSD.Connections.SentToAnswerer", { name: userName(answererUserId) }),
  );
}

/**
 * GM: record an answer, both in the session and on the asker's sheet.
 *
 * The sheet write is what the table actually reads afterwards, so a failure
 * there — the question was edited away mid-round — leaves the session record
 * alone too, rather than logging an answer nobody can see.
 */
export async function recordConnectionAnswer(
  answererUserId: string,
  answer: string,
): Promise<void> {
  if (!game.user?.isGM) return;

  const session = SessionStore.load();
  const pending = session.connections.pending;
  if (!pending) {
    console.warn(`${LOG_PREFIX} Dropping a connection answer: no question is pending.`);
    return;
  }
  if (pending.answererUserId !== answererUserId) {
    console.warn(
      `${LOG_PREFIX} Dropping a connection answer from ${userName(answererUserId)}`,
      `(${answererUserId}): the pending question was sent to ${pending.answererUserId}.`,
    );
    return;
  }

  // The sheet is what the table reads afterwards, so a failure there must not
  // leave a session record pointing at an answer nobody can see. Each reason
  // gets its own message — "it didn't work" is not a diagnosis.
  const outcome = await writeAnswerToSheet(pending, answererUserId, answer);
  if (outcome !== "ok") {
    ui.notifications?.error(game.i18n.localize(WRITE_FAILURE_MESSAGES[outcome]));
    await savePending(null);
    return;
  }

  const record: ConnectionAnswerRecord = {
    actorId: pending.actorId,
    questionIndex: pending.questionIndex,
    question: pending.question,
    askerUserId: pending.askerUserId,
    answererUserId,
    answer,
    answeredAt: Date.now(),
  };

  const current = SessionStore.load();
  await SessionStore.save({
    ...current,
    connections: {
      ...current.connections,
      // Re-answering a question replaces its record, so the tallies never
      // double-count a question that was run twice.
      answers: [
        ...current.connections.answers.filter(
          (a) => !(a.actorId === record.actorId && a.questionIndex === record.questionIndex),
        ),
        record,
      ],
      pending: null,
    },
  });

  // A connection is a two-person beat: the asker's portrait went up when the
  // question was handed to them, the answerer's when they were chosen. They come
  // down together — lowering only the answerer leaves the asker lit with nothing
  // left to say.
  releasePortraitAfterAnswer(pending.askerUserId);
  releasePortraitAfterAnswer(answererUserId);

  // Post it to chat rather than only toasting the GM. The asker in particular
  // has to learn what was said about their own character, and a notification
  // that only the GM sees leaves the person whose question it was in the dark.
  // Chat also gives the round a transcript the table can scroll back through.
  await postConnectionToChat(pending, answererUserId, answer);
}

/**
 * GM: abandon the question in flight, leaving everything already answered alone.
 *
 * The spotlight goes with it. Nobody is being asked anything now, so a portrait
 * left up would be pointing at a beat that isn't happening.
 */
export async function cancelConnection(): Promise<void> {
  if (!game.user?.isGM) return;
  await savePending(null);
  await clearPortraits();
}

/**
 * GM: wipe the round — session records and the answers on every sheet.
 *
 * Destructive and not undoable, so the caller is expected to confirm first.
 */
export async function resetConnections(): Promise<void> {
  if (!game.user?.isGM) return;

  for (const row of connectionRoster()) {
    const actor = getActor(row.actorId);
    if (!actor) continue;
    const cleared = clearConnectionAnswers(connectionsHtml(actor));
    await actor.update({ [`system.${CONNECTIONS_FIELD}`]: cleared });
  }

  // The round itself survives a wipe — clearing answers is a "start these over",
  // not a "stop". Ending the round is `endRound()`.
  const session = SessionStore.load();
  await SessionStore.save({
    ...session,
    connections: { ...session.connections, answers: [], pending: null },
  });
}

// --- internals ---------------------------------------------------------------

async function savePending(pending: PendingConnection | null): Promise<void> {
  const session = SessionStore.load();
  await SessionStore.save({
    ...session,
    connections: { ...session.connections, pending },
  });
}

/** Why a sheet write didn't land, so the GM is told something actionable. */
type WriteOutcome = "ok" | "no-actor" | "no-question" | "update-failed";

const WRITE_FAILURE_MESSAGES: Record<Exclude<WriteOutcome, "ok">, string> = {
  "no-actor": "FSD.Connections.ActorGone",
  "no-question": "FSD.Connections.QuestionGone",
  "update-failed": "FSD.Connections.WriteFailed",
};

/**
 * Put the answer on the asker's actor.
 *
 * `actor.update()` is the one step here that can reject — a validation error, a
 * permission problem, another module vetoing `preUpdateActor`. Left uncaught it
 * became an unhandled rejection two frames up, which is to say: the answer
 * vanished and nobody was told anything. Catch it, log the real error, and hand
 * back a reason the caller can show.
 */
async function writeAnswerToSheet(
  pending: PendingConnection,
  answererUserId: string,
  answer: string,
): Promise<WriteOutcome> {
  const actor = getActor(pending.actorId);
  if (!actor) {
    console.error(`${LOG_PREFIX} No actor ${pending.actorId} to write a connection answer to.`);
    return "no-actor";
  }

  const updated = writeConnectionAnswer(
    connectionsHtml(actor),
    pending.questionIndex,
    characterName(answererUserId),
    answer,
  );
  if (updated === null) {
    console.error(
      `${LOG_PREFIX} Question ${pending.questionIndex} is no longer on ${actor["name"]}'s sheet.`,
    );
    return "no-question";
  }

  try {
    await actor.update({ [`system.${CONNECTIONS_FIELD}`]: updated });
  } catch (error) {
    console.error(`${LOG_PREFIX} Writing the connection answer to ${actor["name"]} failed.`, error);
    return "update-failed";
  }
  return "ok";
}

/**
 * Announce an answered connection to the whole table.
 *
 * Spoken by the asker's character, because the question is theirs; the answer is
 * credited to whoever gave it. Failing to post must never lose the answer — it
 * is already on the sheet by this point — so this only warns.
 */
async function postConnectionToChat(
  pending: PendingConnection,
  answererUserId: string,
  answer: string,
): Promise<void> {
  const actor = getActor(pending.actorId);
  const content = `
    <div class="${MODULE_ID} story-deck story-deck__chat-connection">
      <p class="story-deck__chat-q">${escapeHtml(pending.question)}</p>
      <p class="story-deck__chat-a">${escapeHtml(answer)}</p>
      <p class="story-deck__chat-who">— ${escapeHtml(characterName(answererUserId))}</p>
    </div>`;

  try {
    await ChatMessage.create({
      content,
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      flavor: game.i18n.localize("FSD.Connections.RoundName"),
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not post the connection answer to chat.`, error);
    // Fall back to a toast so the answer isn't silently invisible.
    ui.notifications?.info(
      game.i18n.format("FSD.Connections.Answered", {
        name: userName(answererUserId),
        who: characterName(pending.askerUserId),
        answer,
      }),
    );
  }
}

function getActor(actorId: string): AnyObject | null {
  return (game.actors?.get(actorId) as AnyObject | undefined) ?? null;
}

function actorForUser(userId: string): AnyObject | null {
  const user = game.users?.get(userId) as AnyObject | undefined;
  const actor = user?.["character"] as AnyObject | undefined;
  return actor?.["id"] ? actor : null;
}

function connectionsHtml(actor: AnyObject): string {
  return String(foundry.utils.getProperty(actor, `system.${CONNECTIONS_FIELD}`) ?? "");
}

/**
 * A player's character name, falling back to their own.
 *
 * Answers are read back on a character sheet, in character — "Kira:" belongs
 * there in a way that the account name behind her does not.
 */
function characterName(userId: string): string {
  const actor = actorForUser(userId);
  return String(actor?.["name"] ?? userName(userId));
}

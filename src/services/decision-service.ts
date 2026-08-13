import { LOG_PREFIX } from "../constants.js";
import type { DecisionOption, DecisionState, DecisionType } from "../models/session.js";
import { resolveWinner } from "../engine/decision-resolver.js";
import { SessionStore } from "../stores/session-store.js";
import { sessionDateKey } from "../utils/session-date.js";
import { getOnlinePlayers, userName } from "./foundry-users.js";
import { emitDecisionVote } from "./socket.js";

/**
 * The **Story Decision** vote: the GM poses a question with a few options, the
 * table picks one (a single designated player, or the whole group by majority
 * or weighted-random), and the GM ends voting once everyone (or the one
 * player) has picked. See `apps/story-decision-vote-app.ts` for the UI and
 * `engine/decision-resolver.ts` for how a winner is chosen.
 *
 * Every write happens on the GM client — players cannot write world settings,
 * so a vote arrives over the socket (`decisionVote`) and lands here. State
 * lives in the same session document `connections` does, and syncs the same
 * way: a world-setting write fires `updateSetting` on every client, which
 * re-renders `StoryDecisionVoteApp` off the fresh state.
 */

export interface StartDecisionInput {
  title: string;
  description: string;
  options: DecisionOption[];
  type: DecisionType;
  singlePlayerId: string;
}

/** The decision currently open for voting (or just resolved), if any. */
export function currentDecision(): DecisionState | null {
  return SessionStore.load().decision;
}

/** Who the table is waiting on: the one designated player, or every online player. */
export function expectedVoterIds(state: DecisionState): string[] {
  if (state.type === "single") return state.singlePlayerId ? [state.singlePlayerId] : [];
  return getOnlinePlayers().map((p) => p.id);
}

/** Whether everyone the table is waiting on has voted — lights up "End Voting". */
export function allVoted(state: DecisionState): boolean {
  const expected = expectedVoterIds(state);
  return expected.length > 0 && expected.every((id) => id in state.votes);
}

/**
 * "Being decided by <player>" or "Being decided by everyone" — the banner
 * subtitle, the vote screen's own subheading, and the decisions journal entry
 * (`journal-export.ts`) all share this.
 */
export function subtitleFor(state: Pick<DecisionState, "type" | "singlePlayerId">): string {
  if (state.type === "single") {
    return game.i18n.format("FSD.StoryDecision.DecidedBySingle", {
      name: userName(state.singlePlayerId),
    });
  }
  return game.i18n.localize("FSD.StoryDecision.DecidedByGroup");
}

/**
 * How many times `userId` has been asked to make a `"single"` decision — split
 * by today (`sessionDateKey()`) and lifetime, so the GM can see at a glance
 * whether the job's been spread around. Shown next to each player's name in
 * the "Single" chooser dropdown (`StoryDecisionApp`).
 */
export function singleChooserCounts(userId: string): { today: number; total: number } {
  const key = sessionDateKey();
  let today = 0;
  let total = 0;
  for (const record of SessionStore.load().singleChooserLog) {
    if (record.userId !== userId) continue;
    total++;
    if (record.sessionKey === key) today++;
  }
  return { today, total };
}

/**
 * GM: open a new decision for voting.
 *
 * Refuses while another is already live — a second Ask would silently
 * overwrite votes in flight for the first one.
 */
export async function startDecision(input: StartDecisionInput): Promise<boolean> {
  if (!game.user?.isGM) return false;

  const session = SessionStore.load();
  if (session.decision && session.decision.status === "voting") {
    ui.notifications?.warn(game.i18n.localize("FSD.StoryDecision.AlreadyVoting"));
    return false;
  }

  const decision: DecisionState = {
    id: foundry.utils.randomID(),
    title: input.title,
    description: input.description,
    options: input.options,
    type: input.type,
    singlePlayerId: input.singlePlayerId,
    votes: {},
    status: "voting",
    winnerOptionId: null,
  };

  // Logged here, not on resolve — asking *is* designating them the chooser,
  // regardless of whether voting later gets force-ended before they act.
  const singleChooserLog =
    input.type === "single" && input.singlePlayerId
      ? [...session.singleChooserLog, { userId: input.singlePlayerId, sessionKey: sessionDateKey() }]
      : session.singleChooserLog;

  await SessionStore.save({ ...session, decision, singleChooserLog });
  return true;
}

/**
 * GM: record a vote (or change one already cast).
 *
 * Re-validated rather than trusted, the same way `recordAskerChoice` in
 * `connections-service.ts` re-checks a connection pick: the payload came off
 * the wire, and the vote is meaningless once voting has ended or the option
 * no longer exists.
 */
export async function castVote(userId: string, optionId: string): Promise<void> {
  if (!game.user?.isGM) return;

  const session = SessionStore.load();
  const decision = session.decision;
  if (!decision || decision.status !== "voting") {
    console.warn(`${LOG_PREFIX} Ignoring a decision vote: no vote is open.`);
    return;
  }
  if (!decision.options.some((o) => o.id === optionId)) {
    console.warn(`${LOG_PREFIX} Ignoring a decision vote for an option that no longer exists.`);
    return;
  }
  if (decision.type === "single" && userId !== decision.singlePlayerId) {
    console.warn(
      `${LOG_PREFIX} Ignoring a decision vote from ${userId}: this decision is only ${decision.singlePlayerId}'s to make.`,
    );
    return;
  }

  await SessionStore.save({
    ...session,
    decision: { ...decision, votes: { ...decision.votes, [userId]: optionId } },
  });
}

/**
 * GM: end voting and resolve a winner.
 *
 * Ending early is allowed — the button lighting up once everyone's voted is a
 * hint, not a gate — but ending *before that* warns first rather than acting:
 * `resolveWinner()` falls back to a random pick when there's nothing to go
 * on, and doing that silently on a stray click would be a surprising way to
 * lose a vote nobody meant to end yet. `force` is how the vote screen pushes
 * through anyway — a second End Voting click within a few seconds of the
 * first (see `StoryDecisionVoteApp`) sets it, rather than making the GM find
 * a separate confirmation control for what's still a one-button action.
 */
export async function endVoting(force = false): Promise<DecisionState | null> {
  if (!game.user?.isGM) return null;

  const session = SessionStore.load();
  const decision = session.decision;
  if (!decision || decision.status !== "voting") return null;

  if (!force && !allVoted(decision)) {
    ui.notifications?.warn(
      game.i18n.localize(
        Object.keys(decision.votes).length === 0
          ? "FSD.StoryDecision.NoVotesYet"
          : "FSD.StoryDecision.NotEveryoneVoted",
      ),
    );
    return null;
  }

  const resolved: DecisionState = {
    ...decision,
    status: "resolved",
    winnerOptionId: resolveWinner(decision),
  };
  await SessionStore.save({ ...session, decision: resolved });
  return resolved;
}

/** GM: dismiss a resolved (or abandon a live) decision, closing it for everyone. */
export async function clearDecision(): Promise<void> {
  if (!game.user?.isGM) return;
  const session = SessionStore.load();
  await SessionStore.save({ ...session, decision: null });
}

/**
 * Cast *this client's own* vote, GM included.
 *
 * A socket emit never loops back to its own sender (see `socket.ts`), so the
 * GM clicking a tile can't just call `emitDecisionVote` like a player does —
 * nothing on their own client would ever receive it. The GM writes straight
 * through `castVote` instead; everyone else goes over the wire as usual.
 */
export function voteAsMe(optionId: string): void {
  const userId = game.user?.id;
  if (!userId) return;
  if (game.user?.isGM) void castVote(userId, optionId);
  else emitDecisionVote(optionId);
}

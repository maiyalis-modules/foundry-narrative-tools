import type { DeckEngine } from "../engine/deck-engine.js";
import type { ActivePlay } from "../models/session.js";
import { CardPromptApp } from "../ui/card-prompt-app.js";
import { SessionStore } from "../stores/session-store.js";
import { DEFAULT_REQUIRED_PLAYERS } from "../constants.js";
import { getUsers, onlinePlayerCount, userName } from "./foundry-users.js";
import type { PlayService } from "./play-service.js";
import { releasePortraitAfterAnswer, spotlightPortraits } from "./portrait-bridge.js";
import { emitPromptCard, type PromptPayload } from "./socket.js";
import { buildTokenContext } from "./token-context.js";
import { escapeHtml } from "../utils/escape-html.js";

/**
 * Orchestrates the GM-directed card-play flow:
 *   1. GM picks an online player (warns if none),
 *   2. that step is assigned + sent to the player's client as a resolved prompt,
 *   3. the answer syncs back, is recorded, and announced,
 *   4. the GM can prompt the next step (repeat) or finish.
 */

/** Connected, non-GM users — the players who can be handed a card. */
export function getOnlinePlayers(): { id: string; name: string }[] {
  return getUsers()
    .filter((u) => u.active && !u.isGM)
    .map((u) => ({ id: u.id, name: u.name }));
}

/** GM side: start playing a card, prompting the first step's player. */
export async function startCardPlay(
  engine: DeckEngine | null,
  playService: PlayService | null,
  cardId: string,
): Promise<void> {
  if (!engine || !playService) return;
  const card = engine.getCard(cardId);
  if (!card) return;

  // A card is already running. Starting another would silently discard its
  // answers, so refuse rather than clobber it.
  if (SessionStore.load().active) {
    ui.notifications?.warn(game.i18n.localize("FSD.CardAlreadyActive"));
    return;
  }

  // This card needs more players than are online — it can't hand the spotlight
  // around as designed, so refuse rather than strand it mid-card.
  const required = card.requiredPlayers ?? DEFAULT_REQUIRED_PLAYERS;
  if (onlinePlayerCount() < required) {
    ui.notifications?.warn(game.i18n.format("FSD.NotEnoughPlayers", { count: required }));
    return;
  }

  const playerId = await selectPlayer(game.i18n.format("FSD.PlayCardSelect", { title: card.title }));
  if (!playerId) return;

  // The world can move on while the picker sits open — the GM may have started,
  // skipped, or ended something behind it. Re-check before acting on a stale pick.
  if (SessionStore.load().active) return;

  await playService.startPlay(cardId, playerId);
  sendPrompt(engine, playerId);
}

/**
 * GM side: advance to the next step and prompt its player.
 *
 * The next step declares how its speaker is chosen; that step's `prompt` (whether
 * a GM note or the criterion the previous player just followed) is what the GM's
 * picker shows.
 */
export async function promptNextStep(
  engine: DeckEngine | null,
  playService: PlayService | null,
): Promise<void> {
  const active = SessionStore.load().active;
  if (!active || !playService || !engine) return;
  const card = engine.getCard(active.cardId);
  if (!card || active.stepIndex + 1 >= card.steps.length) return;

  const nextStep = engine.getStep(active.cardId, active.stepIndex + 1);
  const prompt = nextStep ? engine.renderPrompt(nextStep, buildTokenContext(active)) : "";
  const playerId = await selectPlayer(prompt || game.i18n.localize("FSD.PromptNextSelect"));
  if (!playerId) return;

  await playService.promptNextStep(playerId);
  sendPrompt(engine, playerId);
}

/** Target-player side: open the card popup from a resolved payload. */
export function showCardPrompt(prompt: PromptPayload): void {
  new CardPromptApp(prompt).render(true);
}

/** GM side: persist the player's answer and announce it. */
export async function recordCardResponse(
  playService: PlayService,
  engine: DeckEngine | null,
  userId: string,
  cardId: string,
  _stepIndex: number,
  value: string,
  nextPlayerId: string | null = null,
): Promise<void> {
  await playService.recordStepResponse(userId, value);
  // Their turn is done — let their portrait linger briefly, then lower it.
  releasePortraitAfterAnswer(userId);
  const card = engine?.getCard(cardId);
  ui.notifications?.info(
    game.i18n.format("FSD.PlayerAnswered", {
      name: userName(userId),
      title: card?.title ?? cardId,
      answer: value,
    }),
  );

  // If this speaker chose who answers next (a `chosen_by_previous` hand-off), the
  // spotlight passes straight to that player — no detour back through the GM. The
  // GM's window still re-renders off the resulting session write.
  if (nextPlayerId && engine) await passSpotlightTo(engine, playService, nextPlayerId);
}

/**
 * Advance to the next step and prompt the player the previous speaker chose,
 * provided that step really is a player-chosen hand-off and the pick is still a
 * connected player. Anything off (they logged off, the next step is GM-chosen)
 * falls back to the GM's manual **Prompt Next** control.
 */
async function passSpotlightTo(
  engine: DeckEngine,
  playService: PlayService,
  nextPlayerId: string,
): Promise<void> {
  const active = SessionStore.load().active;
  if (!active) return;
  const nextStep = engine.getStep(active.cardId, active.stepIndex + 1);
  if (!nextStep || !engine.chosenByPreviousPlayer(nextStep)) return;

  if (!getOnlinePlayers().some((p) => p.id === nextPlayerId)) {
    ui.notifications?.warn(
      game.i18n.format("FSD.HandoffOffline", { name: userName(nextPlayerId) }),
    );
    return;
  }

  await playService.promptNextStep(nextPlayerId);
  sendPrompt(engine, nextPlayerId);
}

// --- internals --------------------------------------------------------------

/**
 * Build the resolved prompt for the active step and send it to a player.
 *
 * This is the one place the spotlight actually lands on someone, so it is also
 * where the optional portrait integration is driven from.
 */
function sendPrompt(engine: DeckEngine, playerId: string): void {
  const active = SessionStore.load().active;
  if (!active) return;
  const payload = buildPromptPayload(engine, active);
  if (payload) emitPromptCard(playerId, payload);
  void spotlightPortraits([playerId]);
  ui.notifications?.info(
    game.i18n.format("FSD.CardSentTo", { name: userName(playerId), title: payload?.cardTitle ?? "" }),
  );
}

function buildPromptPayload(engine: DeckEngine, active: ActivePlay): PromptPayload | null {
  const card = engine.getCard(active.cardId);
  const step = engine.getStep(active.cardId, active.stepIndex);
  if (!card || !step) return null;
  const ctx = buildTokenContext(active);

  // If the *next* step is chosen by the previous player, this answerer makes that
  // pick — so show them its criterion and the players they can pass to. If the next
  // step is GM-chosen (or the card ends here), the player sees no hand-off line.
  const nextStep = engine.getStep(active.cardId, active.stepIndex + 1);
  const isPlayerHandoff = nextStep !== undefined && engine.chosenByPreviousPlayer(nextStep);
  const handoff = isPlayerHandoff ? engine.renderPrompt(nextStep!, ctx) : "";

  // The current speaker can pass to anyone online but themselves. Computed here on
  // the GM so the player's popup stays a self-contained payload.
  const currentPlayerId = active.participants[step.participant.role]?.[0];
  const handoffCandidates = isPlayerHandoff
    ? getOnlinePlayers().filter((p) => p.id !== currentPlayerId)
    : [];

  return {
    cardId: active.cardId,
    cardTitle: card.title,
    stepIndex: active.stepIndex,
    setup: engine.renderSetup(step, ctx),
    question: engine.renderQuestion(step, ctx),
    handoff,
    handoffCandidates,
  };
}

/**
 * Only one player picker may be open at a time.
 *
 * Several controls can ask for one (the run list, the card window, prompt-next),
 * and a second dialog stacked on the first is left stranded once the card it was
 * asking about has already been played.
 */
let pickerOpen = false;

/** Show the GM a dialog to pick an online player. Warns + returns null if none. */
async function selectPlayer(promptText: string): Promise<string | null> {
  if (pickerOpen) return null;

  const players = getOnlinePlayers();
  if (players.length === 0) {
    ui.notifications?.warn(game.i18n.localize("FSD.NoOnlinePlayers"));
    return null;
  }
  const options = players
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
    .join("");
  const content = `<p>${escapeHtml(promptText)}</p>
    <select name="player" style="width: 100%;">${options}</select>`;
  pickerOpen = true;
  try {
    const chosen = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("FSD.PlayCardTitle") },
      content,
      ok: {
        label: game.i18n.localize("FSD.Play"),
        icon: "fa-solid fa-paper-plane",
        callback: (_event: Event, button: { form: HTMLFormElement }) =>
          (button.form.elements.namedItem("player") as HTMLSelectElement | null)?.value ?? null,
      },
      rejectClose: false,
    });
    return (chosen as string | null) ?? null;
  } catch {
    return null;
  } finally {
    pickerOpen = false;
  }
}


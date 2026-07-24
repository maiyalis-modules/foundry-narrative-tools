import type { DeckEngine } from "../engine/deck-engine.js";
import { SessionStore } from "../stores/session-store.js";

/**
 * GM-authoritative controller for the card-play loop. Every method mutates the
 * shared session and persists it via `SessionStore.save()` — which only succeeds
 * on a GM client (Foundry restricts world-setting writes to GMs). The persisted
 * change fires `updateSetting` on every client, driving the synchronized re-render.
 *
 * The flow is GM-paced and GM-directed: the GM picks which player answers each
 * step (see `card-prompt.ts`); this service just records the resulting state.
 */
export class PlayService {
  constructor(private engine: DeckEngine) {}

  setEngine(engine: DeckEngine): void {
    this.engine = engine;
  }

  /** Begin playing a card, assigning its first step to the chosen player. */
  async startPlay(cardId: string, playerId: string): Promise<void> {
    if (!this.engine.getCard(cardId)) return;
    const role = this.engine.getStep(cardId, 0)?.participant.role ?? "primary";
    const session = SessionStore.load();
    session.active = {
      cardId,
      stepIndex: 0,
      participants: { [role]: [playerId] },
      responses: [],
    };
    await SessionStore.save(session);
  }

  /** Advance to the next step and assign it to the chosen player. */
  async promptNextStep(playerId: string): Promise<void> {
    const session = SessionStore.load();
    const active = session.active;
    if (!active) return;
    const nextIndex = active.stepIndex + 1;
    const step = this.engine.getStep(active.cardId, nextIndex);
    if (!step) return;
    active.stepIndex = nextIndex;
    active.participants[step.participant.role] = [playerId];
    await SessionStore.save(session);
  }

  /** Record a player's answer for the current step (each step has exactly one). */
  async recordStepResponse(userId: string, value: string): Promise<void> {
    const session = SessionStore.load();
    const active = session.active;
    if (!active) return;
    active.responses = active.responses.filter((r) => r.stepIndex !== active.stepIndex);
    active.responses.push({
      cardId: active.cardId,
      stepIndex: active.stepIndex,
      userId,
      value,
      timestamp: Date.now(),
    });
    await SessionStore.save(session);
  }

  /**
   * Complete the active card: snapshot it onto the run (if any), log it (into
   * `results`), and clear the active play.
   *
   * Returns the finished card's id so a caller running a Story Deck can advance
   * the run — this service deliberately knows nothing about the run's progression.
   */
  async finish(): Promise<string | null> {
    const session = SessionStore.load();
    const active = session.active;
    if (!active) return null;
    const card = this.engine.getCard(active.cardId);
    const now = Date.now();

    // The run keeps its own copy of the conversation — the campaign seed. Card
    // outputs ride along as descriptive badges, not as extracted entities.
    if (session.run && card) {
      session.run.cards.push({
        cardId: card.id,
        cardTitle: card.title,
        theme: card.theme,
        phaseId: session.run.phases[session.run.phaseIndex]?.phaseId ?? "",
        outputs: card.outputs ?? [],
        participants: active.participants,
        responses: active.responses,
        completedAt: now,
      });
    }

    // Logged whether or not a Story Deck is running — the Log is the full history.
    session.results.push({
      id: foundry.utils.randomID(),
      cardId: active.cardId,
      title: card?.title ?? active.cardId,
      theme: card?.theme ?? "",
      runId: session.run?.id ?? null,
      phaseId: session.run?.phases[session.run.phaseIndex]?.phaseId ?? null,
      completed: true,
      participants: active.participants,
      responses: active.responses,
      playedAt: now,
    });
    const finishedCardId = active.cardId;
    session.active = null;
    await SessionStore.save(session);
    return finishedCardId;
  }

  /** Abandon the current card without recording a result. */
  async resetActive(): Promise<void> {
    const session = SessionStore.load();
    session.active = null;
    await SessionStore.save(session);
  }

  /** Remove one logged card by its id. */
  async deleteResult(id: string): Promise<void> {
    const session = SessionStore.load();
    session.results = session.results.filter((r) => r.id !== id);
    await SessionStore.save(session);
  }

  /** Empty the entire play log. */
  async clearResults(): Promise<void> {
    const session = SessionStore.load();
    session.results = [];
    await SessionStore.save(session);
  }
}

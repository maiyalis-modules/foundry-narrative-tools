import { matchingCards, selectCards } from "../engine/card-selector.js";
import type { DeckEngine } from "../engine/deck-engine.js";
import type { DeckRun, ResolvedPhase } from "../models/session.js";
import type { StoryCard } from "../models/story-card.js";
import type { DeckPhase, StoryDeckRecipe } from "../models/story-deck-recipe.js";
import { exportRunToJournal } from "./journal-export.js";
import { clearPortraits } from "./portrait-bridge.js";
import { SessionStore } from "../stores/session-store.js";

/**
 * GM-authoritative controller for a Story Deck run.
 *
 * Same contract as `PlayService`: every method mutates the shared session and
 * persists it via `SessionStore.save()`, which only succeeds on a GM client. The
 * write fires `updateSetting` on every client, driving the synchronized re-render.
 *
 * The run decides *which card comes next*; it never changes how a card plays. Card
 * execution stays entirely with `PlayService` / `card-prompt.ts`.
 */
export class DeckRunService {
  constructor(
    private engine: DeckEngine,
    private recipes: StoryDeckRecipe[] = [],
  ) {}

  setEngine(engine: DeckEngine): void {
    this.engine = engine;
  }

  setRecipes(recipes: StoryDeckRecipe[]): void {
    this.recipes = recipes;
  }

  get availableRecipes(): readonly StoryDeckRecipe[] {
    return this.recipes;
  }

  getRecipe(recipeId: string): StoryDeckRecipe | undefined {
    return this.recipes.find((r) => r.id === recipeId);
  }

  /** Begin a Story Deck, opening on its first chapter's intro screen. */
  async startRun(recipeId: string): Promise<void> {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) return;

    const session = SessionStore.load();
    session.run = {
      id: foundry.utils.randomID(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      phaseIndex: 0,
      phases: [
        this.resolvePhase(
          recipe.phases[0]!,
          [],
          recipe.avoidDuplicateCards !== false,
          recipe.phases.slice(1),
        ),
      ],
      status: "phase_intro",
      cards: [],
      startedAt: Date.now(),
      completedAt: null,
      endedEarly: false,
    };
    session.active = null;
    await SessionStore.save(session);
  }

  /** Leave the chapter intro and start presenting that phase's cards. */
  async beginPhase(): Promise<void> {
    const session = SessionStore.load();
    const run = session.run;
    if (!run || run.status !== "phase_intro") return;
    run.status = "playing";
    await SessionStore.save(session);
  }

  /**
   * Record that the current card is done and move the run forward: to the next
   * card, the phase recap, or (after the last phase) completion.
   */
  async cardFinished(cardId: string): Promise<void> {
    const session = SessionStore.load();
    const run = session.run;
    if (!run) return;
    const phase = run.phases[run.phaseIndex];
    if (!phase) return;

    if (!phase.playedCardIds.includes(cardId)) phase.playedCardIds.push(cardId);
    if (phase.playedCardIds.length >= phase.cardIds.length) run.status = "phase_recap";

    await SessionStore.save(session);
  }

  /** Move past the current card without playing it. */
  async skipCard(cardId: string): Promise<void> {
    await this.cardFinished(cardId);
  }

  /** Swap an unplayed card for a different one matching the same phase rules. */
  async replaceCard(cardId: string): Promise<void> {
    const session = SessionStore.load();
    const run = session.run;
    const phase = run?.phases[run.phaseIndex];
    const recipePhase = this.phaseRecipe(run);
    if (!run || !phase || !recipePhase) return;

    const index = phase.cardIds.indexOf(cardId);
    if (index === -1) return;

    // Exclude every card this run has drawn so the swap is genuinely different.
    const replacement = selectCards(this.engine.cards, recipePhase.selection, 1, {
      usedCardIds: this.drawnCardIds(run),
      avoidDuplicates: true,
    });
    const next = replacement.cards[0];
    if (!next) {
      ui.notifications?.warn(game.i18n.localize("FSD.Run.NoReplacement"));
      return;
    }

    phase.cardIds[index] = next.id;
    await SessionStore.save(session);
  }

  /**
   * Cards the GM could substitute into the current phase, split by whether they
   * satisfy the phase's own selection rules.
   *
   * Both groups are offered: the rules express what the phase is *for*, but the
   * deck sets `allowManualSubstitution`, and a GM overriding them deliberately is
   * the whole point of a manual pick.
   */
  candidateCards(): { matching: StoryCard[]; others: StoryCard[] } {
    const run = SessionStore.load().run;
    const phase = run?.phases[run.phaseIndex];
    const recipePhase = this.phaseRecipe(run ?? null);
    if (!run || !phase || !recipePhase) return { matching: [], others: [] };

    const drawn = new Set(this.drawnCardIds(run));
    const available = this.engine.cards.filter((c) => !drawn.has(c.id));
    const matchIds = new Set(
      matchingCards(available, recipePhase.selection).map((c) => c.id),
    );

    return {
      matching: available.filter((c) => matchIds.has(c.id)),
      others: available.filter((c) => !matchIds.has(c.id)),
    };
  }

  /**
   * Put a specific card into the current phase — replacing `replacingCardId` if
   * given, otherwise appended to the end.
   */
  async chooseCard(cardId: string, replacingCardId?: string): Promise<void> {
    const session = SessionStore.load();
    const run = session.run;
    const phase = run?.phases[run.phaseIndex];
    if (!run || !phase) return;
    if (!this.engine.getCard(cardId)) return;
    // Never let the same card appear twice in one phase.
    if (phase.cardIds.includes(cardId)) return;

    if (replacingCardId) {
      // Swapping the card that's mid-play would strand its answers.
      if (session.active?.cardId === replacingCardId) return;
      const index = phase.cardIds.indexOf(replacingCardId);
      if (index === -1) return;
      if (phase.playedCardIds.includes(replacingCardId)) return;
      phase.cardIds[index] = cardId;
    } else {
      phase.cardIds.push(cardId);
      // Adding during a recap reopens the phase.
      if (run.status === "phase_recap") run.status = "playing";
    }

    await SessionStore.save(session);
  }

  /** Append one more matching card to the current phase. */
  async drawAnother(): Promise<void> {
    const session = SessionStore.load();
    const run = session.run;
    const phase = run?.phases[run.phaseIndex];
    const recipePhase = this.phaseRecipe(run);
    if (!run || !phase || !recipePhase) return;

    const drawn = selectCards(this.engine.cards, recipePhase.selection, 1, {
      usedCardIds: this.drawnCardIds(run),
      avoidDuplicates: true,
    });
    const next = drawn.cards[0];
    if (!next) {
      ui.notifications?.warn(game.i18n.localize("FSD.Run.NoMoreCards"));
      return;
    }

    phase.cardIds.push(next.id);
    // Drawing during a recap reopens the phase.
    if (run.status === "phase_recap") run.status = "playing";
    await SessionStore.save(session);
  }

  /** Advance from a phase recap to the next chapter, or finish the run. */
  async nextPhase(): Promise<void> {
    const session = SessionStore.load();
    const run = session.run;
    if (!run) return;
    const recipe = this.getRecipe(run.recipeId);
    if (!recipe) return;

    const nextIndex = run.phaseIndex + 1;
    const nextPhase = recipe.phases[nextIndex];
    if (!nextPhase) {
      this.completeRun(session, run, false);
      await SessionStore.save(session);
      await exportRunToJournal(this.engine, run, session.results);
      return;
    }

    run.phaseIndex = nextIndex;
    run.phases.push(
      this.resolvePhase(
        nextPhase,
        this.drawnCardIds(run),
        recipe.avoidDuplicateCards !== false,
        recipe.phases.slice(nextIndex + 1),
      ),
    );
    run.status = "phase_intro";
    await SessionStore.save(session);
  }

  /** Stop the run early, keeping everything created so far. */
  async endRun(): Promise<void> {
    const session = SessionStore.load();
    const run = session.run;
    if (!run) return;
    this.completeRun(session, run, true);
    await SessionStore.save(session);
    // Ending mid-card can leave a spotlight portrait up.
    await clearPortraits();
    // A run ended early is still worth keeping — export what the group did build.
    await exportRunToJournal(this.engine, run, session.results);
  }

  /** Delete a finished run from the history. */
  async deleteRun(runId: string): Promise<void> {
    const session = SessionStore.load();
    session.runs = session.runs.filter((r) => r.id !== runId);
    await SessionStore.save(session);
  }

  // --- internals ------------------------------------------------------------

  /** Move the run into `runs`, clearing it as the active run. */
  private completeRun(
    session: { run: DeckRun | null; runs: DeckRun[]; active: unknown },
    run: DeckRun,
    early: boolean,
  ): void {
    run.status = "completed";
    run.completedAt = Date.now();
    run.endedEarly = early;
    session.runs.push(run);
    session.run = null;
    session.active = null;
  }

  /** Draw the cards for one phase of the recipe. */
  private resolvePhase(
    phase: DeckPhase,
    usedCardIds: string[],
    avoidDuplicates: boolean,
    upcoming: DeckPhase[] = [],
  ): ResolvedPhase {
    const result = selectCards(this.engine.cards, phase.selection, phase.count, {
      usedCardIds,
      avoidDuplicates,
      upcoming: upcoming.map((p) => ({ selection: p.selection, count: p.count })),
    });
    return {
      phaseId: phase.id,
      name: phase.name,
      description: phase.description,
      cardIds: result.cards.map((c) => c.id),
      playedCardIds: [],
      short: result.short,
    };
  }

  /** The recipe definition backing the run's current phase. */
  private phaseRecipe(run: DeckRun | null): DeckPhase | undefined {
    if (!run) return undefined;
    return this.getRecipe(run.recipeId)?.phases[run.phaseIndex];
  }

  /** Every card this run has drawn, across all phases. */
  private drawnCardIds(run: DeckRun): string[] {
    return run.phases.flatMap((p) => p.cardIds);
  }
}

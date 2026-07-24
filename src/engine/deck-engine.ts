import type { CardStep, StoryCard, CardLibrary } from "../models/story-card.js";
import { resolveTokens, type TokenContext } from "./token-resolver.js";

/**
 * The DeckEngine executes cards. It is intentionally free of any FoundryVTT
 * dependency so it can be unit-tested in isolation and reused outside the VTT.
 *
 * It knows how to:
 *   - walk the sequential steps of a card,
 *   - resolve `{{token}}` placeholders in step text.
 *
 * It does NOT know what any card means — all content lives in JSON.
 */
export class DeckEngine {
  constructor(private readonly library: CardLibrary) {}

  get title(): string {
    return this.library.title;
  }

  get description(): string {
    return this.library.description ?? "";
  }

  get cards(): readonly StoryCard[] {
    return this.library.cards;
  }

  getCard(cardId: string): StoryCard | undefined {
    return this.library.cards.find((c) => c.id === cardId);
  }

  /** Cards on a given theme. */
  cardsByTheme(theme: string): StoryCard[] {
    return this.library.cards.filter((c) => c.theme === theme);
  }

  /** Retrieve a specific step of a card, or `undefined` if out of range. */
  getStep(cardId: string, stepIndex: number): CardStep | undefined {
    return this.getCard(cardId)?.steps[stepIndex];
  }

  /** Resolve the setup text of a step against the current token context. */
  renderSetup(step: CardStep, context: TokenContext = {}): string {
    return resolveTokens(step.setup, context);
  }

  /** Resolve a step's question against the current token context. */
  renderQuestion(step: CardStep, context: TokenContext = {}): string {
    return resolveTokens(step.question, context);
  }

  /** Resolve a step's participant prompt (how its speaker is chosen), or "". */
  renderPrompt(step: CardStep, context: TokenContext = {}): string {
    return step.participant.prompt ? resolveTokens(step.participant.prompt, context) : "";
  }

  /**
   * Whether a step's speaker is chosen by the previous player (so its prompt is
   * shown to them) rather than by the GM.
   */
  chosenByPreviousPlayer(step: CardStep): boolean {
    return step.participant.selection === "chosen_by_previous";
  }

  /** Resolve arbitrary card text against the current token context. */
  renderText(text: string, context: TokenContext = {}): string {
    return resolveTokens(text, context);
  }
}

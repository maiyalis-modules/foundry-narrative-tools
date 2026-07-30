/**
 * Type definitions for a **Story Deck** — the user-facing concept.
 *
 * A Story Deck is not a collection of cards. It is a *recipe* that guides a group
 * through a structured storytelling experience: which cards get presented, in what
 * order, and for what purpose. It never contains card content; it only references
 * the card library through selection rules.
 */

/**
 * Rules for picking cards out of the library.
 *
 * Deliberately **open-ended**: the known keys below are the ones the selector
 * understands today, but any additional key is preserved and handed to the matcher
 * registry in `card-selector.ts`. Adding a future filter (difficulty, tone, campaign
 * tier, estimated duration…) means registering one matcher — no changes to this
 * type, the recipe format, or the runtime.
 */
export interface CardSelection {
  /** How cards are drawn from the matching pool. Only `random` exists today. */
  mode?: "random";
  /** Quantifier applied *within* each filter: `any` = at least one listed value
   *  matches, `all` = every listed value must be present. Fields are always ANDed. */
  match?: "any" | "all";
  themes?: string[];
  scopes?: string[];
  outputs?: string[];
  tags?: string[];
  excludeCardIds?: string[];
  /** @deprecated Alias for `themes`, kept so older recipes still resolve. */
  categories?: string[];
  /** Prefer cards not yet played in this run before reusing any. */
  preferUnused?: boolean;
  /** Future filters live here untouched until a matcher is registered for them. */
  [key: string]: unknown;
}

/** One chapter of a Story Deck. */
export interface DeckPhase {
  id: string;
  name: string;
  description: string;
  /** How many cards this phase should present. */
  count: number;
  selection: CardSelection;
}

/** What happens when every phase is done. */
export interface DeckCompletion {
  summaryPrompt?: string;
  saveOutputsAsCampaignSeed?: boolean;
  campaignSeedTitle?: string;
}

export interface StoryDeckRecipe {
  id: string;
  name: string;
  description: string;
  /** `premade` ships with the module; `custom` was built by a GM. */
  type: "premade" | "custom";
  /** How many players must be online before this deck can be started — a hard gate,
   *  distinct from the advisory `minPlayers`/`maxPlayers` ideal-table range. Party
   *  decks default to 2; a solo/downtime deck may set 1. Defaults to 2 when omitted. */
  requiredPlayers?: number;
  /** Advisory ideal-table range shown as "3–6 players"; not a gate. */
  minPlayers?: number;
  maxPlayers?: number;
  expectedCards?: number;
  allowManualSubstitution?: boolean;
  allowReordering?: boolean;
  avoidDuplicateCards?: boolean;
  /** When you'd reach for this deck — used to filter the deck list. */
  tags?: string[];
  /** Guidance shown to the GM before the deck starts. */
  facilitatorNotes?: string[];
  /** What this deck is trying to achieve — shown as bullets on its detail page. */
  focus?: string[];
  phases: DeckPhase[];
  completion?: DeckCompletion;
}

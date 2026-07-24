/**
 * Runtime session state — the campaign seed being assembled as players work
 * through cards. This is what gets persisted (Phase 1) and eventually exported
 * (Phase 2).
 */

/** The single answer captured for one step, keyed by its position in the card. */
export interface StepResponse {
  cardId: string;
  stepIndex: number;
  /** The user who supplied the answer. */
  userId: string;
  value: unknown;
  timestamp: number;
}

/** Progress + collected data for one card that has been played (a log entry). */
export interface CardResult {
  /** Unique id for this play (for list keys, opening, and deletion). */
  id: string;
  cardId: string;
  /** Snapshot of the card's title/theme, so the log lists even if the deck changes. */
  title: string;
  theme: string;
  /** The Story Deck run this card was played in, or `null` if played standalone. */
  runId: string | null;
  /** The run phase it belonged to, for grouping in the exported journal. */
  phaseId: string | null;
  completed: boolean;
  /** Participant user ids resolved per role, keyed by role name. */
  participants: Record<string, string[]>;
  responses: StepResponse[];
  /** When the card finished, as an epoch millisecond timestamp. */
  playedAt: number;
}

/**
 * A finished card captured onto its run.
 *
 * Schema v3 does not classify outputs per step, so the "campaign seed" is not a
 * list of typed entities — it is the conversation itself. This snapshots what the
 * table said, self-contained so it survives log clearing and outlives the card
 * even if the library changes. Turning any of it into Foundry documents stays a
 * deliberate GM action.
 */
export interface RunCardRecord {
  cardId: string;
  cardTitle: string;
  theme: string;
  phaseId: string;
  /** Descriptive badges — what kinds of thing the card is about. */
  outputs: string[];
  participants: Record<string, string[]>;
  responses: StepResponse[];
  completedAt: number;
}

/** A phase of a run, once its cards have been drawn. */
export interface ResolvedPhase {
  phaseId: string;
  name: string;
  description: string;
  /** The cards drawn for this phase, in play order. */
  cardIds: string[];
  /** Cards already finished (or skipped) within this phase. */
  playedCardIds: string[];
  /** True when the library could not supply the phase's full card count. */
  short: boolean;
}

/** Where a run currently sits: between chapters, mid-chapter, or done. */
export type RunStatus = "phase_intro" | "playing" | "phase_recap" | "completed";

/**
 * A Story Deck being played through — the recipe's phases resolved into actual
 * cards, plus everything created along the way.
 *
 * Phases are resolved lazily (one at a time, at "Begin Phase") so that card
 * selection accounts for what was really played, including GM skips and swaps.
 */
export interface DeckRun {
  id: string;
  recipeId: string;
  recipeName: string;
  /** Index into `phases` of the chapter currently showing. */
  phaseIndex: number;
  phases: ResolvedPhase[];
  status: RunStatus;
  /** Every card the run has finished, in play order — the campaign seed. */
  cards: RunCardRecord[];
  startedAt: number;
  completedAt: number | null;
  /** True when the GM ended the run before its last phase finished. */
  endedEarly: boolean;
}

/**
 * The card currently being played. There is at most one active card at a time;
 * when its last step completes it is folded into `results` and cleared.
 */
export interface ActivePlay {
  cardId: string;
  stepIndex: number;
  /** Resolved participant user ids per role, accumulated across the card's steps. */
  participants: Record<string, string[]>;
  /** Responses collected so far for this card (across all its steps). */
  responses: StepResponse[];
}

/** The full, persistable session document. */
export interface StoryDeckSession {
  /** Schema version for forward-compatible migrations. */
  version: number;
  /** Current stage the group is working through. */
  stage: string | null;
  /** The card currently in play, or `null` when browsing. */
  active: ActivePlay | null;
  /** The Story Deck being played through, or `null` when none is running. */
  run: DeckRun | null;
  /** Finished (or abandoned) Story Deck runs. */
  runs: DeckRun[];
  results: CardResult[];
}

export function createEmptySession(): StoryDeckSession {
  return {
    version: 4,
    stage: null,
    active: null,
    run: null,
    runs: [],
    results: [],
  };
}

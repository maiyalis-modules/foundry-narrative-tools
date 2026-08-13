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

/**
 * One connection question answered for someone else's character.
 *
 * Kept flat (rather than nested under the asker) so it serializes cleanly into
 * the world setting and so the "who has answered how much tonight" tally is a
 * single pass, regardless of whose sheet the answers landed on.
 */
export interface ConnectionAnswerRecord {
  /** The actor whose sheet the question belongs to — the one being asked *about*. */
  actorId: string;
  /** Position of the question within that sheet's parsed connections blob. */
  questionIndex: number;
  /** Snapshot of the question text, so the record still reads if the blob changes. */
  question: string;
  /** The player who owns the character and chose who would answer. */
  askerUserId: string;
  /** The player who wrote the answer. */
  answererUserId: string;
  answer: string;
  answeredAt: number;
}

/**
 * The connection question currently out for an answer.
 *
 * Two-stage: the GM starts a question and the asker picks a responder
 * (`answererUserId` still null), then that responder writes the answer. Holding
 * both stages in one record means a reload mid-question doesn't lose track of
 * which half of the hand-off is outstanding.
 */
export interface PendingConnection {
  actorId: string;
  askerUserId: string;
  questionIndex: number;
  question: string;
  /** Set once the asker has chosen; `null` while their picker is still open. */
  answererUserId: string | null;
}

/**
 * A connections round in progress.
 *
 * Deliberately a nullable object rather than a boolean: "is the round running"
 * and "when did it start" are the same question, and a run of the round is the
 * thing the HUD and the announcement banner are about — the same shape a
 * `DeckRun` plays for a Story Deck.
 */
export interface ConnectionsRound {
  startedAt: number;
}

/** Everything the connections round has produced, plus what it's waiting on. */
export interface ConnectionsState {
  /** The round currently running, or `null` between rounds. */
  round: ConnectionsRound | null;
  answers: ConnectionAnswerRecord[];
  pending: PendingConnection | null;
}

export function emptyConnections(): ConnectionsState {
  return { round: null, answers: [], pending: null };
}

/** One choice the table can pick between in a Story Decision. */
export interface DecisionOption {
  id: string;
  title: string;
  description: string;
  image: string;
}

/** How the table settles on one of a Story Decision's options. */
export type DecisionType = "single" | "groupMajority" | "groupRandom";

/**
 * A Story Decision open for voting, or just resolved — see
 * `services/decision-service.ts`. Nullable rather than a boolean for the same
 * reason `ConnectionsRound` is: "is one running" and "what is it" are the same
 * question.
 */
export interface DecisionState {
  /** Distinguishes one Ask from the next — a late joiner's client uses it to
   *  tell "already saw this one resolved" apart from "never started". */
  id: string;
  title: string;
  description: string;
  options: DecisionOption[];
  type: DecisionType;
  /** Only meaningful when `type` is `"single"`. */
  singlePlayerId: string;
  /** userId → optionId, as votes come in. Visible to the whole table live —
   *  this isn't a secret ballot. */
  votes: Record<string, string>;
  status: "voting" | "resolved";
  /** Set once resolved (`endVoting()` in `decision-service.ts`). */
  winnerOptionId: string | null;
}

/**
 * One record of a player being designated the chooser for a `"single"`
 * decision — an append-only log rather than a running tally, so both the
 * "today" and lifetime counts `singleChooserCounts()` reports (see
 * `decision-service.ts`) are always a plain filter over the same source
 * rather than two numbers that could drift apart.
 */
export interface SingleChooserRecord {
  userId: string;
  /** Calendar-day key ("2026-08-13") — see `utils/session-date.ts`. Decisions
   *  made the same day count as the same "session" for fairness purposes. */
  sessionKey: string;
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
  /** The Daggerheart connections round — see `services/connections-service.ts`. */
  connections: ConnectionsState;
  /** The Story Decision currently open for voting (or just resolved), or
   *  `null` between asks. See `services/decision-service.ts`. */
  decision: DecisionState | null;
  /** Every time a player has been asked to make a `"single"` decision — see
   *  `services/decision-service.ts`'s `singleChooserCounts()`. */
  singleChooserLog: SingleChooserRecord[];
}

export function createEmptySession(): StoryDeckSession {
  return {
    version: 7,
    stage: null,
    active: null,
    run: null,
    runs: [],
    results: [],
    connections: emptyConnections(),
    decision: null,
    singleChooserLog: [],
  };
}

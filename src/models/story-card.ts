/**
 * Type definitions describing the JSON shape of a Story Card (schema v3).
 *
 * These mirror `schemas/story-card.schema.json`. The engine is generic: it
 * executes whatever these structures describe and knows nothing about the
 * contents of any particular card.
 *
 * A card is a *guided conversation*, not a questionnaire: each step names one
 * player, asks a single open question, then passes the spotlight to a *different*
 * player. The player who just answered never answers the next question. The GM
 * facilitates but never supplies content.
 */

/**
 * Who chooses the player that answers a step.
 *
 * This is the single source of truth for every spotlight handoff — there is no
 * separate "pass" field. Whether the instruction is shown to a player follows
 * directly from this: `chosen_by_previous` is shown to the previous speaker (they
 * make the pick); `gm_selects_player` is a GM-only decision.
 */
export type ParticipantSelection =
  /** The GM picks this speaker. Always used for the opening step; used mid-card
   *  when the choice is the GM's call rather than the previous player's. */
  | "gm_selects_player"
  /** The player who just answered picks this speaker (a natural in-fiction handoff). */
  | "chosen_by_previous";

/** The role a participant plays within a single card. */
export type ParticipantRole =
  | "primary"
  | "secondary"
  | "tertiary"
  | "quaternary"
  | "group";

export interface CardParticipant {
  role: ParticipantRole;
  selection: ParticipantSelection;
  /** Guidance for whoever chooses this speaker ("Choose a player who witnessed…").
   *  Shown to the previous player when `chosen_by_previous`; a GM-only note when
   *  `gm_selects_player`. May contain `{{token}}` placeholders. Omitted on the
   *  opening step, where the GM simply picks. */
  prompt?: string;
}

export interface CardStep {
  participant: CardParticipant;
  /** Framing text shown before the question. May contain `{{token}}` placeholders. */
  setup: string;
  /** The single open question this step's player answers. May contain `{{token}}`s. */
  question: string;
}

export interface StoryCard {
  id: string;
  title: string;
  /** What the conversation is *about* (relationships, politics, history…). One per card. */
  theme: string;
  /** How broadly the subject affects the world (personal → global). One per card. */
  scope: string;
  /** How many players must be online for this card to be played. A card is a
   *  guided hand-off between players, so the floor is 2; solo (personal) cards may
   *  set 1, and ensemble cards 3+. Defaults to 2 when omitted. */
  requiredPlayers?: number;
  /** The campaign elements this card creates — descriptive metadata for selection
   *  and guidance, not a per-answer mapping. Turning answers into Foundry
   *  documents is always a deliberate GM action. */
  outputs?: string[];
  /** The nature of the discussion — used for filtering and Story Deck construction. */
  tags?: string[];
  /** Between 2 and 5 steps; every step passes the spotlight to a *different* player. */
  steps: CardStep[];
  /** Optional freeform metadata; ignored by the engine. */
  metadata?: Record<string, unknown>;
}

/** How spotlight management works for a deck — behavioural rules for card authors. */
export interface SpotlightRules {
  gmAnswersQuestions?: boolean;
  gmSelectsOnlyFirstPlayer?: boolean;
  everyStepExplicitlyPassesSpotlight?: boolean;
  spotlightMayReturnToPreviousPlayer?: boolean;
}

/**
 * A loaded collection of cards.
 *
 * Note this is *not* a "Story Deck" in the user-facing sense — a Story Deck is a
 * recipe that selects from this library (see `story-deck-recipe.ts`). The library
 * is just the pool of cards available to draw from.
 */
export interface CardLibrary {
  id: string;
  title: string;
  description?: string;
  spotlightRules?: SpotlightRules;
  cards: StoryCard[];
}

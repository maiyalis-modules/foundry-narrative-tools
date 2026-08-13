/** Shared, immutable identifiers for the module. */

export const MODULE_ID = "foundry-story-deck" as const;
export const MODULE_TITLE = "Maiyalis: Narrative Tools" as const;

/** Prefix used for all console logging so output is easy to filter. */
export const LOG_PREFIX = `${MODULE_TITLE} |` as const;

/** Socket event name (see `socket: true` in module.json). */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;

/** Journal folder that completed Story Deck runs are written into. */
export const JOURNAL_FOLDER = "Story Decks" as const;

/** Journal folder that resolved Story Decisions are written into. */
export const DECISIONS_JOURNAL_FOLDER = "Story Decisions" as const;

/** Players a card or deck needs online when it doesn't declare `requiredPlayers`.
 *  A card is a hand-off between players, so two is the working floor. */
export const DEFAULT_REQUIRED_PLAYERS = 2 as const;

/** The only system whose character sheet the connections round knows how to read. */
export const DAGGERHEART_SYSTEM_ID = "daggerheart" as const;

/**
 * The connections field on a Daggerheart character, as a *suffix*.
 *
 * The sheet builds its editor from `system.schema.getField("biography.connections")`,
 * so whether the rendered input is named with or without the leading `system.`
 * depends on how the sheet prefixes it. Matching on the suffix covers both and
 * survives that detail changing.
 */
export const CONNECTIONS_FIELD = "biography.connections" as const;

/** Setting keys, kept in one place to avoid typos across the codebase. */
export const SETTINGS = {
  /** Persisted in-progress session state (the campaign seed being built). */
  session: "session",
  /** Whether to show the launch button in the Journal sidebar. */
  showJournalButton: "showJournalButton",
  /** Whether the GM's session HUD sits on screen (their shortcut into the window). */
  showGMHud: "showGMHud",
  /** GM-authored Story Deck recipes (written by the future deck editor). */
  customDecks: "customDecks",
  /** Raise the spotlighted player's portrait via the ginzzzu-portraits module. */
  portraitSpotlight: "portraitSpotlight",
  /** Whether the spotlight shows one portrait at a time or lets them accumulate. */
  portraitSpotlightSolo: "portraitSpotlightSolo",
  /** Run the Daggerheart connections round (and lock the sheet field while on). */
  connections: "connections",
} as const;

/**
 * Settings-menu keys (buttons that open a window instead of a flat control).
 * Listed in registration order — mirrors how Maiyalis: Utility Suite organizes
 * its own settings. No entry opens the main Story Deck window itself; the
 * Journal-sidebar launch button and the module API cover that already.
 */
export const MENUS = {
  /** Opens the (untabbed) Story Decks settings window. */
  storyDecksConfig: "storyDecksConfigMenu",
  /** Opens the (placeholder) Story Decisions settings window. */
  storyDecisionsConfig: "storyDecisionsConfigMenu",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  storyDeck: `modules/${MODULE_ID}/templates/story-deck.hbs`,
  cardWindow: `modules/${MODULE_ID}/templates/card-window.hbs`,
  cardPrompt: `modules/${MODULE_ID}/templates/card-prompt.hbs`,
  sessionStatus: `modules/${MODULE_ID}/templates/session-status.hbs`,
  /** Body of the (untabbed) Story Decks settings window. */
  storyDecksConfig: `modules/${MODULE_ID}/templates/story-decks-config.hbs`,
  /** Body of the (placeholder) Story Decisions settings window. */
  storyDecisionsConfig: `modules/${MODULE_ID}/templates/story-decisions-config.hbs`,
  /** Body of the Story Decision trigger window. */
  storyDecision: `modules/${MODULE_ID}/templates/story-decision.hbs`,
  /** Body of the per-option editor popup opened from the Story Decision window. */
  storyDecisionOption: `modules/${MODULE_ID}/templates/story-decision-option.hbs`,
  /** The full-screen vote presented to the table when a decision is asked. */
  storyDecisionVote: `modules/${MODULE_ID}/templates/story-decision-vote.hbs`,
  /** Save/Cancel bar, shared by settings and editor windows. */
  configFooter: `modules/${MODULE_ID}/templates/config-footer.hbs`,
} as const;

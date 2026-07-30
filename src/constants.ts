/** Shared, immutable identifiers for the module. */

export const MODULE_ID = "foundry-story-deck" as const;
export const MODULE_TITLE = "Eryndor: Story Decks" as const;

/** Prefix used for all console logging so output is easy to filter. */
export const LOG_PREFIX = `${MODULE_TITLE} |` as const;

/** Socket event name (see `socket: true` in module.json). */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;

/** Journal folder that completed Story Deck runs are written into. */
export const JOURNAL_FOLDER = "Story Decks" as const;

/** Players a card or deck needs online when it doesn't declare `requiredPlayers`.
 *  A card is a hand-off between players, so two is the working floor. */
export const DEFAULT_REQUIRED_PLAYERS = 2 as const;

/** Setting keys, kept in one place to avoid typos across the codebase. */
export const SETTINGS = {
  /** Persisted in-progress session state (the campaign seed being built). */
  session: "session",
  /** Whether to show the launch button in the Journal sidebar. */
  showJournalButton: "showJournalButton",
  /** GM-authored Story Deck recipes (written by the future deck editor). */
  customDecks: "customDecks",
  /** Raise the spotlighted player's portrait via the ginzzzu-portraits module. */
  portraitSpotlight: "portraitSpotlight",
  /** Whether the spotlight shows one portrait at a time or lets them accumulate. */
  portraitSpotlightSolo: "portraitSpotlightSolo",
  /** Key for the settings-menu button that opens the Story Deck window. */
  menu: "storyDeckMenu",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  storyDeck: `modules/${MODULE_ID}/templates/story-deck.hbs`,
  cardWindow: `modules/${MODULE_ID}/templates/card-window.hbs`,
  cardPrompt: `modules/${MODULE_ID}/templates/card-prompt.hbs`,
  sessionStatus: `modules/${MODULE_ID}/templates/session-status.hbs`,
} as const;

/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 *
 * Right now this is intentionally light — enough to give the module a visible
 * presence under Configure Settings → Module Settings:
 *   - a menu button that opens the Story Deck window, and
 *   - a single real toggle that gates the Journal-sidebar launch button.
 */
import { MODULE_ID, SETTINGS } from "./constants.js";
import { StoryDeckApp } from "./ui/story-deck-app.js";

export function registerSettings(): void {
  // A button on the settings page that opens the main window. `type` accepts an
  // ApplicationV2 subclass in Foundry v13+, so StoryDeckApp works directly.
  game.settings.registerMenu(MODULE_ID, SETTINGS.menu, {
    name: "FSD.Settings.OpenDeckName",
    label: "FSD.Settings.OpenDeckLabel",
    hint: "FSD.Settings.OpenDeckHint",
    icon: "fa-solid fa-book-sparkles",
    type: StoryDeckApp,
    restricted: true,
  });

  // A simple, real setting so there's an actual control to see. Toggling it
  // shows/hides the Journal-sidebar launch button (see module.ts).
  game.settings.register(MODULE_ID, SETTINGS.showJournalButton, {
    name: "FSD.Settings.ShowJournalButtonName",
    hint: "FSD.Settings.ShowJournalButtonHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // The GM's copy of the on-screen session HUD (players always get theirs).
  // Client-scoped: whether a GM wants a floating panel on their screen is a
  // per-person preference, not a world rule — and it must never change what
  // players see.
  game.settings.register(MODULE_ID, SETTINGS.showGMHud, {
    name: "FSD.Settings.ShowGMHudName",
    hint: "FSD.Settings.ShowGMHudHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll(`${MODULE_ID}.refreshHud`),
  });

  // Storage for GM-authored Story Decks. Hidden from the settings page — the deck
  // editor writes here; `loadRecipes()` merges them with the bundled decks.
  game.settings.register(MODULE_ID, SETTINGS.customDecks, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  // Optional integration with ginzzzu-portraits. Registered unconditionally so
  // the choice persists even if that module is toggled off and back on; the
  // bridge itself no-ops when it isn't active.
  game.settings.register(MODULE_ID, SETTINGS.portraitSpotlight, {
    name: "FSD.Settings.PortraitSpotlightName",
    hint: "FSD.Settings.PortraitSpotlightHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.portraitSpotlightSolo, {
    name: "FSD.Settings.PortraitSoloName",
    hint: "FSD.Settings.PortraitSoloHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 *
 * Every setting below is `config: false` — they're edited from the **Story
 * Decks** window instead of Foundry's flat settings list, the same way
 * Maiyalis: Utility Suite organizes its own settings. `customDecks` stays
 * hidden entirely; the deck editor writes it directly.
 *
 * No menu opens the main window directly — the Journal-sidebar launch button
 * (see module.ts) and the `game.modules.get(MODULE_ID).api.open()` API cover
 * that, so a settings-menu entry would just be a third, redundant way in.
 *
 * Menus are listed in registration order, which is why they sit at the bottom
 * of this file rather than beside the settings each one edits: Story Decks,
 * then the placeholder Story Decisions window.
 */
import { StoryDecisionsConfig } from "./apps/story-decisions-config.js";
import { StoryDecksConfig } from "./apps/story-decks-config.js";
import { MENUS, MODULE_ID, SETTINGS } from "./constants.js";
import { isDaggerheart } from "./services/connections-service.js";

export function registerSettings(): void {
  // Shows/hides the Journal-sidebar launch button (see module.ts).
  game.settings.register(MODULE_ID, SETTINGS.showJournalButton, {
    name: "FSD.Settings.ShowJournalButtonName",
    hint: "FSD.Settings.ShowJournalButtonHint",
    scope: "world",
    config: false,
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
    config: false,
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
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.portraitSpotlightSolo, {
    name: "FSD.Settings.PortraitSoloName",
    hint: "FSD.Settings.PortraitSoloHint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // The connections round reads and writes a Daggerheart-specific sheet field, so
  // it can only ever run under that system. Registered (and shown) everywhere all
  // the same, so the feature is discoverable and the choice survives a world
  // switching systems — `connectionsEnabled()` gates on the system as well as the
  // value, and `StoryDecksConfig` disables the checkbox where the system can't
  // support it.
  game.settings.register(MODULE_ID, SETTINGS.connections, {
    name: "FSD.Settings.ConnectionsName",
    hint: "FSD.Settings.ConnectionsHint",
    scope: "world",
    config: false,
    type: Boolean,
    default: isDaggerheart(),
    onChange: () => Hooks.callAll(`${MODULE_ID}.refreshConnections`),
  });

  // The buttons, in the order they should appear. `restricted: true` on both
  // keeps them GM-only, which matters because most settings above are
  // world-scoped and only a GM can write one.

  game.settings.registerMenu(MODULE_ID, MENUS.storyDecksConfig, {
    name: "FSD.Settings.StoryDecksMenu.Name",
    label: "FSD.Settings.StoryDecksMenu.Label",
    hint: "FSD.Settings.StoryDecksMenu.Hint",
    icon: "fa-solid fa-sliders",
    type: StoryDecksConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.storyDecisionsConfig, {
    name: "FSD.Settings.StoryDecisionsMenu.Name",
    label: "FSD.Settings.StoryDecisionsMenu.Label",
    hint: "FSD.Settings.StoryDecisionsMenu.Hint",
    icon: "fa-solid fa-signs-post",
    type: StoryDecisionsConfig,
    restricted: true,
  });
}

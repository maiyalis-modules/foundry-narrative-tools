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
import { isDaggerheart } from "./services/connections-service.js";
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

  // The connections round reads and writes a Daggerheart-specific sheet field, so
  // it can only ever run under that system. Registered (and shown) everywhere all
  // the same, so the feature is discoverable and the choice survives a world
  // switching systems — `connectionsEnabled()` gates on the system as well as the
  // value, and the checkbox is disabled below where the system can't support it.
  game.settings.register(MODULE_ID, SETTINGS.connections, {
    name: "FSD.Settings.ConnectionsName",
    hint: isDaggerheart()
      ? "FSD.Settings.ConnectionsHint"
      : "FSD.Settings.ConnectionsHintUnavailable",
    scope: "world",
    config: true,
    type: Boolean,
    default: isDaggerheart(),
    onChange: () => Hooks.callAll(`${MODULE_ID}.refreshConnections`),
  });
}

/**
 * Grey out the connections checkbox on systems that can't support it.
 *
 * Foundry has no "disabled" flag for a registered setting, so the input is
 * disabled once the settings form is on screen. Cosmetic only — the runtime gate
 * is `connectionsEnabled()`, which never trusts the stored value alone.
 */
export function registerSettingsUI(): void {
  Hooks.on("renderSettingsConfig", (_app: unknown, html: HTMLElement | JQuery) => {
    if (isDaggerheart()) return;
    const root: HTMLElement | undefined =
      html instanceof HTMLElement ? html : (html as JQuery)?.[0];
    const input = root?.querySelector(
      `input[name="${MODULE_ID}.${SETTINGS.connections}"]`,
    ) as HTMLInputElement | null;
    if (!input) return;
    input.checked = false;
    input.disabled = true;
  });
}

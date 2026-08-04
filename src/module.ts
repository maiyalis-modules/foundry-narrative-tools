/**
 * Campaign Story Decks — module entry point.
 *
 * Wires the JSON-driven story-card engine into FoundryVTT's lifecycle hooks.
 * Business logic lives in `engine/`, `services/`, and `stores/`; this file only
 * bootstraps and exposes a small public API on the module.
 */
import { loadDefaultDeck, loadRecipes } from "./cards/index.js";
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "./constants.js";
import { DeckEngine } from "./engine/deck-engine.js";
import { recordCardResponse, showCardPrompt } from "./services/card-prompt.js";
import { DeckRunService } from "./services/deck-run-service.js";
import { PlayService } from "./services/play-service.js";
import { registerSocket } from "./services/socket.js";
import { registerSettings } from "./settings.js";
import { SessionStore } from "./stores/session-store.js";
import { CardWindowApp } from "./ui/card-window-app.js";
import { showSessionBanner } from "./ui/session-banner.js";
import { SessionStatusApp } from "./ui/session-status-app.js";
import { StoryDeckApp } from "./ui/story-deck-app.js";

/** The shape of the public API exposed at `game.modules.get(MODULE_ID).api`. */
export interface StoryDeckApi {
  engine: DeckEngine | null;
  app: StoryDeckApp;
  play: PlayService | null;
  run: DeckRunService | null;
  open(): void;
  reloadDeck(): Promise<void>;
}

let engine: DeckEngine | null = null;
let app: StoryDeckApp;
let cardWindow: CardWindowApp;
let sessionStatus: SessionStatusApp;
let playService: PlayService | null = null;
let deckRunService: DeckRunService | null = null;

/**
 * Open the players' session HUD while a run is live and close it when it ends.
 * GM-suppressed — the GM uses the main window. Players can read the world setting,
 * so this stays in sync off the same `updateSetting` hook as everything else.
 */
function syncSessionStatus(): void {
  if (game.user?.isGM || !sessionStatus) return;
  if (SessionStore.load().run) void sessionStatus.render(true);
  else if (sessionStatus.rendered) void sessionStatus.close();
}

Hooks.once("init", () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  SessionStore.register();
  registerSettings();
  app = new StoryDeckApp();
  cardWindow = new CardWindowApp();
  sessionStatus = new SessionStatusApp();
  app.setCardWindow(cardWindow);
});

Hooks.once("ready", async () => {
  const deck = await loadDefaultDeck();
  const recipes = await loadRecipes();
  engine = new DeckEngine(deck);
  playService = new PlayService(engine);
  deckRunService = new DeckRunService(engine, recipes);
  app.setEngine(engine);
  app.setPlayService(playService);
  app.setDeckRunService(deckRunService);
  cardWindow.setEngine(engine);
  cardWindow.setPlayService(playService);
  cardWindow.setDeckRunService(deckRunService);
  sessionStatus.setDeckRunService(deckRunService);
  registerSocket({
    onPromptCard: (prompt) => showCardPrompt(prompt),
    onCardResponse: (userId, cardId, stepIndex, value, nextPlayerId) => {
      if (playService)
        void recordCardResponse(playService, engine, userId, cardId, stepIndex, value, nextPlayerId);
    },
    onSessionStart: (deckName) => showSessionBanner(deckName),
  });

  const api: StoryDeckApi = {
    get engine() {
      return engine;
    },
    get app() {
      return app;
    },
    get play() {
      return playService;
    },
    get run() {
      return deckRunService;
    },
    open: () => {
      if (!game.user?.isGM) {
        ui.notifications?.warn(game.i18n.localize("FSD.GMOnly"));
        return;
      }
      void app.render(true);
    },
    reloadDeck: async () => {
      engine = new DeckEngine(await loadDefaultDeck());
      playService?.setEngine(engine);
      deckRunService?.setEngine(engine);
      deckRunService?.setRecipes(await loadRecipes());
      app.setEngine(engine);
      cardWindow.setEngine(engine);
    },
  };

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;

  // A player joining mid-session sees the HUD immediately.
  syncSessionStatus();

  console.log(
    `${LOG_PREFIX} Ready. Loaded deck "${deck.title}" with ${deck.cards.length} card(s).`,
  );
});

// Keep every client's open window in sync: when the GM writes the session setting,
// Foundry fires `updateSetting` on all clients — re-render to reflect shared state.
Hooks.on("updateSetting", (setting: { key?: string } | undefined) => {
  if (setting?.key !== `${MODULE_ID}.${SETTINGS.session}`) return;
  if (app?.rendered) void app.render();
  if (cardWindow?.rendered) void cardWindow.render();
  syncSessionStatus();
});

// Add a launch button to the Journal sidebar's header controls, unless disabled.
// GM-only: the window it opens is a GM tool.
Hooks.on("renderJournalDirectory", (_app: unknown, html: HTMLElement | JQuery) => {
  if (!game.user?.isGM) return;
  if (game.settings.get(MODULE_ID, SETTINGS.showJournalButton) === false) return;

  const root = html instanceof HTMLElement ? html : (html as JQuery)[0];
  if (!root || root.querySelector(`.${MODULE_ID}-launch`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${MODULE_ID}-launch`;
  button.innerHTML = `<i class="fa-solid fa-book-sparkles"></i> ${game.i18n.localize("FSD.LaunchButton")}`;
  button.addEventListener("click", () => void app.render(true));

  const header = root.querySelector(".directory-header") ?? root;
  header.prepend(button);
});

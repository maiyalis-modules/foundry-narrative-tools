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
import {
  currentRound,
  recordAskerChoice,
  recordConnectionAnswer,
} from "./services/connections-service.js";
import { DeckRunService } from "./services/deck-run-service.js";
import { PlayService } from "./services/play-service.js";
import { debugSocket, registerSocket, setDebugSocket } from "./services/socket.js";
import { registerSettings, registerSettingsUI } from "./settings.js";
import { SessionStore } from "./stores/session-store.js";
import { CardWindowApp } from "./ui/card-window-app.js";
import { showConnectionAnswer, showConnectionAsk } from "./ui/connection-dialogs.js";
import { registerConnectionsLock } from "./ui/connections-lock.js";
import { showSessionBanner } from "./ui/session-banner.js";
import { SessionStatusApp } from "./ui/session-status-app.js";
import { StoryDeckApp } from "./ui/story-deck-app.js";

/** The shape of the public API exposed at `game.modules.get(MODULE_ID).api`. */
export interface StoryDeckApi {
  engine: DeckEngine | null;
  app: StoryDeckApp;
  play: PlayService | null;
  run: DeckRunService | null;
  /** Trace every socket message on this client. Set per-client from the console. */
  debugSocket: boolean;
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
 * Show the session HUD while a run is live and close it when it ends — for
 * everyone. Nothing running means nothing to report, and neither side wants a
 * panel sitting on their scene between sessions. Everyone can read the world
 * setting, so this stays in sync off the same `updateSetting` hook as
 * everything else.
 *
 * The GM's copy carries the shortcut into the Story Deck window, and can be
 * turned off entirely from their own client settings.
 */
/**
 * Run a socket handler's promise and surface anything it throws.
 *
 * A bare `void somePromise()` turns a rejection into an unhandled one: it
 * reaches the console with no stack context and nothing reaches the screen. On
 * this channel that reads as "the message never arrived", which is the hardest
 * kind of failure to diagnose at a table mid-session — so every handler is
 * funnelled through here instead.
 */
function report(what: string, work: Promise<unknown>): void {
  void work.catch((error: unknown) => {
    console.error(`${LOG_PREFIX} Handling ${what} failed.`, error);
    ui.notifications?.error(game.i18n.format("FSD.HandlerFailed", { what }));
  });
}

function syncSessionStatus(): void {
  if (!sessionStatus) return;
  const live = SessionStore.load().run !== null || currentRound() !== null;
  const wanted =
    live && (!game.user?.isGM || game.settings.get(MODULE_ID, SETTINGS.showGMHud) !== false);
  if (wanted) void sessionStatus.render(true);
  else if (sessionStatus.rendered) void sessionStatus.close();
}

Hooks.once("init", () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  SessionStore.register();
  registerSettings();
  registerSettingsUI();
  registerConnectionsLock();
  app = new StoryDeckApp();
  cardWindow = new CardWindowApp();
  sessionStatus = new SessionStatusApp();
  app.setCardWindow(cardWindow);
  sessionStatus.setStoryDeckApp(app);
});

// The GM toggling their HUD setting applies immediately, rather than at reload.
Hooks.on(`${MODULE_ID}.refreshHud`, () => syncSessionStatus());

// Toggling the connections round adds or removes a tab, and locks or frees the
// sheet field. Re-render the window and any open character sheet so both land
// without a reload — the lock is applied during render, so the sheet has to
// redraw for it to take effect either way.
Hooks.on(`${MODULE_ID}.refreshConnections`, () => {
  if (app?.rendered) void app.render();
  // Character sheets are ApplicationV2, so they live in `applications.instances`
  // rather than the legacy `ui.windows` registry.
  const open = foundry.applications.instances as Map<string, AnyObject> | undefined;
  for (const sheet of open?.values() ?? []) {
    if (sheet?.["document"]?.["type"] === "character" && sheet["rendered"]) {
      void sheet["render"]?.();
    }
  }
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
    onSessionStart: (deckName, titleKey) => showSessionBanner(deckName, titleKey),
    onConnectionAsk: (ask) => report("connection ask", showConnectionAsk(ask)),
    onConnectionPick: (askerUserId, answererUserId) =>
      report("connection pick", recordAskerChoice(askerUserId, answererUserId)),
    onConnectionAnswer: (ask) => report("connection answer", showConnectionAnswer(ask)),
    onConnectionReply: (answererUserId, answer) =>
      report("connection reply", recordConnectionAnswer(answererUserId, answer)),
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
    get debugSocket() {
      return debugSocket;
    },
    set debugSocket(on: boolean) {
      setDebugSocket(on);
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

  // A player joining mid-session sees the HUD immediately; the GM's comes up
  // with the world.
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

// The Connections tab reads its questions straight off the character sheets, so
// it has to redraw when one changes — an answer landing, or a GM correcting the
// text by hand. Narrowed to the biography so ordinary play (HP, stress, items)
// doesn't re-render the window constantly.
// The HUD's progress bar counts answers on those same sheets, so it re-renders
// here too rather than waiting for the session write that follows.
Hooks.on("updateActor", (_actor: unknown, changes: AnyObject) => {
  if (changes?.["system"]?.["biography"] === undefined) return;
  if (app?.rendered) void app.render();
  if (sessionStatus?.rendered) void sessionStatus.render();
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

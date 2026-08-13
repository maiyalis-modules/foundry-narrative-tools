/**
 * Campaign Story Decks — module entry point.
 *
 * Wires the JSON-driven story-card engine into FoundryVTT's lifecycle hooks.
 * Business logic lives in `engine/`, `services/`, and `stores/`; this file only
 * bootstraps and exposes a small public API on the module.
 */
import { StoryDecisionApp } from "./apps/story-decision-app.js";
import { StoryDecisionVoteApp } from "./apps/story-decision-vote-app.js";
import { loadDefaultDeck, loadRecipes } from "./cards/index.js";
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "./constants.js";
import { DeckEngine } from "./engine/deck-engine.js";
import { recordCardResponse, showCardPrompt } from "./services/card-prompt.js";
import {
  currentRound,
  recordAskerChoice,
  recordConnectionAnswer,
} from "./services/connections-service.js";
import { castVote, subtitleFor } from "./services/decision-service.js";
import { DeckRunService } from "./services/deck-run-service.js";
import { exportDecisionToJournal } from "./services/journal-export.js";
import { PlayService } from "./services/play-service.js";
import { debugSocket, registerSocket, setDebugSocket } from "./services/socket.js";
import { registerSettings } from "./settings.js";
import { SessionStore } from "./stores/session-store.js";
import { CardWindowApp } from "./ui/card-window-app.js";
import { showConnectionAnswer, showConnectionAsk } from "./ui/connection-dialogs.js";
import { registerConnectionsLock } from "./ui/connections-lock.js";
import { showDecisionBanner, showSessionBanner } from "./ui/session-banner.js";
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
let storyDecisionApp: StoryDecisionApp;
let decisionVoteApp: StoryDecisionVoteApp;
let playService: PlayService | null = null;
let deckRunService: DeckRunService | null = null;

/** The last decision `id` this client has already announced with a banner —
 *  so a late joiner's catch-up sync (see `ready` below) never replays one for
 *  a decision that was already voting before they arrived. */
let lastAnnouncedDecisionId: string | null = null;
/** The last `{id, status}` this client observed the decision in — how
 *  `syncDecisionOverlay` notices a fresh "voting" → "resolved" transition to
 *  clear the GM's `StoryDecisionApp` draft, rather than on every sync (a vote
 *  coming in re-syncs just as much as resolving does). */
let lastDecisionStatus: { id: string; status: string } | null = null;

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

/**
 * Show/update/hide the full-screen Story Decision vote to match the shared
 * state, the same way `syncSessionStatus` does for the session HUD.
 *
 * `announceNew` distinguishes a genuine new Ask (banner-worthy) from a catch-up
 * sync — a late joiner's `ready` hook calling this must never replay the
 * banner for a decision that was already voting before they connected.
 */
function syncDecisionOverlay(announceNew: boolean): void {
  if (!decisionVoteApp) return;
  const decision = SessionStore.load().decision;

  if (!decision) {
    lastAnnouncedDecisionId = null;
    lastDecisionStatus = null;
    // `{ animate: false }`: Foundry's default close forces the element to its
    // last measured width/height and runs a ~1s "minimize" collapse toward
    // that box — fine for a normal window, but this app is a `position:
    // fixed; inset: 0;` full-viewport overlay with `window.positioned: false`
    // (see StoryDecisionVoteApp), so mid-collapse it visibly shrinks toward
    // whatever position Foundry last thought it had rather than just vanishing.
    if (decisionVoteApp.rendered) void decisionVoteApp.close({ animate: false });
    return;
  }

  if (announceNew && decision.status === "voting" && decision.id !== lastAnnouncedDecisionId) {
    showDecisionBanner(decision.title, subtitleFor(decision));
  }
  lastAnnouncedDecisionId = decision.id;

  // The decision *completing* (voting ends, a winner's decided) — not the
  // Ask that started it, and not a vote coming in mid-round — is what clears
  // the compose window's draft (so opening it again for a new decision
  // doesn't show the one that just finished) and writes it to the journal.
  // `exportDecisionToJournal` guards on `game.user?.isGM` and reports its own
  // errors, same as `clearDraft` is harmless to call on a player's unused
  // instance — neither needs `report()`'s generic wrapping here.
  if (
    decision.status === "resolved" &&
    lastDecisionStatus?.id === decision.id &&
    lastDecisionStatus.status === "voting"
  ) {
    storyDecisionApp?.clearDraft();
    void exportDecisionToJournal(decision);
  }
  lastDecisionStatus = { id: decision.id, status: decision.status };

  void decisionVoteApp.render(true);
}

Hooks.once("init", () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  SessionStore.register();
  registerSettings();
  registerConnectionsLock();
  app = new StoryDeckApp();
  cardWindow = new CardWindowApp();
  sessionStatus = new SessionStatusApp();
  storyDecisionApp = new StoryDecisionApp();
  decisionVoteApp = new StoryDecisionVoteApp();
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
    onDecisionVote: (userId, optionId) => report("decision vote", castVote(userId, optionId)),
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
  // with the world. Same for a Story Decision already open for voting — but
  // never re-announce it, see `syncDecisionOverlay`.
  syncSessionStatus();
  syncDecisionOverlay(false);

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
  syncDecisionOverlay(true);
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

// Add launch buttons to the Journal sidebar's header controls, unless disabled.
// GM-only: both windows they open are GM tools. Side by side in one `flexrow`
// (the same layout core uses for its own Create Entry / Create Folder row)
// rather than stacked, so each takes half the header's width.
Hooks.on("renderJournalDirectory", (_app: unknown, html: HTMLElement | JQuery) => {
  if (!game.user?.isGM) return;
  if (game.settings.get(MODULE_ID, SETTINGS.showJournalButton) === false) return;

  const root = html instanceof HTMLElement ? html : (html as JQuery)[0];
  if (!root || root.querySelector(`.${MODULE_ID}-launch-row`)) return;

  const row = document.createElement("div");
  row.className = `flexrow ${MODULE_ID}-launch-row`;

  const deckButton = document.createElement("button");
  deckButton.type = "button";
  deckButton.className = `${MODULE_ID}-launch`;
  deckButton.innerHTML = `<i class="fa-solid fa-book-sparkles"></i> ${game.i18n.localize("FSD.LaunchButton")}`;
  deckButton.addEventListener("click", () => void app.render(true));

  const decisionButton = document.createElement("button");
  decisionButton.type = "button";
  decisionButton.className = `${MODULE_ID}-launch`;
  decisionButton.innerHTML = `<i class="fa-solid fa-signs-post"></i> ${game.i18n.localize("FSD.StoryDecision.LaunchButton")}`;
  const tooltip = game.i18n.localize("FSD.StoryDecision.TriggerTooltip");
  decisionButton.dataset["tooltip"] = tooltip;
  decisionButton.setAttribute("aria-label", tooltip);
  decisionButton.addEventListener("click", () => void storyDecisionApp.render(true));

  row.append(deckButton, decisionButton);

  const header = root.querySelector(".directory-header") ?? root;
  header.prepend(row);
});

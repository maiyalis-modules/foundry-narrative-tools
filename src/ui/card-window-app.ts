import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { DeckEngine } from "../engine/deck-engine.js";
import type { StoryCard } from "../models/story-card.js";
import type { CardResult } from "../models/session.js";
import { promptNextStep, startCardPlay } from "../services/card-prompt.js";
import { userName, userNames } from "../services/foundry-users.js";
import type { DeckRunService } from "../services/deck-run-service.js";
import type { PlayService } from "../services/play-service.js";
import { clearPortraits } from "../services/portrait-bridge.js";
import type { TokenContext } from "../engine/token-resolver.js";
import { buildTokenContext } from "../services/token-context.js";
import { SessionStore } from "../stores/session-store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Friendly stand-ins for role tokens when previewing a card (before play). */
const PREVIEW_CONTEXT: TokenContext = {
  primary: "the first player",
  secondary: "another player",
  tertiary: "another player",
  quaternary: "another player",
  group: "the group",
};

/**
 * A single card, opened from the browser. It has three modes:
 *   - **preview** — all steps' questions + a **Play Card** button (GM),
 *   - **play** — the active card: per step, "Waiting for {name}…" then the answer,
 *     with **Prompt Next** / **Finish** controls,
 *   - **log** — a finished card opened from the Log tab: all questions + recorded
 *     answers, read-only.
 *
 * There is one shared instance; `openCard`/`openLogEntry` retarget it.
 */
export class CardWindowApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private engine: DeckEngine | null;
  private playService: PlayService | null = null;
  private deckRunService: DeckRunService | null = null;
  private cardId: string | null = null;
  private logEntry: CardResult | null = null;

  constructor(engine: DeckEngine | null = null, options: AnyObject = {}) {
    super(options);
    this.engine = engine;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-card-window`,
    tag: "section",
    window: {
      title: "FSD.CardPromptTitle",
      icon: "fa-solid fa-scroll",
      resizable: true,
    },
    position: {
      width: 560,
      height: "auto",
    },
    classes: [MODULE_ID, "story-deck", "card-window"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.cardWindow,
    },
  };

  setEngine(engine: DeckEngine | null): void {
    this.engine = engine;
  }

  setPlayService(playService: PlayService): void {
    this.playService = playService;
  }

  setDeckRunService(deckRunService: DeckRunService): void {
    this.deckRunService = deckRunService;
  }

  /** Open (or retarget) the window to a specific card for preview/play. */
  openCard(cardId: string): void {
    this.cardId = cardId;
    this.logEntry = null;
    void this.render(true);
  }

  /** Open a finished card from the log, read-only. */
  openLogEntry(entry: CardResult): void {
    this.logEntry = entry;
    this.cardId = null;
    void this.render(true);
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root || root.dataset["fsdBound"]) return;
    root.dataset["fsdBound"] = "1";
    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-fsd]") as HTMLElement | null;
      if (!el || !root.contains(el) || (el as HTMLButtonElement).disabled) return;
      void this.handleAction(el.dataset["fsd"] ?? "");
    });
  }

  private async handleAction(action: string): Promise<void> {
    if (!game.user?.isGM || !this.cardId) return;
    switch (action) {
      case "play":
        return startCardPlay(this.engine, this.playService, this.cardId);
      case "promptNext":
        return promptNextStep(this.engine, this.playService);
      case "finish": {
        const finishedCardId = await this.playService?.finish();
        // If a Story Deck is running, let it move on to the next card / recap.
        if (finishedCardId) await this.deckRunService?.cardFinished(finishedCardId);
        await clearPortraits();
        void this.close();
        return;
      }
      case "reset":
        await clearPortraits();
        return this.playService?.resetActive();
    }
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const isGM = Boolean(game.user?.isGM);

    if (this.logEntry) {
      return this.prepareLogContext(this.logEntry, isGM);
    }

    const engine = this.engine;
    const card = this.cardId ? engine?.getCard(this.cardId) : undefined;
    if (!engine || !card) {
      return { isGM, missing: true };
    }

    const active = SessionStore.load().active;
    const playingThis = active !== null && active.cardId === card.id;
    const currentStep = playingThis ? active!.stepIndex : -1;
    const tokenCtx: TokenContext = playingThis ? buildTokenContext(active!) : PREVIEW_CONTEXT;

    const steps = card.steps.map((step, i) => {
      const assigned = playingThis ? (active!.participants[step.participant.role] ?? []) : [];
      const isCurrent = i === currentStep;
      const response = playingThis
        ? active!.responses.find((r) => r.stepIndex === i)
        : undefined;
      const answered = response !== undefined;
      return {
        number: i + 1,
        setup: engine.renderSetup(step, tokenCtx),
        question: engine.renderQuestion(step, tokenCtx),
        // How this speaker is chosen — a cue shown above the step. The opener
        // (i === 0) needs none; the GM simply picks.
        cue: i > 0 ? engine.renderPrompt(step, tokenCtx) : "",
        // A GM-chosen mid-card speaker is the GM's call and was hidden from players.
        cueByGm: i > 0 && step.participant.selection === "gm_selects_player",
        answered,
        who: response ? userName(response.userId) : null,
        value: response ? String(response.value ?? "") : "",
        waiting: isCurrent && !answered && assigned.length > 0,
        assignedNames: assigned.length > 0 ? userNames(assigned) : "",
        isCurrent,
        isPast: playingThis && i < currentStep,
        isFuture: playingThis && i > currentStep,
      };
    });

    const current = currentStep >= 0 ? steps[currentStep] : undefined;
    const currentAnswered = current !== undefined && current.answered;
    const hasNext = currentStep + 1 < card.steps.length;

    return {
      isGM,
      missing: false,
      isLog: false,
      cardId: card.id,
      cardTitle: card.title,
      theme: card.theme,
      scope: card.scope,
      outputs: card.outputs ?? [],
      tags: card.tags ?? [],
      hasMeta: (card.outputs?.length ?? 0) > 0 || (card.tags?.length ?? 0) > 0,
      playingThis,
      steps,
      canPromptNext: playingThis && currentAnswered && hasNext,
      canFinish: playingThis && currentAnswered && !hasNext,
    };
  }

  /** Read-only render of a finished (logged) card. */
  private prepareLogContext(entry: CardResult, isGM: boolean): AnyObject {
    const engine = this.engine;
    const card = engine?.getCard(entry.cardId);
    if (!engine || !card) {
      return {
        isGM,
        missing: true,
        isLog: true,
        cardTitle: entry.title || entry.cardId,
        playedAt: formatDate(entry.playedAt),
      };
    }

    const tokenCtx = buildTokenContext(entry);
    const steps = card.steps.map((step: StoryCard["steps"][number], i: number) => {
      const response = entry.responses.find((r) => r.stepIndex === i);
      return {
        number: i + 1,
        setup: engine.renderSetup(step, tokenCtx),
        question: engine.renderQuestion(step, tokenCtx),
        cue: i > 0 ? engine.renderPrompt(step, tokenCtx) : "",
        cueByGm: i > 0 && step.participant.selection === "gm_selects_player",
        answered: response !== undefined,
        who: response ? userName(response.userId) : null,
        value: response ? String(response.value ?? "") : "",
        waiting: false,
        assignedNames: "",
        isCurrent: false,
        isPast: false,
        isFuture: false,
      };
    });

    return {
      isGM,
      missing: false,
      isLog: true,
      cardId: card.id,
      cardTitle: card.title,
      theme: card.theme,
      scope: card.scope,
      outputs: card.outputs ?? [],
      tags: card.tags ?? [],
      hasMeta: (card.outputs?.length ?? 0) > 0 || (card.tags?.length ?? 0) > 0,
      playedAt: formatDate(entry.playedAt),
      playingThis: false,
      steps,
      canPromptNext: false,
      canFinish: false,
    };
  }
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString();
}

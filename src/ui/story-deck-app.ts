import { DEFAULT_REQUIRED_PLAYERS, MODULE_ID, MODULE_TITLE, TEMPLATES } from "../constants.js";
import type { DeckEngine } from "../engine/deck-engine.js";
import type { DeckRun, RunCardRecord } from "../models/session.js";
import type { DeckPhase, StoryDeckRecipe } from "../models/story-deck-recipe.js";
import type { DeckRunService } from "../services/deck-run-service.js";
import { onlinePlayerCount, userName } from "../services/foundry-users.js";
import type { PlayService } from "../services/play-service.js";
import { buildTokenContext } from "../services/token-context.js";
import { SessionStore } from "../stores/session-store.js";
import { escapeHtml } from "../utils/escape-html.js";
import { announceSessionStart } from "./session-banner.js";
import type { CardWindowApp } from "./card-window-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type TabId = "home" | "decks" | "cards" | "log";
type DeckFilter = "all" | "in_progress" | "completed";

/** The deck-list filter tags, in display order. Fixed so all show even before a
 *  deck uses them; a deck's `tags` should be drawn from this set. */
const DECK_TAGS = [
  "New Campaign",
  "New Character",
  "Party Downtime",
  "Plot Twist",
  "Campaign Event",
] as const;

/** Friendly stand-ins for role tokens when previewing a card's first question. */
const PREVIEW_TOKENS: Record<string, string> = {
  primary: "the first player",
  secondary: "another player",
  tertiary: "another player",
  quaternary: "another player",
  group: "the group",
};

/**
 * The main Story Deck window (ApplicationV2 + Handlebars): a tabbed browser with
 * **Home**, **Story Decks**, and **Story Cards**. Clicking a card opens it in a
 * separate `CardWindowApp` (which is where a card is previewed and played).
 *
 * Interaction uses a single delegated click listener attached in `_onRender`
 * (elements carry `data-fsd="<action>"`) — independent of ApplicationV2's built-in
 * `actions` dispatch so behaviour is predictable across Foundry versions.
 */
export class StoryDeckApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private engine: DeckEngine | null;
  private cardWindow: CardWindowApp | null = null;
  private playService: PlayService | null = null;
  private deckRunService: DeckRunService | null = null;

  // Local view state (persists across re-renders).
  private activeTab: TabId = "home";
  private deckFilter: DeckFilter = "all";
  /** A finished run opened from the Story Decks tab, shown as a campaign seed. */
  private viewingRunId: string | null = null;
  /** A recipe opened from the Home tab, shown as its detail/breakdown page. */
  private viewingRecipeId: string | null = null;
  /** Active tag filter on the Home deck list, or null for all decks. */
  private deckTag: string | null = null;
  private cardTheme: string | null = null;
  private cardScope: string | null = null;
  private cardOutput: string | null = null;
  private cardTag: string | null = null;
  private filtersOpen = false;

  constructor(engine: DeckEngine | null = null, options: AnyObject = {}) {
    super(options);
    this.engine = engine;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-app`,
    tag: "section",
    window: {
      title: MODULE_TITLE,
      icon: "fa-solid fa-book-sparkles",
      resizable: true,
    },
    position: {
      width: 720,
      height: 640,
    },
    classes: [MODULE_ID, "story-deck"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.storyDeck,
    },
  };

  /**
   * The Story Deck browser is a GM tool: it exposes the whole card library, the
   * deck picker, and the run controls. Players take part through the card prompts
   * pushed to their own client, never through this window.
   *
   * Guarded here as well as at every call site, so no future caller can open it
   * for a player by accident.
   */
  async render(...args: unknown[]): Promise<this> {
    if (!game.user?.isGM) return this;
    return super.render(...args);
  }

  setEngine(engine: DeckEngine | null): void {
    this.engine = engine;
    if (this.rendered) void this.render();
  }

  setCardWindow(cardWindow: CardWindowApp): void {
    this.cardWindow = cardWindow;
  }

  setPlayService(playService: PlayService): void {
    this.playService = playService;
  }

  setDeckRunService(deckRunService: DeckRunService): void {
    this.deckRunService = deckRunService;
    if (this.rendered) void this.render();
  }

  /** Attach one delegated click listener for `[data-fsd]` elements. */
  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root || root.dataset["fsdBound"]) return;
    root.dataset["fsdBound"] = "1";
    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-fsd]") as
        | HTMLElement
        | null;
      if (!el || !root.contains(el) || (el as HTMLButtonElement).disabled) return;
      this.handleAction(el.dataset["fsd"] ?? "", el);
    });
  }

  private handleAction(action: string, target: HTMLElement): void {
    const value = target.dataset["value"];
    switch (action) {
      case "tab":
        if (value === "home" || value === "decks" || value === "cards" || value === "log") {
          this.activeTab = value;
          void this.render();
        }
        return;
      case "deckFilter":
        if (value === "all" || value === "in_progress" || value === "completed") {
          this.deckFilter = value;
          void this.render();
        }
        return;
      case "cardTheme":
        this.cardTheme = normalizeFilter(value);
        void this.render();
        return;
      case "cardScope":
        this.cardScope = normalizeFilter(value);
        void this.render();
        return;
      case "cardOutput":
        this.cardOutput = normalizeFilter(value);
        void this.render();
        return;
      case "cardTag":
        this.cardTag = normalizeFilter(value);
        void this.render();
        return;
      case "toggleFilters":
        this.filtersOpen = !this.filtersOpen;
        void this.render();
        return;
      case "clearFilters":
        this.cardTheme = null;
        this.cardScope = null;
        this.cardOutput = null;
        this.cardTag = null;
        void this.render();
        return;
      case "openCard": {
        const cardId = target.dataset["cardId"];
        if (cardId) this.cardWindow?.openCard(cardId);
        return;
      }
      case "openLog": {
        const logId = target.dataset["logId"];
        const entry = SessionStore.load().results.find((r) => r.id === logId);
        if (entry) this.cardWindow?.openLogEntry(entry);
        return;
      }
      case "deleteLog": {
        const logId = target.dataset["logId"];
        if (logId && game.user?.isGM) void this.playService?.deleteResult(logId);
        return;
      }
      case "clearLog":
        void this.onClearLog();
        return;

      // --- Story Deck run (all GM-only; the service also ignores non-GM writes) ---
      case "deckTagFilter":
        this.deckTag = normalizeFilter(value);
        void this.render();
        return;
      case "viewRecipe":
        this.viewingRecipeId = value ?? null;
        void this.render();
        return;
      case "closeRecipe":
        this.viewingRecipeId = null;
        void this.render();
        return;
      case "startRun":
        if (value && game.user?.isGM) {
          const recipe = this.deckRunService?.getRecipe(value);
          if (!recipe) return;
          const required = recipe.requiredPlayers ?? DEFAULT_REQUIRED_PLAYERS;
          if (onlinePlayerCount() < required) {
            ui.notifications?.warn(game.i18n.format("FSD.NotEnoughPlayers", { count: required }));
            return;
          }
          this.viewingRecipeId = null;
          void this.deckRunService?.startRun(value);
          announceSessionStart(recipe.name);
        }
        return;
      case "beginPhase":
        if (game.user?.isGM) void this.deckRunService?.beginPhase();
        return;
      case "viewRunCard": {
        // Only open the card. Play starts from the card window's own button, so
        // the GM can read the questions before committing a player to the first.
        const cardId = target.dataset["cardId"];
        if (cardId && game.user?.isGM) this.cardWindow?.openCard(cardId);
        return;
      }
      case "skipRunCard": {
        const cardId = target.dataset["cardId"];
        if (cardId && game.user?.isGM) void this.deckRunService?.skipCard(cardId);
        return;
      }
      case "replaceRunCard": {
        const cardId = target.dataset["cardId"];
        if (cardId && game.user?.isGM) void this.deckRunService?.replaceCard(cardId);
        return;
      }
      case "drawAnother":
        if (game.user?.isGM) void this.deckRunService?.drawAnother();
        return;
      case "chooseRunCard":
        // With a card id it replaces that slot; without one it appends.
        void this.onChooseCard(target.dataset["cardId"]);
        return;
      case "nextPhase":
        if (game.user?.isGM) void this.deckRunService?.nextPhase();
        return;
      case "endRun":
        void this.onEndRun();
        return;
      case "viewRun":
        this.viewingRunId = target.dataset["runId"] ?? null;
        void this.render();
        return;
      case "closeRun":
        this.viewingRunId = null;
        void this.render();
        return;
      case "deleteRun": {
        const runId = target.dataset["runId"];
        if (runId && game.user?.isGM) {
          if (this.viewingRunId === runId) this.viewingRunId = null;
          void this.deckRunService?.deleteRun(runId);
        }
        return;
      }
    }
  }

  /**
   * Let the GM pick an exact card for the current phase, rather than taking
   * whatever the selection rules rolled.
   *
   * Cards matching the phase's rules are listed first and separately, so the
   * rules still guide the choice without constraining it.
   */
  private async onChooseCard(replacingCardId?: string): Promise<void> {
    if (!game.user?.isGM || !this.deckRunService) return;

    const { matching, others } = this.deckRunService.candidateCards();
    if (matching.length === 0 && others.length === 0) {
      ui.notifications?.warn(game.i18n.localize("FSD.Run.NoCardsToChoose"));
      return;
    }

    const group = (labelKey: string, cards: { id: string; title: string; theme: string }[]) =>
      cards.length === 0
        ? ""
        : `<optgroup label="${escapeHtml(game.i18n.localize(labelKey))}">${cards
            .map(
              (c) =>
                `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)} — ${escapeHtml(c.theme)}</option>`,
            )
            .join("")}</optgroup>`;

    const prompt = game.i18n.localize(
      replacingCardId ? "FSD.Run.ChooseReplace" : "FSD.Run.ChooseAdd",
    );
    const content = `<p>${escapeHtml(prompt)}</p>
      <select name="card" style="width: 100%;">
        ${group("FSD.Run.ChooseMatching", matching)}
        ${group("FSD.Run.ChooseOthers", others)}
      </select>`;

    let chosen: string | null = null;
    try {
      chosen = (await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("FSD.Run.ChooseTitle") },
        content,
        ok: {
          label: game.i18n.localize("FSD.Run.ChooseConfirm"),
          icon: "fa-solid fa-check",
          callback: (_event: Event, button: { form: HTMLFormElement }) =>
            (button.form.elements.namedItem("card") as HTMLSelectElement | null)?.value ?? null,
        },
        rejectClose: false,
      })) as string | null;
    } catch {
      return;
    }

    if (chosen) await this.deckRunService.chooseCard(chosen, replacingCardId);
  }

  /** Ending a run early discards nothing, but it can't be resumed — confirm it. */
  private async onEndRun(): Promise<void> {
    if (!game.user?.isGM || !this.deckRunService) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FSD.Run.End") },
      content: `<p>${game.i18n.localize("FSD.Run.EndConfirm")}</p>`,
      rejectClose: false,
    });
    if (confirmed) await this.deckRunService.endRun();
  }

  private async onClearLog(): Promise<void> {
    if (!game.user?.isGM || !this.playService) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FSD.Log.Clear") },
      content: `<p>${game.i18n.localize("FSD.Log.ClearConfirm")}</p>`,
      rejectClose: false,
    });
    if (confirmed) await this.playService.clearResults();
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const isGM = Boolean(game.user?.isGM);
    const cards = this.engine?.cards ?? [];

    const themes = distinct(cards.map((c) => c.theme));
    const scopes = distinct(cards.map((c) => c.scope));
    const outputs = distinct(cards.flatMap((c) => c.outputs ?? []));
    const tags = distinct(cards.flatMap((c) => c.tags ?? []));

    const filteredCards = cards.filter(
      (c) =>
        (this.cardTheme === null || c.theme === this.cardTheme) &&
        (this.cardScope === null || c.scope === this.cardScope) &&
        (this.cardOutput === null || (c.outputs ?? []).includes(this.cardOutput)) &&
        (this.cardTag === null || (c.tags ?? []).includes(this.cardTag)),
    );

    return {
      isGM,
      moduleTitle: MODULE_TITLE,
      hasDeck: this.engine !== null,
      deckTitle: this.engine?.title ?? null,

      tabs: [
        { id: "home", label: "FSD.Tab.Home", active: this.activeTab === "home" },
        { id: "decks", label: "FSD.Tab.Decks", active: this.activeTab === "decks" },
        { id: "cards", label: "FSD.Tab.Cards", active: this.activeTab === "cards" },
        { id: "log", label: "FSD.Tab.Log", active: this.activeTab === "log" },
      ],
      isHome: this.activeTab === "home",
      isDecks: this.activeTab === "decks",
      isCards: this.activeTab === "cards",
      isLog: this.activeTab === "log",
      ...this.logContext(),
      ...this.homeContext(),
      ...this.decksContext(),

      filtersOpen: this.filtersOpen,
      activeFilterCount: [this.cardTheme, this.cardScope, this.cardOutput, this.cardTag].filter(
        (v) => v !== null,
      ).length,
      themeFilters: themeChips(themes, this.cardTheme),
      scopeFilters: filterChips(scopes, this.cardScope),
      outputFilters: filterChips(outputs, this.cardOutput),
      tagFilters: filterChips(tags, this.cardTag),
      hasScopes: scopes.length > 0,
      hasOutputs: outputs.length > 0,
      hasTags: tags.length > 0,
      cards: filteredCards.map((c) => ({
        id: c.id,
        title: c.title,
        theme: c.theme,
        scope: c.scope,
        themeHue: themeHue(c.theme),
        outputs: c.outputs ?? [],
        firstQuestion: this.firstQuestion(c),
      })),
      cardCount: filteredCards.length,
    };
  }

  /** The card's opening question, with role tokens shown as friendly placeholders. */
  private firstQuestion(card: { steps: { question: string }[] }): string {
    const question = card.steps[0]?.question;
    if (!question) return "";
    return this.engine ? this.engine.renderText(question, PREVIEW_TOKENS) : question;
  }

  /**
   * The Home tab: either the Story Deck picker (no run) or the active run,
   * rendered as a chapter — intro, the phase's cards, or the phase recap.
   */
  private homeContext(): AnyObject {
    const run = SessionStore.load().run;
    const online = onlinePlayerCount();

    if (!run) {
      const recipes = this.deckRunService?.availableRecipes ?? [];

      // A specific deck opened for its detail/breakdown page.
      const viewing =
        this.viewingRecipeId != null
          ? recipes.find((r) => r.id === this.viewingRecipeId)
          : undefined;
      if (viewing) {
        const required = viewing.requiredPlayers ?? DEFAULT_REQUIRED_PLAYERS;
        return {
          hasRun: false,
          viewingRecipe: {
            id: viewing.id,
            name: viewing.name,
            description: viewing.description,
            tags: viewing.tags ?? [],
            cardCount: viewing.expectedCards ?? viewing.phases.reduce((n, p) => n + p.count, 0),
            players:
              viewing.minPlayers && viewing.maxPlayers
                ? `${viewing.minPlayers}–${viewing.maxPlayers}`
                : null,
            requiredPlayers: required,
            enoughPlayers: online >= required,
            breakdown: themeBreakdown(viewing.phases),
            focus: viewing.focus ?? [],
            notes: viewing.facilitatorNotes ?? [],
          },
        };
      }

      const shown =
        this.deckTag === null
          ? recipes
          : recipes.filter((r) => (r.tags ?? []).includes(this.deckTag!));

      return {
        hasRun: false,
        deckTagFilters: [
          { value: "all", label: "FSD.Filter.All", active: this.deckTag === null },
          ...DECK_TAGS.map((t) => ({ value: t, label: t, active: this.deckTag === t })),
        ],
        recipes: shown.map((r: StoryDeckRecipe) => {
          const required = r.requiredPlayers ?? DEFAULT_REQUIRED_PLAYERS;
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            tags: r.tags ?? [],
            phaseCount: r.phases.length,
            cardCount: r.expectedCards ?? r.phases.reduce((n, p) => n + p.count, 0),
            players:
              r.minPlayers && r.maxPlayers ? `${r.minPlayers}–${r.maxPlayers}` : null,
            requiredPlayers: required,
            enoughPlayers: online >= required,
          };
        }),
        hasRecipes: shown.length > 0,
      };
    }

    const phase = run.phases[run.phaseIndex];
    const total = this.deckRunService?.getRecipe(run.recipeId)?.phases.length ?? run.phases.length;

    return {
      hasRun: true,
      runName: run.recipeName,
      phaseNumber: run.phaseIndex + 1,
      phaseTotal: total,
      phaseName: phase?.name ?? "",
      phaseDescription: phase?.description ?? "",
      phaseCardCount: phase?.cardIds.length ?? 0,
      phaseIsShort: phase?.short ?? false,
      isPhaseIntro: run.status === "phase_intro",
      isPlaying: run.status === "playing",
      isPhaseRecap: run.status === "phase_recap",
      isLastPhase: run.phaseIndex + 1 >= total,
      runCards: (phase?.cardIds ?? []).map((cardId) => {
        const card = this.engine?.getCard(cardId);
        return {
          id: cardId,
          title: card?.title ?? cardId,
          theme: card?.theme ?? "",
          themeHue: themeHue(card?.theme ?? ""),
          played: phase?.playedCardIds.includes(cardId) ?? false,
        };
      }),
      // What this phase's cards drew out of the table — the answers themselves.
      phaseCards: this.renderRunCards(this.phaseCards(run)),
      hasPhaseCards: this.phaseCards(run).length > 0,
    };
  }

  /** The finished-card records belonging to the run's current phase. */
  private phaseCards(run: DeckRun): RunCardRecord[] {
    const phaseId = run.phases[run.phaseIndex]?.phaseId;
    return run.cards.filter((c) => c.phaseId === phaseId);
  }

  /** Turn stored card records into rendered question/answer blocks for display. */
  private renderRunCards(records: RunCardRecord[]): AnyObject[] {
    const engine = this.engine;
    return records.map((rec) => {
      const card = engine?.getCard(rec.cardId);
      const ctx = buildTokenContext(rec);
      const answers = [...rec.responses]
        .sort((a, b) => a.stepIndex - b.stepIndex)
        .map((r) => {
          const step = card?.steps[r.stepIndex];
          return {
            question: step && engine ? engine.renderQuestion(step, ctx) : "",
            answer: String(r.value ?? ""),
            who: userName(r.userId),
          };
        })
        .filter((a) => a.answer.trim() !== "");
      return {
        title: rec.cardTitle,
        theme: rec.theme,
        themeHue: themeHue(rec.theme),
        outputs: rec.outputs,
        answers,
      };
    });
  }

  /** The Story Decks tab: past runs, filtered, plus the opened run's transcript. */
  private decksContext(): AnyObject {
    const session = SessionStore.load();
    const all: DeckRun[] = [...(session.run ? [session.run] : []), ...session.runs];

    const runs = all
      .filter((r) =>
        this.deckFilter === "all"
          ? true
          : this.deckFilter === "completed"
            ? r.status === "completed"
            : r.status !== "completed",
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => ({
        id: r.id,
        name: r.recipeName,
        inProgress: r.status !== "completed",
        endedEarly: r.endedEarly,
        cardCount: r.cards.length,
        date: new Date(r.completedAt ?? r.startedAt).toLocaleString(),
      }));

    const viewing = this.viewingRunId
      ? all.find((r) => r.id === this.viewingRunId)
      : undefined;

    return {
      deckFilters: [
        { value: "all", label: "FSD.Filter.All", active: this.deckFilter === "all" },
        { value: "in_progress", label: "FSD.Filter.InProgress", active: this.deckFilter === "in_progress" },
        { value: "completed", label: "FSD.Filter.Completed", active: this.deckFilter === "completed" },
      ],
      runs,
      hasRuns: runs.length > 0,
      viewingRun: viewing ? { id: viewing.id, name: viewing.recipeName } : null,
      seedPhases: viewing ? this.groupRunByPhase(viewing) : [],
    };
  }

  /** A viewed run's cards grouped into their phases, for the campaign-seed view. */
  private groupRunByPhase(run: DeckRun): AnyObject[] {
    return run.phases
      .map((phase) => ({
        name: phase.name,
        cards: this.renderRunCards(run.cards.filter((c) => c.phaseId === phase.phaseId)),
      }))
      .filter((p) => (p.cards as AnyObject[]).length > 0);
  }

  /** Newest-first list of finished cards for the Log tab. */
  private logContext(): AnyObject {
    const logEntries = [...SessionStore.load().results]
      .sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0))
      .map((r) => ({
        id: r.id,
        title: r.title || r.cardId,
        theme: r.theme || "",
        playedAt: r.playedAt ? new Date(r.playedAt).toLocaleString() : "",
      }));
    return { logEntries, hasLog: logEntries.length > 0 };
  }
}

/** Distinct, stable-ordered list of non-empty strings. */
function distinct(values: string[]): string[] {
  return [...new Set(values.filter((v) => v))];
}

/** "all" / empty resolves to no filter (null). */
function normalizeFilter(value: string | undefined): string | null {
  return !value || value === "all" ? null : value;
}

/** Build "All + each value" filter chips, marking the active one. */
function filterChips(
  values: string[],
  selected: string | null,
): { value: string; label: string; active: boolean }[] {
  return [
    { value: "all", label: "FSD.Filter.All", active: selected === null },
    ...values.map((v) => ({ value: v, label: v, active: selected === v })),
  ];
}

/**
 * Aggregate a recipe's phases into a per-theme card breakdown, biggest first.
 *
 * Each phase contributes its card count to the theme(s) it draws from — the same
 * "Relationships: 3, Community: 2" summary the deck is designed around, derived
 * from the phases so there's no separate count to keep in sync. A phase that
 * draws from several themes at once is listed under their combined label.
 */
function themeBreakdown(
  phases: DeckPhase[],
): { theme: string; count: number; hue: number }[] {
  const counts = new Map<string, number>();
  for (const phase of phases) {
    const themes = phase.selection.themes ?? phase.selection.categories ?? [];
    const key = themes.length > 0 ? themes.join(" / ") : "any theme";
    counts.set(key, (counts.get(key) ?? 0) + phase.count);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([theme, count]) => ({ theme, count, hue: themeHue(theme) }));
}

/** Theme chips, each carrying its own hue (the "All" chip stays neutral). */
function themeChips(
  values: string[],
  selected: string | null,
): { value: string; label: string; active: boolean; hue: number | null }[] {
  return [
    { value: "all", label: "FSD.Filter.All", active: selected === null, hue: null },
    ...values.map((v) => ({ value: v, label: v, active: selected === v, hue: themeHue(v) })),
  ];
}

/**
 * A stable hue for a theme, derived from its name so new themes get one for free.
 *
 * Only the hue is decided here — saturation and lightness live in CSS, so the
 * same theme reads correctly against both the light and dark palettes without the
 * UI having to know which one is active.
 */
function themeHue(theme: string): number {
  let hash = 0;
  for (let i = 0; i < theme.length; i++) {
    hash = (hash * 31 + theme.charCodeAt(i)) % 360;
  }
  return hash;
}

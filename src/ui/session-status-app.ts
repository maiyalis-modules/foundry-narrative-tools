import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { DeckRunService } from "../services/deck-run-service.js";
import { SessionStore } from "../stores/session-store.js";
import type { StoryDeckApp } from "./story-deck-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Gap kept between the panel and the edge of the play area. */
const HUD_MARGIN = 16;

/** Where the panel's top edge starts out, before anyone drags it.
 *  The GM's sits lower to clear the countdown/tracker bars that live in that
 *  corner of a GM's screen; a player's corner is usually free. */
const PLAYER_TOP = 16;
const GM_TOP = 130;

/**
 * The session HUD: a small frameless glass panel showing the Story Session's name
 * and how far through it the table is. It updates live off the same world-setting
 * sync as everything else (`updateSetting` → re-render).
 *
 * It is deliberately chrome-less — no title bar, no close button. At the table
 * this sits over the scene for the whole session, so it reads as part of the
 * scene rather than as a window someone has to manage. Losing the frame also
 * loses Foundry's drag handle, so the panel is its own (see `startDrag`).
 *
 * It is only ever on screen while a run is live (see `module.ts`). Players see
 * name + progress only, and never the words "Story Deck". The GM gets the same
 * panel plus a shortcut into the main window, so running a session doesn't mean
 * a trip to the Journal sidebar every time.
 */
export class SessionStatusApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private deckRunService: DeckRunService | null = null;
  private storyDeckApp: StoryDeckApp | null = null;
  /** Set once the opening position has been computed — later renders (and any
   *  drag the user has done since) must not be overruled. */
  private placed = false;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-session-status`,
    tag: "section",
    window: {
      // No frame: no header, no close button. `positioned` is kept so Foundry
      // still applies left/top — the panel's own CSS makes it fixed on screen.
      frame: false,
      positioned: true,
      title: "FSD.Status.Title",
      icon: "fa-solid fa-book-sparkles",
      resizable: false,
      minimizable: false,
    },
    // Placed by `anchorTopRight()` once its real width is known — an auto-width
    // panel can't be right-aligned from a static left offset.
    position: {
      width: "auto" as const,
      height: "auto" as const,
      top: PLAYER_TOP,
    },
    classes: [MODULE_ID, "story-deck", "session-status", "session-status--unplaced"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.sessionStatus,
    },
  };

  setDeckRunService(deckRunService: DeckRunService): void {
    this.deckRunService = deckRunService;
  }

  /** The window the GM's shortcut button opens. */
  setStoryDeckApp(app: StoryDeckApp): void {
    this.storyDeckApp = app;
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    if (!this.placed) {
      this.placed = true;
      // Next frame: the panel has to be laid out before its width can be
      // measured, and this runs after Foundry has applied its own positioning.
      requestAnimationFrame(() => this.anchorTopRight());
    } else {
      // Closing and reopening (a player's HUD does that every session) rebuilds
      // the element from DEFAULT_OPTIONS, hidden class and all — but the panel
      // already has a position to reappear at, so just show it.
      root.classList.remove("session-status--unplaced");
    }

    if (root.dataset["fsdBound"]) return;
    root.dataset["fsdBound"] = "1";

    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-fsd]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      if (el.dataset["fsd"] === "openDeck") void this.storyDeckApp?.render(true);
    });

    root.addEventListener("pointerdown", (event: PointerEvent) => this.startDrag(event));
  }

  /**
   * Park the panel in the top-right of the play area.
   *
   * Right-aligned means measured, not assumed: the panel is auto-width, so its
   * left edge depends on how long the deck's name is. The right edge is the
   * sidebar's left edge rather than the viewport's — the sidebar is opaque, and
   * a panel tucked underneath it isn't a HUD. It falls back to the viewport when
   * the sidebar can't be found (or is collapsed out of the layout).
   */
  private anchorTopRight(): void {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    const sidebar = document.getElementById("sidebar") ?? document.getElementById("ui-right");
    const sidebarLeft = sidebar?.getBoundingClientRect().left ?? 0;
    const rightEdge = sidebarLeft > 0 ? sidebarLeft : window.innerWidth;
    const width = root.getBoundingClientRect().width;

    this.setPosition({
      left: Math.max(HUD_MARGIN, rightEdge - width - HUD_MARGIN),
      top: game.user?.isGM ? GM_TOP : PLAYER_TOP,
    });
    // Only now is it somewhere deliberate — fade it in rather than let it flash
    // through the position Foundry gave it.
    root.classList.remove("session-status--unplaced");
  }

  /**
   * Drag the panel by its body.
   *
   * A frameless application has no `.window-header` for Foundry to bind dragging
   * to, and a HUD pinned to one spot for the whole session will sooner or later
   * be sitting on top of something that matters. Buttons are excluded so the
   * GM's shortcut still clicks.
   */
  private startDrag(event: PointerEvent): void {
    const root = this.element as HTMLElement | undefined;
    if (!root || event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("button")) return;

    const rect = root.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const onMove = (move: PointerEvent): void => {
      this.setPosition({ left: move.clientX - offsetX, top: move.clientY - offsetY });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const isGM = Boolean(game.user?.isGM);
    const run = SessionStore.load().run;
    // Renders as nothing: this window is closed when no run is live, so this is
    // only the moment between a session ending and the close landing.
    if (!run) return { active: false, isGM };

    const total = this.deckRunService?.getRecipe(run.recipeId)?.phases.length ?? run.phases.length;
    const phase = run.phases[run.phaseIndex];

    // Phases fully behind us; a recap counts its phase as done.
    const done =
      run.status === "phase_recap" || run.status === "completed"
        ? run.phaseIndex + 1
        : run.phaseIndex;

    const stateLabel =
      run.status === "phase_intro"
        ? "FSD.Status.Starting"
        : run.status === "phase_recap"
          ? "FSD.Status.Pause"
          : "FSD.Status.InProgress";

    return {
      active: true,
      isGM,
      deckName: run.recipeName,
      phaseNumber: run.phaseIndex + 1,
      phaseTotal: total,
      phaseName: phase?.name ?? "",
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      stateLabel,
    };
  }
}

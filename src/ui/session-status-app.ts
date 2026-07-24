import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { DeckRunService } from "../services/deck-run-service.js";
import { SessionStore } from "../stores/session-store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A small, read-only HUD shown on *players'* screens while a Story Session runs:
 * the session's name and how far through it the table is. It updates live off the
 * same world-setting sync as everything else (`updateSetting` → re-render).
 *
 * Deliberately player-facing: it never says "Story Deck" and carries no controls.
 * The GM drives everything from the main window, so this window is GM-suppressed.
 */
export class SessionStatusApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private deckRunService: DeckRunService | null = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-session-status`,
    tag: "section",
    window: {
      title: "FSD.Status.Title",
      icon: "fa-solid fa-book-sparkles",
      resizable: false,
      minimizable: true,
    },
    position: {
      width: 260,
      height: "auto" as const,
      left: 16,
      top: 100,
    },
    classes: [MODULE_ID, "story-deck", "session-status"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.sessionStatus,
    },
  };

  setDeckRunService(deckRunService: DeckRunService): void {
    this.deckRunService = deckRunService;
  }

  /** Players only — the GM has the full window. */
  async render(...args: unknown[]): Promise<this> {
    if (game.user?.isGM) return this;
    return super.render(...args);
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const run = SessionStore.load().run;
    if (!run) return { active: false };

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
      deckName: run.recipeName,
      phaseNumber: run.phaseIndex + 1,
      phaseTotal: total,
      phaseName: phase?.name ?? "",
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      stateLabel,
    };
  }
}

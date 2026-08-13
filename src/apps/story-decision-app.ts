/**
 * The **Story Decision** trigger window — lets the GM compose a decision (a
 * title, a longer description, and a growing list of options) before
 * presenting it to the table. Opened from the button in the Journal sidebar
 * header (see module.ts).
 *
 * "Ask" hands the draft to `startDecision()` (see `decision-service.ts`),
 * which opens it for voting for the whole table — every client, including
 * this one, picks it up via the same world-setting sync `StoryDecksConfig`
 * and the connections round already use. See `StoryDecisionsConfig` for where
 * the resolution method (majority vote / weighted random / single chooser)
 * itself is chosen, and `story-decision-vote-app.ts` for the vote screen.
 *
 * Each option's own fields (title/description/image) are edited in a separate
 * popup (`StoryDecisionOptionApp`) rather than inline, so this list stays a
 * compact thumbnail + title row per option — added, edited, and removed the
 * same way `HotbarPagesConfig` in Maiyalis: Utility Suite manages its
 * assignment rows: harvest edits out of the DOM, mutate the in-memory array,
 * then re-render from it. Rows are also drag-reorderable via native HTML5 DnD.
 *
 * The draft otherwise outlives closing this window (see the fields below) —
 * `clearDraft()` is the one thing that resets it, either by hand (the Clear
 * button) or automatically once an asked decision resolves (see `module.ts`),
 * so opening this window for a *new* decision doesn't start from the old one.
 */
import { MODULE_ID, TEMPLATES } from "../constants.js";
import type { DecisionType } from "../models/session.js";
import { singleChooserCounts, startDecision } from "../services/decision-service.js";
import { getOnlinePlayers } from "../services/foundry-users.js";
import { ConfigWindow } from "./config-window.js";
import { StoryDecisionOptionApp, type DecisionOption } from "./story-decision-option-app.js";

export class StoryDecisionApp extends ConfigWindow {
  // Not reset just by closing the window — leaving without triggering the
  // decision keeps the draft, the same way leaving a compose window would.
  // `clearDraft()` is what actually resets these (see the class doc above).
  //
  // Named `decision*` rather than `title`/`options` because ApplicationV2
  // itself owns instance properties by those exact names (`get title()` reads
  // `options.window.title`; `options` is the frozen, merged DEFAULT_OPTIONS) —
  // a same-named class field silently shadows them and breaks rendering.
  private decisionTitle = "";
  private decisionDescription = "";
  private decisionOptions: DecisionOption[] = [];
  private decisionType: DecisionType = "groupMajority";
  /** Only meaningful when {@link decisionType} is `"single"`. */
  private singlePlayerId = "";

  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-story-decision`,
    window: {
      title: "FSD.StoryDecision.Title",
      icon: "fa-solid fa-signs-post",
    },
  };

  static PARTS = {
    main: { template: TEMPLATES.storyDecision },
  };

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    const onlinePlayers = getOnlinePlayers();
    return {
      ...context,
      title: this.decisionTitle,
      description: this.decisionDescription,
      options: this.decisionOptions,
      // Handlebars here has no `eq` helper (see CLAUDE.md), so each branch the
      // template needs is picked ahead of time rather than compared inline.
      isSingle: this.decisionType === "single",
      isGroupMajority: this.decisionType === "groupMajority",
      isGroupRandom: this.decisionType === "groupRandom",
      hasOnlinePlayers: onlinePlayers.length > 0,
      hasSelectedPlayer: onlinePlayers.some((p) => p.id === this.singlePlayerId),
      onlinePlayers: onlinePlayers.map((p) => {
        const counts = singleChooserCounts(p.id);
        return {
          ...p,
          selected: p.id === this.singlePlayerId,
          // Fairness at a glance: how often they've already had this job,
          // today and lifetime — see `singleChooserCounts()`.
          label: game.i18n.format("FSD.StoryDecision.PlayerOption", {
            name: p.name,
            today: counts.today,
            total: counts.total,
          }),
        };
      }),
    };
  }

  protected override onAction(action: string, el: HTMLElement): void {
    if (action === "add-option") this.onAddOption();
    else if (action === "edit-option") this.onEditOption(el);
    else if (action === "remove-option") this.onRemoveOption(el);
    else if (action === "ask") void this.onAsk();
    else if (action === "clear-draft") void this.onClearDraft();
  }

  /**
   * Show the "Player" dropdown only for a "Single" decision type. Toggled with
   * plain `hidden` rather than a re-render — same pattern
   * `DaggerheartAutomationConfig` in Maiyalis: Utility Suite uses to grey out
   * its own dependent control on every change.
   */
  protected override refreshControls(root: HTMLElement): void {
    const typeSelect = root.querySelector<HTMLSelectElement>("select[name='decisionType']");
    const playerGroup = root.querySelector<HTMLElement>("[data-fsd-single-player]");
    if (typeSelect && playerGroup) playerGroup.hidden = typeSelect.value !== "single";
  }

  /**
   * Pull edits made since the last render out of the DOM. Every re-render
   * rebuilds the fields from `this.decisionTitle`/`decisionDescription`/
   * `decisionType`/`singlePlayerId`, so anything changed since the last render
   * has to be harvested first — otherwise adding, editing, removing, or
   * reordering an option would discard them.
   */
  private readFromDom(): void {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    this.decisionTitle = root.querySelector<HTMLInputElement>("input[name='title']")?.value ?? "";
    this.decisionDescription =
      root.querySelector<HTMLTextAreaElement>("textarea[name='description']")?.value ?? "";
    this.decisionType =
      (root.querySelector<HTMLSelectElement>("select[name='decisionType']")
        ?.value as DecisionType) || "groupMajority";
    this.singlePlayerId =
      root.querySelector<HTMLSelectElement>("select[name='singlePlayer']")?.value ?? "";
  }

  /** The index of the option row a `data-fsd-option` descendant belongs to. */
  private optionIndexOf(el: HTMLElement): number {
    const row = el.closest("[data-fsd-option]");
    if (!row?.parentElement) return -1;
    return Array.from(row.parentElement.children).indexOf(row);
  }

  private onAddOption(): void {
    new StoryDecisionOptionApp({ title: "", description: "", image: "" }, (option) => {
      // Harvested here, not before the popup opens — the GM may have kept
      // typing in the title/description fields while it was open.
      this.readFromDom();
      this.decisionOptions.push(option);
      void this.render();
    }).render(true);
  }

  private onEditOption(el: HTMLElement): void {
    const index = this.optionIndexOf(el);
    const current = this.decisionOptions[index];
    if (!current) return;

    new StoryDecisionOptionApp(current, (option) => {
      this.readFromDom();
      this.decisionOptions[index] = option;
      void this.render();
    }).render(true);
  }

  private onRemoveOption(el: HTMLElement): void {
    const index = this.optionIndexOf(el);
    if (index < 0) return;
    this.readFromDom();
    this.decisionOptions.splice(index, 1);
    void this.render();
  }

  /**
   * Open the draft for voting. Option ids are generated here, not carried in
   * the draft — a fresh id per Ask is fine since votes are always keyed to a
   * fresh `DecisionState.id` too, and it keeps `StoryDecisionOptionApp`'s
   * shape (title/description/image only) from needing to know about ids at all.
   */
  private async onAsk(): Promise<void> {
    this.readFromDom();

    if (this.decisionOptions.length === 0) {
      ui.notifications?.warn(game.i18n.localize("FSD.StoryDecision.NeedsOptions"));
      return;
    }
    if (this.decisionType === "single" && !this.singlePlayerId) {
      ui.notifications?.warn(game.i18n.localize("FSD.StoryDecision.NeedsPlayer"));
      return;
    }

    const started = await startDecision({
      title: this.decisionTitle,
      description: this.decisionDescription,
      options: this.decisionOptions.map((option) => ({
        ...option,
        id: foundry.utils.randomID(),
      })),
      type: this.decisionType,
      singlePlayerId: this.singlePlayerId,
    });
    if (started) await this.close();
  }

  /**
   * Reset the draft to blank. Public (unlike the rest of this class's
   * mutators) so `module.ts` can call it once an asked decision resolves,
   * alongside the GM's own Clear button. Safe to call while the window is
   * closed — the empty draft is just what the next open starts from.
   */
  clearDraft(): void {
    this.decisionTitle = "";
    this.decisionDescription = "";
    this.decisionOptions = [];
    this.decisionType = "groupMajority";
    this.singlePlayerId = "";
    if (this.rendered) void this.render();
  }

  /** Confirm before wiping anything the GM would actually lose. */
  private async onClearDraft(): Promise<void> {
    this.readFromDom();
    const hasDraft =
      this.decisionTitle.length > 0 ||
      this.decisionDescription.length > 0 ||
      this.decisionOptions.length > 0;

    if (hasDraft) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("FSD.StoryDecision.Clear") },
        content: `<p>${game.i18n.localize("FSD.StoryDecision.ClearConfirm")}</p>`,
        rejectClose: false,
      });
      if (!confirmed) return;
    }
    this.clearDraft();
  }

  /**
   * Native HTML5 drag-and-drop reordering. One delegated listener set, bound
   * once like the click dispatch in `ConfigWindow` — `dragIndex` lives in this
   * closure rather than a field since it only ever matters mid-gesture, between
   * a `dragstart` and the `drop`/`dragend` that follows it.
   */
  override _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root || root.dataset["fsdDndBound"]) return;
    root.dataset["fsdDndBound"] = "1";

    let dragIndex: number | null = null;

    const rowOf = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.closest?.("[data-fsd-option]") as HTMLElement | null;

    root.addEventListener("dragstart", (event: DragEvent) => {
      const row = rowOf(event.target);
      if (!row) return;
      dragIndex = this.optionIndexOf(row);
      row.classList.add("dragging");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    root.addEventListener("dragover", (event: DragEvent) => {
      if (dragIndex === null || !rowOf(event.target)) return;
      // Required to allow a drop — browsers reject it by default.
      event.preventDefault();
    });

    root.addEventListener("drop", (event: DragEvent) => {
      if (dragIndex === null) return;
      event.preventDefault();
      const dropIndex = this.optionIndexOf(rowOf(event.target) ?? root);
      const from = dragIndex;
      dragIndex = null;
      if (dropIndex < 0 || dropIndex === from) return;

      this.readFromDom();
      const [moved] = this.decisionOptions.splice(from, 1);
      if (moved) this.decisionOptions.splice(dropIndex, 0, moved);
      void this.render();
    });

    root.addEventListener("dragend", (event: DragEvent) => {
      rowOf(event.target)?.classList.remove("dragging");
      dragIndex = null;
    });
  }
}

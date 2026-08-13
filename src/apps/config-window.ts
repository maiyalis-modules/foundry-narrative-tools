/**
 * Shared base for the module's own settings windows — as opposed to
 * `StoryDeckApp`, which is the feature itself, not a settings editor.
 *
 * Foundry v14 gives every module exactly one flat category in Configure Settings —
 * `SettingsConfig` extends `CategoryBrowser`, with no notion of a sub-tab. So each
 * group of settings gets its own `ApplicationV2`, opened from a button in that
 * category, and this class holds what those windows have in common: the
 * delegated click dispatch, and saving a set of checkboxes back to
 * `game.settings`. Mirrors Maiyalis: Utility Suite's `ConfigWindow`.
 *
 * A subclass supplies `PARTS`, a window title, an id, and {@link settingKeys}.
 */
import { MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ConfigWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  // Typed loosely on purpose: Foundry merges DEFAULT_OPTIONS along the inheritance
  // chain, so a subclass supplies only the keys it changes — which an inferred
  // literal type would reject as an incomplete override.
  static DEFAULT_OPTIONS: AnyObject = {
    // A form element so the controls pick up Foundry's settings styling. Nothing
    // is submitted through the form plumbing — see `_onRender`.
    tag: "form",
    // `standard-form` is what supplies `.tab.active { display: flex }` for any
    // tabbed subclass; the base `.tab[data-tab]:not(.active) { display: none }`
    // rule does the hiding. That pair is why no window here needs tab CSS.
    classes: [MODULE_ID, "fsd-config", "standard-form"],
    window: {
      resizable: true,
    },
    position: {
      width: 560,
      height: "auto",
    },
  };

  /**
   * Keys of the boolean settings this window edits. The `name` attribute of each
   * checkbox in the templates is its key, which is how {@link onSave} reads them
   * back without a per-field list.
   */
  protected settingKeys: readonly string[] = [];

  /** Read a boolean setting without caring whether it has ever been written. */
  protected static flag(key: string): boolean {
    return game.settings.get(MODULE_ID, key) === true;
  }

  /**
   * Hand each tab part its own tab descriptor, which is what supplies the
   * `data-group`/`data-tab`/`active` attributes `changeTab` looks for. A no-op in
   * an untabbed window, where the context carries no `tabs`.
   */
  async _preparePartContext(
    partId: string,
    context: AnyObject,
    options: AnyObject,
  ): Promise<AnyObject> {
    const prepared = (await super._preparePartContext?.(partId, { ...context }, options)) ?? {
      ...context,
    };
    const tab = (prepared["tabs"] as AnyObject | undefined)?.[partId];
    return tab ? { ...prepared, tab } : prepared;
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    // Runs on every render: the parts are re-rendered from scratch, so derived
    // control state has to be reapplied even though the listeners below don't.
    this.refreshControls(root);

    // One delegated listener bound once — ApplicationV2's built-in `actions`
    // dispatch has proven unreliable in this Foundry build (see CLAUDE.md), which
    // is also why tab clicks are driven by hand below even though core's nav
    // template emits `data-action="tab"`.
    if (root.dataset["fsdBound"]) return;
    root.dataset["fsdBound"] = "1";

    root.addEventListener("submit", (event: Event) => event.preventDefault());
    root.addEventListener("change", () => this.refreshControls(root));

    root.addEventListener("click", (event: Event) => {
      const target = event.target as HTMLElement | null;

      const tabLink = target?.closest?.("[data-action='tab']") as HTMLElement | null;
      if (tabLink && root.contains(tabLink)) {
        const { tab, group } = tabLink.dataset;
        if (tab && group) this.changeTab(tab, group);
        return;
      }

      const el = target?.closest?.("[data-fsd]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      const action = el.dataset["fsd"] ?? "";
      if (action === "save") void this.onSave();
      else if (action === "cancel") void this.close();
      else this.onAction(action, el);
    });
  }

  /**
   * Re-derive control state that depends on other controls. Called after every
   * render and on every input change. Does nothing unless a subclass needs it.
   */
  protected refreshControls(_root: HTMLElement): void {}

  /**
   * Handle a `data-fsd` action beyond the built-in "save"/"cancel" — e.g. a
   * growing list's add/remove buttons. Does nothing unless a subclass needs it.
   */
  protected onAction(_action: string, _el: HTMLElement): void {}

  /**
   * Persist {@link settingKeys}. Unchanged settings are skipped, because writing
   * one fires its `onChange` — there is no reason to re-render the HUD just
   * because someone opened this window and pressed Save.
   */
  private async onSave(): Promise<void> {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    for (const key of this.settingKeys) {
      const input = root.querySelector<HTMLInputElement>(`input[name='${key}']`);
      if (!input) continue;
      if (input.checked === ConfigWindow.flag(key)) continue;
      await game.settings.set(MODULE_ID, key, input.checked);
    }

    ui.notifications?.info(game.i18n.localize("FSD.Config.Saved"));
    await this.close();
  }
}

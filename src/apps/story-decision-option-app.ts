/**
 * The **Story Decision option** editor — a small popup opened from the
 * "+ Add Option" button (or from editing an existing option) in
 * `StoryDecisionApp`. Keeping each option's fields in their own dialog rather
 * than inline is what lets the parent list stay compact (thumbnail + title).
 *
 * Not a `ConfigWindow` subclass: that base's Save writes checkboxes to
 * `game.settings`, which doesn't fit a callback-driven text/image editor. This
 * hands its result back through a plain constructor callback instead — the
 * same reason `HotbarPagesConfig` in Maiyalis: Utility Suite is its own
 * standalone `ApplicationV2` rather than sharing that base.
 */
import { MODULE_ID, TEMPLATES } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** One choice the table can pick between. */
export interface DecisionOption {
  title: string;
  description: string;
  image: string;
}

/** `<file-picker>` is a custom form-associated element, not a plain `<input>`. */
interface FilePickerElement extends HTMLElement {
  value: string;
}

export class StoryDecisionOptionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private readonly option: DecisionOption;
  private readonly onSubmit: (option: DecisionOption) => void;

  static DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-story-decision-option`,
    tag: "form",
    classes: [MODULE_ID, "fsd-config", "standard-form"],
    window: {
      title: "FSD.StoryDecision.OptionEditor.Title",
      icon: "fa-solid fa-list-check",
      resizable: true,
    },
    position: {
      width: 480,
      height: "auto",
    },
  };

  static PARTS = {
    main: { template: TEMPLATES.storyDecisionOption },
    footer: { template: TEMPLATES.configFooter },
  };

  constructor(option: DecisionOption, onSubmit: (option: DecisionOption) => void, options: AnyObject = {}) {
    super(options);
    this.option = option;
    this.onSubmit = onSubmit;
  }

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    return { ...context, ...this.option };
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root || root.dataset["fsdBound"]) return;
    root.dataset["fsdBound"] = "1";

    root.addEventListener("submit", (event: Event) => event.preventDefault());

    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-fsd]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      if (el.dataset["fsd"] === "save") void this.onSave();
      else if (el.dataset["fsd"] === "cancel") void this.close();
    });
  }

  private async onSave(): Promise<void> {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    const title = root.querySelector<HTMLInputElement>("input[name='title']")?.value ?? "";
    const description =
      root.querySelector<HTMLTextAreaElement>("textarea[name='description']")?.value ?? "";
    const image = root.querySelector<FilePickerElement>("file-picker[name='image']")?.value ?? "";

    this.onSubmit({ title, description, image });
    await this.close();
  }
}

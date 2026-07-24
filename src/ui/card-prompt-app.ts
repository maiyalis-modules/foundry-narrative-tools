import { MODULE_ID, TEMPLATES } from "../constants.js";
import { emitCardResponse, type PromptPayload } from "../services/socket.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The focused card popup shown on a player's client when a step is played to them.
 * It renders a fully-resolved prompt payload (setup + one question + the spotlight
 * instruction) — deliberately minimal, and it never shows the card's tags/metadata.
 */
export class CardPromptApp extends HandlebarsApplicationMixin(ApplicationV2) {
  private prompt: PromptPayload;

  constructor(prompt: PromptPayload, options: AnyObject = {}) {
    super({
      ...options,
      window: {
        title: game.i18n.format("FSD.CardWindowTitle", { title: prompt.cardTitle }),
        icon: "fa-solid fa-scroll",
      },
    });
    this.prompt = prompt;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-card-prompt`,
    tag: "section",
    window: {
      title: "FSD.CardPromptTitle",
      icon: "fa-solid fa-scroll",
      resizable: true,
    },
    position: {
      width: 480,
      height: "auto",
    },
    classes: [MODULE_ID, "story-deck", "card-prompt"],
  };

  static PARTS = {
    main: {
      template: TEMPLATES.cardPrompt,
    },
  };

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root || root.dataset["fsdBound"]) return;
    root.dataset["fsdBound"] = "1";
    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-fsd]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      if (el.dataset["fsd"] === "submit") void this.submit();
    });
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    return {
      setup: this.prompt.setup,
      question: this.prompt.question,
      handoff: this.prompt.handoff,
    };
  }

  private async submit(): Promise<void> {
    const root = this.element as HTMLElement;
    const input = root.querySelector<HTMLTextAreaElement>("[data-answer]");
    emitCardResponse(this.prompt.cardId, this.prompt.stepIndex, input?.value ?? "");
    // Remind this speaker to hand the spotlight on, when the choice is theirs.
    if (this.prompt.handoff) {
      ui.notifications?.info(
        game.i18n.format("FSD.YourTurnToPass", { instruction: this.prompt.handoff }),
      );
    }
    void this.close();
  }
}

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
    const candidates = this.prompt.handoffCandidates ?? [];
    // A payload sent by an older build carries no history — treat it as none
    // rather than letting the template fail on an undefined list.
    const history = this.prompt.history ?? [];
    return {
      setup: this.prompt.setup,
      question: this.prompt.question,
      history,
      hasHistory: history.length > 0,
      handoff: this.prompt.handoff,
      // The pick is only theirs to make when the hand-off is a player choice AND
      // there's actually someone else online to pass to.
      canChooseNext: this.prompt.handoff !== "" && candidates.length > 0,
      // The hand-off is theirs but nobody else is online — the GM will continue.
      handoffNoPlayers: this.prompt.handoff !== "" && candidates.length === 0,
      candidates,
    };
  }

  private async submit(): Promise<void> {
    const root = this.element as HTMLElement;
    const input = root.querySelector<HTMLTextAreaElement>("[data-answer]");
    const nextPlayerId = this.selectedNextPlayer(root);
    emitCardResponse(this.prompt.cardId, this.prompt.stepIndex, input?.value ?? "", nextPlayerId);
    // Confirm to this speaker who they just passed the spotlight to.
    if (nextPlayerId) {
      const name = this.prompt.handoffCandidates.find((c) => c.id === nextPlayerId)?.name ?? "";
      ui.notifications?.info(game.i18n.format("FSD.PassedTo", { name }));
    }
    void this.close();
  }

  /** The player this speaker chose to answer next, or null when it isn't their call. */
  private selectedNextPlayer(root: HTMLElement): string | null {
    const select = root.querySelector<HTMLSelectElement>("[data-next-player]");
    return select?.value || null;
  }
}

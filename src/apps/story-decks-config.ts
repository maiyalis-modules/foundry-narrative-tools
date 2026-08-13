/**
 * The **Story Decks** settings window — the toggles that used to sit as flat
 * checkboxes under Configure Settings, now grouped behind one button the same
 * way Maiyalis: Utility Suite organizes its own settings.
 *
 * Untabbed on purpose: it is one short list of switches. `customDecks` isn't
 * here — it's hidden storage the deck editor writes directly, never a checkbox.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { isDaggerheart } from "../services/connections-service.js";
import { ConfigWindow } from "./config-window.js";

export class StoryDecksConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-story-decks`,
    window: {
      title: "FSD.StoryDecksConfig.Title",
      icon: "fa-solid fa-book-sparkles",
    },
  };

  static PARTS = {
    main: { template: TEMPLATES.storyDecksConfig },
    footer: { template: TEMPLATES.configFooter },
  };

  protected override settingKeys = [
    SETTINGS.showJournalButton,
    SETTINGS.showGMHud,
    SETTINGS.portraitSpotlight,
    SETTINGS.portraitSpotlightSolo,
    SETTINGS.connections,
  ] as const;

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    const daggerheart = isDaggerheart();
    return {
      ...context,
      showJournalButton: StoryDecksConfig.flag(SETTINGS.showJournalButton),
      showGMHud: StoryDecksConfig.flag(SETTINGS.showGMHud),
      portraitSpotlight: StoryDecksConfig.flag(SETTINGS.portraitSpotlight),
      portraitSpotlightSolo: StoryDecksConfig.flag(SETTINGS.portraitSpotlightSolo),
      connections: daggerheart && StoryDecksConfig.flag(SETTINGS.connections),
      connectionsDisabled: !daggerheart,
      // Handlebars here has no `eq`/ternary helper, so the hint is picked ahead
      // of time rather than branched on in the template.
      connectionsHint: game.i18n.localize(
        daggerheart ? "FSD.Settings.ConnectionsHint" : "FSD.Settings.ConnectionsHintUnavailable",
      ),
    };
  }

  /**
   * Grey out (and force off) the connections round on non-Daggerheart systems —
   * it reads a sheet field that only that system provides. Cosmetic only; the
   * runtime gate is `connectionsEnabled()`, which never trusts the stored value
   * alone.
   */
  protected override refreshControls(root: HTMLElement): void {
    if (isDaggerheart()) return;
    const input = root.querySelector<HTMLInputElement>(`input[name='${SETTINGS.connections}']`);
    if (!input) return;
    input.checked = false;
    input.disabled = true;
  }
}

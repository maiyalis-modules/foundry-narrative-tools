/**
 * The **Story Decisions** settings window — placeholder until the feature
 * itself exists. Story Decisions will prompt players with story-driving
 * choices at the start of a session (e.g. which plot hook kicks things off),
 * resolved by majority vote, weighted random pick, or a single chooser.
 *
 * No real settings yet, so this borrows only `ConfigWindow`'s chrome and close
 * behaviour, not its save-a-checkbox-array behaviour — `settingKeys` stays
 * empty and the template supplies its own Close button rather than the shared
 * Save/Cancel footer.
 */
import { MODULE_ID, TEMPLATES } from "../constants.js";
import { ConfigWindow } from "./config-window.js";

export class StoryDecisionsConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-story-decisions`,
    window: {
      title: "FSD.StoryDecisionsConfig.Title",
      icon: "fa-solid fa-signs-post",
    },
  };

  static PARTS = {
    main: { template: TEMPLATES.storyDecisionsConfig },
  };
}

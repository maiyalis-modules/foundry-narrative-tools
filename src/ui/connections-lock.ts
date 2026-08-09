import { CONNECTIONS_FIELD } from "../constants.js";
import { connectionsEnabled } from "../services/connections-service.js";

/**
 * Make the **Connections** field on a Daggerheart character sheet read-only while
 * the connections round is switched on.
 *
 * The point of the round is that a character's connections are written by the
 * *other* players, through the GM. Leaving the sheet's own editor live alongside
 * that invites two ways to fill the same slots — and a hand-edit mid-round shifts
 * the question positions the pending answer is addressed by.
 *
 * The GM keeps the pencil, as the escape hatch for fixing a typo or a bad answer
 * without switching the whole feature off.
 *
 * ## How it attaches
 *
 * Foundry fires render hooks for every class in an application's chain
 * (`Application##callHooks`), so hooking `renderActorSheetV2` catches Daggerheart's
 * `CharacterSheet` without naming it — the module never depends on a system class
 * that could be renamed.
 *
 * The editor is Foundry's `<prose-mirror>` custom element, which owns a `disabled`
 * property that greys out its own toggle button. Setting that is far safer than
 * removing the button ourselves: the element stays internally consistent, and it
 * un-disables cleanly on the next render when the setting goes off.
 */
export function registerConnectionsLock(): void {
  Hooks.on("renderActorSheetV2", (app: AnyObject, html: HTMLElement | JQuery) => {
    if (!connectionsEnabled()) return;
    if (game.user?.isGM) return;
    if (app?.["document"]?.["type"] !== "character") return;

    const root: HTMLElement | undefined =
      html instanceof HTMLElement ? html : (html as JQuery)?.[0];
    if (!root) return;

    // Match on the suffix: the sheet derives the input's name from the schema
    // field, which may or may not carry the leading `system.` prefix.
    const editors = root.querySelectorAll(
      `prose-mirror[name$="${CONNECTIONS_FIELD}"]`,
    ) as NodeListOf<HTMLElement>;
    for (const editor of editors) {
      (editor as AnyObject)["disabled"] = true;
      editor.setAttribute("disabled", "");
      editor.classList.add("fsd-connections-locked");
      editor.title = game.i18n.localize("FSD.Connections.LockedHint");
    }
  });
}

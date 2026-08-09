import { MODULE_ID } from "../constants.js";
import { getOnlinePlayers, userName } from "../services/foundry-users.js";
import { emptyParticipation, participationByUser, type Participation } from "../services/participation.js";
import { SessionStore } from "../stores/session-store.js";
import { escapeHtml } from "../utils/escape-html.js";

/**
 * The GM's "who answers this?" dialog.
 *
 * Picking well means knowing who has already spoken on this card and who has
 * been carrying the session so far, so the picker shows both alongside the
 * choice rather than leaving the GM to remember it.
 */

/**
 * Only one player picker may be open at a time.
 *
 * Several controls can ask for one (the run list, the card window, prompt-next),
 * and a second dialog stacked on the first is left stranded once the card it was
 * asking about has already been played.
 */
let pickerOpen = false;

/** Show the GM a dialog to pick an online player. Warns + returns null if none. */
export async function selectPlayer(promptText: string): Promise<string | null> {
  if (pickerOpen) return null;

  const players = getOnlinePlayers();
  if (players.length === 0) {
    ui.notifications?.warn(game.i18n.localize("FSD.NoOnlinePlayers"));
    return null;
  }

  const options = players
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
    .join("");
  const content = `<p>${escapeHtml(promptText)}</p>
    <select name="player" style="width: 100%;">${options}</select>
    ${participationTable(players)}`;

  pickerOpen = true;
  try {
    const chosen = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("FSD.PlayCardTitle") },
      // "dialog" is DialogV2's own default class; passing `classes` replaces the
      // list rather than adding to it, so keep it alongside ours. The module +
      // "story-deck" pair is what the surface palette variables key off.
      classes: ["dialog", MODULE_ID, "story-deck", "player-picker"],
      content,
      ok: {
        label: game.i18n.localize("FSD.Play"),
        icon: "fa-solid fa-paper-plane",
        callback: (_event: Event, button: { form: HTMLFormElement }) =>
          (button.form.elements.namedItem("player") as HTMLSelectElement | null)?.value ?? null,
      },
      rejectClose: false,
    });
    return (chosen as string | null) ?? null;
  } catch {
    return null;
  } finally {
    pickerOpen = false;
  }
}

// --- internals --------------------------------------------------------------

/**
 * Who has spoken, and how much, **within the Story Deck being played**: one row
 * per online player, plus any player who answered on the card in play but has
 * since gone offline — otherwise "who has already answered this card" would
 * quietly lose them.
 *
 * The caption names the deck when one is running, because a total that silently
 * changed scope is worse than no total: the GM has to be able to see that "4
 * cards" means four tonight, not four since the campaign began.
 */
function participationTable(players: { id: string; name: string }[]): string {
  const session = SessionStore.load();
  const stats = participationByUser(session);
  const online = new Set(players.map((p) => p.id));
  const activeCard = session.active !== null;

  const offlineAnswerers = activeCard
    ? [...new Set(session.active!.responses.map((r) => r.userId))]
        .filter((id) => !online.has(id))
        .map((id) => ({ id, name: userName(id) }))
    : [];

  const rows = [
    ...players.map((p) => row(p, stats.get(p.id), activeCard, false)),
    ...offlineAnswerers.map((p) => row(p, stats.get(p.id), activeCard, true)),
  ].join("");

  const thisCardHeader = activeCard
    ? `<th scope="col">${game.i18n.localize("FSD.Picker.ThisCard")}</th>`
    : "";

  const caption = session.run
    ? game.i18n.format("FSD.Picker.StatsHeadingRun", { deck: escapeHtml(session.run.recipeName) })
    : game.i18n.localize("FSD.Picker.StatsHeading");

  return `<table class="player-picker__stats">
      <caption>${caption}</caption>
      <thead>
        <tr>
          <th scope="col">${game.i18n.localize("FSD.Picker.Player")}</th>
          ${thisCardHeader}
          <th scope="col">${game.i18n.localize("FSD.Picker.Cards")}</th>
          <th scope="col">${game.i18n.localize("FSD.Picker.Questions")}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function row(
  player: { id: string; name: string },
  stat: Participation | undefined,
  activeCard: boolean,
  offline: boolean,
): string {
  const { cards, questions, thisCard } = stat ?? emptyParticipation();
  const name = offline
    ? `${escapeHtml(player.name)} <span class="player-picker__offline">${game.i18n.localize("FSD.Picker.Offline")}</span>`
    : escapeHtml(player.name);
  const answered = thisCard
    .map((n) => game.i18n.format("FSD.Picker.QuestionNumber", { n }))
    .join(", ");
  const thisCardCell = activeCard
    ? `<td class="${thisCard.length > 0 ? "player-picker__answered" : "player-picker__none"}">${escapeHtml(answered) || "—"}</td>`
    : "";

  return `<tr class="${offline ? "player-picker__row--offline" : ""}">
      <th scope="row">${name}</th>
      ${thisCardCell}
      <td>${cards}</td>
      <td>${questions}</td>
    </tr>`;
}

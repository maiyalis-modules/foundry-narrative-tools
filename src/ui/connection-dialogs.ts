import { MODULE_ID } from "../constants.js";
import {
  emitConnectionPick,
  emitConnectionReply,
  type ConnectionAnswerPayload,
  type ConnectionAskPayload,
} from "../services/socket.js";
import { escapeHtml } from "../utils/escape-html.js";

/**
 * The two player-facing halves of a connection question.
 *
 * Both are `DialogV2`s rather than `ApplicationV2` windows: each is a single
 * question with a single control, the same weight as the GM's player picker they
 * sit alongside — and they reuse its styling for free.
 *
 * Neither dialog reads the session. Everything they show arrives in the payload
 * the GM built, so a player's client needs no shared state and can't race the
 * world-setting sync.
 */

/** Only one connection dialog at a time, mirroring the GM's player picker. */
let dialogOpen = false;

/**
 * Asker side: choose who answers one of your character's connection questions.
 *
 * The candidate list is already filtered by the GM (players who have answered for
 * you are gone, unless that emptied the list) and ordered fairest-first, so the
 * top option is the one that spreads the round most evenly. The tally is shown
 * alongside rather than enforced — an asker with a reason to pick someone busier
 * can still do it.
 */
export async function showConnectionAsk(ask: ConnectionAskPayload): Promise<void> {
  if (dialogOpen || ask.candidates.length === 0) return;

  const options = ask.candidates
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} — ${game.i18n.format(
          "FSD.Connections.AnsweredCount",
          { count: c.answered },
        )}</option>`,
    )
    .join("");

  const content = `
    <p class="story-deck__ask-lead">${escapeHtml(game.i18n.localize("FSD.Connections.AskLead"))}</p>
    <p class="story-deck__ask-question">${escapeHtml(ask.question)}</p>
    <select name="answerer" style="width: 100%;">${options}</select>
    ${candidateTable(ask.candidates)}`;

  dialogOpen = true;
  try {
    const chosen = (await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("FSD.Connections.AskTitle") },
      classes: ["dialog", MODULE_ID, "story-deck", "player-picker", "connection-ask"],
      content,
      ok: {
        label: game.i18n.localize("FSD.Connections.AskConfirm"),
        icon: "fa-solid fa-paper-plane",
        callback: (_event: Event, button: { form: HTMLFormElement }) =>
          (button.form.elements.namedItem("answerer") as HTMLSelectElement | null)?.value ?? null,
      },
      rejectClose: false,
    })) as string | null;

    if (chosen) emitConnectionPick(chosen);
  } catch {
    // Dismissed. The GM's Connections tab still shows the question as pending,
    // and they can cancel or re-run it.
  } finally {
    dialogOpen = false;
  }
}

/**
 * Answerer side: write the answer to somebody else's connection question.
 *
 * The question is phrased from the asker's character's point of view ("What
 * animal do I say you remind me of?"), so the heading names whose sheet it is —
 * without it the pronouns have nobody to attach to.
 */
export async function showConnectionAnswer(ask: ConnectionAnswerPayload): Promise<void> {
  if (dialogOpen) return;

  const content = `
    <p class="story-deck__ask-lead">${escapeHtml(
      game.i18n.format("FSD.Connections.AnswerLead", { name: ask.askerName }),
    )}</p>
    <p class="story-deck__ask-question">${escapeHtml(ask.question)}</p>
    <textarea name="answer" rows="4" style="width: 100%;"></textarea>`;

  dialogOpen = true;
  try {
    const answer = (await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("FSD.Connections.AnswerTitle") },
      classes: ["dialog", MODULE_ID, "story-deck", "card-prompt", "connection-answer"],
      content,
      ok: {
        label: game.i18n.localize("FSD.Submit"),
        icon: "fa-solid fa-paper-plane",
        callback: (_event: Event, button: { form: HTMLFormElement }) =>
          (button.form.elements.namedItem("answer") as HTMLTextAreaElement | null)?.value ?? "",
      },
      rejectClose: false,
    })) as string | null;

    // An empty answer is a dismissal, not a contribution — sending it would mark
    // the question done with nothing in the slot.
    if (answer !== null && answer.trim() !== "") emitConnectionReply(answer.trim());
  } catch {
    // Dismissed; the GM can re-run the question.
  } finally {
    dialogOpen = false;
  }
}

// --- internals --------------------------------------------------------------

/**
 * How much of the round each candidate has already carried.
 *
 * Deliberately the same markup as the GM's participation table so it inherits
 * that styling — the asker is making the same kind of judgement the GM makes when
 * handing out a card, and it should look like it.
 */
function candidateTable(candidates: ConnectionAskPayload["candidates"]): string {
  const rows = candidates
    .map(
      (c) => `<tr>
        <th scope="row">${escapeHtml(c.name)}</th>
        <td>${c.answered}</td>
      </tr>`,
    )
    .join("");

  return `<table class="player-picker__stats">
    <caption>${game.i18n.localize("FSD.Connections.StatsHeading")}</caption>
    <thead>
      <tr>
        <th scope="col">${game.i18n.localize("FSD.Picker.Player")}</th>
        <th scope="col">${game.i18n.localize("FSD.Connections.StatsAnswered")}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

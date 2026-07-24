import { JOURNAL_FOLDER, LOG_PREFIX } from "../constants.js";
import type { DeckEngine } from "../engine/deck-engine.js";
import type { CardResult, DeckRun, RunCardRecord } from "../models/session.js";
import { userName } from "./foundry-users.js";
import { buildTokenContext } from "./token-context.js";
import { escapeHtml } from "../utils/escape-html.js";

/**
 * Writes a finished Story Deck run into the world's journal.
 *
 * The run's own state is the source of truth for structure (which phases, which
 * cards, in what order) and the play log supplies the answers, matched back by
 * `runId`. One page per phase, plus a closing campaign-seed page.
 *
 * GM-only: creating documents requires it, and a run only ever completes on the
 * GM's client.
 */
export async function exportRunToJournal(
  engine: DeckEngine,
  run: DeckRun,
  results: CardResult[],
): Promise<void> {
  if (!game.user?.isGM) return;

  const played = results.filter((r) => r.runId === run.id);
  // A run abandoned before anything was answered has nothing worth writing down.
  if (played.length === 0 && run.cards.length === 0) return;

  try {
    const folder = await ensureFolder();

    const pages = [
      ...run.phases.map((phase, index) => ({
        name: `${index + 1}. ${phase.name}`,
        type: "text",
        title: { show: true, level: 1 },
        text: {
          format: 1,
          content: phasePage(engine, phase.description, phase.cardIds, played),
        },
      })),
      {
        name: game.i18n.localize("FSD.Journal.SeedPage"),
        type: "text",
        title: { show: true, level: 1 },
        text: { format: 1, content: developPage(run.cards) },
      },
    ];

    const entry = await JournalEntry.create({
      name: `${run.recipeName} — ${new Date(run.completedAt ?? Date.now()).toLocaleDateString()}`,
      folder: folder?.id ?? null,
      pages,
    });

    if (entry) {
      ui.notifications?.info(
        game.i18n.format("FSD.Journal.Created", { name: entry.name ?? run.recipeName }),
      );
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Could not write the run to a journal entry.`, error);
    ui.notifications?.error(game.i18n.localize("FSD.Journal.Failed"));
  }
}

/** Find (or create) the "Story Decks" journal folder. */
async function ensureFolder(): Promise<Folder | undefined> {
  const existing = game.folders?.find(
    (f: Folder) => f.type === "JournalEntry" && f.name === JOURNAL_FOLDER,
  );
  if (existing) return existing;
  return (await Folder.create({ name: JOURNAL_FOLDER, type: "JournalEntry" })) ?? undefined;
}

/** One phase: its framing, then each card's questions with the answers given. */
function phasePage(
  engine: DeckEngine,
  description: string,
  cardIds: string[],
  played: CardResult[],
): string {
  const parts: string[] = [];
  if (description) parts.push(`<p><em>${escapeHtml(description)}</em></p>`);

  for (const cardId of cardIds) {
    const card = engine.getCard(cardId);
    const result = played.find((r) => r.cardId === cardId);
    const title = card?.title ?? result?.title ?? cardId;

    parts.push(`<h2>${escapeHtml(title)}</h2>`);

    if (!result) {
      // Drawn but never played — the GM skipped it, or the run ended first.
      parts.push(`<p><em>${escapeHtml(game.i18n.localize("FSD.Journal.NotPlayed"))}</em></p>`);
      continue;
    }
    if (!card) {
      parts.push(`<p><em>${escapeHtml(game.i18n.localize("FSD.CardMissing"))}</em></p>`);
      continue;
    }

    // Resolve `{{tokens}}` against what was actually said, so the journal reads
    // the way the table heard it rather than showing raw placeholders.
    const ctx = buildTokenContext(result);
    for (const [index, step] of card.steps.entries()) {
      const response = result.responses.find((r) => r.stepIndex === index);
      const answer = String(response?.value ?? "").trim();
      if (!answer) continue;

      const setup = engine.renderSetup(step, ctx);
      if (setup) parts.push(`<p class="fsd-setup"><em>${escapeHtml(setup)}</em></p>`);
      parts.push(`<p><strong>${escapeHtml(engine.renderQuestion(step, ctx))}</strong></p>`);
      parts.push(
        `<p>${escapeHtml(answer)}<br><em>— ${escapeHtml(userName(response!.userId))}</em></p>`,
      );
    }
  }

  return parts.join("\n");
}

/**
 * The closing page: a GM to-do list, not an entity dump.
 *
 * Schema v3 keeps outputs card-level and descriptive, so this lists each kind of
 * element the run's cards touched on and which cards raised it — prompts the GM
 * can turn into NPCs, places, and hooks by hand, on their own terms.
 */
function developPage(cards: RunCardRecord[]): string {
  if (cards.length === 0) {
    return `<p><em>${escapeHtml(game.i18n.localize("FSD.Seed.Empty"))}</em></p>`;
  }

  // output type -> the card titles that raised it
  const byOutput = new Map<string, Set<string>>();
  for (const card of cards) {
    for (const output of card.outputs) {
      (byOutput.get(output) ?? byOutput.set(output, new Set()).get(output)!).add(card.cardTitle);
    }
  }

  if (byOutput.size === 0) {
    return `<p><em>${escapeHtml(game.i18n.localize("FSD.Seed.Empty"))}</em></p>`;
  }

  const parts: string[] = [
    `<p><em>${escapeHtml(game.i18n.localize("FSD.Journal.DevelopIntro"))}</em></p>`,
  ];
  for (const [output, titles] of byOutput) {
    parts.push(`<h2>${escapeHtml(game.i18n.localize(`FSD.Seed.${output}`))}</h2>`);
    parts.push("<ul>");
    for (const title of titles) parts.push(`<li>${escapeHtml(title)}</li>`);
    parts.push("</ul>");
  }
  return parts.join("\n");
}


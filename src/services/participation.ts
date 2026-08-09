import type { StepResponse, StoryDeckSession } from "../models/session.js";
import { SessionStore } from "../stores/session-store.js";

/**
 * How much of the Story Deck in play a player has contributed to, used to keep
 * the spotlight spread evenly when the GM picks who answers next.
 *
 * "Involved with" is measured by answers given, not by assignment: a step a
 * player was handed but walked away from counts for neither total.
 */
export interface Participation {
  /** Distinct cards in the current run they have answered at least one question on. */
  cards: number;
  /** Questions they have answered in the current run, totalled across its cards. */
  questions: number;
  /** 1-based question numbers they have answered on the card in play. */
  thisCard: number[];
}

export function emptyParticipation(): Participation {
  return { cards: 0, questions: 0, thisCard: [] };
}

/**
 * Tally participation per user id for the Story Deck currently being played,
 * plus the card in play.
 *
 * Scope is **this run only**, not all history. The GM is deciding who speaks
 * next in *this* deck, so a player who carried last month's deck should not read
 * as over-served tonight — and `results` is the full log, spanning every run and
 * every standalone card ever played.
 *
 * The run's own `cards` is the source rather than `results` filtered by
 * `runId`: it is the run's self-contained copy of the same finished plays, so it
 * survives the GM clearing or pruning the log mid-run. Counting both would
 * double every card. With no run going, the comparable scope is cards played
 * outside any run. Either way the active card is folded in too, so the counts a
 * GM sees while choosing the next speaker already include what this card has
 * cost each player.
 */
export function participationByUser(
  session: StoryDeckSession = SessionStore.load(),
): Map<string, Participation> {
  const stats = new Map<string, Participation>();
  const entry = (userId: string): Participation => {
    let found = stats.get(userId);
    if (!found) stats.set(userId, (found = emptyParticipation()));
    return found;
  };

  if (session.run) {
    for (const card of session.run.cards) tallyCard(card.responses, entry);
  } else {
    for (const result of session.results) {
      if (result.runId === null) tallyCard(result.responses, entry);
    }
  }

  const active = session.active;
  if (active) {
    tallyCard(active.responses, entry);
    for (const response of active.responses) entry(response.userId).thisCard.push(response.stepIndex + 1);
    // Re-answering a step rewrites it at the end of the list, so answer order
    // isn't reliably question order — sort for display.
    for (const stat of stats.values()) stat.thisCard.sort((a, b) => a - b);
  }

  return stats;
}

/** Add one card's answers: a question each, and a single card per distinct answerer. */
function tallyCard(responses: StepResponse[], entry: (userId: string) => Participation): void {
  const seen = new Set<string>();
  for (const response of responses) {
    const stat = entry(response.userId);
    stat.questions += 1;
    if (!seen.has(response.userId)) {
      seen.add(response.userId);
      stat.cards += 1;
    }
  }
}

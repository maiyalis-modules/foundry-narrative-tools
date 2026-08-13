import type { DecisionState } from "../models/session.js";

/**
 * Turns a Story Decision's votes into a winning option id. Pure and
 * Foundry-free (the caller injects the RNG) so it can be unit-tested the same
 * way `card-selector.ts` is.
 */

/** Votes tallied per option id, in `state.options` order. */
export function tallyVotes(state: DecisionState): Map<string, number> {
  const tally = new Map(state.options.map((o) => [o.id, 0]));
  for (const optionId of Object.values(state.votes)) {
    if (tally.has(optionId)) tally.set(optionId, (tally.get(optionId) ?? 0) + 1);
  }
  return tally;
}

/**
 * The winning option — `null` only when there are no options at all to choose
 * from. Every other "nothing to go on" case (a `"single"` decision whose
 * designated player never voted, a group decision nobody voted in) falls back
 * to a uniform draw across every option rather than resolving to nothing.
 *
 * That fallback matters beyond "some answer is nicer than none": the vote
 * screen's reveal (`revealWinner()` in `story-decision-vote-app.ts`) hides
 * every tile *except* the winner's — a `winnerOptionId` that doesn't match any
 * option hides all of them, with nothing left to dismiss the screen from.
 * `endVoting()` in `decision-service.ts` already refuses to resolve with zero
 * votes cast at all, so this is the second, unconditional layer against that.
 *
 * - `"single"`: whatever the designated player picked.
 * - `"groupMajority"`: the most-voted option; a tie is broken at random among
 *   the leaders.
 * - `"groupRandom"`: a weighted draw over voted options only — 3 votes to 2
 *   is a 60/40 draw, not a coin flip.
 */
export function resolveWinner(state: DecisionState, rng: () => number = Math.random): string | null {
  if (state.options.length === 0) return null;

  if (state.type === "single") {
    const chosen = state.votes[state.singlePlayerId];
    if (state.options.some((o) => o.id === chosen)) return chosen!;
    return pick(state.options, rng)?.id ?? null;
  }

  const tally = tallyVotes(state);
  const totalVotes = Array.from(tally.values()).reduce((sum, n) => sum + n, 0);

  if (totalVotes === 0) {
    // Nobody voted — draw uniformly rather than resolving to nothing.
    return pick(state.options, rng)?.id ?? null;
  }

  if (state.type === "groupMajority") {
    const max = Math.max(...tally.values());
    const leaders = state.options.filter((o) => tally.get(o.id) === max);
    return pick(leaders, rng)?.id ?? null;
  }

  // groupRandom
  let roll = rng() * totalVotes;
  for (const option of state.options) {
    const weight = tally.get(option.id) ?? 0;
    if (weight <= 0) continue;
    if (roll < weight) return option.id;
    roll -= weight;
  }
  // Floating-point rounding can leave `roll` a hair over the last slice —
  // land on the last voted option rather than falling through to nothing.
  return [...state.options].reverse().find((o) => (tally.get(o.id) ?? 0) > 0)?.id ?? null;
}

function pick<T>(items: readonly T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

import { LOG_PREFIX } from "../constants.js";
import type { CardSelection } from "../models/story-deck-recipe.js";
import type { StoryCard } from "../models/story-card.js";

/**
 * Chooses which cards a phase presents, by filtering the card library against a
 * phase's selection rules.
 *
 * Pure and Foundry-free so it can be unit-tested; the caller injects the RNG and
 * the set of already-played cards.
 *
 * ## Extensibility
 *
 * Filters are a **registry**, not a hard-coded chain. Every key present in a
 * selection block is looked up in `MATCHERS` and applied; unknown keys are ignored
 * with a warning rather than silently narrowing (or silently widening) the pool.
 * Supporting a future filter — difficulty, tone, campaign tier, estimated duration,
 * required previous cards — is a single new registry entry. Nothing else changes.
 */

/** Decides whether one card satisfies one filter value. */
export type CardMatcher = (
  card: StoryCard,
  value: unknown,
  ctx: { match: "any" | "all" },
) => boolean;

/** Keys that configure selection rather than filter cards, so they never match. */
const NON_FILTER_KEYS = new Set(["mode", "match", "count", "preferUnused"]);

export const MATCHERS: Record<string, CardMatcher> = {
  themes: (card, value) => asArray(value).includes(card.theme),
  scopes: (card, value) => asArray(value).includes(card.scope),
  outputs: (card, value, ctx) => quantify(card.outputs ?? [], asArray(value), ctx.match),
  tags: (card, value, ctx) => quantify(card.tags ?? [], asArray(value), ctx.match),
  excludeCardIds: (card, value) => !asArray(value).includes(card.id),
  // Back-compat alias: older recipes filtered on `categories`, which is now `theme`.
  categories: (card, value) => asArray(value).includes(card.theme),
};

export interface SelectContext {
  /** Cards already played during this run — skipped first when `preferUnused`. */
  usedCardIds?: string[];
  /** When true, never repeat a used card: run the phase short instead. */
  avoidDuplicates?: boolean;
  /**
   * Phases still to come in this run. Cards that a later phase cannot do without
   * are drawn last here, so an early broad phase does not strand a narrow one.
   */
  upcoming?: { selection: CardSelection; count: number }[];
  /** Injectable RNG (defaults to Math.random) for deterministic tests. */
  rng?: () => number;
}

export interface SelectResult {
  cards: StoryCard[];
  /** True when the pool could not supply `count` cards. */
  short: boolean;
  /** True when already-played cards had to be reused to fill the phase. */
  reused: boolean;
}

/** Every card in `cards` that satisfies the selection's filters. */
export function matchingCards(cards: readonly StoryCard[], selection: CardSelection): StoryCard[] {
  const match = selection.match === "all" ? "all" : "any";

  const filters = Object.entries(selection).filter(([key, value]) => {
    if (NON_FILTER_KEYS.has(key) || value === undefined || value === null) return false;
    if (!MATCHERS[key]) {
      console.warn(
        `${LOG_PREFIX} Unknown selection filter "${key}" — ignoring. ` +
          `Register a matcher in card-selector.ts to support it.`,
      );
      return false;
    }
    // An empty list is not a constraint; treating it as one would match nothing.
    return !(Array.isArray(value) && value.length === 0);
  });

  return cards.filter((card) =>
    filters.every(([key, value]) => MATCHERS[key]!(card, value, { match })),
  );
}

/**
 * Pick `count` cards for a phase.
 *
 * Falls back gently rather than failing: prefer cards not yet played, then allow
 * already-played ones, and if the pool still cannot fill the phase, return what
 * there is and flag it `short` so the UI can tell the GM plainly.
 *
 * When the deck sets `avoidDuplicateCards`, the reuse step is skipped entirely —
 * a short phase is far less confusing at the table than replaying a card the group
 * has already answered.
 */
export function selectCards(
  cards: readonly StoryCard[],
  selection: CardSelection,
  count: number,
  ctx: SelectContext = {},
): SelectResult {
  const rng = ctx.rng ?? Math.random;
  const used = new Set(ctx.usedCardIds ?? []);
  const pool = matchingCards(cards, selection);

  const unused = selection.preferUnused === false ? pool : pool.filter((c) => !used.has(c.id));

  // Spend freely-available cards before scarce ones, so a broad early phase does
  // not consume the only card a narrow later phase could have used.
  const reserved = reservedFor(cards, ctx.upcoming ?? [], used);
  const spare = unused.filter((c) => !reserved.has(c.id));
  const scarce = unused.filter((c) => reserved.has(c.id));

  const picked = drawRandom(spare, count, rng);
  if (picked.length < count) {
    picked.push(...drawRandom(scarce, count - picked.length, rng));
  }

  // Not enough fresh cards — top up from the ones already played, unless the deck
  // forbids duplicates, in which case a short phase is the better outcome.
  let reused = false;
  if (picked.length < count && !ctx.avoidDuplicates) {
    const chosen = new Set(picked.map((c) => c.id));
    const remainder = pool.filter((c) => !chosen.has(c.id));
    const topUp = drawRandom(remainder, count - picked.length, rng);
    if (topUp.length > 0) reused = true;
    picked.push(...topUp);
  }

  return { cards: picked, short: picked.length < count, reused };
}

/**
 * Cards that an upcoming phase cannot afford to lose.
 *
 * A phase whose remaining pool is no bigger than the number of cards it needs has
 * no slack: every card in it is effectively spoken for. Those ids are held back
 * from earlier draws. Deliberately a single pass — it fixes the common case (a
 * narrow finale competing with a broad early phase) without turning card
 * selection into a constraint solver.
 */
function reservedFor(
  cards: readonly StoryCard[],
  upcoming: { selection: CardSelection; count: number }[],
  used: Set<string>,
): Set<string> {
  const reserved = new Set<string>();
  for (const phase of upcoming) {
    const pool = matchingCards(cards, phase.selection).filter((c) => !used.has(c.id));
    if (pool.length > 0 && pool.length <= phase.count) {
      for (const card of pool) reserved.add(card.id);
    }
  }
  return reserved;
}

/** Draw up to `count` distinct cards at random (partial Fisher–Yates). */
function drawRandom(cards: readonly StoryCard[], count: number, rng: () => number): StoryCard[] {
  const pool = [...cards];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, take);
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

/** `any` — the card has at least one wanted value; `all` — it has every one. */
function quantify(cardValues: string[], wanted: string[], match: "any" | "all"): boolean {
  return match === "all"
    ? wanted.every((w) => cardValues.includes(w))
    : wanted.some((w) => cardValues.includes(w));
}

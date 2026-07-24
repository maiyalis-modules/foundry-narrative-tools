import type { CardStep, StoryCard, CardLibrary } from "../models/story-card.js";
import { LOG_PREFIX } from "../constants.js";

/**
 * Loads Story Card JSON into typed `CardLibrary` structures.
 *
 * Loading is separated from the engine so cards can come from anywhere: bundled
 * files, a compendium pack, or a remote URL. Validation here is intentionally
 * light (shape checks only); full schema validation can be layered on in Phase 3.
 */
export class CardLoader {
  /** Fetch and parse a deck from a URL/path reachable by the browser. */
  static async fromUrl(url: string): Promise<CardLibrary> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${LOG_PREFIX} Failed to load deck from ${url}: ${response.status}`);
    }
    const data: unknown = await response.json();
    return CardLoader.fromData(data);
  }

  /** Build a deck from already-parsed data (bundled cards, socket payloads…). */
  static fromData(data: unknown): CardLibrary {
    if (!isRecord(data)) {
      throw new Error(`${LOG_PREFIX} Deck data must be an object.`);
    }

    const rawCards = Array.isArray(data.cards) ? data.cards : [];
    const cards = rawCards.filter(isStoryCard);

    if (cards.length !== rawCards.length) {
      console.warn(
        `${LOG_PREFIX} Skipped ${rawCards.length - cards.length} malformed card(s) while loading deck.`,
      );
    }

    // A deck names itself with `name` (schema v2); `title` is accepted as an alias.
    const name = typeof data.name === "string" ? data.name : data.title;

    return {
      id: typeof data.id === "string" ? data.id : "unknown-deck",
      title: typeof name === "string" ? name : "Untitled Deck",
      ...(typeof data.description === "string" ? { description: data.description } : {}),
      ...(isRecord(data.spotlightRules) ? { spotlightRules: data.spotlightRules } : {}),
      cards,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Minimal structural guard — enough to keep obviously-broken cards out. */
function isStoryCard(value: unknown): value is StoryCard {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.theme === "string" &&
    typeof value.scope === "string" &&
    Array.isArray(value.steps) &&
    value.steps.length > 0 &&
    value.steps.every(isCardStep)
  );
}

/** Every step must ask exactly one question of exactly one participant. */
function isCardStep(value: unknown): value is CardStep {
  if (!isRecord(value)) return false;
  return (
    typeof value.question === "string" &&
    isRecord(value.participant) &&
    typeof value.participant.role === "string"
  );
}

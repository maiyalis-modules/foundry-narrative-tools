import { LOG_PREFIX } from "../constants.js";
import type { DeckPhase, StoryDeckRecipe } from "../models/story-deck-recipe.js";

/**
 * Loads Story Deck recipes from JSON.
 *
 * Mirrors `card-loader.ts`: validation is intentionally light (shape checks only)
 * and malformed entries are skipped with a warning rather than failing the whole
 * load, so one bad custom deck can never stop the module from opening.
 */
export class RecipeLoader {
  /** Fetch and parse recipes from a URL/path reachable by the browser. */
  static async fromUrl(url: string): Promise<StoryDeckRecipe[]> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${LOG_PREFIX} Failed to load story decks from ${url}: ${response.status}`);
    }
    const data: unknown = await response.json();
    return RecipeLoader.fromData(data);
  }

  /** Build recipes from already-parsed data (bundled packs, custom decks…). */
  static fromData(data: unknown): StoryDeckRecipe[] {
    if (!isRecord(data)) {
      console.warn(`${LOG_PREFIX} Story deck data must be an object.`);
      return [];
    }

    const raw = Array.isArray(data.decks) ? data.decks : [];
    const recipes = raw.filter(isRecipe).map(normalize);

    if (recipes.length !== raw.length) {
      console.warn(
        `${LOG_PREFIX} Skipped ${raw.length - recipes.length} malformed story deck(s).`,
      );
    }

    return recipes;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecipe(value: unknown): value is StoryDeckRecipe {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.phases) &&
    value.phases.length > 0 &&
    value.phases.every(isPhase)
  );
}

function isPhase(value: unknown): value is DeckPhase {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.count === "number" &&
    value.count > 0 &&
    isRecord(value.selection)
  );
}

/** Fill in the optional fields the runtime reads, so callers never guard them. */
function normalize(recipe: StoryDeckRecipe): StoryDeckRecipe {
  return {
    ...recipe,
    description: recipe.description ?? "",
    type: recipe.type === "custom" ? "custom" : "premade",
    phases: recipe.phases.map((p) => ({ ...p, description: p.description ?? "" })),
  };
}

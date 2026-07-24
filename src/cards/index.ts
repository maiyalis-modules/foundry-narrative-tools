import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { CardLoader } from "../services/card-loader.js";
import { RecipeLoader } from "../services/recipe-loader.js";
import type { CardLibrary } from "../models/story-card.js";
import type { StoryDeckRecipe } from "../models/story-deck-recipe.js";

/** Path (relative to the module root) of the bundled card library. */
const CARD_LIBRARY_PATH = `modules/${MODULE_ID}/packs/storydeck/story-cards.json`;

/** Bundled Story Deck recipe packs, loaded in order. Add a file, add a line.
 *
 * session-0.json is parked: its phases filter on themes that don't exist in the
 * library yet (only `relationships` is authored so far). Re-add it once the other
 * themes have cards, and update its phase filters from `categories` to `themes`. */
const RECIPE_PATHS = [
  `modules/${MODULE_ID}/packs/storydecks/test-deck.json`,
  `modules/${MODULE_ID}/packs/storydecks/campaigns.json`,
];

/** A tiny fallback so the module still opens if the JSON fails to load. */
const FALLBACK_LIBRARY: CardLibrary = {
  id: "fallback-library",
  title: "Story Deck (empty)",
  cards: [],
};

/**
 * Load the card library the module ships with. Content lives entirely in JSON —
 * swap the path or load additional libraries without touching the engine.
 */
export async function loadDefaultDeck(): Promise<CardLibrary> {
  try {
    return await CardLoader.fromUrl(CARD_LIBRARY_PATH);
  } catch (error) {
    console.error(`${LOG_PREFIX} Could not load card library; using fallback.`, error);
    return FALLBACK_LIBRARY;
  }
}

/**
 * Load every Story Deck recipe available: the bundled ones plus any the GM has
 * saved. Custom decks live in a world setting so the future deck editor writes
 * there and is picked up here with no runtime change.
 */
export async function loadRecipes(): Promise<StoryDeckRecipe[]> {
  // One bad pack shouldn't cost you the others, so each is loaded independently.
  const loaded = await Promise.all(
    RECIPE_PATHS.map(async (path) => {
      try {
        return await RecipeLoader.fromUrl(path);
      } catch (error) {
        console.error(`${LOG_PREFIX} Could not load story decks from ${path}.`, error);
        return [];
      }
    }),
  );
  const bundled = loaded.flat();

  const stored = game.settings.get(MODULE_ID, SETTINGS.customDecks);
  const custom = RecipeLoader.fromData({ decks: Array.isArray(stored) ? stored : [] });

  return [...bundled, ...custom];
}

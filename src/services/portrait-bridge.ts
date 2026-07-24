import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";

/**
 * Optional integration with **Ginzzzu's Portraits & NPC Dock**
 * (`ginzzzu-portraits`): raise the spotlighted player's character portrait while
 * it is their turn to speak.
 *
 * Everything here degrades to a no-op when that module is absent or disabled, so
 * it is never a dependency — only an enhancement.
 *
 * ## How it talks to that module
 *
 * `globalThis.GinzzzuPortraits.togglePortrait(actor)` is its public entry point.
 * It is GM-only and works by writing an actor flag, which Foundry replicates to
 * every client — so one call from the GM raises the portrait on everyone's
 * screen. We read that same flag to know the current state, because the call is
 * a *toggle*: firing it blindly would hide a portrait that is already up.
 */

const PORTRAITS_MODULE = "ginzzzu-portraits";
const SHOWN_FLAG = `flags.${PORTRAITS_MODULE}.portraitShown`;

interface PortraitsApi {
  togglePortrait(actorOrId: unknown): Promise<void>;
}

/**
 * Portraits this module raised, so we only ever lower our own.
 *
 * A GM may have pinned a portrait by hand before play started; closing it out
 * from under them would be rude. GM-client only and intentionally not persisted —
 * a reload simply leaves those portraits alone.
 */
const raisedByUs = new Set<string>();

/** The portraits API, or `null` when the module isn't available to us. */
function api(): PortraitsApi | null {
  if (!game.user?.isGM) return null;
  if (!game.modules.get(PORTRAITS_MODULE)?.active) return null;
  const found = (globalThis as { GinzzzuPortraits?: PortraitsApi }).GinzzzuPortraits;
  return typeof found?.togglePortrait === "function" ? found : null;
}

/** Whether the integration can currently do anything. */
export function portraitsAvailable(): boolean {
  return api() !== null;
}

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.portraitSpotlight) !== false;
}

/** The actor a user speaks through, if they have one assigned. */
function actorForUser(userId: string): { id: string } | undefined {
  const users = (game.users as { get?: (id: string) => AnyObject | undefined })?.get;
  const user = typeof users === "function" ? users.call(game.users, userId) : undefined;
  return (user?.["character"] as { id: string } | undefined) ?? undefined;
}

/** Raise or lower one portrait, but only when it isn't already in that state. */
async function setShown(portraits: PortraitsApi, actorId: string, shown: boolean): Promise<void> {
  const actor = (game.actors as { get?: (id: string) => AnyObject | undefined })?.get?.(actorId);
  if (!actor) return;
  const current = Boolean(foundry.utils.getProperty(actor, SHOWN_FLAG));
  if (current === shown) return;
  await portraits.togglePortrait(actor);
}

/**
 * Put the spotlight on these users: raise their portraits and, unless the GM has
 * asked for portraits to accumulate, lower the ones we raised for whoever spoke
 * before them.
 */
export async function spotlightPortraits(userIds: string[]): Promise<void> {
  const portraits = api();
  if (!portraits || !enabled()) return;

  const wanted = new Set(
    userIds.map((id) => actorForUser(id)?.id).filter((id): id is string => Boolean(id)),
  );

  try {
    const solo = game.settings.get(MODULE_ID, SETTINGS.portraitSpotlightSolo) !== false;
    if (solo) {
      for (const actorId of [...raisedByUs]) {
        if (wanted.has(actorId)) continue;
        await setShown(portraits, actorId, false);
        raisedByUs.delete(actorId);
      }
    }

    for (const actorId of wanted) {
      await setShown(portraits, actorId, true);
      raisedByUs.add(actorId);
    }
  } catch (error) {
    // Never let a cosmetic integration interrupt play.
    console.warn(`${LOG_PREFIX} Portrait spotlight failed.`, error);
  }
}

/** Lower every portrait this module raised — end of a card, or end of a run. */
export async function clearPortraits(): Promise<void> {
  const portraits = api();
  if (!portraits) {
    raisedByUs.clear();
    return;
  }

  try {
    for (const actorId of [...raisedByUs]) {
      await setShown(portraits, actorId, false);
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not lower spotlight portraits.`, error);
  } finally {
    raisedByUs.clear();
  }
}

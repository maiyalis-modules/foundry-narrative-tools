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

/**
 * Pending "lower this portrait" timers, keyed by actor id. A portrait is lowered
 * a short while *after its player submits* (not when the next player is prompted),
 * so the speaker's portrait lingers through the beat where they finish answering.
 * A re-spotlight cancels its timer; card-end cancels them all.
 */
const pendingLower = new Map<string, number>();

/** How long a portrait stays up after its player submits, in milliseconds. */
const LINGER_MS = 1500;

function cancelPendingLower(actorId: string): void {
  const timer = pendingLower.get(actorId);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    pendingLower.delete(actorId);
  }
}

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
 * Put the spotlight on these users by raising their portraits.
 *
 * Lowering is *not* done here — a previously spotlighted portrait comes down a
 * short while after that player submits (see `releasePortraitAfterAnswer`), so
 * it doesn't vanish the instant the GM prompts the next player.
 */
export async function spotlightPortraits(userIds: string[]): Promise<void> {
  const portraits = api();
  if (!portraits || !enabled()) return;

  const wanted = new Set(
    userIds.map((id) => actorForUser(id)?.id).filter((id): id is string => Boolean(id)),
  );

  try {
    for (const actorId of wanted) {
      // If this actor was about to be lowered, keep them up — they're on again.
      cancelPendingLower(actorId);
      await setShown(portraits, actorId, true);
      raisedByUs.add(actorId);
    }
  } catch (error) {
    // Never let a cosmetic integration interrupt play.
    console.warn(`${LOG_PREFIX} Portrait spotlight failed.`, error);
  }
}

/**
 * The spotlighted player has submitted their answer — schedule their portrait to
 * lower after a short linger. GM-side only. In "accumulate" mode (solo off) the
 * portraits are left up until the card ends, so this does nothing.
 */
export function releasePortraitAfterAnswer(userId: string): void {
  if (!api() || !enabled()) return;
  const solo = game.settings.get(MODULE_ID, SETTINGS.portraitSpotlightSolo) !== false;
  if (!solo) return;

  const actorId = actorForUser(userId)?.id;
  if (!actorId || !raisedByUs.has(actorId)) return;

  cancelPendingLower(actorId);
  const timer = window.setTimeout(() => {
    pendingLower.delete(actorId);
    void (async () => {
      const portraits = api();
      if (!portraits || !raisedByUs.has(actorId)) return;
      try {
        await setShown(portraits, actorId, false);
        raisedByUs.delete(actorId);
      } catch (error) {
        console.warn(`${LOG_PREFIX} Could not lower portrait after answer.`, error);
      }
    })();
  }, LINGER_MS);
  pendingLower.set(actorId, timer);
}

/** Lower every portrait this module raised — end of a card, or end of a run. */
export async function clearPortraits(): Promise<void> {
  for (const timer of pendingLower.values()) window.clearTimeout(timer);
  pendingLower.clear();

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

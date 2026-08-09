import { MODULE_ID, SETTINGS } from "../constants.js";
import {
  createEmptySession,
  emptyConnections,
  type ConnectionsState,
  type DeckRun,
  type StoryDeckSession,
} from "../models/session.js";

/**
 * Persists the in-progress session (the campaign seed being built) via Foundry's
 * world-scoped settings, so progress survives reloads (brief, Phase 1).
 *
 * The store owns *how* state is stored; callers work only with the typed
 * `StoryDeckSession` model.
 */
export class SessionStore {
  /** Register the backing setting. Must run during the `init` hook. */
  static register(): void {
    game.settings.register(MODULE_ID, SETTINGS.session, {
      scope: "world",
      config: false,
      type: Object,
      default: createEmptySession(),
    });
  }

  static load(): StoryDeckSession {
    const stored = game.settings.get(MODULE_ID, SETTINGS.session);
    if (!isSession(stored)) return createEmptySession();
    // Backfill fields added by later schema versions, so a session saved by an
    // older build never reaches the runtime with holes in it. The spread only
    // covers top-level keys, so nested run state is normalized explicitly.
    const session = { ...createEmptySession(), ...stored };
    if (session.run) session.run = normalizeRun(session.run);
    session.runs = session.runs.map(normalizeRun);
    session.connections = normalizeConnections(session.connections);
    return session;
  }

  static async save(session: StoryDeckSession): Promise<void> {
    await game.settings.set(MODULE_ID, SETTINGS.session, session);
  }

  static async reset(): Promise<void> {
    await SessionStore.save(createEmptySession());
  }
}

function isSession(value: unknown): value is StoryDeckSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    "results" in value
  );
}

/**
 * Fill in run fields added by later schema versions.
 *
 * A run persisted before v4 has a `seed` array and no `cards`; the schema v3
 * seed can't be recovered as a transcript, so those runs simply start with an
 * empty `cards` list rather than crashing the render.
 */
function normalizeRun(run: DeckRun): DeckRun {
  return {
    ...run,
    cards: Array.isArray(run.cards) ? run.cards : [],
    phases: Array.isArray(run.phases) ? run.phases : [],
  };
}

/**
 * Fill in the connections block, added in schema v5.
 *
 * A session written by an older build has no `connections` at all, and a session
 * written mid-upgrade may have it half-formed — either way the round simply
 * starts empty rather than reaching the UI with holes in it.
 */
function normalizeConnections(state: ConnectionsState | undefined): ConnectionsState {
  if (!state) return emptyConnections();
  return {
    round: state.round ?? null,
    answers: Array.isArray(state.answers) ? state.answers : [],
    pending: state.pending ?? null,
  };
}

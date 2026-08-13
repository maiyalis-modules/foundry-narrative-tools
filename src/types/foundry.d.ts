/**
 * Minimal ambient declarations for the FoundryVTT globals this module touches.
 *
 * This is a deliberately small shim so the project type-checks and builds without
 * pulling in the full community type packages. When you want richer typings,
 * install `fvtt-types` (https://github.com/League-of-Foundry-Developers/foundry-vtt-types)
 * and delete this file.
 */

export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyObject = Record<string, any>;

  /** Loose stand-in for jQuery — some classic Foundry hooks still pass it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type JQuery = any;

  /** Foundry's global hook dispatcher. */
  const Hooks: {
    on(hook: string, fn: (...args: any[]) => unknown): number;
    once(hook: string, fn: (...args: any[]) => unknown): number;
    off(hook: string, fn: number | ((...args: any[]) => unknown)): void;
    call(hook: string, ...args: any[]): boolean;
    callAll(hook: string, ...args: any[]): boolean;
  };

  /** The active game instance. Only ready after the `ready` hook fires. */
  const game: {
    modules: Map<string, { active: boolean; api?: unknown } & AnyObject>;
    settings: {
      register(namespace: string, key: string, data: AnyObject): void;
      registerMenu(namespace: string, key: string, data: AnyObject): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    socket?: {
      on(event: string, fn: (...args: any[]) => void): void;
      emit(event: string, ...args: any[]): void;
    };
    user?: { id: string; isGM: boolean; name: string } & AnyObject;
    users?: AnyObject;
    /** World actors — the connections round reads and writes character sheets. */
    actors?: { get(id: string): AnyObject | undefined } & AnyObject;
    /** The active game system; gates the Daggerheart-only connections round. */
    system?: { id: string; version?: string } & AnyObject;
    /** World folders, including the journal folders runs are exported into. */
    folders?: { find(fn: (folder: Folder) => boolean): Folder | undefined } & AnyObject;
    /** World journal entries, including the ones runs and decisions are exported into. */
    journal?: { find(fn: (entry: JournalEntry) => boolean): JournalEntry | undefined } & AnyObject;
    i18n: {
      localize(key: string): string;
      format(key: string, data?: AnyObject): string;
    };
  } & AnyObject;

  /** A world document folder (we only ever use the `JournalEntry` type). */
  type Folder = { id: string; name: string; type: string } & AnyObject;
  const Folder: {
    create(data: AnyObject): Promise<Folder | undefined>;
  };

  /** A chat message, used to announce answered connections to the table. */
  type ChatMessage = { id: string } & AnyObject;
  const ChatMessage: {
    create(data: AnyObject): Promise<ChatMessage | undefined>;
    getSpeaker(data: AnyObject): AnyObject;
  };

  /** A journal entry document, created when a Story Deck run completes. */
  type JournalEntry = { id: string; name?: string } & AnyObject;
  const JournalEntry: {
    create(data: AnyObject): Promise<JournalEntry | undefined>;
  };

  const CONFIG: AnyObject;
  const ui: AnyObject & { notifications?: { info(m: string): void; warn(m: string): void; error(m: string): void } };

  /** The Foundry client-side API namespace (ApplicationV2 lives here). */
  const foundry: {
    applications: {
      api: {
        ApplicationV2: any;
        HandlebarsApplicationMixin: <T>(base: T) => T;
        DialogV2: any;
      };
      /** Every open ApplicationV2, keyed by id (the v1 `ui.windows` successor). */
      instances: Map<string, AnyObject>;
    } & AnyObject;
    utils: AnyObject;
  } & AnyObject;
}

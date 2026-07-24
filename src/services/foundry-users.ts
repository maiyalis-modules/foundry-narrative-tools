/**
 * Thin adapter over Foundry's user collection, so the rest of the code works with
 * plain data instead of live Foundry documents.
 */

export interface RosterUser {
  id: string;
  name: string;
  isGM: boolean;
  active: boolean;
}

export function getUsers(): RosterUser[] {
  // game.users is a WorldCollection; `.contents` is a plain array.
  const contents = (game.users as { contents?: AnyObject[] })?.contents ?? [];
  return contents.map((u) => ({
    id: String(u.id),
    name: String(u.name ?? u.id),
    isGM: Boolean(u.isGM),
    active: Boolean(u.active),
  }));
}

/** Connected players (non-GM) and GMs, by id. */
export function getRoster(): { players: string[]; gmIds: string[] } {
  const players: string[] = [];
  const gmIds: string[] = [];
  for (const u of getUsers()) {
    if (!u.active) continue;
    (u.isGM ? gmIds : players).push(u.id);
  }
  return { players, gmIds };
}

export function userName(id: string): string {
  return getUsers().find((u) => u.id === id)?.name ?? id;
}

export function userNames(ids: string[]): string {
  return ids.map(userName).join(" & ");
}

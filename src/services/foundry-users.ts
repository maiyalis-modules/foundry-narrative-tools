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

/** Connected, non-GM users — the players who can be handed a card. */
export function getOnlinePlayers(): { id: string; name: string }[] {
  return getUsers()
    .filter((u) => u.active && !u.isGM)
    .map((u) => ({ id: u.id, name: u.name }));
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

/** How many non-GM players are currently connected. Used to gate cards/decks
 *  whose `requiredPlayers` can't be met with too few players online. */
export function onlinePlayerCount(): number {
  return getUsers().filter((u) => u.active && !u.isGM).length;
}

export function userName(id: string): string {
  return getUsers().find((u) => u.id === id)?.name ?? id;
}

export function userNames(ids: string[]): string {
  return ids.map(userName).join(" & ");
}

/** A user's own color swatch (their player-color pip elsewhere in Foundry). */
export function userColor(id: string): string {
  const user = (game.users as { get?: (id: string) => AnyObject | undefined })?.get?.(id);
  return String(user?.["color"] ?? "#ffffff");
}

export interface UserCharacter {
  id: string;
  name: string;
  img: string;
}

/** The character assigned to a user ("Configure Player Character"), if any. */
export function characterFor(id: string): UserCharacter | null {
  const user = (game.users as { get?: (id: string) => AnyObject | undefined })?.get?.(id);
  const actor = user?.["character"] as AnyObject | undefined;
  if (!actor?.["id"]) return null;
  return {
    id: String(actor["id"]),
    name: String(actor["name"] ?? ""),
    img: String(actor["img"] ?? ""),
  };
}

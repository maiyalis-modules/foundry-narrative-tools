import { SOCKET_EVENT } from "../constants.js";

/**
 * Cross-client intent channel for the card-play loop. Players cannot write world
 * settings, so shared state is mutated only on the GM client; other clients emit
 * intents that are routed by type to whoever should act:
 *   - `promptCard`   → the targeted player (opens the card popup)
 *   - `cardResponse` → the GM (records the answer into the session)
 *
 * The GM resolves `{{tokens}}` before sending, so the prompt payload is fully
 * self-contained — the player's popup needs no engine or session access, which
 * also avoids any race with the world-setting sync.
 */

export interface PromptPayload {
  cardId: string;
  cardTitle: string;
  stepIndex: number;
  setup: string;
  /** The single question this step asks, fully resolved. */
  question: string;
  /** Criterion shown to this player for choosing the next speaker — empty when the
   *  next speaker is the GM's call (or the card ends here). */
  handoff: string;
}

type SocketMessage =
  | { type: "promptCard"; targetUserId: string; prompt: PromptPayload }
  | {
      type: "cardResponse";
      userId: string;
      cardId: string;
      stepIndex: number;
      value: string;
    }
  | { type: "sessionStart"; deckName: string };

export interface SocketHandlers {
  /** Runs on the targeted player's client. */
  onPromptCard: (prompt: PromptPayload) => void;
  /** Runs on the GM's client. */
  onCardResponse: (
    userId: string,
    cardId: string,
    stepIndex: number,
    value: string,
  ) => void;
  /** Runs on every other client: a Story Session has begun. */
  onSessionStart: (deckName: string) => void;
}

let handlers: SocketHandlers | null = null;

export function registerSocket(deps: SocketHandlers): void {
  handlers = deps;
  game.socket?.on(SOCKET_EVENT, (message: SocketMessage) => {
    if (!handlers) return;
    switch (message.type) {
      case "promptCard":
        if (game.user?.id === message.targetUserId) handlers.onPromptCard(message.prompt);
        return;
      case "cardResponse":
        if (game.user?.isGM) {
          handlers.onCardResponse(message.userId, message.cardId, message.stepIndex, message.value);
        }
        return;
      case "sessionStart":
        handlers.onSessionStart(message.deckName);
        return;
    }
  });
}

/** GM → everyone else: announce that a Story Session has begun. */
export function emitSessionStart(deckName: string): void {
  game.socket?.emit(SOCKET_EVENT, { type: "sessionStart", deckName });
}

/** GM → a specific player: open the card popup for a resolved step. */
export function emitPromptCard(targetUserId: string, prompt: PromptPayload): void {
  game.socket?.emit(SOCKET_EVENT, { type: "promptCard", targetUserId, prompt });
}

/** Player → GM: the player's answer to a played step. */
export function emitCardResponse(cardId: string, stepIndex: number, value: string): void {
  game.socket?.emit(SOCKET_EVENT, {
    type: "cardResponse",
    userId: game.user?.id,
    cardId,
    stepIndex,
    value,
  });
}

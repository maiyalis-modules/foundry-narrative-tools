import { LOG_PREFIX, SOCKET_EVENT } from "../constants.js";

/**
 * Cross-client intent channel for the card-play loop. Players cannot write world
 * settings, so shared state is mutated only on the GM client; other clients emit
 * intents that are routed by type to whoever should act:
 *   - `promptCard`   → the targeted player (opens the card popup)
 *   - `cardResponse` → the GM (records the answer into the session)
 *
 * The connections round (see `connections-service.ts`) adds a second, two-hop
 * exchange over the same channel — the GM asks a player who should answer, then
 * asks that player for the answer:
 *   - `connectionAsk`    → the asker (choose who answers)
 *   - `connectionPick`   → the GM (their choice)
 *   - `connectionAnswer` → the chosen player (write the answer)
 *   - `connectionReply`  → the GM (records it, and writes it to the sheet)
 *
 * The GM resolves `{{tokens}}` before sending, so the prompt payload is fully
 * self-contained — the player's popup needs no engine or session access, which
 * also avoids any race with the world-setting sync.
 */

/** One question already answered on the card in play, resolved for display. */
export interface AnsweredQuestion {
  /** Display name of the player who answered it. */
  who: string;
  question: string;
  answer: string;
}

export interface PromptPayload {
  cardId: string;
  cardTitle: string;
  stepIndex: number;
  setup: string;
  /** The single question this step asks, fully resolved. */
  question: string;
  /** The card's earlier questions and answers, in step order — the context this
   *  player is building on. Empty on the card's first step. */
  history: AnsweredQuestion[];
  /** Criterion shown to this player for choosing the next speaker — empty when the
   *  next speaker is the GM's call (or the card ends here). */
  handoff: string;
  /** When the next speaker is this player's to choose (`chosen_by_previous`), the
   *  online players they may pass to — themselves excluded. Empty otherwise; also
   *  empty when they're the only player online, in which case the GM continues. */
  handoffCandidates: { id: string; name: string }[];
}

/** GM → asker: pick who answers one of your character's connection questions. */
export interface ConnectionAskPayload {
  actorId: string;
  questionIndex: number;
  question: string;
  /** Who they may pass it to, already filtered and ordered by the GM. */
  candidates: { id: string; name: string; answered: number }[];
}

/** GM → answerer: write the answer to someone else's connection question. */
export interface ConnectionAnswerPayload {
  question: string;
  /** The character being asked about — whose sheet this lands on. */
  askerName: string;
}

type SocketMessage =
  | { type: "promptCard"; targetUserId: string; prompt: PromptPayload }
  | { type: "connectionAsk"; targetUserId: string; ask: ConnectionAskPayload }
  | { type: "connectionPick"; userId: string; answererUserId: string }
  | { type: "connectionAnswer"; targetUserId: string; ask: ConnectionAnswerPayload }
  | { type: "connectionReply"; userId: string; answer: string }
  | {
      type: "cardResponse";
      userId: string;
      cardId: string;
      stepIndex: number;
      value: string;
      /** The player this speaker chose to answer next, when the hand-off was
       *  theirs to make. The GM prompts them automatically. */
      nextPlayerId: string | null;
    }
  | { type: "sessionStart"; deckName: string; titleKey?: string };

export interface SocketHandlers {
  /** Runs on the targeted player's client. */
  onPromptCard: (prompt: PromptPayload) => void;
  /** Runs on the GM's client. */
  onCardResponse: (
    userId: string,
    cardId: string,
    stepIndex: number,
    value: string,
    nextPlayerId: string | null,
  ) => void;
  /** Runs on every other client: a session has begun. `titleKey` names which
   *  kind, so the banner heading is localized per client rather than sent. */
  onSessionStart: (deckName: string, titleKey?: string) => void;
  /** Runs on the asker's client: choose who answers this connection question. */
  onConnectionAsk: (ask: ConnectionAskPayload) => void;
  /** Runs on the GM's client: the asker chose an answerer. */
  onConnectionPick: (askerUserId: string, answererUserId: string) => void;
  /** Runs on the chosen player's client: write the answer. */
  onConnectionAnswer: (ask: ConnectionAnswerPayload) => void;
  /** Runs on the GM's client: the answer, ready to record. */
  onConnectionReply: (answererUserId: string, answer: string) => void;
}

/**
 * Log every message this client sends or receives on the channel.
 *
 * Off by default. A hand-off that spans three clients is close to undebuggable
 * from the outside — "nothing happened" could be any of six hops — so turn this
 * on from the console on each client to see exactly where a round stops:
 *
 * ```js
 * game.modules.get("foundry-story-deck").api.debugSocket = true;
 * ```
 */
export let debugSocket = false;

export function setDebugSocket(on: boolean): void {
  debugSocket = on;
}

/**
 * Send one message, optionally tracing it.
 *
 * Foundry does not loop an emit back to its sender, so a message logged here and
 * never logged as received on the target client localizes the break precisely.
 */
function emit(message: SocketMessage): void {
  if (debugSocket) console.log(`${LOG_PREFIX} socket →`, message.type, message);
  game.socket?.emit(SOCKET_EVENT, message);
}

/**
 * This client's user id, as the sender of a player → GM message.
 *
 * `game.user` is always set by the time any of these fire, but it is optional on
 * the global — and an `undefined` id would sail over the wire and quietly fail
 * the GM's "is this the player I asked?" check with nothing logged. Fail loudly
 * instead; an empty id matches nobody and says so.
 */
function myUserId(): string {
  const id = game.user?.id;
  if (!id) console.error(`${LOG_PREFIX} Emitting without a user id — the GM will ignore this.`);
  return id ?? "";
}

let handlers: SocketHandlers | null = null;

export function registerSocket(deps: SocketHandlers): void {
  handlers = deps;
  game.socket?.on(SOCKET_EVENT, (message: SocketMessage) => {
    if (!handlers) return;
    if (debugSocket) {
      console.log(`${LOG_PREFIX} socket ←`, message.type, message, {
        me: game.user?.id,
        isGM: game.user?.isGM,
      });
    }
    switch (message.type) {
      case "promptCard":
        if (game.user?.id === message.targetUserId) handlers.onPromptCard(message.prompt);
        return;
      case "cardResponse":
        if (game.user?.isGM) {
          handlers.onCardResponse(
            message.userId,
            message.cardId,
            message.stepIndex,
            message.value,
            message.nextPlayerId ?? null,
          );
        }
        return;
      case "sessionStart":
        handlers.onSessionStart(message.deckName, message.titleKey);
        return;
      case "connectionAsk":
        if (game.user?.id === message.targetUserId) handlers.onConnectionAsk(message.ask);
        return;
      case "connectionPick":
        if (game.user?.isGM) handlers.onConnectionPick(message.userId, message.answererUserId);
        return;
      case "connectionAnswer":
        if (game.user?.id === message.targetUserId) handlers.onConnectionAnswer(message.ask);
        return;
      case "connectionReply":
        if (game.user?.isGM) handlers.onConnectionReply(message.userId, message.answer);
        return;
    }
  });
}

/** GM → everyone else: announce that a session has begun. */
export function emitSessionStart(deckName: string, titleKey?: string): void {
  emit({ type: "sessionStart", deckName, titleKey });
}

/** GM → a specific player: open the card popup for a resolved step. */
export function emitPromptCard(targetUserId: string, prompt: PromptPayload): void {
  emit({ type: "promptCard", targetUserId, prompt });
}

/** GM → the question's owner: choose who should answer it. */
export function emitConnectionAskRequest(
  targetUserId: string,
  ask: ConnectionAskPayload,
): void {
  emit({ type: "connectionAsk", targetUserId, ask });
}

/** Asker → GM: the player they chose to answer their question. */
export function emitConnectionPick(answererUserId: string): void {
  emit({
    type: "connectionPick",
    userId: myUserId(),
    answererUserId,
  });
}

/** GM → the chosen player: write the answer to this connection question. */
export function emitConnectionAnswerRequest(
  targetUserId: string,
  ask: ConnectionAnswerPayload,
): void {
  emit({ type: "connectionAnswer", targetUserId, ask });
}

/** Answerer → GM: the answer, for recording and writing onto the asker's sheet. */
export function emitConnectionReply(answer: string): void {
  emit({
    type: "connectionReply",
    userId: myUserId(),
    answer,
  });
}

/** Player → GM: the player's answer to a played step, and — when the hand-off was
 *  theirs — the player they chose to answer next. */
export function emitCardResponse(
  cardId: string,
  stepIndex: number,
  value: string,
  nextPlayerId: string | null = null,
): void {
  emit({
    type: "cardResponse",
    userId: myUserId(),
    cardId,
    stepIndex,
    value,
    nextPlayerId,
  });
}

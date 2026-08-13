import { LOG_PREFIX, MODULE_ID, TEMPLATES } from "../constants.js";
import { tallyVotes } from "../engine/decision-resolver.js";
import type { DecisionState } from "../models/session.js";
import {
  allVoted,
  clearDecision,
  currentDecision,
  endVoting,
  expectedVoterIds,
  subtitleFor,
  voteAsMe,
} from "../services/decision-service.js";
import { characterFor, userColor, userName } from "../services/foundry-users.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Percentage distance of each option tile from the center, tuned by eye. */
const RADIUS = 36;

/** A second End Voting click within this long of the first forces it through
 *  (see {@link StoryDecisionVoteApp.onEndVoting}). */
const FORCE_END_WINDOW_MS = 5000;

/**
 * The full-screen Story Decision vote: a compact center card (title,
 * description, live "N of M voted" line, and the GM's End Voting button)
 * surrounded by the options arranged in a circle, each connected to the
 * center by a line. See `services/decision-service.ts` for the state this
 * renders and `module.ts` for what shows/hides it (`syncDecisionOverlay`).
 *
 * Frameless and full-viewport, the same way `SessionStatusApp` is a frameless
 * floating HUD: `window.frame/positioned` are both off so Foundry never
 * applies its own left/top/width/height, leaving this class's own
 * `position: fixed; inset: 0;` CSS in full control.
 */
export class StoryDecisionVoteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Decision ids whose "groupRandom" roulette has already played, so a
   *  redundant re-render (e.g. a late-joiner's initial sync) never replays it. */
  private animatedIds = new Set<string>();
  /** The decision id and time of the last End Voting click that got a "not
   *  everyone's voted" warning instead of ending it — a second click on the
   *  *same* decision within {@link FORCE_END_WINDOW_MS} forces it through. */
  private lastEndVotingWarning: { decisionId: string; at: number } | null = null;

  static DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-decision-vote`,
    tag: "section",
    window: {
      frame: false,
      positioned: false,
      title: "FSD.StoryDecision.Title",
    },
    position: {
      width: "auto",
      height: "auto",
    },
    classes: [MODULE_ID, "fsd-vote"],
  };

  static PARTS = {
    main: { template: TEMPLATES.storyDecisionVote },
  };

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    const state = currentDecision();
    if (!state || state.options.length === 0) return { ...context, active: false };

    const isGM = Boolean(game.user?.isGM);
    const resolved = state.status === "resolved";
    const tally = tallyVotes(state);
    const n = state.options.length;

    const options_ = state.options.map((option, index) => {
      const angle = (2 * Math.PI * index) / n - Math.PI / 2;
      const x = 50 + RADIUS * Math.cos(angle);
      const y = 50 + RADIUS * Math.sin(angle);

      const votes = Object.entries(state.votes)
        .filter(([, optionId]) => optionId === option.id)
        .map(([userId]) => {
          const character = characterFor(userId);
          return {
            userId,
            name: character?.name || userName(userId),
            color: userColor(userId),
            portrait: character?.img ?? "",
            hasPortrait: Boolean(character?.img),
          };
        });

      return {
        id: option.id,
        title: option.title || game.i18n.localize("FSD.StoryDecision.OptionUntitled"),
        description: option.description,
        hasDescription: option.description.length > 0,
        image: option.image,
        hasImage: option.image.length > 0,
        x,
        y,
        votes,
        voteCount: tally.get(option.id) ?? 0,
        isWinner: resolved && state.winnerOptionId === option.id,
      };
    });

    const canVote =
      state.status === "voting" &&
      (state.type !== "single" || game.user?.id === state.singlePlayerId);
    const expected = expectedVoterIds(state);

    return {
      ...context,
      active: true,
      isGM,
      resolved,
      title: state.title,
      description: state.description,
      hasDescription: state.description.length > 0,
      options: options_,
      canVote,
      allVoted: allVoted(state),
      // Counted against who's expected to vote, not every vote on record — the
      // GM can also click a tile (see `voteAsMe`), and their vote shouldn't
      // turn "1 of 1" into a confusing "2 of 1".
      votedCount: expected.filter((id) => id in state.votes).length,
      expectedCount: expected.length,
      isGroupRandom: state.type === "groupRandom",
      subtitle: subtitleFor(state),
    };
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    // Every render, not just the first: whether this client may click a tile
    // right now (voting open, and — for "single" — this is that one player)
    // changes without the listener itself needing to move.
    root.classList.toggle("fsd-vote--can-vote", Boolean(context["canVote"]));

    const state = currentDecision();
    this.animateResolution(root, state);

    if (root.dataset["fsdBound"]) return;
    root.dataset["fsdBound"] = "1";

    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-fsd]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;

      const action = el.dataset["fsd"];
      if (action === "vote") {
        const optionId = el.closest<HTMLElement>("[data-option-id]")?.dataset["optionId"];
        if (optionId && root.classList.contains("fsd-vote--can-vote")) voteAsMe(optionId);
      } else if (action === "end-voting") {
        this.onEndVoting();
      } else if (action === "close-decision") {
        void clearDecision();
      }
    });
  }

  /**
   * Not everyone (or, commonly, nobody) has voted the first time this is
   * clicked — `endVoting()` refuses and warns rather than resolving. Clicking
   * it again for the *same* decision within {@link FORCE_END_WINDOW_MS} of
   * that warning forces it through: a deliberate second press reads as "yes,
   * I meant it," without needing a separate confirmation control.
   */
  private onEndVoting(): void {
    const state = currentDecision();
    if (!state) return;

    const now = Date.now();
    const force =
      this.lastEndVotingWarning?.decisionId === state.id &&
      now - this.lastEndVotingWarning.at < FORCE_END_WINDOW_MS;

    if (!force && !allVoted(state)) {
      this.lastEndVotingWarning = { decisionId: state.id, at: now };
    }
    void endVoting(force);
  }

  /**
   * Resolution, once per resolved decision (guarded by `animatedIds` so a
   * redundant re-render — a late-joiner's initial sync, say — never replays
   * it): `groupRandom` spins first, cycling a highlight across the tiles,
   * decelerating, landing on the winner; every type then reveals the same way
   * — `revealWinner()` fades the hub and the losing tiles out and sends the
   * winner back to center, grown.
   */
  private animateResolution(root: HTMLElement, state: DecisionState | null): void {
    if (!state || state.status !== "resolved") return;
    if (this.animatedIds.has(state.id)) {
      root.classList.remove("fsd-vote--spinning");
      return;
    }
    this.animatedIds.add(state.id);

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (state.type !== "groupRandom" || reduceMotion) {
      root.classList.remove("fsd-vote--spinning");
      this.revealWinner(root);
      return;
    }

    const tiles = Array.from(root.querySelectorAll<HTMLElement>("[data-option-id]"));
    const winnerIndex = tiles.findIndex((t) => t.dataset["optionId"] === state.winnerOptionId);
    if (winnerIndex < 0) {
      this.revealWinner(root);
      return;
    }

    root.classList.add("fsd-vote--spinning");
    const n = tiles.length;
    const rounds = 3;
    const totalSteps = rounds * n + winnerIndex + 1;
    let step = 0;
    let delay = 70;

    const tick = (): void => {
      for (const tile of tiles) tile.classList.remove("fsd-vote-option--spinlit");
      tiles[step % n]?.classList.add("fsd-vote-option--spinlit");
      step++;
      if (step >= totalSteps) {
        window.setTimeout(() => {
          for (const tile of tiles) tile.classList.remove("fsd-vote-option--spinlit");
          root.classList.remove("fsd-vote--spinning");
          this.revealWinner(root);
        }, 350);
        return;
      }
      delay = Math.min(260, delay * 1.12);
      window.setTimeout(tick, delay);
    };
    tick();
  }

  /**
   * The reveal itself: send the winning tile back to dead center — its
   * `left`/`top` transition (see module.css) is what turns that into a glide
   * rather than a jump — and let `.fsd-vote--revealed` fade everything else
   * (hub, connector lines, losing tiles) away around it.
   */
  private revealWinner(root: HTMLElement): void {
    const winnerTile = root.querySelector<HTMLElement>(".fsd-vote-option--winner");
    if (!winnerTile) {
      // Should be unreachable — `endVoting()` refuses to resolve with zero
      // votes, and `resolveWinner()` never returns an id that doesn't match an
      // option — but `.fsd-vote--revealed` hides every *non*-winner tile, so
      // if this ever fires anyway, skipping it is what keeps the hub (and its
      // Close button) on screen instead of fading everything to a blank
      // backdrop with no way to dismiss it.
      console.warn(`${LOG_PREFIX} Resolved with no matching winner tile — skipping the reveal.`);
      return;
    }
    root.classList.add("fsd-vote--revealed");
    winnerTile.style.left = "50%";
    winnerTile.style.top = "50%";
    playDecisionChime();
  }
}

/**
 * A short triumphant sting for the reveal — synthesized so the module ships no
 * audio asset, the same technique `playSessionChime` in `session-banner.ts`
 * uses. Silent-fails: a cosmetic sound must never interrupt the reveal.
 */
function playDecisionChime(): void {
  try {
    const audio = game.audio as { ctx?: AudioContext; context?: AudioContext } | undefined;
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = audio?.ctx ?? audio?.context ?? (Ctx ? new Ctx() : undefined);
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);

    // A quick rising sweep into a bright, sustained major chord.
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = "sawtooth";
    sweep.frequency.setValueAtTime(220, now);
    sweep.frequency.exponentialRampToValueAtTime(880, now + 0.28);
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.22, now + 0.1);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    sweep.connect(sweepGain);
    sweepGain.connect(master);
    sweep.start(now);
    sweep.stop(now + 0.32);

    const chord = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    chord.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + 0.26);
      gain.gain.exponentialRampToValueAtTime(0.28, now + 0.32);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + 0.26);
      osc.stop(now + 1.9);
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Decision reveal chime failed.`, error);
  }
}

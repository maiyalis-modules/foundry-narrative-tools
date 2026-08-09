import { LOG_PREFIX, MODULE_ID } from "../constants.js";
import { emitSessionStart } from "../services/socket.js";
import { escapeHtml } from "../utils/escape-html.js";

/**
 * The "Story Session" announcement: a full-width banner that sweeps across every
 * client's screen with a chime when a run begins — inspired by Epic Rolls 5e's
 * roll banner, but themed to this module and deliberately less loud.
 *
 * Everything here is pure client-side DOM/audio; the cross-client fan-out is the
 * socket layer's job (see `emitSessionStart`).
 */

const BANNER_ID = `${MODULE_ID}-banner`;
/** Enter + hold + exit, in ms — kept in step with the CSS animation. */
const BANNER_LIFETIME = 4200;

/** The banner's default heading — a Story Deck run. */
const DEFAULT_TITLE_KEY = "FSD.Banner.Title";

/**
 * GM side: show the banner locally and broadcast it to everyone else.
 *
 * `titleKey` lets other kinds of session borrow the same announcement — the
 * connections round opens with one too. Only the *key* crosses the wire, so each
 * client renders the heading in its own language.
 */
export function announceSessionStart(subtitle: string, titleKey?: string): void {
  showSessionBanner(subtitle, titleKey);
  emitSessionStart(subtitle, titleKey);
}

/** Show the animated banner + chime on *this* client. */
export function showSessionBanner(subtitle: string, titleKey?: string): void {
  try {
    document.getElementById(BANNER_ID)?.remove();

    const el = document.createElement("div");
    el.id = BANNER_ID;
    el.className = BANNER_ID;
    const sub = subtitle
      ? `<span class="${BANNER_ID}__subtitle">${escapeHtml(subtitle)}</span>`
      : "";
    const title = game.i18n.localize(titleKey || DEFAULT_TITLE_KEY);
    el.innerHTML = `
      <div class="${BANNER_ID}__inner">
        <i class="fa-solid fa-book-sparkles ${BANNER_ID}__glyph"></i>
        <div class="${BANNER_ID}__text">
          <span class="${BANNER_ID}__title">${escapeHtml(title)}</span>
          ${sub}
        </div>
        <i class="fa-solid fa-book-sparkles ${BANNER_ID}__glyph"></i>
      </div>`;
    document.body.appendChild(el);

    playSessionChime();

    window.setTimeout(() => el.remove(), BANNER_LIFETIME);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not show the session banner.`, error);
  }
}

/**
 * A short, warm ascending chime — synthesized so the module ships no audio asset.
 *
 * Prefers Foundry's own AudioContext (already unlocked once the user has clicked
 * into the world), falling back to a fresh one. Silent-fails: a cosmetic sound
 * must never interrupt play.
 */
function playSessionChime(): void {
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
    master.gain.value = 0.6;
    master.connect(ctx.destination);

    // A gentle low swell underneath the arpeggio.
    const pad = ctx.createOscillator();
    const padGain = ctx.createGain();
    pad.type = "sine";
    pad.frequency.value = 130.81; // C3
    padGain.gain.setValueAtTime(0.0001, now);
    padGain.gain.exponentialRampToValueAtTime(0.18, now + 0.12);
    padGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    pad.connect(padGain);
    padGain.connect(master);
    pad.start(now);
    pad.stop(now + 2.3);

    // C-major arpeggio, bell-like decays, staggered.
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t = now + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 1.6);
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Session chime failed.`, error);
  }
}

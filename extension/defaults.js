/**
 * Shared default settings for the extension.
 * Loaded in the content script (isolated world), the popup (via <script>),
 * and the service worker (via importScripts).
 *
 * Exposes a global `MOYU_DEFAULTS` and, when modules/CommonJS are present,
 * also exports it.
 */
(function (root) {
  const DEFAULTS = {
    // Master switch.
    enabled: false,

    // Scroll engine ---------------------------------------------------------
    // Pixels moved per animation tick. Higher = faster scrolling.
    speed: 2,
    // Milliseconds between scroll ticks. Lower = smoother/faster.
    tickMs: 24,
    // "bounce": scroll down then back up; "loop": jump to top at the bottom.
    mode: "bounce",
    // Add small random variation to each step so motion looks less robotic.
    humanize: true,

    // Pauses (simulate "reading") ------------------------------------------
    // Probability (0..1) of starting a pause after finishing a scroll burst.
    pauseChance: 0.35,
    // A scroll burst lasts a random time in this range before we re-roll a pause.
    burstMinMs: 2500,
    burstMaxMs: 6000,
    // Pause duration range, in milliseconds.
    pauseMinMs: 1500,
    pauseMaxMs: 5000,

    // Keep-awake (supporting safeguard) ------------------------------------
    // Request the Screen Wake Lock API so the display does not sleep and a
    // screensaver does not cover the scrolling page. This is a safeguard for
    // the auto-scroll, NOT a standalone anti-screensaver mechanism.
    wakeLock: true
  };

  root.MOYU_DEFAULTS = DEFAULTS;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DEFAULTS;
  }
})(typeof self !== "undefined" ? self : this);

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

    // Edge dwell — pause when reaching the very top/bottom before reversing,
    // so a "bounce" does not look like a robotic instant flip. (ms)
    edgeDwellMinMs: 1200,
    edgeDwellMaxMs: 3500,

    // Short-page guard ------------------------------------------------------
    // If the scrollable distance is below this many pixels the page is "too
    // short": rapid back-and-forth would look obviously fake, so the engine
    // idles (and re-checks, in case content lazy-loads) instead of bouncing.
    minScrollPx: 160,

    // Human takeover --------------------------------------------------------
    // "off"     : never auto-stop on real user input.
    // "instant" : any real input (mouse move / wheel / key / touch) takes over.
    // "delayed" : only take over after the user is continuously active for
    //             `takeoverDelayMs`, so an accidental nudge is ignored.
    takeoverMode: "instant",
    takeoverDelayMs: 3000,
    // When taken over: if true, soft-pause and auto-resume after the user has
    // been idle for `resumeIdleMs`. If false, hard-stop (flip the master off).
    autoResume: true,
    resumeIdleMs: 6000,

    // Keep-awake (supporting safeguard) ------------------------------------
    // Request the Screen Wake Lock API so the display does not sleep and a
    // screensaver does not cover the scrolling page. This is a safeguard for
    // the auto-scroll, NOT a standalone anti-screensaver mechanism.
    wakeLock: true,

    // Diagnostics -----------------------------------------------------------
    // When true, the content script logs detailed state to the page console
    // (prefixed "[摸鱼助手]") to help diagnose pages that "don't work".
    debug: false
  };

  root.MOYU_DEFAULTS = DEFAULTS;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DEFAULTS;
  }
})(typeof self !== "undefined" ? self : this);

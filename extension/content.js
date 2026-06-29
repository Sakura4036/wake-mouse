/**
 * 摸鱼助手 content script — the simulation engine.
 *
 * Runs in every page (top frame). When enabled it:
 *   - smoothly auto-scrolls the page,
 *   - reverses / loops at the bottom,
 *   - takes random human-like pauses ("reading"),
 *   - dispatches subtle synthetic mousemove events,
 *   - requests a Screen Wake Lock so the display does not sleep.
 *
 * NOTE ON LIMITATIONS: A browser extension cannot move the operating-system
 * mouse cursor or directly reset the OS idle timer. The Wake Lock API is the
 * supported, reliable way for a page to keep the *screen* awake; scrolling and
 * synthetic events keep the page/site "active". See README for details.
 */
(function () {
  "use strict";

  const DEFAULTS = self.MOYU_DEFAULTS || {};

  const STORAGE_KEY = "settings";

  /** @type {object} current effective settings */
  let settings = Object.assign({}, DEFAULTS);

  // Engine runtime state -----------------------------------------------------
  let running = false; // engine actively scrolling/looping
  let direction = 1; // 1 = down, -1 = up
  let scrollTimer = null;
  let mouseTimer = null;
  let burstDeadline = 0; // timestamp at which the current scroll burst ends
  let wakeLock = null; // WakeLockSentinel | null

  const rand = (min, max) => min + Math.random() * (max - min);

  function maxScrollTop() {
    const doc = document.documentElement;
    const body = document.body || {};
    const scrollHeight = Math.max(
      doc.scrollHeight || 0,
      body.scrollHeight || 0
    );
    return Math.max(0, scrollHeight - window.innerHeight);
  }

  function currentScrollTop() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  // --- Wake Lock -------------------------------------------------------------
  async function acquireWakeLock() {
    if (!settings.wakeLock) return;
    if (!("wakeLock" in navigator)) return;
    if (document.visibilityState !== "visible") return;
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } catch (err) {
      // Throws if document is hidden or the user/OS denies it. Safe to ignore;
      // we retry on the next visibilitychange.
      wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try {
      await wakeLock.release();
    } catch (_) {
      /* ignore */
    }
    wakeLock = null;
  }

  // --- Synthetic mouse movement ---------------------------------------------
  let mouseX = Math.floor(window.innerWidth / 2);
  let mouseY = Math.floor(window.innerHeight / 2);

  function dispatchMouseMove() {
    if (!settings.mouseMove) return;
    if (document.visibilityState !== "visible") return;

    // Wander a little around the viewport.
    mouseX = clamp(
      mouseX + rand(-60, 60),
      4,
      Math.max(8, window.innerWidth - 4)
    );
    mouseY = clamp(
      mouseY + rand(-40, 40),
      4,
      Math.max(8, window.innerHeight - 4)
    );

    const target =
      document.elementFromPoint(mouseX, mouseY) || document.documentElement;
    const evt = new MouseEvent("mousemove", {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: Math.round(mouseX),
      clientY: Math.round(mouseY),
      screenX: Math.round(mouseX),
      screenY: Math.round(mouseY)
    });
    try {
      (target || document).dispatchEvent(evt);
    } catch (_) {
      /* ignore */
    }
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // --- Scroll loop -----------------------------------------------------------
  function step() {
    if (!running) return;

    const now = Date.now();

    // Time to roll for a pause?
    if (now >= burstDeadline) {
      scheduleNextBurst();
      if (Math.random() < (settings.pauseChance || 0)) {
        startPause();
        return;
      }
    }

    const top = currentScrollTop();
    const max = maxScrollTop();

    // Reached an edge → reverse or loop.
    if (direction > 0 && top >= max - 1) {
      if (settings.mode === "loop") {
        window.scrollTo({ top: 0, behavior: "auto" });
      } else {
        direction = -1;
      }
    } else if (direction < 0 && top <= 0) {
      direction = 1;
    }

    let stepPx = (settings.speed || 1) * direction;
    if (settings.humanize) {
      stepPx *= rand(0.7, 1.3);
    }

    window.scrollBy({ top: stepPx, left: 0, behavior: "auto" });

    scrollTimer = window.setTimeout(step, settings.tickMs || 24);
  }

  function scheduleNextBurst() {
    burstDeadline =
      Date.now() + rand(settings.burstMinMs || 2000, settings.burstMaxMs || 5000);
  }

  function startPause() {
    const dur = rand(settings.pauseMinMs || 1000, settings.pauseMaxMs || 4000);
    scrollTimer = window.setTimeout(() => {
      if (!running) return;
      scheduleNextBurst();
      step();
    }, dur);
  }

  // --- Engine control --------------------------------------------------------
  function startEngine() {
    if (running) return;
    if (document.visibilityState !== "visible") return; // wait until visible
    running = true;
    direction = 1;
    scheduleNextBurst();

    if (scrollTimer) clearTimeout(scrollTimer);
    step();

    if (mouseTimer) clearInterval(mouseTimer);
    if (settings.mouseMove) {
      mouseTimer = window.setInterval(
        dispatchMouseMove,
        settings.mouseMoveMs || 4000
      );
    }

    acquireWakeLock();
  }

  function stopEngine() {
    running = false;
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    if (mouseTimer) {
      clearInterval(mouseTimer);
      mouseTimer = null;
    }
    releaseWakeLock();
  }

  function applyEnabledState() {
    if (settings.enabled) {
      startEngine();
    } else {
      stopEngine();
    }
  }

  // --- Settings wiring -------------------------------------------------------
  function loadSettings() {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      const stored = (res && res[STORAGE_KEY]) || {};
      settings = Object.assign({}, DEFAULTS, stored);
      applyEnabledState();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    const newVal = changes[STORAGE_KEY].newValue || {};
    const wasEnabled = settings.enabled;
    settings = Object.assign({}, DEFAULTS, newVal);

    // Restart engine so new timing/options take effect immediately.
    if (settings.enabled) {
      stopEngine();
      startEngine();
    } else if (wasEnabled) {
      stopEngine();
    }
  });

  // Pause work when the tab is hidden; resume (and re-grab wake lock) when visible.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (settings.enabled) startEngine();
    } else {
      // Keep `running` intent but halt timers; wake lock auto-releases anyway.
      if (scrollTimer) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
      if (mouseTimer) {
        clearInterval(mouseTimer);
        mouseTimer = null;
      }
      running = false;
      wakeLock = null;
    }
  });

  window.addEventListener("pagehide", stopEngine);

  loadSettings();
})();

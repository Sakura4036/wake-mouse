/**
 * 摸鱼助手 content script — the simulation engine.
 *
 * Goal (see CONTEXT.md): "presence simulation" for the OBSERVATION CHANNEL =
 * the on-screen image (screen share / shoulder-surfing, scenarios A/D). It
 * makes the visible page look like someone is actively browsing.
 *
 * When enabled it:
 *   - finds the real scrollable container (page OR an inner scroll element),
 *   - smoothly auto-scrolls it, reversing/looping at the edges,
 *   - dwells at the top/bottom and takes random "reading" pauses so motion is
 *     not robotic,
 *   - idles on pages too short to scroll convincingly (and re-checks them),
 *   - detects real user input ("human takeover") and pauses or stops,
 *   - requests a Screen Wake Lock as a SAFEGUARD so a screensaver does not
 *     cover the scrolling page.
 *
 * HARD LIMITS: A browser extension cannot move the real OS cursor and the
 * scrolling produces no OS-level input, so this does NOT defeat OS-level
 * activity monitors. It only makes the on-screen image look alive. See README.
 */
(function () {
  "use strict";

  const DEFAULTS = self.MOYU_DEFAULTS || {};
  const STORAGE_KEY = "settings";
  const WATCHDOG_MS = 500; // takeover/resume polling cadence
  const SHORT_RECHECK_MS = 4000; // re-evaluate a too-short page this often

  /** @type {object} current effective settings */
  let settings = Object.assign({}, DEFAULTS);

  // Engine runtime state -----------------------------------------------------
  let running = false; // scroll loop scheduled (scrolling/pausing/dwell/short)
  let direction = 1; // 1 = down, -1 = up
  let scrollTimer = null;
  let watchdog = null;
  let burstDeadline = 0;
  let wakeLock = null; // WakeLockSentinel | null
  let scroller = null; // cached { el, isWindow }

  // Human-takeover state.
  let userTakeover = false;
  let lastInputTs = 0;
  let inputActiveSince = 0;
  let lastX = null;
  let lastY = null;

  // Diagnostics: a short machine-readable state for the popup.
  // stopped | hidden | scrolling | reading-pause | edge-dwell | short-idle | takeover
  let state = "stopped";
  let lastError = "";

  const rand = (min, max) => min + Math.random() * (max - min);

  function log() {
    if (!settings.debug) return;
    try {
      console.debug(
        "[摸鱼助手]",
        ...Array.prototype.slice.call(arguments)
      );
    } catch (_) {
      /* ignore */
    }
  }

  // --- Scroller detection ----------------------------------------------------
  function isScrollableStyle(el) {
    const oy = getComputedStyle(el).overflowY;
    return oy === "auto" || oy === "scroll" || oy === "overlay";
  }

  function detectScroller() {
    const docEl = document.scrollingElement || document.documentElement;
    if (docEl && docEl.scrollHeight - docEl.clientHeight > 4) {
      return { el: docEl, isWindow: true };
    }
    // Many SPAs scroll an inner container. Probe the viewport centre and walk
    // up to the nearest scrollable ancestor.
    try {
      const probe = document.elementFromPoint(
        Math.floor(window.innerWidth / 2),
        Math.floor(window.innerHeight / 2)
      );
      let el = probe;
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.scrollHeight - el.clientHeight > 4 && isScrollableStyle(el)) {
          return { el: el, isWindow: false };
        }
        el = el.parentElement;
      }
    } catch (_) {
      /* ignore */
    }
    // Last resort: bounded scan for the largest scrollable element.
    let best = null;
    let bestGain = 4;
    const nodes = document.body ? document.body.querySelectorAll("*") : [];
    const limit = Math.min(nodes.length, 4000);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      const gain = el.scrollHeight - el.clientHeight;
      if (gain > bestGain && el.clientHeight > 80 && isScrollableStyle(el)) {
        best = el;
        bestGain = gain;
      }
    }
    if (best) return { el: best, isWindow: false };
    return { el: docEl, isWindow: true };
  }

  function getScroller() {
    if (!scroller || !scroller.el || !scroller.el.isConnected) {
      scroller = detectScroller();
      log("scroller =", scroller.isWindow ? "page" : scroller.el.tagName);
    }
    return scroller;
  }

  function metrics() {
    const sc = getScroller();
    if (sc.isWindow) {
      const docEl = document.scrollingElement || document.documentElement;
      return {
        sc,
        top: window.scrollY || docEl.scrollTop || 0,
        max: Math.max(0, docEl.scrollHeight - window.innerHeight)
      };
    }
    const el = sc.el;
    return {
      sc,
      top: el.scrollTop,
      max: Math.max(0, el.scrollHeight - el.clientHeight)
    };
  }

  function scrollByPx(sc, px) {
    if (sc.isWindow) window.scrollBy(0, px);
    else sc.el.scrollTop += px;
  }

  function scrollToTop(sc) {
    if (sc.isWindow) window.scrollTo(0, 0);
    else sc.el.scrollTop = 0;
  }

  // --- Wake Lock -------------------------------------------------------------
  async function acquireWakeLock() {
    if (!settings.wakeLock) return;
    if (!("wakeLock" in navigator)) {
      lastError = "本浏览器不支持 Wake Lock";
      return;
    }
    if (document.visibilityState !== "visible") return;
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
      log("Wake Lock 已获取");
    } catch (err) {
      // Throws on insecure (http) context, hidden document, or OS denial.
      wakeLock = null;
      lastError =
        "Wake Lock 申请失败：" +
        (self.isSecureContext ? "" : "(非 HTTPS 安全页面) ") +
        (err && err.message ? err.message : String(err));
      log(lastError);
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

  // --- Scroll loop -----------------------------------------------------------
  function clearScrollTimer() {
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
  }

  function schedule(fn, ms) {
    scrollTimer = window.setTimeout(fn, ms);
  }

  function scheduleNextBurst() {
    burstDeadline =
      Date.now() +
      rand(settings.burstMinMs || 2000, settings.burstMaxMs || 5000);
  }

  function tick() {
    scrollTimer = null;
    if (!running) return;

    const { sc, top, max } = metrics();

    // Short-page guard: bouncing over a tiny range looks obviously fake.
    if (max < (settings.minScrollPx || 0)) {
      if (state !== "short-idle") {
        log("可滚动高度过短(", Math.round(max), "px)，暂停并定期重试");
      }
      state = "short-idle";
      schedule(tick, SHORT_RECHECK_MS);
      return;
    }

    const now = Date.now();

    // Random "reading" pause between scroll bursts.
    if (now >= burstDeadline) {
      scheduleNextBurst();
      if (Math.random() < (settings.pauseChance || 0)) {
        state = "reading-pause";
        schedule(tick, rand(settings.pauseMinMs || 1000, settings.pauseMaxMs || 4000));
        return;
      }
    }

    // Edge handling — dwell before reversing so it does not look robotic.
    if (direction > 0 && top >= max - 1) {
      if (settings.mode === "loop") {
        scrollToTop(sc);
        direction = 1;
      } else {
        direction = -1;
      }
      state = "edge-dwell";
      schedule(tick, rand(settings.edgeDwellMinMs || 800, settings.edgeDwellMaxMs || 2500));
      return;
    }
    if (direction < 0 && top <= 0) {
      direction = 1;
      state = "edge-dwell";
      schedule(tick, rand(settings.edgeDwellMinMs || 800, settings.edgeDwellMaxMs || 2500));
      return;
    }

    let stepPx = (settings.speed || 1) * direction;
    if (settings.humanize) stepPx *= rand(0.7, 1.3);
    scrollByPx(sc, stepPx);
    state = "scrolling";
    schedule(tick, settings.tickMs || 24);
  }

  // --- Engine control --------------------------------------------------------
  function startScrolling() {
    if (running) return;
    if (document.visibilityState !== "visible") return;
    if (userTakeover) return;
    running = true;
    direction = 1;
    scroller = null; // re-detect for the current DOM
    scheduleNextBurst();
    clearScrollTimer();
    acquireWakeLock();
    tick();
  }

  function stopScrolling() {
    running = false;
    clearScrollTimer();
    releaseWakeLock();
  }

  function startWatchdog() {
    if (watchdog) return;
    watchdog = window.setInterval(watchdogTick, WATCHDOG_MS);
  }

  function stopWatchdog() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }

  function watchdogTick() {
    if (!settings.enabled || document.visibilityState !== "visible") return;
    if (!userTakeover) return;
    if (
      settings.autoResume &&
      Date.now() - lastInputTs >= (settings.resumeIdleMs || 6000)
    ) {
      userTakeover = false;
      log("真人空闲达到阈值，自动恢复滚动");
      applyState();
    }
  }

  /** Single source of truth: reconcile engine with settings + visibility. */
  function applyState() {
    const visible = document.visibilityState === "visible";

    if (!settings.enabled) {
      stopScrolling();
      stopWatchdog();
      userTakeover = false;
      state = "stopped";
      return;
    }
    if (!visible) {
      stopScrolling();
      stopWatchdog();
      wakeLock = null;
      state = "hidden";
      return;
    }

    startWatchdog();
    if (userTakeover) {
      stopScrolling();
      state = "takeover";
    } else {
      startScrolling();
    }
  }

  // --- Human takeover detection ----------------------------------------------
  function onUserInput() {
    const now = Date.now();
    if (now - lastInputTs > 800) inputActiveSince = now; // new activity burst
    lastInputTs = now;

    if (!settings.enabled || settings.takeoverMode === "off") return;
    if (userTakeover) return;

    if (settings.takeoverMode === "instant") {
      triggerTakeover();
    } else if (
      settings.takeoverMode === "delayed" &&
      now - inputActiveSince >= (settings.takeoverDelayMs || 3000)
    ) {
      triggerTakeover();
    }
  }

  function triggerTakeover() {
    if (userTakeover) return;
    if (settings.autoResume) {
      userTakeover = true;
      log("检测到真人操作 → 暂停（离开后自动恢复）");
      applyState();
    } else {
      log("检测到真人操作 → 停止（自动恢复已关闭）");
      setEnabled(false); // hard stop, propagates to all tabs via storage
    }
  }

  function setEnabled(val) {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      const cur = Object.assign({}, DEFAULTS, (res && res[STORAGE_KEY]) || {});
      cur.enabled = val;
      chrome.storage.local.set({ [STORAGE_KEY]: cur });
    });
  }

  // mousemove also fires while WE scroll (the element under a stationary
  // pointer changes), so only count it as real input when the pointer position
  // actually changed — otherwise auto-scroll would falsely "take over".
  function onMouseMove(e) {
    const moved =
      (e.movementX && e.movementX !== 0) ||
      (e.movementY && e.movementY !== 0) ||
      (lastX !== null && (e.clientX !== lastX || e.clientY !== lastY));
    lastX = e.clientX;
    lastY = e.clientY;
    if (moved) onUserInput();
  }

  function installInputListeners() {
    const opts = { capture: true, passive: true };
    window.addEventListener("mousemove", onMouseMove, opts);
    window.addEventListener("wheel", onUserInput, opts);
    window.addEventListener("touchstart", onUserInput, opts);
    window.addEventListener("touchmove", onUserInput, opts);
    window.addEventListener("pointerdown", onUserInput, opts);
    window.addEventListener("mousedown", onUserInput, opts);
    window.addEventListener("keydown", onUserInput, opts);
  }

  // --- Diagnostics channel ---------------------------------------------------
  function buildStatus() {
    let m = null;
    try {
      m = metrics();
    } catch (_) {
      /* ignore */
    }
    return {
      ok: true,
      enabled: !!settings.enabled,
      visible: document.visibilityState === "visible",
      state: state,
      takeover: userTakeover,
      scrollerKind: m ? (m.sc.isWindow ? "page" : "element") : "unknown",
      maxScroll: m ? Math.round(m.max) : 0,
      scrollable: m ? m.max >= (settings.minScrollPx || 0) : false,
      minScrollPx: settings.minScrollPx || 0,
      wakeLockSupported: "wakeLock" in navigator,
      wakeLockActive: !!wakeLock,
      secure: self.isSecureContext === true,
      host: location.host || location.protocol,
      lastError: lastError
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "getStatus") {
      sendResponse(buildStatus());
    }
    return false;
  });

  // --- Settings wiring -------------------------------------------------------
  chrome.storage.local.get(STORAGE_KEY, (res) => {
    settings = Object.assign({}, DEFAULTS, (res && res[STORAGE_KEY]) || {});
    applyState();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    settings = Object.assign({}, DEFAULTS, changes[STORAGE_KEY].newValue || {});
    // Re-detect scroller and restart timing so new options take effect now.
    stopScrolling();
    applyState();
  });

  document.addEventListener("visibilitychange", applyState);
  window.addEventListener("pagehide", () => {
    stopScrolling();
    stopWatchdog();
  });

  installInputListeners();
})();

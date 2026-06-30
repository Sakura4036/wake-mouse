/* Popup controller: binds the UI to chrome.storage.local "settings". */
(function () {
  "use strict";

  const DEFAULTS = self.MOYU_DEFAULTS || {};
  const STORAGE_KEY = "settings";

  const els = {
    enabled: document.getElementById("enabled"),
    status: document.getElementById("status"),
    speed: document.getElementById("speed"),
    speedValue: document.getElementById("speedValue"),
    tickMs: document.getElementById("tickMs"),
    tickValue: document.getElementById("tickValue"),
    mode: document.getElementById("mode"),
    pauseChance: document.getElementById("pauseChance"),
    pauseValue: document.getElementById("pauseValue"),
    pauseMinMs: document.getElementById("pauseMinMs"),
    pauseMinValue: document.getElementById("pauseMinValue"),
    pauseMaxMs: document.getElementById("pauseMaxMs"),
    pauseMaxValue: document.getElementById("pauseMaxValue"),
    takeoverMode: document.getElementById("takeoverMode"),
    delayRow: document.getElementById("delayRow"),
    takeoverDelayMs: document.getElementById("takeoverDelayMs"),
    delayValue: document.getElementById("delayValue"),
    autoResume: document.getElementById("autoResume"),
    resumeRow: document.getElementById("resumeRow"),
    resumeIdleMs: document.getElementById("resumeIdleMs"),
    resumeValue: document.getElementById("resumeValue"),
    wakeLock: document.getElementById("wakeLock"),
    humanize: document.getElementById("humanize"),
    debug: document.getElementById("debug"),
    reset: document.getElementById("reset"),
    refreshDiag: document.getElementById("refreshDiag"),
    diagBody: document.getElementById("diagBody")
  };

  let settings = Object.assign({}, DEFAULTS);

  function fmtSec(ms) {
    return (ms / 1000).toFixed(1) + " s";
  }

  function render() {
    els.enabled.checked = !!settings.enabled;
    els.status.textContent = settings.enabled ? "运行中 · 摸鱼中…" : "已停止";
    els.status.classList.toggle("on", !!settings.enabled);

    els.speed.value = settings.speed;
    els.speedValue.textContent = settings.speed + " px";

    els.tickMs.value = settings.tickMs;
    els.tickValue.textContent = settings.tickMs + " ms";

    els.mode.value = settings.mode;

    els.pauseChance.value = Math.round(settings.pauseChance * 100);
    els.pauseValue.textContent = Math.round(settings.pauseChance * 100) + "%";

    els.pauseMinMs.value = settings.pauseMinMs;
    els.pauseMinValue.textContent = fmtSec(settings.pauseMinMs);

    els.pauseMaxMs.value = settings.pauseMaxMs;
    els.pauseMaxValue.textContent = fmtSec(settings.pauseMaxMs);

    els.takeoverMode.value = settings.takeoverMode;
    els.takeoverDelayMs.value = settings.takeoverDelayMs;
    els.delayValue.textContent = fmtSec(settings.takeoverDelayMs);
    els.autoResume.checked = !!settings.autoResume;
    els.resumeIdleMs.value = settings.resumeIdleMs;
    els.resumeValue.textContent = fmtSec(settings.resumeIdleMs);

    // Conditional rows.
    els.delayRow.classList.toggle("is-hidden", settings.takeoverMode !== "delayed");
    els.takeoverDelayMs.classList.toggle(
      "is-hidden",
      settings.takeoverMode !== "delayed"
    );
    const resumeIrrelevant = settings.takeoverMode === "off";
    els.autoResume.closest(".toggle-row").classList.toggle(
      "is-hidden",
      resumeIrrelevant
    );
    els.resumeRow.classList.toggle(
      "is-hidden",
      resumeIrrelevant || !settings.autoResume
    );
    els.resumeIdleMs.classList.toggle(
      "is-hidden",
      resumeIrrelevant || !settings.autoResume
    );

    els.wakeLock.checked = !!settings.wakeLock;
    els.humanize.checked = !!settings.humanize;
    els.debug.checked = !!settings.debug;
  }

  function save() {
    chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }

  function update(patch) {
    settings = Object.assign({}, settings, patch);
    // Keep min <= max for pause range.
    if (settings.pauseMinMs > settings.pauseMaxMs) {
      if (patch.pauseMinMs !== undefined) {
        settings.pauseMaxMs = settings.pauseMinMs;
      } else {
        settings.pauseMinMs = settings.pauseMaxMs;
      }
    }
    render();
    save();
  }

  // Wire up events --------------------------------------------------------
  els.enabled.addEventListener("change", (e) =>
    update({ enabled: e.target.checked })
  );
  els.speed.addEventListener("input", (e) =>
    update({ speed: Number(e.target.value) })
  );
  els.tickMs.addEventListener("input", (e) =>
    update({ tickMs: Number(e.target.value) })
  );
  els.mode.addEventListener("change", (e) => update({ mode: e.target.value }));
  els.pauseChance.addEventListener("input", (e) =>
    update({ pauseChance: Number(e.target.value) / 100 })
  );
  els.pauseMinMs.addEventListener("input", (e) =>
    update({ pauseMinMs: Number(e.target.value) })
  );
  els.pauseMaxMs.addEventListener("input", (e) =>
    update({ pauseMaxMs: Number(e.target.value) })
  );
  els.takeoverMode.addEventListener("change", (e) =>
    update({ takeoverMode: e.target.value })
  );
  els.takeoverDelayMs.addEventListener("input", (e) =>
    update({ takeoverDelayMs: Number(e.target.value) })
  );
  els.autoResume.addEventListener("change", (e) =>
    update({ autoResume: e.target.checked })
  );
  els.resumeIdleMs.addEventListener("input", (e) =>
    update({ resumeIdleMs: Number(e.target.value) })
  );
  els.wakeLock.addEventListener("change", (e) =>
    update({ wakeLock: e.target.checked })
  );
  els.humanize.addEventListener("change", (e) =>
    update({ humanize: e.target.checked })
  );
  els.debug.addEventListener("change", (e) =>
    update({ debug: e.target.checked })
  );
  els.refreshDiag.addEventListener("click", refreshDiagnostics);
  els.reset.addEventListener("click", () => {
    settings = Object.assign({}, DEFAULTS, { enabled: settings.enabled });
    render();
    save();
  });

  // React to changes made elsewhere (e.g. another popup / content script).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    settings = Object.assign({}, DEFAULTS, changes[STORAGE_KEY].newValue || {});
    render();
  });

  // Diagnostics -----------------------------------------------------------
  const STATE_LABEL = {
    stopped: "已停止",
    hidden: "标签页不可见（已暂停）",
    scrolling: "滚动中",
    "reading-pause": "拟人停顿中",
    "edge-dwell": "到达边缘停留中",
    "short-idle": "页面内容过短，已暂停",
    takeover: "真人接管中（已暂停）"
  };

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"
    );
  }

  function renderDiag(d) {
    const lines = [];
    const stateCls =
      d.state === "scrolling"
        ? "ok"
        : d.state === "short-idle" || d.state === "hidden"
        ? "warn"
        : "";
    lines.push(
      `状态：<span class="${stateCls}">${esc(STATE_LABEL[d.state] || d.state)}</span>`
    );
    lines.push(
      `可滚动区域：${
        d.scrollable
          ? `<span class="ok">${esc(d.scrollerKind)} · ${d.maxScroll}px</span>`
          : `<span class="warn">不足（${d.maxScroll}px < ${d.minScrollPx}px）</span>`
      }`
    );
    if (d.wakeLockSupported) {
      lines.push(
        `屏幕常亮：${
          d.wakeLockActive
            ? '<span class="ok">已生效</span>'
            : '<span class="warn">未生效</span>'
        }${d.secure ? "" : '（<span class="bad">非 HTTPS</span>）'}`
      );
    } else {
      lines.push('屏幕常亮：<span class="bad">浏览器不支持</span>');
    }
    if (d.lastError) {
      lines.push(`<span class="bad">最近错误：${esc(d.lastError)}</span>`);
    }
    els.diagBody.innerHTML = lines.join("<br>");
  }

  function refreshDiagnostics() {
    els.diagBody.textContent = "检测中…";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        els.diagBody.innerHTML = '<span class="bad">无法获取当前标签页</span>';
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "getStatus" }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          els.diagBody.innerHTML =
            '<span class="bad">无法在此页面运行。</span><br>' +
            "常见原因：浏览器内置页面（chrome:// / edge:// / 设置 / 扩展商店）、" +
            "PDF 阅读器、本地 file:// 或其它受限页面——内容脚本无法注入。" +
            "请在普通网页上使用。";
          return;
        }
        renderDiag(resp);
      });
    });
  }

  // Initial load ----------------------------------------------------------
  chrome.storage.local.get(STORAGE_KEY, (res) => {
    settings = Object.assign({}, DEFAULTS, (res && res[STORAGE_KEY]) || {});
    render();
    refreshDiagnostics();
  });
})();

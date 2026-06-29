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
    wakeLock: document.getElementById("wakeLock"),
    humanize: document.getElementById("humanize"),
    reset: document.getElementById("reset")
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

    els.wakeLock.checked = !!settings.wakeLock;
    els.humanize.checked = !!settings.humanize;
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
  els.wakeLock.addEventListener("change", (e) =>
    update({ wakeLock: e.target.checked })
  );
  els.humanize.addEventListener("change", (e) =>
    update({ humanize: e.target.checked })
  );
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

  // Initial load ----------------------------------------------------------
  chrome.storage.local.get(STORAGE_KEY, (res) => {
    settings = Object.assign({}, DEFAULTS, (res && res[STORAGE_KEY]) || {});
    render();
  });
})();

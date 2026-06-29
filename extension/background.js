/**
 * 摸鱼助手 service worker.
 * - Seeds default settings on install.
 * - Mirrors the enabled state onto the toolbar badge.
 */
importScripts("defaults.js");

const DEFAULTS = self.MOYU_DEFAULTS || {};
const STORAGE_KEY = "settings";

function updateBadge(enabled) {
  const text = enabled ? "ON" : "";
  chrome.action.setBadgeText({ text });
  if (enabled) {
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
  }
}

async function getSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return Object.assign({}, DEFAULTS, (res && res[STORAGE_KEY]) || {});
}

chrome.runtime.onInstalled.addListener(async () => {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const merged = Object.assign({}, DEFAULTS, (res && res[STORAGE_KEY]) || {});
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  updateBadge(merged.enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const s = await getSettings();
  updateBadge(s.enabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  const val = changes[STORAGE_KEY].newValue || {};
  updateBadge(!!val.enabled);
});

/**
* LingoBlend background script — v0.7.2
* Added: seed-profile loading from bundled profiles/index.json on install/update.
* Removed (v0.7.0): auto-creation of a "Default" profile — profiles object
* starts empty if no profiles exist; popup prompts user to create one.
*/

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Volatile per-tab mismatch map (survives until tab navigates)
const tabLangMismatch = new Map();

// ── Seed profile loading ──────────────────────────────────────────────────────
async function loadSeedProfiles() {
  try {
    const indexUrl = chrome.runtime.getURL('profiles/index.json');
    const indexResp = await fetch(indexUrl);
    if (!indexResp.ok) return {};
    const filenames = await indexResp.json();
    if (!Array.isArray(filenames) || !filenames.length) return {};

    const seeded = {};
    for (const filename of filenames) {
      try {
        const url = chrome.runtime.getURL('profiles/' + filename);
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const profile = await resp.json();
        if (!profile.id || !profile.name) continue;
        seeded[profile.id] = profile;
      } catch (_) {
        // Skip malformed/missing individual profile files without failing the batch.
      }
    }
    return seeded;
  } catch (_) {
    // No profiles/index.json bundled — not an error, just no seeds.
    return {};
  }
}

async function mergeSeedProfiles() {
  const data = await chrome.storage.local.get(['profiles']);
  const existing = data.profiles || {};
  const seeded = await loadSeedProfiles();

  const updates = {};
  for (const [id, profile] of Object.entries(seeded)) {
    if (!existing[id]) {
      existing[id] = { ...profile, lastUsedAt: profile.lastUsedAt || Date.now() };
      updates.added = true;
    }
  }
  if (updates.added) {
    await chrome.storage.local.set({ profiles: existing });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null).then(async data => {
    const updates = {};
    if (data.enabled === undefined) updates.enabled = true;
    if (data.rate === undefined) updates.rate = 100;

    // No profiles yet — leave empty; popup.js prompts user to create one.
    if (!data.profiles) updates.profiles = {};

    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    await mergeSeedProfiles();
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.type === 'LANG_MISMATCH') {
    if (tabId) tabLangMismatch.set(tabId, { pageLang: msg.pageLang, nativeLang: msg.nativeLang });
    sendResponse({});
    return true;
  }

  if (msg.type === 'GET_TAB_LANG_MISMATCH') {
    const tid = msg.tabId;
    sendResponse({ mismatch: tid ? (tabLangMismatch.get(tid) || null) : null });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabLangMismatch.delete(tabId);
  }
});
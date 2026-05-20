/**
 * LingoBlend background script — v0.5.0
 */

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Volatile per-tab mismatch map (survives until tab navigates)
const tabLangMismatch = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null).then(data => {
    const updates = {};
    if (data.enabled === undefined) updates.enabled = true;
    if (data.rate === undefined) updates.rate = 100;

    // ── Profile migration ──────────────────────────────────────────────────────
    if (!data.profiles) {
      const id = generateUUID();
      const now = Date.now();
      updates.profiles = {
        [id]: {
          id,
          name: 'Default',
          nativeLanguage: 'pl',
          targetLanguage: 'en',
          vocabText: data.vocabText || '',
          vocabName: data.vocabName || '',
          vocabCount: data.vocabCount || 0,
          vocabDelimiter: data.vocabDelimiter || '\t',
          analyticsHistory: data.analyticsHistory || [],
          disabledHosts: data.disabledHosts || [],
          createdAt: now,
          lastUsedAt: now
        }
      };
      updates.activeProfileId = id;
      if (data.nativeLanguage === undefined) updates.nativeLanguage = 'pl';
    }

    if (Object.keys(updates).length) chrome.storage.local.set(updates);
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
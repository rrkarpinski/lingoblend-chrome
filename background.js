/**
* LingoBlend background script — v0.9.3
* starts empty if no profiles exist; popup prompts user to create one.
*/

// Volatile per-tab mismatch map (survives until tab navigates)
const tabLangMismatch = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null).then(async data => {
    const updates = {};
    if (data.enabled === undefined) updates.enabled = true;
    if (data.rate === undefined) updates.rate = 100;
    if (!data.profiles) updates.profiles = {};
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
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
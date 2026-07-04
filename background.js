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

    // v0.7.0: no longer auto-create a default profile. If no profiles
    // exist, leave `profiles` unset/empty — popup.js detects this and
    // prompts the user to create one via the dashboard.
    if (!data.profiles) {
      updates.profiles = {};
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
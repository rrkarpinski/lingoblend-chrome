/**
 * LingoBlend popup script — v0.6.2
 * Change from v0.6.1: removed auto-reload-on-change behavior from all
 * interactive elements (toggle, rate slider, profile switch, site mute,
 * clear vocab). Replaced with saveSettings() which only persists to
 * storage and re-renders the popup. Added an explicit "Refresh page"
 * button (#btn-refresh) as the sole trigger for chrome.tabs.reload().
 */
import { delimForFile, detectDelimiter, parseVocabFull, detectFunctionWords, buildDiff, applyMerge, vocabRowsToText } from '../vocab-import.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chkEnabled = document.getElementById('chk-enabled');
const fileInput = document.getElementById('file-input');
const btnClear = document.getElementById('btn-clear');
const rateSlider = document.getElementById('rate-slider');
const rateVal = document.getElementById('rate-val');
const pageStats = document.getElementById('page-stats');
const langMismatchNotice = document.getElementById('lang-mismatch-notice');
const sentStats = document.getElementById('sentence-stats');
const stateEmpty = document.getElementById('state-empty');
const stateLoaded = document.getElementById('state-loaded');
const vocabName = document.getElementById('vocab-name');
const vocabCount = document.getElementById('vocab-count');
const siteLine = document.getElementById('site-line');
const btnDash = document.getElementById('btn-dashboard');
const btnRefresh = document.getElementById('btn-refresh');
const profileBadge = document.getElementById('profile-badge');
const profileBadgeName = document.getElementById('profile-badge-name');
const profileDropdown = document.getElementById('profile-dropdown');
const profileDropdownList = document.getElementById('profile-dropdown-list');
const btnManageProfiles = document.getElementById('btn-manage-profiles');

let currentHostname = '';
let currentTab = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
// Persist storage changes only. No tab reload, no window.close().
async function saveSettings(storageUpdates = {}) {
  if (Object.keys(storageUpdates).length > 0) {
    await chrome.storage.local.set(storageUpdates);
  }
}

function syncFlatFromProfile(profile) {
  return {
    vocabText: profile.vocabText || '',
    vocabName: profile.vocabName || '',
    vocabCount: profile.vocabCount || 0,
    vocabDelimiter: profile.vocabDelimiter || '\t',
    disabledHosts: profile.disabledHosts || [],
    analyticsHistory: profile.analyticsHistory || [],
    nativeLanguage: profile.nativeLanguage || 'pl'
  };
}

async function switchProfile(id) {
  const data = await chrome.storage.local.get(['profiles']);
  const profiles = data.profiles || {};
  const profile = profiles[id];
  if (!profile) return;
  profile.lastUsedAt = Date.now();
  profiles[id] = profile;
  const flatKeys = syncFlatFromProfile(profile);
  await saveSettings({ activeProfileId: id, profiles, ...flatKeys });

  // Re-render popup UI in place (no reload) with the new profile's data.
  renderProfileBadge(profiles, id);
  renderProfileDropdown(profiles, id);
  rateSlider.value = 100; // rate is per-device, kept as-is unless you store per-profile rate
  if (flatKeys.vocabText) showLoadedState(flatKeys.vocabName || 'vocab', flatKeys.vocabCount || '?');
  else showEmptyState();
  profileDropdown.hidden = true;
  showRefreshHint();
}

function renderProfileBadge(profiles, activeId) {
  const active = profiles[activeId];
  if (active) profileBadgeName.textContent = active.name;
}

function renderProfileDropdown(profiles, activeId) {
  profileDropdownList.innerHTML = '';
  for (const id of Object.keys(profiles)) {
    const p = profiles[id];
    const item = document.createElement('li');
    item.className = 'profile-dropdown-item' + (id === activeId ? ' active' : '');
    item.innerHTML = `<span class="profile-dot"></span><span>${p.name}</span>`;
    item.addEventListener('click', () => switchProfile(id));
    profileDropdownList.appendChild(item);
  }
}

profileBadge.addEventListener('click', e => {
  e.stopPropagation();
  profileDropdown.hidden = !profileDropdown.hidden;
});
document.addEventListener('click', () => { profileDropdown.hidden = true; });
profileDropdown.addEventListener('click', e => e.stopPropagation());

btnManageProfiles.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') + '#profiles' });
  window.close();
});

// ── Refresh hint / explicit refresh ──────────────────────────────────────────
function showRefreshHint() {
  pageStats.textContent = 'Settings saved — click refresh to apply';
  pageStats.className = 'page-stats muted';
}

btnRefresh.addEventListener('click', () => {
  if (!currentTab?.id) return;
  chrome.tabs.reload(currentTab.id);
  window.close();
});

// ── Lang mismatch ─────────────────────────────────────────────────────────────
function showLangMismatchNotice(pageLang, nativeLang) {
  langMismatchNotice.textContent = `Page may not be in ${nativeLang.toUpperCase()}`;
  langMismatchNotice.hidden = false;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  const data = await chrome.storage.local.get(
    ['enabled', 'vocabText', 'vocabName', 'vocabCount', 'rate', 'disabledHosts', 'profiles', 'activeProfileId', 'nativeLanguage']
  );
  const profiles = data.profiles || {};
  const activeId = data.activeProfileId || '';
  renderProfileBadge(profiles, activeId);
  renderProfileDropdown(profiles, activeId);

  chkEnabled.checked = data.enabled !== false;
  rateSlider.value = data.rate !== undefined ? data.rate : 100;
  rateVal.textContent = rateSlider.value + '%';

  if (data.vocabText) showLoadedState(data.vocabName || 'vocab', data.vocabCount || '?');
  else showEmptyState();

  if (tab?.url) {
    try {
      currentHostname = new URL(tab.url).hostname;
      renderSiteLine((data.disabledHosts || []).includes(currentHostname));
    } catch (_) {}
  }

  if (tab?.id && tab.url && /^https?:\/\//.test(tab.url)) {
    chrome.runtime.sendMessage({ type: 'GET_TAB_LANG_MISMATCH', tabId: tab.id }, resp => {
      if (chrome.runtime.lastError) return;
      if (resp?.mismatch) showLangMismatchNotice(resp.mismatch.pageLang, resp.mismatch.nativeLang);
      queryAndRenderStats(tab.id);
    });
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function queryAndRenderStats(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'GET_STATS' }, resp => {
    if (chrome.runtime.lastError || !resp) {
      pageStats.textContent = 'Reload page to activate';
      pageStats.className = 'page-stats muted';
      return;
    }
    pageStats.textContent = resp.count > 0
      ? `${resp.count} word${resp.count !== 1 ? 's' : ''} blended in`
      : '0 words blended in';
    pageStats.className = resp.count > 0 ? 'page-stats success' : 'page-stats muted';
  });

  chrome.tabs.sendMessage(tabId, { type: 'GET_SENTENCE_STATS' }, resp => {
    if (chrome.runtime.lastError || !resp) return;
    renderSentenceStats(resp);
    if (resp?.sentenceCount > 0 && currentHostname) saveSnapshot(currentHostname, resp);
  });
}

function renderSentenceStats(data) {
  if (!data || data.sentenceCount === 0) return;
  sentStats.hidden = false;
  sentStats.innerHTML = `
    <div class="stat-item">
      <span class="stat-num">${data.avgPct}%</span>
      <span class="stat-lbl">Avg sentence coverage</span>
    </div>
    <div class="stat-item">
      <span class="stat-num">${data.highCoverageCount}</span>
      <span class="stat-lbl">High-coverage sentences</span>
    </div>`;
}

function showEmptyState() { stateEmpty.hidden = false; stateLoaded.hidden = true; }
function showLoadedState(name, count) {
  stateEmpty.hidden = true; stateLoaded.hidden = false;
  vocabName.textContent = name;
  vocabCount.textContent = count + ' words';
}

// ── Site line ─────────────────────────────────────────────────────────────────
function renderSiteLine(disabled) {
  if (!currentHostname) { siteLine.textContent = ''; return; }
  if (disabled) {
    siteLine.innerHTML = `<strong>${currentHostname}</strong> is muted — <span class="site-action whitelist" id="btn-toggle-site">re-enable</span>`;
  } else {
    siteLine.innerHTML = `<span class="site-action blacklist" id="btn-toggle-site">Mute ${currentHostname}</span>`;
  }
  document.getElementById('btn-toggle-site')?.addEventListener('click', toggleSite);
}

async function toggleSite() {
  const data = await chrome.storage.local.get(['disabledHosts', 'profiles', 'activeProfileId']);
  let hosts = data.disabledHosts || [];
  const isDisabled = hosts.includes(currentHostname);
  hosts = isDisabled ? hosts.filter(h => h !== currentHostname) : [...hosts, currentHostname];

  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) profiles[activeId].disabledHosts = hosts;

  await saveSettings({ disabledHosts: hosts, ...(activeId && profiles[activeId] ? { profiles } : {}) });
  renderSiteLine(!isDisabled);
  showRefreshHint();
}

// ── Controls ──────────────────────────────────────────────────────────────────
chkEnabled.addEventListener('change', async () => {
  await saveSettings({ enabled: chkEnabled.checked });
  showRefreshHint();
});

rateSlider.addEventListener('input', () => { rateVal.textContent = rateSlider.value + '%'; });
rateSlider.addEventListener('change', async () => {
  await saveSettings({ rate: parseInt(rateSlider.value) });
  showRefreshHint();
});

btnClear.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['profiles', 'activeProfileId']);
  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) {
    profiles[activeId].vocabText = '';
    profiles[activeId].vocabName = '';
    profiles[activeId].vocabCount = 0;
  }
  await saveSettings({ vocabText: '', vocabName: '', vocabCount: 0, profiles });
  showEmptyState();
  showRefreshHint();
});

// ── Vocab import ──────────────────────────────────────────────────────────────
const modalDiff = document.getElementById('modal-diff');
const modalDiffBody = document.getElementById('modal-diff-body');
let diffResolve = null;

function showDiffModal(diff, fwStats) {
  let fwLine = '';
  if (fwStats && fwStats.totalFlagged > 0) {
    const parts = [];
    if (fwStats.targetFlagged > 0) parts.push(`${fwStats.targetFlagged} target word${fwStats.targetFlagged !== 1 ? 's' : ''} flagged`);
    if (fwStats.translationFlagged > 0) parts.push(`${fwStats.translationFlagged} row${fwStats.translationFlagged !== 1 ? 's' : ''} with a function-word translation`);
    fwLine = `<br><span style="color:#7a7974;font-size:0.92em">Function words detected: ${parts.join(', ')} (${fwStats.totalFlagged} total, kept in word bank)</span>`;
  }
  modalDiffBody.innerHTML = `
    <strong style="color:#437a22">${diff.newWords.length} added</strong>&nbsp;
    <strong style="color:#da7101">${diff.updated.length} modified</strong>&nbsp;
    <strong style="color:#7a7974">${diff.unchanged.length} unchanged</strong>&nbsp;
    <strong style="color:#a12c7b">${diff.removed.length} removed</strong>${fwLine}
  `;
  modalDiff.style.display = 'flex';
  return new Promise(res => { diffResolve = res; });
}

document.getElementById('diff-add-new').addEventListener('click', () => { modalDiff.style.display = 'none'; diffResolve?.('addnew'); diffResolve = null; });
document.getElementById('diff-add-update').addEventListener('click', () => { modalDiff.style.display = 'none'; diffResolve?.('addupdate'); diffResolve = null; });
document.getElementById('diff-replace').addEventListener('click', () => { modalDiff.style.display = 'none'; diffResolve?.('replace'); diffResolve = null; });
document.getElementById('diff-cancel').addEventListener('click', () => { modalDiff.style.display = 'none'; diffResolve?.(null); diffResolve = null; });

async function handleImport(text, fileName) {
  const lines = text.split(/\r?\n/);
  const firstLine = lines.find(l => l.trim());
  let delim = delimForFile(fileName);
  if (!delim && firstLine) delim = detectDelimiter(firstLine);
  if (!delim) { alert('Could not detect delimiter. File must be tab- or semicolon-separated.'); return; }

  const { rows: rawIncoming, colNames: importedColNames } = parseVocabFull(text, delim);
  if (!rawIncoming.length) { alert('No valid rows found in file.'); return; }

  const stored = await chrome.storage.local.get(['vocabText', 'vocabColNames', 'profiles', 'activeProfileId']);
  const activeProfile = (stored.profiles || {})[stored.activeProfileId] || {};
  const targetLang = activeProfile.targetLanguage || null;
  const nativeLang = activeProfile.nativeLanguage || null;

  const { tagged: incoming, fwStats } = detectFunctionWords(rawIncoming, targetLang, nativeLang);

  let colNames = importedColNames;
  if (!colNames.includes('functionWordDetected')) colNames = [...colNames, 'functionWordDetected'];

  const existingText = stored.vocabText || '';
  const existingDelim = existingText.includes('\t') ? '\t' : ';';
  const { rows: existing } = existingText ? parseVocabFull(existingText, existingDelim) : { rows: [] };

  const diff = buildDiff(incoming, existing);
  const mode = await showDiffModal(diff, fwStats);
  if (!mode) return;

  const merged = applyMerge(mode, incoming, existing);
  const newText = vocabRowsToText(merged, colNames, delim);
  const name = fileName.replace(/\.[^.]+$/, '');
  const count = merged.length;

  const profiles = stored.profiles || {};
  const activeId = stored.activeProfileId;
  if (activeId && profiles[activeId]) {
    profiles[activeId].vocabText = newText;
    profiles[activeId].vocabName = name;
    profiles[activeId].vocabCount = count;
    profiles[activeId].vocabDelimiter = delim;
  }
  await saveSettings({ vocabText: newText, vocabName: name, vocabCount: count, vocabColNames: colNames, vocabDelimiter: delim, profiles });
  showLoadedState(name, count);
  showRefreshHint();
}

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  fileInput.value = '';
  await handleImport(await file.text(), file.name);
});

// ── Dashboard button ──────────────────────────────────────────────────────────
btnDash.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// ── Analytics snapshot ────────────────────────────────────────────────────────
async function saveSnapshot(hostname, sentData) {
  const data = await chrome.storage.local.get(['analyticsHistory', 'profiles', 'activeProfileId']);
  let history = data.analyticsHistory || [];
  history.unshift({
    hostname, ts: Date.now(),
    avgPct: sentData.avgPct,
    highCoverageCount: sentData.highCoverageCount,
    topMissing: sentData.topMissing
  });
  if (history.length > 200) history = history.slice(0, 200);

  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) profiles[activeId].analyticsHistory = history;
  await chrome.storage.local.set({ analyticsHistory: history, profiles });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
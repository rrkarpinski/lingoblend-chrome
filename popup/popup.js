/**
 * LingoBlend popup script — v0.7.0
 * Vocabulary import/management removed entirely — now dashboard-only.
 * Popup shows a "Create Profile" CTA when no profiles exist, redirecting
 * to dashboard.html#profiles&new=1. Otherwise shows profile switcher,
 * blend-rate slider, refresh button, stats, and site mute control.
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chkEnabled = document.getElementById('chk-enabled');
const toggleWrap = document.getElementById('toggle-wrap');
const rateSlider = document.getElementById('rate-slider');
const rateVal = document.getElementById('rate-val');
const pageStats = document.getElementById('page-stats');
const langMismatchNotice = document.getElementById('lang-mismatch-notice');
const sentStats = document.getElementById('sentence-stats');
const siteLine = document.getElementById('site-line');
const btnDash = document.getElementById('btn-dashboard');
const btnRefresh = document.getElementById('btn-refresh');
const profileBadgeWrap = document.getElementById('profile-badge-wrap');
const profileBadge = document.getElementById('profile-badge');
const profileBadgeName = document.getElementById('profile-badge-name');
const profileDropdown = document.getElementById('profile-dropdown');
const profileDropdownList = document.getElementById('profile-dropdown-list');
const btnManageProfiles = document.getElementById('btn-manage-profiles');
const noProfilePanel = document.getElementById('no-profile-panel');
const mainPanel = document.getElementById('main-panel');
const btnCreateFirstProfile = document.getElementById('btn-create-first-profile');

let currentHostname = '';
let currentTab = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

  renderProfileBadge(profiles, id);
  renderProfileDropdown(profiles, id);
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

btnCreateFirstProfile.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') + '#profiles&new=1' });
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
    ['enabled', 'rate', 'disabledHosts', 'profiles', 'activeProfileId', 'nativeLanguage']
  );
  const profiles = data.profiles || {};
  const activeId = data.activeProfileId || '';

  if (Object.keys(profiles).length === 0) {
    noProfilePanel.hidden = false;
    mainPanel.hidden = true;
    profileBadgeWrap.hidden = true;
    toggleWrap.hidden = true;
    return;
  }

  noProfilePanel.hidden = true;
  mainPanel.hidden = false;
  profileBadgeWrap.hidden = false;
  toggleWrap.hidden = false;

  renderProfileBadge(profiles, activeId);
  renderProfileDropdown(profiles, activeId);

  chkEnabled.checked = data.enabled !== false;
  rateSlider.value = data.rate !== undefined ? data.rate : 100;
  rateVal.textContent = rateSlider.value + '%';

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
    <div class="stat-item"><span class="stat-num">${data.avgPct}%</span><span class="stat-lbl">Avg sentence coverage</span></div>
    <div class="stat-item"><span class="stat-num">${data.highCoverageCount}</span><span class="stat-lbl">High-coverage sentences</span></div>
  `;
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

// ── Dashboard button ──────────────────────────────────────────────────────────
btnDash.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// ── Analytics snapshot ────────────────────────────────────────────────────────
async function saveSnapshot(hostname, sentData) {
  const data = await chrome.storage.local.get(['analyticsHistory', 'profiles', 'activeProfileId']);
  let history = data.analyticsHistory || [];
  history.unshift({ hostname, ts: Date.now(), avgPct: sentData.avgPct, highCoverageCount: sentData.highCoverageCount, topMissing: sentData.topMissing });
  if (history.length > 200) history = history.slice(0, 200);

  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) profiles[activeId].analyticsHistory = history;
  await chrome.storage.local.set({ analyticsHistory: history, profiles });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
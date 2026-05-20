// ── v0.4.3 DOM refs (unchanged) ───────────────────────────────────────────────
const chkEnabled          = document.getElementById('chk-enabled');
const fileInput           = document.getElementById('file-input');
const btnClear            = document.getElementById('btn-clear');
const rateSlider          = document.getElementById('rate-slider');
const rateVal             = document.getElementById('rate-val');
const pageStats           = document.getElementById('page-stats');
const langMismatchNotice  = document.getElementById('lang-mismatch-notice');
const sentStats           = document.getElementById('sentence-stats');
const stateEmpty          = document.getElementById('state-empty');
const stateLoaded         = document.getElementById('state-loaded');
const vocabName           = document.getElementById('vocab-name');
const vocabCount          = document.getElementById('vocab-count');
const siteLine            = document.getElementById('site-line');
const btnDash             = document.getElementById('btn-dashboard');

// ── v0.5.0 DOM refs ───────────────────────────────────────────────────────────
const profileBadge       = document.getElementById('profile-badge');
const profileBadgeName   = document.getElementById('profile-badge-name');
const profileDropdown    = document.getElementById('profile-dropdown');
const profileDropdownList= document.getElementById('profile-dropdown-list');
const btnManageProfiles  = document.getElementById('btn-manage-profiles');

let currentHostname = '';
let currentTab = null;

// ── Helpers (v0.5.0) ──────────────────────────────────────────────────────────

async function applyAndReload(storageUpdates = {}) {
  if (Object.keys(storageUpdates).length > 0) {
    await chrome.storage.local.set(storageUpdates);
  }
  if (!currentTab?.id) return;
  chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
    if (tabId === currentTab.id && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => queryAndRenderStats(currentTab.id), 300);
    }
  });
  chrome.tabs.reload(currentTab.id);
  window.close();
}

// Sync active profile's flat keys to storage, update lastUsedAt
function syncFlatFromProfile(profile) {
  return {
    vocabText:        profile.vocabText        || '',
    vocabName:        profile.vocabName        || '',
    vocabCount:       profile.vocabCount       || 0,
    vocabDelimiter:   profile.vocabDelimiter   || '\t',
    disabledHosts:    profile.disabledHosts    || [],
    analyticsHistory: profile.analyticsHistory || [],
    nativeLanguage:   profile.nativeLanguage   || 'pl'
  };
}

async function switchProfile(id) {
  const data = await chrome.storage.local.get(['profiles']);
  const profiles = data.profiles || {};
  const profile = profiles[id];
  if (!profile) return;
  profile.lastUsedAt = Date.now();
  profiles[id] = profile;

  const flatKeys = await syncFlatFromProfile(profile);

  await applyAndReload({activeProfileId: id, profiles, ...flatKeys});
}

function renderProfileBadge(profiles, activeId) {
  const active = profiles[activeId];
  if (active) {
    profileBadgeName.textContent = active.name;
  }
}

function renderProfileDropdown(profiles, activeId) {
  // Render in insertion order (static order per spec)
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

// Toggle dropdown visibility
profileBadge.addEventListener('click', e => {
  e.stopPropagation();
  const hidden = profileDropdown.hidden;
  profileDropdown.hidden = !hidden;
});

document.addEventListener('click', () => { profileDropdown.hidden = true; });

profileDropdown.addEventListener('click', e => e.stopPropagation());

btnManageProfiles.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') + '#profiles' });
  window.close();
});

// ── Lang mismatch notice ──────────────────────────────────────────────────────
function showLangMismatchNotice(pageLang, nativeLang) {
  langMismatchNotice.textContent = `Page may not be in ${nativeLang.toUpperCase()}`;
  langMismatchNotice.hidden = false;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  const data = await chrome.storage.local.get(
    ['enabled', 'vocabText', 'vocabName', 'vocabCount', 'rate', 'disabledHosts',
     'profiles', 'activeProfileId', 'nativeLanguage']
  );

  // Render profile badge + dropdown
  const profiles   = data.profiles || {};
  const activeId   = data.activeProfileId || '';
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
      const disabled = (data.disabledHosts || []).includes(currentHostname);
      renderSiteLine(disabled);
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

// ── Stats helpers ──────────────────────────────────────────────────────────────
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

// ── Sentence stats ─────────────────────────────────────────────────────────────
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

// ── State display helpers (unchanged) ─────────────────────────────────────────
function showEmptyState() {
  stateEmpty.hidden = false;
  stateLoaded.hidden = true;
}

function showLoadedState(name, count) {
  stateEmpty.hidden = true;
  stateLoaded.hidden = false;
  vocabName.textContent = name;
  vocabCount.textContent = count + ' words';
}

// ── Site line ──────────────────────────────────────────────────────────────────
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
  if (isDisabled) hosts = hosts.filter(h => h !== currentHostname);
  else hosts.push(currentHostname);

  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) {
    profiles[activeId].disabledHosts = hosts;
  }

  await applyAndReload({
    disabledHosts: hosts,
    ...(activeId && profiles[activeId] ? { profiles } : {})
  });
}

// ── Enabled toggle ────────────────────────────────────────────────────────────
chkEnabled.addEventListener('change', async () => {
  await applyAndReload({ enabled: chkEnabled.checked });
});

// ── Rate slider ───────────────────────────────────────────────────────────────
rateSlider.addEventListener('input', () => {
  rateVal.textContent = rateSlider.value + '%';
});
rateSlider.addEventListener('change', () => {
  applyAndReload({ rate: parseInt(rateSlider.value) });
});

// ── Clear vocab (unchanged, but also updates active profile) ──────────────────
btnClear.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['profiles', 'activeProfileId']);
  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) {
    profiles[activeId].vocabText = '';
    profiles[activeId].vocabName = '';
    profiles[activeId].vocabCount = 0;
  }
  await applyAndReload({
    vocabText: '', vocabName: '', vocabCount: 0,
    profiles
  });
});

// ── File import ───────────────────────────────────────────────────────────────
const modalDiff = document.getElementById('modal-diff');
const modalDiffBody = document.getElementById('modal-diff-body');
let _diffResolve = null;

function showDiffModal(diff) {
  modalDiffBody.innerHTML =
    `<strong style="color:#437a22">+${diff.newWords.length} added</strong> &nbsp;` +
    `<strong style="color:#da7101">~${diff.updated.length} modified</strong> &nbsp;` +
    `<strong style="color:#7a7974">=${diff.unchanged.length} unchanged</strong> &nbsp;` +
    `<strong style="color:#a12c7b">-${diff.removed.length} removed</strong>`;
  modalDiff.style.display = 'flex';
  return new Promise(res => { _diffResolve = res; });
}

document.getElementById('diff-add-new').addEventListener('click', () => {
  modalDiff.style.display = 'none';
  _diffResolve?.('addnew');
  _diffResolve = null;
});
document.getElementById('diff-add-update').addEventListener('click', () => {
  modalDiff.style.display = 'none';
  _diffResolve?.('addupdate');
  _diffResolve = null;
});
document.getElementById('diff-replace').addEventListener('click', () => {
  modalDiff.style.display = 'none';
  _diffResolve?.('replace');
  _diffResolve = null;
});
document.getElementById('diff-cancel').addEventListener('click', () => {
  modalDiff.style.display = 'none';
  _diffResolve?.(null);
  _diffResolve = null;
});

const KNOWN_HEADER_TOKENS = new Set([
  'target','word','native','translation','translations',
  'forms','source','notes','comment','tags'
]);

function delimForFile(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (ext === 'tsv') return '\t';
  if (ext === 'csv') return ';';
  return null;
}

function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(';'))  return ';';
  return null;
}

function parseVocabFull(text, delim) {
  const KNOWN_COLS = ['target', 'translations', 'forms', 'source'];
  const lines = text.split(/\r?\n/);
  let colNames = null;
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(delim);
    if (colNames === null) {
      const firstToken = cells[0].trim().toLowerCase();
      if (KNOWN_HEADER_TOKENS.has(firstToken)) {
        colNames = cells.map(c => c.trim().toLowerCase());
        continue;
      } else {
        const n = Math.max(cells.length, 2);
        colNames = Array.from({ length: n }, (_, i) => KNOWN_COLS[i] || `col${i}`);
      }
    }
    const obj = {};
    cells.forEach((c, i) => { obj[colNames[i] || `col${i}`] = c.trim(); });
    if (!obj.target) obj.target = obj[colNames[0]] || '';
    if (!obj.translations && colNames[1]) obj.translations = obj[colNames[1]] || '';
    if (!obj.target || !obj.translations) continue;
    rows.push(obj);
  }
  return { rows, colNames: colNames || KNOWN_COLS.slice(0, 2) };
}

function vocabRowsToText(rows, colNames, delim = ';') {
  const header = colNames.join(delim);
  const body = rows.map(r =>
    colNames.map(c => (r[c] || '').replace(new RegExp(delim === '\t' ? '\t' : delim, 'g'), ' ')).join(delim)
  );
  return [header, ...body].join('\n');
}

function buildDiff(incoming, existing) {
  const existingMap = new Map(existing.map(r => [r.target, r]));
  const incomingSet = new Set(incoming.map(r => r.target));
  const newWords = [], updated = [], unchanged = [], removed = [];
  for (const row of incoming) {
    if (!existingMap.has(row.target)) newWords.push(row);
    else {
      const old = existingMap.get(row.target);
      (JSON.stringify(old) !== JSON.stringify(row) ? updated : unchanged).push(row);
    }
  }
  for (const row of existing) {
    if (!incomingSet.has(row.target)) removed.push(row);
  }
  return { newWords, updated, unchanged, removed };
}

function applyMerge(mode, incoming, existing) {
  if (mode === 'replace') return incoming;
  const existingMap = new Map(existing.map(r => [r.target, r]));
  if (mode === 'addnew') return [...existing, ...incoming.filter(r => !existingMap.has(r.target))];
  const merged = [...existing];
  const mergedIdx = new Map(merged.map((r, i) => [r.target, i]));
  for (const row of incoming) {
    if (mergedIdx.has(row.target)) merged[mergedIdx.get(row.target)] = row;
    else merged.push(row);
  }
  return merged;
}

async function handleImport(text, fileName, onComplete) {
  const lines = text.split(/\r?\n/);
  const firstLine = lines.find(l => l.trim()) || '';

  let delim = delimForFile(fileName);
  if (!delim || firstLine.split(delim).length < 2) {
    delim = detectDelimiter(firstLine);
  }
  if (!delim) {
    alert('Could not detect delimiter. File must be tab- or semicolon-separated.');
    return;
  }

  const { rows: incoming, colNames } = parseVocabFull(text, delim);
  if (!incoming.length) {
    alert('No valid rows found in file.');
    return;
  }

  const stored = await chrome.storage.local.get(['vocabText', 'vocabName', 'vocabColNames', 'profiles', 'activeProfileId']);
  const existingText = stored.vocabText || '';
  const existingDelim = existingText.includes('\t') ? '\t' : ';';
  const { rows: existing } = existingText ? parseVocabFull(existingText, existingDelim) : { rows: [] };

  const diff = buildDiff(incoming, existing);
  const mode = await showDiffModal(diff);
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

  const storageUpdates = {
    vocabText: newText, vocabName: name, vocabCount: count,
    vocabColNames: colNames, vocabDelimiter: delim, profiles
  };

  await onComplete(storageUpdates, { merged, colNames, name, delim });
}

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  fileInput.value = '';
  await handleImport(file.text ? await file.text() : '', file.name, async (storageUpdates) => {
    await applyAndReload(storageUpdates);
  });
});

// ── Dashboard button ───────────────────────────────────────────────────────────
btnDash.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// ── Analytics snapshot helper (unchanged, but scoped to active profile) ───────
async function saveSnapshot(hostname, sentData) {
  const data = await chrome.storage.local.get(['analyticsHistory', 'profiles', 'activeProfileId']);
  let history = data.analyticsHistory || [];
  history.unshift({
    hostname, ts: Date.now(),
    avgPct: sentData.avgPct,
    highCoverageCount: sentData.highCoverageCount,
    topMissing: sentData.topMissing || []
  });
  if (history.length > 200) history = history.slice(0, 200);

  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) {
    profiles[activeId].analyticsHistory = history;
  }
  await chrome.storage.local.set({ analyticsHistory: history, profiles });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();

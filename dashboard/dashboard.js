import { initI18n, setLang, getLang, t, applyStaticI18n } from '../i18n.js';
import { delimForFile, detectDelimiter, parseVocabFull, buildDiff, applyMerge, vocabRowsToText } from '../vocab-import.js';
import { uploadVocab, getJobStatus, getJobResult, jobCreatedAt } from '../enrichment-api.js';


// ── Enrichment API config ─────────────────────────────────────────────────────
// Single place to change when moving from local dev to the eventual Render URL.
// Must also match a host_permissions entry in manifest.json.
// const ENRICHMENT_API_BASE_URL = 'http://localhost:8000'; // local dev
const ENRICHMENT_API_BASE_URL = 'https://lingoblend-processing.onrender.com';
const ENRICH_POLL_INTERVAL_MS = 4000;


// ── i18n boot ─────────────────────────────────────────────────────────────────
await initI18n();
applyStaticI18n();
document.getElementById('lang-select').value = getLang();
document.getElementById('lang-select').addEventListener('change', async e => {
  await setLang(e.target.value);
  applyStaticI18n();
  renderProfiles();
  renderAnalytics(globalProfiles[globalActiveId]?.analyticsHistory || []);
  renderVocab(globalRows, globalColNames);
  renderBlacklist(globalProfiles[globalActiveId]?.disabledHosts || []);
});


// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    history.replaceState(null, '', '#' + btn.dataset.tab);
    if (btn.dataset.tab === 'vocab') {
      maybeStartEnrichPolling();
    } else {
      stopEnrichPolling();
    }
  });
});


const VALID_TABS = ['profiles', 'analytics', 'vocab', 'blacklist'];
const hashParts = (location.hash || '').replace('#', '').split('&');
const initialTab = hashParts.find(h => VALID_TABS.includes(h));
if (initialTab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  document.querySelector(`[data-tab="${initialTab}"]`).classList.add('active');
  document.getElementById('tab-' + initialTab).classList.add('active');
  // Deliberately nothing else here — no stopEnrichPolling(), no
  // maybeStartEnrichPolling(). Both reference state that doesn't exist yet
  // at this point in the script; the storage-load callback below is the
  // only safe place to kick off polling.
}
if (hashParts.includes('new=1')) {
  document.getElementById('new-profile-name').value = '';
  document.getElementById('new-profile-file').value = '';
  document.getElementById('modal-new-profile').style.display = 'flex';
}


fetch(chrome.runtime.getURL('manifest.json'))
  .then(r => r.json())
  .then(m => { document.getElementById('version-label').textContent = 'v' + m.version; });


// ── UUID helper ───────────────────────────────────────────────────────────────
function generateUUID() {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}


// ── State ─────────────────────────────────────────────────────────────────────
let globalRows = [];
let globalColNames = ['target', 'translations'];
let globalVocabName = 'lingoblend-vocab';
let globalProfiles = {};
let globalActiveId = '';

// Enrichment state — in-memory cache of the LIVE status while a job is
// actively being tracked (profile.pendingEnrichJobId is set). Terminal
// outcomes (anything but 'pending') also get mirrored onto the profile
// object itself (profile.lastEnrichStatus) so they survive a refresh even
// after pendingEnrichJobId is eventually cleared (e.g. once the result has
// been fetched — see pullEnrichedVocab). 'pending' updates stay memory-only:
// an active job is always re-verified fresh from the server on next view
// anyway, so there's nothing worth persisting for that state.
let lastEnrichStatusByProfile = {}; // { [profileId]: { kind, phase?, message?, detail?, createdAt? } }
let uploadingProfileIds = new Set();
let enrichPollTimer = null;


chrome.storage.local.get(['vocabText', 'vocabName', 'vocabColNames', 'disabledHosts',
                          'analyticsHistory', 'profiles', 'activeProfileId'])
  .then(data => {
    globalProfiles = data.profiles || {};
    globalActiveId = data.activeProfileId || '';


    const activeProfile = globalProfiles[globalActiveId];
    if (activeProfile) {
      document.getElementById('header-profile-name').textContent = activeProfile.name;
    }


    renderProfiles();
    renderAnalytics(data.analyticsHistory || []);


    globalVocabName = data.vocabName || 'lingoblend-vocab';
    globalColNames = data.vocabColNames || ['target', 'translations'];
    if (data.vocabText) {
      const delim = data.vocabText.includes('\t') ? '\t' : ';';
      const parsed = parseVocabFull(data.vocabText, delim);
      globalRows = parsed.rows;
      if (parsed.colNames && parsed.colNames.length) globalColNames = parsed.colNames;
    }
    renderVocab(globalRows, globalColNames);
    renderBlacklist(data.disabledHosts || []);
    maybeStartEnrichPolling();
  });


// ══ PROFILES TAB ══════════════════════════════════════════════════════════════
async function syncFlatFromProfile(profile) {
  await chrome.storage.local.set({
    vocabText:        profile.vocabText        || '',
    vocabName:        profile.vocabName        || '',
    vocabCount:       profile.vocabCount       || 0,
    vocabDelimiter:   profile.vocabDelimiter   || '\t',
    disabledHosts:    profile.disabledHosts    || [],
    analyticsHistory: profile.analyticsHistory || [],
    nativeLanguage:   profile.nativeLanguage   || 'pl'
  });
}


const LANG_LABELS = { pl: 'PL', en: 'EN', es: 'ES' };


function renderProfiles() {
  const container = document.getElementById('profile-cards');
  container.innerHTML = '';
  const count = Object.keys(globalProfiles).length;


  for (const id of Object.keys(globalProfiles)) {
    const p = globalProfiles[id];
    const isActive = id === globalActiveId;
    const card = document.createElement('div');
    card.className = 'profile-card' + (isActive ? ' active' : '');


    const nL = LANG_LABELS[p.nativeLanguage] || p.nativeLanguage.toUpperCase();
    const tL = LANG_LABELS[p.targetLanguage] || p.targetLanguage.toUpperCase();
    const wordCount = p.vocabCount || 0;
    const lastUsed = p.lastUsedAt
      ? new Date(p.lastUsedAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';


    card.innerHTML = `
      <div class="profile-card-info">
        <div class="profile-card-name-row">
          <span class="profile-card-name" id="pname-${id}">${p.name}</span>
          <input class="profile-card-name-input" id="pname-input-${id}" value="${p.name}" hidden>
          <span class="btn-edit-name" data-id="${id}" title="${t('tooltip_edit_name')}">✎</span>
        </div>
        <div class="profile-card-meta">
          <span class="profile-card-lang">${nL} → ${tL}</span>
          <span>${t('words_count', { count: wordCount })}</span>
          <span>${t('last_used', { date: lastUsed })}</span>
        </div>
      </div>
      <div class="profile-card-actions">
        <button class="btn-profile-action btn-set-active" data-id="${id}" ${isActive ? 'disabled' : ''}>${t('btn_set_active')}</button>
        <button class="btn-profile-action btn-delete-profile" data-id="${id}" ${count <= 1 ? 'disabled' : ''}>${t('btn_delete')}</button>
        <button class="btn-profile-action btn-export-profile" data-id="${id}">${t('btn_export_profile')}</button>
      </div>`;
    container.appendChild(card);
  }


  container.querySelectorAll('.btn-set-active').forEach(btn => {
    btn.addEventListener('click', () => setActiveProfile(btn.dataset.id));
  });
  container.querySelectorAll('.btn-delete-profile').forEach(btn => {
    btn.addEventListener('click', () => deleteProfile(btn.dataset.id));
  });
  container.querySelectorAll('.btn-export-profile').forEach(btn => {
    btn.addEventListener('click', () => exportProfile(btn.dataset.id));
  });


  container.querySelectorAll('.btn-edit-name').forEach(btn => {
    const id = btn.dataset.id;
    const span  = document.getElementById(`pname-${id}`);
    const input = document.getElementById(`pname-input-${id}`);
    let committing = false;


    btn.addEventListener('click', () => {
      span.hidden = true;
      input.hidden = false;
      input.focus();
      input.select();
    });


    async function commitRename() {
      if (committing) return;
      committing = true;
      const newName = input.value.trim();
      if (!newName) { cancelRename(); committing = false; return; }
      globalProfiles[id].name = newName;
      await chrome.storage.local.set({ profiles: globalProfiles });
      span.textContent = newName;
      span.hidden = false;
      input.hidden = true;
      if (id === globalActiveId) {
        document.getElementById('header-profile-name').textContent = newName;
      }
      committing = false;
    }


    function cancelRename() {
      input.value = span.textContent;
      span.hidden = false;
      input.hidden = true;
    }


    input.addEventListener('blur', commitRename);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    });
  });
}


async function setActiveProfile(id) {
  const profile = globalProfiles[id];
  if (!profile) return;
  profile.lastUsedAt = Date.now();
  globalProfiles[id] = profile;
  globalActiveId = id;


  await chrome.storage.local.set({ activeProfileId: id, profiles: globalProfiles });
  await syncFlatFromProfile(profile);


  document.getElementById('header-profile-name').textContent = profile.name;
  renderProfiles();


  const delim = (profile.vocabText || '').includes('\t') ? '\t' : ';';
  const parsed = profile.vocabText
    ? parseVocabFull(profile.vocabText, delim)
    : { rows: [], colNames: ['target', 'translations'] };
  globalRows = parsed.rows;
  globalColNames = parsed.colNames?.length ? parsed.colNames : ['target', 'translations'];
  globalVocabName = profile.vocabName || 'lingoblend-vocab';
  renderVocab(globalRows, globalColNames);
  renderAnalytics(profile.analyticsHistory || []);
  renderBlacklist(profile.disabledHosts || []);

  stopEnrichPolling();
  maybeStartEnrichPolling();
}


async function deleteProfile(id) {
  if (Object.keys(globalProfiles).length <= 1) return;
  delete globalProfiles[id];
  delete lastEnrichStatusByProfile[id];
  if (id === globalActiveId) {
    const firstId = Object.keys(globalProfiles)[0];
    globalActiveId = firstId;
    await chrome.storage.local.set({ activeProfileId: firstId, profiles: globalProfiles });
    await syncFlatFromProfile(globalProfiles[firstId]);
    document.getElementById('header-profile-name').textContent = globalProfiles[firstId].name;
  } else {
    await chrome.storage.local.set({ profiles: globalProfiles });
  }
  renderProfiles();
}


function exportProfile(id) {
  const profile = globalProfiles[id];
  if (!profile) return;
  // Deliberately strip credentials and job state — never let a shared/exported
  // profile leak the owner's API key, and a job id/result/status cached under
  // that key would be meaningless (orphaned) in another profile's hands anyway.
  const { apiKey, pendingEnrichJobId, pendingEnrichResult, lastEnrichStatus, ...exportable } = profile;
  const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lingoblend-profile-${profile.id.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}


// ── New profile modal ────────────────────────────────────────────────────────
document.getElementById('btn-new-profile').addEventListener('click', () => {
  document.getElementById('new-profile-name').value = '';
  document.getElementById('new-profile-file').value = '';
  document.getElementById('modal-new-profile').style.display = 'flex';
});


document.getElementById('btn-create-profile-confirm').addEventListener('click', async () => {
  const name = document.getElementById('new-profile-name').value.trim();
  const nativeLang = document.getElementById('new-profile-native').value;
  const targetLang = document.getElementById('new-profile-target').value;
  const fileInput = document.getElementById('new-profile-file');
  const file = fileInput.files[0];


  if (!name || !file) {
    alert(t('require_fields_alert'));
    return;
  }


  const text = await file.text();
  const lines = text.split(/\r?\n/);
  const firstLine = lines.find(l => l.trim());
  let delim = delimForFile(file.name);
  if (!delim && firstLine) delim = detectDelimiter(firstLine);
  if (!delim) { alert(t('delimiter_error')); return; }


  const { rows, colNames } = parseVocabFull(text, delim);
  if (!rows.length) { alert(t('no_valid_rows')); return; }


  const vocabText = vocabRowsToText(rows, colNames, delim);
  const id = generateUUID();
  const now = Date.now();


  globalProfiles[id] = {
    id, name,
    nativeLanguage: nativeLang, targetLanguage: targetLang,
    vocabText, vocabName: file.name.replace(/\.[^.]+$/, ''), vocabCount: rows.length,
    vocabDelimiter: delim, vocabColNames: colNames,
    analyticsHistory: [], disabledHosts: [],
    apiKey: null, pendingEnrichJobId: null, pendingEnrichResult: null, lastEnrichStatus: null,
    createdAt: now, lastUsedAt: now
  };
  globalActiveId = id;


  await chrome.storage.local.set({ profiles: globalProfiles, activeProfileId: id });
  await syncFlatFromProfile(globalProfiles[id]);
  document.getElementById('header-profile-name').textContent = name;


  const parsed = parseVocabFull(vocabText, delim);
  globalRows = parsed.rows;
  globalColNames = colNames;
  globalVocabName = globalProfiles[id].vocabName;
  renderVocab(globalRows, globalColNames);
  renderAnalytics([]);
  renderBlacklist([]);


  document.getElementById('modal-new-profile').style.display = 'none';
  renderProfiles();
});


document.getElementById('btn-create-profile-cancel').addEventListener('click', () => {
  document.getElementById('modal-new-profile').style.display = 'none';
});


// ── Import profile ────────────────────────────────────────────────────────────
document.getElementById('btn-import-profile').addEventListener('click', () => {
  document.getElementById('profile-file-input').click();
});


document.getElementById('profile-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const profile = JSON.parse(await file.text());
    if (!profile.id || !profile.name) throw new Error();
    globalProfiles[profile.id] = profile;
    await chrome.storage.local.set({ profiles: globalProfiles });
    renderProfiles();
  } catch (_) {
    alert(t('invalid_profile_file'));
  }
});


// ══ ANALYTICS TAB ════════════════════════════════════════════════════════════
function renderAnalytics(history) {
  const totalSessions = history.length;
  const sites = new Set(history.map(h => h.hostname)).size;
  const avgPct = history.length
    ? Math.round(history.reduce((s, h) => s + h.avgPct, 0) / history.length) : 0;
  const totalHighCov = history.reduce((s, h) => s + (h.highCoverageCount || 0), 0); //unused - total count of high-coverage sentences across all sessions
  const missingFreq = {};
  for (const entry of history)
    for (const w of (entry.topMissing || []))
      missingFreq[w] = (missingFreq[w] || 0) + 1;
  const sortedMissing = Object.entries(missingFreq).sort((a, b) => b[1] - a[1]).slice(0, 60);
  const maxFreq = sortedMissing[0]?.[1] || 1;


  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card">
      <span class="card-label">${t('sessions_label')}</span>
      <span class="card-val">${totalSessions}</span>
      <span class="card-sub">${t('sessions_sub')}</span>
    </div>
    <div class="summary-card">
      <span class="card-label">${t('sites_label')}</span>
      <span class="card-val">${sites}</span>
      <span class="card-sub">${t('sites_sub')}</span>
    </div>
    <div class="summary-card">
      <span class="card-label">${t('avg_coverage_card')}</span>
      <span class="card-val">${avgPct}%</span>
      <span class="card-sub">${t('avg_coverage_sub')}</span>
    </div>
    <div class="summary-card">
      <span class="card-label">${t('missing_links_card')}</span>
      <span class="card-val">${sortedMissing.length}</span>
      <span class="card-sub">${t('missing_links_sub')}</span>
    </div>`;


  const cloud = document.getElementById('missing-cloud');
  if (!sortedMissing.length) {
    cloud.innerHTML = `<span style="color:#bab9b4;font-size:13px">${t('no_data_yet')}</span>`;
  } else {
    cloud.innerHTML = sortedMissing.map(([w, f]) => {
      const cls = f >= maxFreq * 0.6 ? 'word-chip freq-high' : f >= maxFreq * 0.3 ? 'word-chip freq-med' : 'word-chip';
      return `<span class="${cls}">${w}</span>`;
    }).join('');
  }


  const list = document.getElementById('history-list');
  if (!history.length) {
    list.innerHTML = `<p class="empty-msg">${t('no_history')}</p>`;
    return;
  }
  list.innerHTML = history.map(h => {
    const dt = new Date(h.ts);
    const dateStr = dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const preview = (h.topMissing || []).slice(0, 6).join(', ');
    return `<div class="history-row">
      <span class="history-hostname">${h.hostname}</span>
      <span class="history-ts">${dateStr} ${timeStr}</span>
      <span class="history-pct">${t('history_pct_coverage', { pct: h.avgPct })}</span>
      <span class="history-missing">${t('history_high_cov', { count: h.highCoverageCount })}</span>
      ${preview ? `<span class="history-words">${t('history_missing_links', { list: preview })}</span>` : ''}
    </div>`;
  }).join('');
}


// ══ VOCABULARY TAB ════════════════════════════════════════════════════════════
function renderVocab(rows, colNames) {
  const badge = document.getElementById('vocab-count-badge');
  badge.textContent = t('words_count', { count: rows.length });


  const thead = document.getElementById('vocab-thead');
  const tbody = document.getElementById('vocab-tbody');


  thead.innerHTML = `<tr>${colNames.map(c => `<th>${c}</th>`).join('')}<th class="td-actions"></th></tr>`;


  const search = document.getElementById('vocab-search').value.toLowerCase();
  const filtered = search ? rows.filter(r =>
    colNames.some(c => (r[c] || '').toLowerCase().includes(search))
  ) : rows;


  tbody.innerHTML = '';
  filtered.forEach((row, idx) => {
    const realIdx = rows.indexOf(row);
    const tr = document.createElement('tr');
    tr.innerHTML = colNames.map((c, ci) =>
      `<td class="${ci === 0 ? 'td-target' : 'td-trans'}">${row[c] || ''}</td>`
    ).join('') +
    `<td class="td-actions">
      <button class="btn-edit-row" data-idx="${realIdx}">✎</button>
      <button class="btn-del-row" data-idx="${realIdx}">✕</button>
    </td>`;
    tbody.appendChild(tr);
  });


  tbody.querySelectorAll('.btn-edit-row').forEach(btn => {
    btn.addEventListener('click', () => editVocabRow(parseInt(btn.dataset.idx)));
  });
  tbody.querySelectorAll('.btn-del-row').forEach(btn => {
    btn.addEventListener('click', () => deleteVocabRow(parseInt(btn.dataset.idx)));
  });

  renderEnrichStatus();
}


document.getElementById('vocab-search').addEventListener('input', () => renderVocab(globalRows, globalColNames));


function editVocabRow(idx) {
  const row = globalRows[idx];
  if (!row) return;
  const tbody = document.getElementById('vocab-tbody');
  const tr = tbody.querySelector(`[data-idx="${idx}"]`)?.closest('tr');
  if (!tr) return;


  tr.innerHTML = globalColNames.map(c =>
    `<td><input class="edit-input" data-col="${c}" value="${(row[c] || '').replace(/"/g, '&quot;')}" style="width:100%"></td>`
  ).join('') +
  `<td class="td-actions">
    <button class="btn-save-row" data-idx="${idx}">${t('btn_save')}</button>
    <button class="btn-cancel-row" data-idx="${idx}">✕</button>
  </td>`;


  tr.querySelector('.btn-save-row').addEventListener('click', async () => {
    globalColNames.forEach(c => {
      row[c] = tr.querySelector(`[data-col="${c}"]`).value.trim();
    });
    globalRows[idx] = row;
    await saveVocabRows();
    renderVocab(globalRows, globalColNames);
  });
  tr.querySelector('.btn-cancel-row').addEventListener('click', () => renderVocab(globalRows, globalColNames));
}


async function deleteVocabRow(idx) {
  globalRows.splice(idx, 1);
  await saveVocabRows();
  renderVocab(globalRows, globalColNames);
}


async function saveVocabRows() {
  const text = vocabRowsToText(globalRows, globalColNames, ';');
  const data = await chrome.storage.local.get(['profiles', 'activeProfileId']);
  const profiles = data.profiles || {};
  const activeId = data.activeProfileId;
  if (activeId && profiles[activeId]) {
    profiles[activeId].vocabText = text;
    profiles[activeId].vocabCount = globalRows.length;
  }
  await chrome.storage.local.set({ vocabText: text, vocabCount: globalRows.length, profiles });
}


// ── Vocab export ──────────────────────────────────────────────────────────────
document.getElementById('btn-export-dash').addEventListener('click', () => {
  const text = vocabRowsToText(globalRows, globalColNames, ';');
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10) + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${globalVocabName}_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});


// ── Vocab import (shared diff modal state) ──────────────────────────────────
const modalDiff = document.getElementById('modal-diff');
const modalDiffBody = document.getElementById('modal-diff-body');
let diffResolve = null;


function showDiffModal(diff) {
  modalDiffBody.innerHTML = `
    <strong style="color:#437a22">${t('diff_added', { count: diff.newWords.length })}</strong>&nbsp;
    <strong style="color:#da7101">${t('diff_modified', { count: diff.updated.length })}</strong>&nbsp;
    <strong style="color:#7a7974">${t('diff_unchanged', { count: diff.unchanged.length })}</strong>&nbsp;
    <strong style="color:#a12c7b">${t('diff_removed', { count: diff.removed.length })}</strong>
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
  if (!delim) { alert(t('delimiter_error')); return; }


  const { rows: incoming, colNames } = parseVocabFull(text, delim);
  if (!incoming.length) { alert(t('no_valid_rows')); return; }


  const existingText = globalProfiles[globalActiveId]?.vocabText || '';
  const existingDelim = existingText.includes('\t') ? '\t' : ';';
  const { rows: existing } = existingText ? parseVocabFull(existingText, existingDelim) : { rows: [] };


  const diff = buildDiff(incoming, existing);
  const mode = await showDiffModal(diff);
  if (!mode) return;


  const merged = applyMerge(mode, incoming, existing);
  const newText = vocabRowsToText(merged, colNames, delim);
  const name = fileName.replace(/\.[^.]+$/, '');
  const count = merged.length;


  if (globalActiveId && globalProfiles[globalActiveId]) {
    globalProfiles[globalActiveId].vocabText = newText;
    globalProfiles[globalActiveId].vocabName = name;
    globalProfiles[globalActiveId].vocabCount = count;
    globalProfiles[globalActiveId].vocabDelimiter = delim;
    globalProfiles[globalActiveId].vocabColNames = colNames;
  }


  globalRows = merged;
  globalColNames = colNames;
  globalVocabName = name;


  await chrome.storage.local.set({
    vocabText: newText, vocabName: name, vocabCount: count,
    vocabColNames: colNames, vocabDelimiter: delim,
    profiles: globalProfiles
  });
  renderVocab(globalRows, globalColNames);
}


document.getElementById('btn-import-dash').addEventListener('click', () => document.getElementById('dash-file-input').click());
document.getElementById('dash-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  await handleImport(await file.text(), file.name);
});


// ══ VOCAB ENRICHMENT ═════════════════════════════════════════════════════════
// Job/result/apiKey/lastEnrichStatus (terminal only) are persisted per-profile.
// lastEnrichStatusByProfile (live cache, incl. 'pending' updates) and
// uploadingProfileIds are transient, in-memory only.
//
// enrichment-api.js already resolves every call to a { kind, ...extra } object
// — this file never inspects an HTTP status code. mapApiKindToRenderStatus()
// is the ONE place that turns an API result's `kind` into a render `kind`.

function getLanguagePair(profile) {
  // ASSUMPTION: server's "language_pair" is "{targetLanguage}_{nativeLanguage}",
  // inferred from the handoff's own "en_pl" example matching this profile's
  // default native=pl/target=en setup. If the server rejects this with a 400,
  // the returned detail text lists the actually-supported pairs — verify against that.
  return `${profile.targetLanguage}_${profile.nativeLanguage}`;
}


async function persistProfile(id) {
  await chrome.storage.local.set({ profiles: globalProfiles });
}


function isVocabTabActive() {
  return document.getElementById('tab-vocab').classList.contains('active');
}


// Maps an enrichment-api.js result's `kind` into the render-facing status
// kind + display fields. Only handles the SHARED, no-side-effect outcomes —
// callers special-case 'ok'/'pending'/'done' and any kind needing a side
// effect (promptApiKey, resuming polling) themselves.
function mapApiKindToRenderStatus(apiResult) {
  switch (apiResult.kind) {
    case 'unauthorized':
      return { kind: 'unauthorized' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'network_error':
      return { kind: 'network_error' };
    case 'unsupported_pair':
      return { kind: 'unsupported_pair', detail: apiResult.detail || '' };
    case 'job_error':
      return { kind: 'job_error', message: apiResult.message || '' };
    case 'still_pending':
      return { kind: 'pending', phase: '' };
    case 'invalid_request':
    case 'server_error':
    case 'unknown_error':
    default:
      return { kind: 'request_error', detail: apiResult.detail || '' };
  }
}


// Updates the live in-memory status, and — for any TERMINAL kind (everything
// except 'pending') — mirrors it onto the profile object too, so it survives
// a refresh independent of whether pendingEnrichJobId is still set.
// createdAt is inherited from the previous entry unless explicitly overridden,
// so callers don't need to thread it through every single call site.
function setEnrichStatus(profileId, kind, extra = {}) {
  const prev = lastEnrichStatusByProfile[profileId];
  const createdAt = extra.createdAt ?? prev?.createdAt ?? null;
  const entry = { kind, ...extra, createdAt };
  lastEnrichStatusByProfile[profileId] = entry;

  if (kind !== 'pending') {
    const profile = globalProfiles[profileId];
    if (profile) {
      profile.lastEnrichStatus = entry;
      persistProfile(profileId);
    }
  }

  if (profileId === globalActiveId) renderEnrichStatus();
}


function stopEnrichPolling() {
  clearTimeout(enrichPollTimer);
  enrichPollTimer = null;
}


function maybeStartEnrichPolling() {
  stopEnrichPolling();
  renderEnrichStatus();
  const profile = globalProfiles[globalActiveId];
  if (!profile || !profile.pendingEnrichJobId) return;
  if (!isVocabTabActive()) return;
  const st = lastEnrichStatusByProfile[profile.id];
  if (st && st.kind !== 'pending') return; // already resolved — no need to keep polling
  pollEnrichStatus(profile.id, profile.pendingEnrichJobId);
}


async function autoFetchEnrichResult(profileId, jobId, createdAt) {
  const profile = globalProfiles[profileId];
  if (!profile || profile.pendingEnrichJobId !== jobId) return; // superseded/cleared already

  const res = await getJobResult(ENRICHMENT_API_BASE_URL, profile.apiKey, jobId);

  const stillCurrent = globalProfiles[profileId] === profile && profile.pendingEnrichJobId === jobId;
  if (!stillCurrent) return;

  if (res.kind === 'ok') {
    profile.pendingEnrichResult = res.csvText;
    profile.pendingEnrichJobId = null; // cached — cut further server contact for this job
    await persistProfile(profileId);
    setEnrichStatus(profileId, 'done', { createdAt });
    return;
  }

  // Auto-fetch failed — report the real failure instead of a misleading
  // "done." The job stays tracked (pendingEnrichJobId untouched), since this
  // could be transient (e.g. a key that just got revoked) rather than the
  // job itself being dead.
  const { kind, ...extra } = mapApiKindToRenderStatus(res);
  setEnrichStatus(profileId, kind, { ...extra, createdAt });
}


function pollEnrichStatus(profileId, jobId) {
  const profile = globalProfiles[profileId];
  if (!profile || profile.pendingEnrichJobId !== jobId) return; // superseded/cleared while awaiting

  getJobStatus(ENRICHMENT_API_BASE_URL, profile.apiKey, jobId).then(res => {
    const stillCurrent = globalProfiles[profileId] === profile && profile.pendingEnrichJobId === jobId;
    if (!stillCurrent) return;

    const prevCreatedAt = lastEnrichStatusByProfile[profileId]?.createdAt;
    const createdAt = prevCreatedAt ?? jobCreatedAt(jobId)?.getTime() ?? null;

    if (res.kind === 'pending') {
      setEnrichStatus(profileId, 'pending', { phase: res.phase || '', createdAt });
      if (isVocabTabActive() && profileId === globalActiveId) {
        enrichPollTimer = setTimeout(() => pollEnrichStatus(profileId, jobId), ENRICH_POLL_INTERVAL_MS);
      }
      return;
    }

    if (res.kind === 'done') {
      autoFetchEnrichResult(profileId, jobId, createdAt);
      return;
    }

    // Every other kind is terminal for this polling loop — no further
    // scheduling; the user must act (update key) or retry (fresh Enrich click).
    const { kind, ...extra } = mapApiKindToRenderStatus(res);
    setEnrichStatus(profileId, kind, { ...extra, createdAt });
  });
}


function renderEnrichStatus() {
  const bar = document.getElementById('enrich-status');
  const btn = document.getElementById('btn-enrich-vocab');
  const profile = globalProfiles[globalActiveId];

  if (!profile) { bar.hidden = true; bar.innerHTML = ''; if (btn) btn.disabled = false; return; }

  if (uploadingProfileIds.has(profile.id)) {
    bar.hidden = false;
    bar.className = 'enrich-status enrich-status--pending';
    bar.innerHTML = `<span class="enrich-spinner"></span> ${t('enrich_status_uploading')}`;
    btn.disabled = true;
    return;
  }

  const jobId = profile.pendingEnrichJobId;

  // While a job is actively tracked, the live in-memory status (refreshed by
  // polling) is the source of truth — defaults to 'pending' with a date
  // parsed straight from the jobId the moment a job exists but no poll
  // response has landed yet (e.g. immediately after upload, or right after
  // a refresh, before the first status check completes).
  // Once no job is being tracked (never enriched, or already pulled), fall
  // back to the persisted last-known outcome on the profile itself — this is
  // what makes "done, ready to pull" (and a plain failed-attempt message)
  // survive a refresh with zero server contact.
  const st = jobId
    ? (lastEnrichStatusByProfile[profile.id] || { kind: 'pending', createdAt: jobCreatedAt(jobId)?.getTime() ?? null })
    : profile.lastEnrichStatus;

  if (!st) {
    bar.hidden = true;
    bar.innerHTML = '';
    btn.disabled = false;
    return;
  }

  const dateStr = st.createdAt
    ? new Date(st.createdAt).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  bar.hidden = false;
  btn.disabled = (st.kind === 'pending');

  if (st.kind === 'pending') {
    const phaseSuffix = st.phase ? ` — ${st.phase}` : '';
    bar.className = 'enrich-status enrich-status--pending';
    bar.innerHTML = `<span class="enrich-spinner"></span> ${t('enrich_status_pending', { date: dateStr, phase: phaseSuffix })}`;
  } else if (st.kind === 'done') {
    bar.className = 'enrich-status enrich-status--done';
    bar.innerHTML = `${t('enrich_status_done', { date: dateStr })} <button class="btn-enrich-action" id="btn-enrich-pull">${t('btn_pull_enriched')}</button>`;
    document.getElementById('btn-enrich-pull')?.addEventListener('click', pullEnrichedVocab);
  } else if (st.kind === 'unauthorized') {
    bar.className = 'enrich-status enrich-status--error';
    bar.innerHTML = `${t('enrich_status_unauthorized')} <button class="btn-enrich-action" id="btn-update-api-key">${t('btn_update_api_key')}</button>`;
    document.getElementById('btn-update-api-key')?.addEventListener('click', () => promptApiKey(profile.id, true));
  } else if (st.kind === 'not_found') {
    bar.className = 'enrich-status enrich-status--error';
    bar.innerHTML = t('enrich_status_not_found');
  } else if (st.kind === 'unsupported_pair') {
    bar.className = 'enrich-status enrich-status--error';
    bar.innerHTML = t('enrich_status_unsupported_pair', { detail: st.detail || '' });
  } else if (st.kind === 'job_error') {
    bar.className = 'enrich-status enrich-status--error';
    bar.innerHTML = t('enrich_status_job_error', { message: st.message || '' });
  } else if (st.kind === 'request_error') {
    bar.className = 'enrich-status enrich-status--error';
    bar.innerHTML = t('enrich_status_request_error', { detail: st.detail || '' });
  } else if (st.kind === 'network_error') {
    bar.className = 'enrich-status enrich-status--error';
    bar.innerHTML = t('enrich_status_network_error');
  }
}


async function startEnrichJob(profile) {
  if (!globalRows.length) { alert(t('no_valid_rows')); return; }

  // A fresh click always supersedes whatever came before — clear old job
  // tracking up front, so a failed retry never leaves stale info lingering
  // (regardless of whether THIS attempt succeeds or fails).
  profile.pendingEnrichJobId = null;
  profile.pendingEnrichResult = null;
  profile.lastEnrichStatus = null;
  delete lastEnrichStatusByProfile[profile.id];
  await persistProfile(profile.id);

  uploadingProfileIds.add(profile.id);
  renderEnrichStatus();

  const csvText = vocabRowsToText(globalRows, globalColNames, ';');
  const languagePair = getLanguagePair(profile);

  const res = await uploadVocab(ENRICHMENT_API_BASE_URL, profile.apiKey, csvText, profile.id, profile.name, languagePair);
  uploadingProfileIds.delete(profile.id);

  if (res.kind === 'ok') {
    profile.pendingEnrichJobId = res.jobId;
    profile.pendingEnrichResult = null;
    await persistProfile(profile.id);
    const createdAt = jobCreatedAt(res.jobId)?.getTime() ?? Date.now();
    setEnrichStatus(profile.id, 'pending', { phase: '', createdAt });
    maybeStartEnrichPolling();
    return;
  }

  const { kind, ...extra } = mapApiKindToRenderStatus(res);
  setEnrichStatus(profile.id, kind, extra);
  if (kind === 'unauthorized') promptApiKey(profile.id, true);
}


// ── Enrichment confirmation modal ─────────────────────────────────────────────
const modalEnrichConfirm = document.getElementById('modal-enrich-confirm');
let enrichConfirmResolve = null;

function showEnrichConfirmModal() {
  modalEnrichConfirm.style.display = 'flex';
  return new Promise(res => { enrichConfirmResolve = res; });
}

document.getElementById('enrich-confirm-ok').addEventListener('click', () => {
  modalEnrichConfirm.style.display = 'none';
  enrichConfirmResolve?.(true);
  enrichConfirmResolve = null;
});
document.getElementById('enrich-confirm-cancel').addEventListener('click', () => {
  modalEnrichConfirm.style.display = 'none';
  enrichConfirmResolve?.(false);
  enrichConfirmResolve = null;
});


document.getElementById('btn-enrich-vocab').addEventListener('click', async () => {
  const profile = globalProfiles[globalActiveId];
  if (!profile) return;
  if (!globalRows.length) { alert(t('no_valid_rows')); return; }

  const confirmed = await showEnrichConfirmModal();
  if (!confirmed) return;

  if (!profile.apiKey) {
    promptApiKey(profile.id, false);
    return;
  }
  startEnrichJob(profile);
});


// ── API key modal ─────────────────────────────────────────────────────────────
function promptApiKey(profileId, isUpdate) {
  const modal = document.getElementById('modal-api-key');
  const input = document.getElementById('api-key-input');
  input.value = '';
  modal.dataset.profileId = profileId;
  modal.dataset.isUpdate = isUpdate ? '1' : '0';
  modal.style.display = 'flex';
  input.focus();
}


document.getElementById('btn-api-key-confirm').addEventListener('click', async () => {
  const modal = document.getElementById('modal-api-key');
  const input = document.getElementById('api-key-input');
  const key = input.value.trim();
  if (!key) { alert(t('api_key_required')); return; }

  const profileId = modal.dataset.profileId;
  const isUpdate = modal.dataset.isUpdate === '1';
  const profile = globalProfiles[profileId];
  if (!profile) { modal.style.display = 'none'; return; }

  profile.apiKey = key;
  await persistProfile(profileId);
  modal.style.display = 'none';

  if (isUpdate) {
    // The old job/result/status were created under the previous key —
    // they're orphaned now (the server ties job ownership to the creating key).
    profile.pendingEnrichJobId = null;
    profile.pendingEnrichResult = null;
    profile.lastEnrichStatus = null;
    delete lastEnrichStatusByProfile[profileId];
    await persistProfile(profileId);
    if (profileId === globalActiveId) { stopEnrichPolling(); renderEnrichStatus(); }
  } else if (profileId === globalActiveId) {
    await startEnrichJob(profile);
  }
});


document.getElementById('btn-api-key-cancel').addEventListener('click', () => {
  document.getElementById('modal-api-key').style.display = 'none';
});


// ── Enrichment diff modal ─────────────────────────────────────────────────────
const modalEnrichDiff = document.getElementById('modal-enrich-diff');
const modalEnrichDiffBody = document.getElementById('modal-enrich-diff-body');
let enrichDiffResolve = null;


function tokenCount(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean).length;
}


function effectiveBank(row) {
  return (row.forms && row.forms.trim()) ? row.forms : (row.translations || '');
}


function totalBankTokens(rows) {
  return rows.reduce((sum, r) => sum + tokenCount(effectiveBank(r)), 0);
}


function computeEnrichStats(existing, incoming, diff) {
  const oldTotal = totalBankTokens(existing);
  const newTotal = totalBankTokens(incoming);
  const oldAvg = existing.length ? oldTotal / existing.length : 0;
  const newAvg = incoming.length ? newTotal / incoming.length : 0;
  const expansionRate = oldTotal > 0 ? (newTotal / oldTotal) : null;
  return {
    expansionRate, oldAvg, newAvg,
    translationsAdded: newTotal - oldTotal,
    rowsNew: diff.newWords.length,
    rowsModified: diff.updated.length,
    rowsRemoved: diff.removed.length
  };
}


function showEnrichDiffModal(stats) {
  const rateStr = stats.expansionRate !== null ? `${stats.expansionRate.toFixed(1)}×` : '—';
  modalEnrichDiffBody.innerHTML = `
    <div class="enrich-stat-row">${t('enrich_expansion_rate', { rate: rateStr })}</div>
    <div class="enrich-stat-row">${t('enrich_avg_translations', { old: stats.oldAvg.toFixed(1), new: stats.newAvg.toFixed(1) })}</div>
    <div class="enrich-stat-row">${t('enrich_translations_added', { count: stats.translationsAdded })}</div>
    <div class="enrich-stat-row">${t('enrich_rows_new', { count: stats.rowsNew })}</div>
    <div class="enrich-stat-row">${t('enrich_rows_modified', { count: stats.rowsModified })}</div>
    <div class="enrich-stat-row">${t('enrich_rows_removed', { count: stats.rowsRemoved })}</div>
  `;
  modalEnrichDiff.style.display = 'flex';
  return new Promise(res => { enrichDiffResolve = res; });
}


document.getElementById('enrich-diff-overwrite').addEventListener('click', () => {
  modalEnrichDiff.style.display = 'none';
  enrichDiffResolve?.(true);
  enrichDiffResolve = null;
});
document.getElementById('enrich-diff-cancel').addEventListener('click', () => {
  modalEnrichDiff.style.display = 'none';
  enrichDiffResolve?.(false);
  enrichDiffResolve = null;
});


async function saveVocabRowsForProfile(profile, rows, colNames, delim) {
  const text = vocabRowsToText(rows, colNames, delim);
  profile.vocabText = text;
  profile.vocabCount = rows.length;
  profile.vocabColNames = colNames;
  profile.vocabDelimiter = delim;
  await chrome.storage.local.set({
    vocabText: text, vocabCount: rows.length, vocabColNames: colNames, vocabDelimiter: delim,
    profiles: globalProfiles
  });
}


async function pullEnrichedVocab() {
  const profile = globalProfiles[globalActiveId];
  if (!profile) return;
  if (!profile.pendingEnrichJobId && !profile.pendingEnrichResult) return;

  let csvText = profile.pendingEnrichResult;
  if (!csvText) {
    const res = await getJobResult(ENRICHMENT_API_BASE_URL, profile.apiKey, profile.pendingEnrichJobId);

    if (res.kind !== 'ok') {
      const { kind, ...extra } = mapApiKindToRenderStatus(res);
      setEnrichStatus(profile.id, kind, extra);
      if (kind === 'unauthorized') promptApiKey(profile.id, true);
      if (kind === 'pending') maybeStartEnrichPolling(); // covers the defensive still_pending case
      return;
    }

    csvText = res.csvText;
    profile.pendingEnrichResult = csvText;
    // Result is safely cached — cut all further server contact for this job.
    // The persisted 'done' status (already set by the earlier poll that first
    // reported it) keeps driving the display via profile.lastEnrichStatus,
    // completely independent of pendingEnrichJobId from this point on.
    profile.pendingEnrichJobId = null;
    stopEnrichPolling();
    await persistProfile(profile.id);
  }

  const delim = ';'; // server always returns semicolon-separated per the API contract
  const { rows: incoming, colNames: incomingCols } = parseVocabFull(csvText, delim);
  if (!incoming.length) { alert(t('no_valid_rows')); return; }

  // Comparison basis is deliberately the CURRENT in-memory vocab, not the
  // pre-upload snapshot — the user may have kept editing after clicking
  // "Enrich vocab", and this diff answers "what changes if I merge now."
  const existing = globalRows;
  const diff = buildDiff(incoming, existing);
  const stats = computeEnrichStats(existing, incoming, diff);

  const proceed = await showEnrichDiffModal(stats);
  if (!proceed) return; // cancel — cached result + persisted 'done' status remain available to revisit

  globalRows = incoming;
  globalColNames = incomingCols;
  await saveVocabRowsForProfile(profile, incoming, incomingCols, delim);
  renderVocab(globalRows, globalColNames);

  profile.pendingEnrichResult = null;
  profile.lastEnrichStatus = null;
  delete lastEnrichStatusByProfile[profile.id];
  await persistProfile(profile.id);
  renderEnrichStatus();
}


// ══ MUTED SITES TAB ═══════════════════════════════════════════════════════════
function renderBlacklist(hosts) {
  const ul = document.getElementById('blacklist-ul');
  if (!hosts.length) {
    ul.innerHTML = `<p class="empty-msg">${t('no_muted_sites')}</p>`;
    return;
  }
  ul.innerHTML = hosts.map(h =>
    `<li class="blacklist-item">
      <span class="blacklist-hostname">${h}</span>
      <button class="btn-whitelist" data-host="${h}">${t('btn_reenable')}</button>
    </li>`
  ).join('');
  ul.querySelectorAll('.btn-whitelist').forEach(btn => {
    btn.addEventListener('click', async () => {
      const data = await chrome.storage.local.get(['disabledHosts', 'profiles', 'activeProfileId']);
      let hosts = (data.disabledHosts || []).filter(h => h !== btn.dataset.host);
      const profiles = data.profiles || {};
      const activeId = data.activeProfileId;
      if (activeId && profiles[activeId]) profiles[activeId].disabledHosts = hosts;
      await chrome.storage.local.set({ disabledHosts: hosts, profiles });
      renderBlacklist(hosts);
    });
  });
}

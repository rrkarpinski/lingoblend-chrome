import { initI18n, setLang, getLang, t, applyStaticI18n } from '../i18n.js';
import { delimForFile, detectDelimiter, parseVocabFull, buildDiff, applyMerge, vocabRowsToText } from '../vocab-import.js';
import { initEnrichmentController, getEnrichStatus, isUploading, maybeStartEnrichPolling,
         stopEnrichPolling, startEnrichJob, fetchEnrichedResult, clearEnrichmentState,
         resetJobForKeyChange, forgetProfile } from '../enrichment-controller.js';


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
    if (btn.dataset.tab === 'vocab') renderEnrichStatus();
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


initEnrichmentController({
  getProfiles: () => globalProfiles,
  getActiveId: () => globalActiveId,
  onChange: (profileId) => { if (profileId === globalActiveId) renderEnrichStatus(); }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.profiles) return;
  globalProfiles = changes.profiles.newValue || {};
  renderProfiles();
  renderEnrichStatus();
});


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
  forgetProfile(id);
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
// Enrichment job tracking, polling, and persistence all live in enrichment-controller.js — this section only renders status and wires user actions to it.

function renderEnrichStatus() {
  const bar = document.getElementById('enrich-status');
  const btn = document.getElementById('btn-enrich-vocab');
  const profile = globalProfiles[globalActiveId];
  if (!profile) { bar.hidden = true; bar.innerHTML = ''; if (btn) btn.disabled = false; return; }

  if (isUploading(profile.id)) {
    bar.hidden = false;
    bar.className = 'enrich-status enrich-status--pending';
    bar.innerHTML = `<span class="enrich-spinner"></span> ${t('enrich_status_uploading')}`;
    btn.disabled = true;
    return;
  }

  const st = getEnrichStatus(profile.id);
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
    const doneText = st.partial
      ? t('enrich_status_done_partial', { date: dateStr, skipped: st.skippedCount })
      : t('enrich_status_done', { date: dateStr });
    bar.innerHTML = `${doneText}<button class="btn-enrich-action" id="btn-enrich-pull">${t('btn_pull_enriched')}</button>`;
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
  const csvText = vocabRowsToText(globalRows, globalColNames, ';');
  const res = await startEnrichJob(profile.id, csvText);
  if (res.kind === 'unauthorized') promptApiKey(profile.id, true);
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
  await chrome.storage.local.set({ profiles: globalProfiles });
  modal.style.display = 'none';

  if (isUpdate) {
    await resetJobForKeyChange(profileId);
    if (profileId === globalActiveId) renderEnrichStatus();
  } else if (profileId === globalActiveId) {
    const csvText = vocabRowsToText(globalRows, globalColNames, ';');
    await startEnrichJob(profileId, csvText);
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
  const rowsSkipped = incoming.filter(r => !r.forms || !r.forms.trim()).length;
  return {
    expansionRate, oldAvg, newAvg,
    translationsAdded: newTotal - oldTotal,
    rowsNew: diff.newWords.length,
    rowsModified: diff.updated.length,
    rowsRemoved: diff.removed.length,
    rowsProcessed: incoming.length - rowsSkipped,
    rowsSkipped,
    rowsTotal: incoming.length
  };
}


function showEnrichDiffModal(stats) {
  const rateStr = stats.expansionRate !== null ? `${stats.expansionRate.toFixed(1)}×` : '—';
  modalEnrichDiffBody.innerHTML = `
    ${stats.rowsSkipped > 0
      ? `<div class="enrich-stat-row enrich-stat-row--warn">${t('enrich_processed_of_total', { processed: stats.rowsProcessed, total: stats.rowsTotal })}</div>`
      : ''}
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

  const res = await fetchEnrichedResult(profile.id);
  if (res.kind !== 'ok') {
    if (res.kind === 'unauthorized') promptApiKey(profile.id, true);
    return;
  }

  const delim = ';'; // server always returns semicolon-separated per the API contract
  const { rows: incoming, colNames: incomingCols } = parseVocabFull(res.csvText, delim);
  if (!incoming.length) { alert(t('no_valid_rows')); return; }

  const existing = globalRows;
  const diff = buildDiff(incoming, existing);
  const stats = computeEnrichStats(existing, incoming, diff);
  const proceed = await showEnrichDiffModal(stats);
  if (!proceed) return; // cancel — cached result/persisted 'done' status remain available to revisit

  globalRows = incoming;
  globalColNames = incomingCols;
  await saveVocabRowsForProfile(profile, incoming, incomingCols, delim);
  renderVocab(globalRows, globalColNames);
  await clearEnrichmentState(profile.id);
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

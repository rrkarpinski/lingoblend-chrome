import { delimForFile, detectDelimiter, parseVocabFull, detectFunctionWords, buildDiff, applyMerge, vocabRowsToText } from '../vocab-import.js';

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

if (location.hash === '#profiles') {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  document.querySelector('[data-tab="profiles"]').classList.add('active');
  document.getElementById('tab-profiles').classList.add('active');
}

fetch(chrome.runtime.getURL('manifest.json'))
  .then(r => r.json())
  .then(m => { document.getElementById('version-label').textContent = 'v' + m.version; });

// ── UUID helper ───────────────────────────────────────────────────────────────
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let globalRows = [];
let globalColNames = ['target', 'translations'];
let globalVocabName = 'lingoblend-vocab';
let globalProfiles = {};
let globalActiveId = '';

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
          <span class="btn-edit-name" data-id="${id}" title="Edit name">✎</span>
        </div>
        <div class="profile-card-meta">
          <span class="profile-card-lang">${nL} → ${tL}</span>
          <span>${wordCount} words</span>
          <span>Last used: ${lastUsed}</span>
        </div>
      </div>
      <div class="profile-card-actions">
        <button class="btn-profile-action btn-set-active" data-id="${id}" ${isActive ? 'disabled' : ''}>Set active</button>
        <button class="btn-profile-action btn-delete-profile" data-id="${id}" ${count <= 1 ? 'disabled' : ''}>Delete</button>
        <button class="btn-profile-action btn-export-profile" data-id="${id}">Export</button>
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
}

async function deleteProfile(id) {
  if (Object.keys(globalProfiles).length <= 1) return;
  delete globalProfiles[id];
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
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lingoblend-profile-${profile.name.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── New profile modal ─────────────────────────────────────────────────────────
document.getElementById('btn-new-profile').addEventListener('click', () => {
  document.getElementById('new-profile-name').value = '';
  document.getElementById('modal-new-profile').style.display = 'flex';
});

document.getElementById('btn-create-profile-confirm').addEventListener('click', async () => {
  const name = document.getElementById('new-profile-name').value.trim();
  if (!name) return;
  const nativeLang = document.getElementById('new-profile-native').value;
  const targetLang = document.getElementById('new-profile-target').value;
  const id = generateUUID();
  const now = Date.now();
  globalProfiles[id] = {
    id, name,
    nativeLanguage: nativeLang,
    targetLanguage: targetLang,
    vocabText: '', vocabName: '', vocabCount: 0, vocabDelimiter: '\t',
    analyticsHistory: [], disabledHosts: [],
    createdAt: now, lastUsedAt: now
  };
  await chrome.storage.local.set({ profiles: globalProfiles });
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
    alert('Invalid profile file.');
  }
});

// ══ ANALYTICS TAB ════════════════════════════════════════════════════════════
function renderAnalytics(history) {
  const totalSessions = history.length;
  const sites = new Set(history.map(h => h.hostname)).size;
  const avgPct = history.length
    ? Math.round(history.reduce((s, h) => s + h.avgPct, 0) / history.length) : 0;
  const totalHighCov = history.reduce((s, h) => s + (h.highCoverageCount || 0), 0);
  const missingFreq = {};
  for (const entry of history)
    for (const w of (entry.topMissing || []))
      missingFreq[w] = (missingFreq[w] || 0) + 1;
  const sortedMissing = Object.entries(missingFreq).sort((a, b) => b[1] - a[1]).slice(0, 60);
  const maxFreq = sortedMissing[0]?.[1] || 1;

  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card">
      <span class="card-label">Sessions</span>
      <span class="card-val">${totalSessions}</span>
      <span class="card-sub">pages analysed</span>
    </div>
    <div class="summary-card">
      <span class="card-label">Sites</span>
      <span class="card-val">${sites}</span>
      <span class="card-sub">unique hostnames</span>
    </div>
    <div class="summary-card">
      <span class="card-label">Avg sentence coverage</span>
      <span class="card-val">${avgPct}%</span>
      <span class="card-sub">words known per sentence</span>
    </div>
    <div class="summary-card">
      <span class="card-label">Missing links found</span>
      <span class="card-val">${sortedMissing.length}</span>
      <span class="card-sub">unique missing words</span>
    </div>`;

  const cloud = document.getElementById('missing-cloud');
  if (!sortedMissing.length) {
    cloud.innerHTML = '<span style="color:#bab9b4;font-size:13px">No data yet.</span>';
  } else {
    cloud.innerHTML = sortedMissing.map(([w, f]) => {
      const cls = f >= maxFreq * 0.6 ? 'word-chip freq-high' : f >= maxFreq * 0.3 ? 'word-chip freq-med' : 'word-chip';
      return `<span class="${cls}">${w}</span>`;
    }).join('');
  }

  const list = document.getElementById('history-list');
  if (!history.length) {
    list.innerHTML = '<p class="empty-msg">No history yet.</p>';
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
      <span class="history-pct">${h.avgPct}% coverage</span>
      <span class="history-missing">${h.highCoverageCount} high-cov</span>
      ${preview ? `<span class="history-words">Missing links: ${preview}</span>` : ''}
    </div>`;
  }).join('');
}

// ══ VOCABULARY TAB ════════════════════════════════════════════════════════════
function renderVocab(rows, colNames) {
  const badge = document.getElementById('vocab-count-badge');
  badge.textContent = rows.length + ' words';

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
    <button class="btn-save-row" data-idx="${idx}">Save</button>
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

// ── Vocab import ──────────────────────────────────────────────────────────────
const modalDiff    = document.getElementById('modal-diff');
const modalDiffBody = document.getElementById('modal-diff-body');
let _diffResolve = null;

function showDiffModal(diff, fwStats) {
  let fwLine = '';
  if (fwStats) {
    const totalDropped = (fwStats.droppedCol1 || 0) + (fwStats.droppedCol2Empty || 0);
    const removedT = fwStats.removedTranslations || 0;
    const rowsT = fwStats.rowsWithRemovedTranslations || 0;
    if (totalDropped > 0 || removedT > 0) {
      const parts = [];
      if (fwStats.droppedCol1 > 0)
        parts.push(`${fwStats.droppedCol1} row${fwStats.droppedCol1 !== 1 ? 's' : ''} dropped (col1 function word)`);
      if (fwStats.droppedCol2Empty > 0)
        parts.push(`${fwStats.droppedCol2Empty} row${fwStats.droppedCol2Empty !== 1 ? 's' : ''} dropped (all translations filtered)`);
      if (removedT > 0)
        parts.push(`${removedT} translation${removedT !== 1 ? 's' : ''} removed from ${rowsT} row${rowsT !== 1 ? 's' : ''}`);
      fwLine = `<br><span style="color:#7a7974;font-size:0.92em">⊘ Function words: ${parts.join(' · ')}</span>`;
    }
  }
  modalDiffBody.innerHTML =
    `<strong style="color:#437a22">+${diff.newWords.length} added</strong> &nbsp;` +
    `<strong style="color:#da7101">~${diff.updated.length} modified</strong> &nbsp;` +
    `<strong style="color:#7a7974">=${diff.unchanged.length} unchanged</strong> &nbsp;` +
    `<strong style="color:#a12c7b">-${diff.removed.length} removed</strong>` +
    fwLine;
  modalDiff.style.display = 'flex';
  return new Promise(res => { _diffResolve = res; });
}

document.getElementById('diff-add-new').addEventListener('click', () => {
  modalDiff.style.display = 'none'; _diffResolve?.('addnew'); _diffResolve = null;
});
document.getElementById('diff-add-update').addEventListener('click', () => {
  modalDiff.style.display = 'none'; _diffResolve?.('addupdate'); _diffResolve = null;
});
document.getElementById('diff-replace').addEventListener('click', () => {
  modalDiff.style.display = 'none'; _diffResolve?.('replace'); _diffResolve = null;
});
document.getElementById('diff-cancel').addEventListener('click', () => {
  modalDiff.style.display = 'none'; _diffResolve?.(null); _diffResolve = null;
});

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

  globalRows = merged;
  globalColNames = colNames;
  globalVocabName = name;

  await chrome.storage.local.set({ vocabText: newText, vocabName: name, vocabCount: count, vocabColNames: colNames, vocabDelimiter: delim, profiles });
  renderVocab(globalRows, globalColNames);
}

document.getElementById('btn-import-dash').addEventListener('click', () => {
  document.getElementById('dash-file-input').click();
});

document.getElementById('dash-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  await handleImport(await file.text(), file.name);
});

// ══ MUTED SITES TAB ═══════════════════════════════════════════════════════════
function renderBlacklist(hosts) {
  const ul = document.getElementById('blacklist-ul');
  if (!hosts.length) {
    ul.innerHTML = '<p class="empty-msg">No muted sites.</p>';
    return;
  }
  ul.innerHTML = hosts.map(h =>
    `<li class="blacklist-item">
      <span class="blacklist-hostname">${h}</span>
      <button class="btn-whitelist" data-host="${h}">re-enable</button>
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

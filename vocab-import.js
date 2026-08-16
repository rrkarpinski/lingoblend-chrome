/**
 * vocab-import.js — LingoBlend shared ES module
 * Owns all pure logic for parsing, diffing, merging, and serialising vocab.
 * No DOM, no chrome.storage, no side effects.
 */

// ── Delimiter helpers ─────────────────────────────────────────────────────────

export function delimForFile(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (ext === 'tsv') return '\t';
  if (ext === 'csv') return ';';
  return null;
}

export function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(';'))  return ';';
  return null;
}

// ── Parser ────────────────────────────────────────────────────────────────────

const FALLBACK_HEADERS = ['target', 'translations', 'forms', 'source'];

export function parseVocabFull(text, delim) {
  const lines = text.split(/\r?\n/);
  let colNames = null;
  const rows = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(delim);

    if (colNames === null) {
      const firstToken = cells[0].trim().toLowerCase();
      if (window.LB_HEADER_TOKENS.has(firstToken)) {
        colNames = cells.map(c => c.trim().toLowerCase());
        continue;
      } else {
        const n = Math.max(cells.length, 2);
        colNames = Array.from({ length: n }, (_, i) => FALLBACK_HEADERS[i] || `col${i}`);
      }
    }

    const obj = {};
    cells.forEach((c, i) => { obj[colNames[i] || `col${i}`] = c.trim(); });
    if (!obj.target)       obj.target       = obj[colNames[0]] || '';
    if (!obj.translations) obj.translations = colNames[1] ? (obj[colNames[1]] || '') : '';
    if (!obj.target || !obj.translations) continue;
    rows.push(obj);
  }

  return { rows, colNames: colNames || FALLBACK_HEADERS.slice(0, 2) };
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export function buildDiff(incoming, existing) {
  const existingMap = new Map(existing.map(r => [r.target, r]));
  const incomingSet = new Set(incoming.map(r => r.target));
  const newWords = [], updated = [], unchanged = [], removed = [];

  for (const row of incoming) {
    if (!existingMap.has(row.target)) {
      newWords.push(row);
    } else {
      const old = existingMap.get(row.target);
      (JSON.stringify(old) !== JSON.stringify(row) ? updated : unchanged).push(row);
    }
  }
  for (const row of existing) {
    if (!incomingSet.has(row.target)) removed.push(row);
  }

  return { newWords, updated, unchanged, removed };
}

// ── Merge ─────────────────────────────────────────────────────────────────────

export function applyMerge(mode, incoming, existing) {
  if (mode === 'replace') return incoming;
  const existingMap = new Map(existing.map(r => [r.target, r]));
  if (mode === 'addnew')
    return [...existing, ...incoming.filter(r => !existingMap.has(r.target))];
  // addupdate
  const merged = [...existing];
  const mergedIdx = new Map(merged.map((r, i) => [r.target, i]));
  for (const row of incoming) {
    if (mergedIdx.has(row.target)) merged[mergedIdx.get(row.target)] = row;
    else merged.push(row);
  }
  return merged;
}

// ── Serialiser ────────────────────────────────────────────────────────────────

export function vocabRowsToText(rows, colNames, delim = ';') {
  const header = colNames.join(delim);
  const body = rows.map(r =>
    colNames.map(c =>
      (r[c] || '').replace(new RegExp(delim === '\t' ? '\t' : delim, 'g'), ' ')
    ).join(delim)
  );
  return [header, ...body].join('\n');
}

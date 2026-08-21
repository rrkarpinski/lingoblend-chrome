/**
 * enrichment-api.js — LingoBlend shared ES module
 * Thin fetch wrapper for the vocab enrichment server. No DOM, no chrome.storage,
 * no UI logic, no i18n — dashboard.js owns all state (job ids, cached results,
 * polling, localized display strings).
 *
 * ── Design contract ──────────────────────────────────────────────────────────
 * Every exported function ALWAYS resolves (never throws) with a plain object
 * of the shape { kind: '<string>', ...extra fields }. This module is the ONLY
 * place that knows about HTTP status codes — callers must never inspect a
 * status code themselves; they switch on `kind` only. Network-level failures
 * (fetch throwing before any response arrives) are caught here and normalized
 * into a `network_error` kind, same as any other outcome.
 *
 * `detail`/`message` fields carry raw server text for DISPLAY ONLY — per the
 * API handoff, never branch client logic on that text, only on `kind`.
 *
 * kind enum per function:
 *   uploadVocab   → ok | unauthorized | unsupported_pair | invalid_request |
 *                   server_error | network_error | unknown_error
 *   getJobStatus  → pending | done | job_error | unauthorized | not_found |
 *                   invalid_request | network_error | unknown_error
 *   getJobResult  → ok | unauthorized | not_found | still_pending | job_error |
 *                   invalid_request | network_error | unknown_error
 */

async function safeFetch(url, options) {
  try {
    const response = await fetch(url, options);
    return { reached: true, response };
  } catch (_) {
    return { reached: false };
  }
}

/**
 * Normalizes FastAPI's two distinct error body shapes into one display string:
 * - {"detail": "some message"}                     (401/400/404/202/500)
 * - {"detail": [{"loc":[...], "msg":"...", ...}]}  (422 validation errors)
 */
function extractDetail(body) {
  if (!body) return '';
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) {
    return body.detail.map(d => (d && d.msg) ? d.msg : JSON.stringify(d)).join('; ');
  }
  try { return JSON.stringify(body); } catch (_) { return String(body); }
}

async function parseJsonSafely(response) {
  try {
    return { ok: true, body: await response.json() };
  } catch (_) {
    return { ok: false, body: null };
  }
}


/**
 * @param {string} baseUrl - e.g. 'http://localhost:8000' (no trailing slash)
 * @param {string} apiKey
 * @param {string} vocabCsvText - raw CSV text, columns exactly target/translations
 * @param {string} profileId
 * @param {string} profileName
 * @param {string} languagePair - e.g. 'en_pl'
 */
export async function uploadVocab(baseUrl, apiKey, vocabCsvText, profileId, profileName, languagePair) {
  const form = new FormData();
  const blob = new Blob([vocabCsvText], { type: 'text/csv' });
  form.append('file', blob, 'vocab.csv');
  form.append('profile_id', profileId);
  form.append('profile_name', profileName);
  form.append('language_pair', languagePair);

  const fetched = await safeFetch(`${baseUrl}/upload`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body: form
  });
  if (!fetched.reached) return { kind: 'network_error' };

  const { response } = fetched;
  const { body } = await parseJsonSafely(response);

  switch (response.status) {
    case 200:
      return body?.job_id ? { kind: 'ok', jobId: body.job_id } : { kind: 'unknown_error', detail: 'Missing job_id in 200 response.' };
    case 401:
      return { kind: 'unauthorized' };
    case 400:
      return { kind: 'unsupported_pair', detail: extractDetail(body) };
    case 422:
      return { kind: 'invalid_request', detail: extractDetail(body) };
    case 500:
      return { kind: 'server_error', detail: extractDetail(body) };
    default:
      return { kind: 'unknown_error', detail: extractDetail(body) || `HTTP ${response.status}` };
  }
}


/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} jobId
 */
export async function getJobStatus(baseUrl, apiKey, jobId) {
  const fetched = await safeFetch(`${baseUrl}/status/${encodeURIComponent(jobId)}`, {
    headers: { 'X-API-Key': apiKey }
  });
  if (!fetched.reached) return { kind: 'network_error' };

  const { response } = fetched;
  const { body } = await parseJsonSafely(response);

  switch (response.status) {
    case 200: {
      const jobStatus = body?.status;
      if (jobStatus === 'pending') return { kind: 'pending', phase: body.phase || '' };
      if (jobStatus === 'done') return { kind: 'done', partial: !!body.partial, skippedCount: body.skipped_count ?? 0 };
      if (jobStatus === 'error') return { kind: 'job_error', message: body.error || '' };
      return { kind: 'unknown_error', detail: `Unexpected status value: ${jobStatus}` };
    }
    case 401:
      return { kind: 'unauthorized' };
    case 404:
      return { kind: 'not_found' };
    case 422:
      return { kind: 'invalid_request', detail: extractDetail(body) };
    default:
      return { kind: 'unknown_error', detail: extractDetail(body) || `HTTP ${response.status}` };
  }
}


/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} jobId
 */
export async function getJobResult(baseUrl, apiKey, jobId) {
  const fetched = await safeFetch(`${baseUrl}/result/${encodeURIComponent(jobId)}`, {
    headers: { 'X-API-Key': apiKey }
  });
  if (!fetched.reached) return { kind: 'network_error' };

  const { response } = fetched;

  if (response.status === 200) {
    const csvText = await response.text();
    return { kind: 'ok', csvText };
  }

  const { body } = await parseJsonSafely(response);

  switch (response.status) {
    case 401:
      return { kind: 'unauthorized' };
    case 404:
      return { kind: 'not_found' };
    case 202:
      return { kind: 'still_pending' };
    case 500:
      return { kind: 'job_error', message: extractDetail(body) };
    case 422:
      return { kind: 'invalid_request', detail: extractDetail(body) };
    default:
      return { kind: 'unknown_error', detail: extractDetail(body) || `HTTP ${response.status}` };
  }
}


/**
 * Derives a job's creation timestamp from its id, per the server's
 * "{timestamp_ms}-{random_hex}" job_id format. Returns null if unparseable.
 * @param {string} jobId
 * @returns {Date|null}
 */
export function jobCreatedAt(jobId) {
  if (!jobId) return null;
  const parts = jobId.split('-');
  const ms = parseInt(parts[0], 10);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

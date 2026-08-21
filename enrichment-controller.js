/**
 * enrichment-controller.js — LingoBlend shared ES module
 *
 * Owns every DECISION about talking to the enrichment server: when to poll,
 * how often, when to auto-fetch a finished result, how to classify outcomes,
 * and how job/result state gets persisted onto a profile. Wraps the pure
 * HTTP functions in enrichment-api.js — this file is the only thing that
 * calls those functions; nothing else should import enrichment-api.js.
 *
 * dashboard.js's job is reduced to: render whatever getEnrichStatus()/
 * isUploading() report, and call startEnrichJob()/fetchEnrichedResult() in
 * response to user clicks. It never schedules a poll, decides an interval,
 * or writes pendingEnrichJobId/pendingEnrichResult/lastEnrichStatus itself.
 *
 * ── Shared state model ────────────────────────────────────────────────────
 * `profiles` (the whole object) is owned by dashboard.js and handed to this
 * module via accessor functions (see initEnrichmentController), not copied.
 *
 * IMPORTANT: dashboard.js keeps its `globalProfiles` in sync via
 * chrome.storage.onChanged (to avoid stale-snapshot clobbering across
 * multiple open dashboard windows — see project discussion). That means
 * `config.getProfiles()` can start returning a DIFFERENT object reference
 * at any point where this module awaits something — a write anywhere
 * (including this module's own persistProfiles() calls) round-trips
 * through storage and comes back as a freshly deserialized object.
 *
 * Consequence: NEVER hold a profile object across an `await` and mutate it
 * afterwards — the reference may already be orphaned by the time you get
 * back control. Every function below re-fetches the profile by id from
 * config.getProfiles() after each await, and treats "not found anymore" or
 * "pendingEnrichJobId no longer matches" as a safe no-op (superseded by a
 * newer action — new upload, profile deleted, API key changed mid-flight —
 * rather than an error).
 *
 * Polling runs for as long as the dashboard PAGE is open, independent of
 * which tab is visible — it is only ever active for the current active
 * profile (config.getActiveId()), never for a background profile. Tracking
 * every profile's job regardless of which one is active is a deliberate
 * non-goal here (see CHANGELOG 0.9.1 discussion) — that would require a
 * background service worker, not just this module.
 */

import { uploadVocab, getJobStatus, getJobResult, jobCreatedAt } from './enrichment-api.js';

// Single place to change when moving from local dev to the eventual Render URL.
// Must also match a host_permissions entry in manifest.json.
// const ENRICHMENT_API_BASE_URL = 'http://localhost:8000'; // local dev
const ENRICHMENT_API_BASE_URL = 'https://lingoblend-processing.onrender.com';
const ENRICH_POLL_INTERVAL_MS = 4000;

// ── Injected context ──────────────────────────────────────────────────────
// getProfiles/getActiveId are closures over dashboard.js's own `let`
// variables — always call them fresh, never cache their result across an
// await (see file header).
let config = { getProfiles: () => ({}), getActiveId: () => '', onChange: null };

export function initEnrichmentController({ getProfiles, getActiveId, onChange }) {
  config = { getProfiles, getActiveId, onChange };
}

// ── Module state ────────────────────────────────────────────────────────
// Live cache while a job is actively tracked (profile.pendingEnrichJobId is
// set). Terminal outcomes also get mirrored onto profile.lastEnrichStatus
// (persisted) so they survive a refresh even after pendingEnrichJobId is
// cleared. 'pending' stays memory-only — an active job is always
// re-verified fresh from the server on next view anyway.
let lastEnrichStatusByProfile = {}; // { [profileId]: { kind, phase?, message?, detail?, createdAt? } }
let uploadingProfileIds = new Set();
let enrichPollTimer = null;

function notifyChange(profileId) {
  config.onChange?.(profileId);
}

async function persistProfiles() {
  await chrome.storage.local.set({ profiles: config.getProfiles() });
}

/** Always fetches a FRESH profile object by id — see file header. */
function getProfile(profileId) {
  return config.getProfiles()[profileId] || null;
}

/**
 * ASSUMPTION: the server's language_pair is targetLanguage_nativeLanguage,
 * inferred from the handoff's own en_pl example matching a native:pl/target:en
 * setup. If the server rejects this with a 400, the returned detail text
 * lists the actually-supported pairs — verify against that.
 */
function getLanguagePair(profile) {
  return `${profile.targetLanguage}_${profile.nativeLanguage}`;
}

/**
 * Maps an enrichment-api.js result's `kind` into the render-facing status
 * kind + display fields. Only handles the SHARED, no-side-effect outcomes —
 * callers special-case 'ok'/'pending'/'done' and anything needing a side
 * effect (prompting for a new API key, resuming polling) themselves.
 */
function mapApiKindToRenderStatus(apiResult) {
  switch (apiResult.kind) {
    case 'unauthorized': return { kind: 'unauthorized' };
    case 'not_found': return { kind: 'not_found' };
    case 'network_error': return { kind: 'network_error' };
    case 'unsupported_pair': return { kind: 'unsupported_pair', detail: apiResult.detail };
    case 'job_error': return { kind: 'job_error', message: apiResult.message };
    case 'still_pending': return { kind: 'pending', phase: '' };
    case 'invalid_request':
    case 'server_error':
    case 'unknown_error':
    default:
      return { kind: 'request_error', detail: apiResult.detail };
  }
}

/**
 * Updates the live in-memory status, and for any TERMINAL kind (everything
 * but 'pending') mirrors it onto the profile object too, so it survives a
 * refresh independent of whether pendingEnrichJobId is still set.
 * createdAt is inherited from the previous entry unless explicitly
 * overridden, so callers don't need to thread it through every call site.
 */
function setEnrichStatus(profileId, kind, extra = {}) {
  const prev = lastEnrichStatusByProfile[profileId];
  const createdAt = extra.createdAt ?? prev?.createdAt ?? null;
  const entry = { kind, ...extra, createdAt };
  lastEnrichStatusByProfile[profileId] = entry;

  if (kind !== 'pending') {
    const profile = getProfile(profileId);
    if (profile) profile.lastEnrichStatus = entry;
    persistProfiles();
  }
  notifyChange(profileId);
}

// ── Public read API (for rendering) ────────────────────────────────────

/**
 * Resolves the effective display status for a profile: the live in-memory
 * cache while a job is tracked (defaulting to 'pending' with a date parsed
 * from the job id if no poll response has landed yet — e.g. right after
 * upload or right after a refresh), otherwise the persisted last-known
 * outcome. Returns null if there's nothing to show.
 */
export function getEnrichStatus(profileId) {
  const profile = getProfile(profileId);
  if (!profile) return null;
  const jobId = profile.pendingEnrichJobId;
  if (jobId) {
    return lastEnrichStatusByProfile[profileId]
      || { kind: 'pending', createdAt: jobCreatedAt(jobId)?.getTime() ?? null };
  }
  return profile.lastEnrichStatus || null;
}

export function isUploading(profileId) {
  return uploadingProfileIds.has(profileId);
}

// ── Polling ─────────────────────────────────────────────────────────────

export function stopEnrichPolling() {
  clearTimeout(enrichPollTimer);
  enrichPollTimer = null;
}

/**
 * Starts (or resumes) polling for the ACTIVE profile's tracked job, if any.
 * Runs regardless of which tab is visible — the job just needs the
 * dashboard page itself to stay open. Safe to call repeatedly; it always
 * stops any existing timer first, so callers don't need to reason about
 * whether one is already running.
 */
export function maybeStartEnrichPolling() {
  stopEnrichPolling();
  const activeId = config.getActiveId();
  notifyChange(activeId);
  const profile = getProfile(activeId);
  if (!profile || !profile.pendingEnrichJobId) return;
  const st = lastEnrichStatusByProfile[activeId];
  if (st && st.kind !== 'pending') return; // already resolved — no need to keep polling
  pollEnrichStatus(activeId, profile.pendingEnrichJobId);
}

function pollEnrichStatus(profileId, jobId) {
  const profile = getProfile(profileId);
  if (!profile || profile.pendingEnrichJobId !== jobId) return; // superseded/cleared before the call even went out
  const apiKey = profile.apiKey;

  getJobStatus(ENRICHMENT_API_BASE_URL, apiKey, jobId).then(res => {
    // Re-fetch fresh — config.getProfiles() may now be a different object
    // (see file header) if anything wrote to storage while this awaited.
    const current = getProfile(profileId);
    if (!current || current.pendingEnrichJobId !== jobId) return; // superseded/cleared while awaiting

    const prevCreatedAt = lastEnrichStatusByProfile[profileId]?.createdAt;
    const createdAt = prevCreatedAt ?? jobCreatedAt(jobId)?.getTime() ?? null;

    if (res.kind === 'pending') {
      setEnrichStatus(profileId, 'pending', { phase: res.phase, createdAt });
      // Only the active profile's job gets kept alive by polling — switching
      // away to a different PROFILE (not tab) still pauses this loop.
      if (profileId === config.getActiveId()) {
        enrichPollTimer = setTimeout(() => pollEnrichStatus(profileId, jobId), ENRICH_POLL_INTERVAL_MS);
      }
      return;
    }
    if (res.kind === 'done') {
      autoFetchEnrichResult(profileId, jobId, createdAt, { partial: res.partial, skippedCount: res.skippedCount });
      return;
    }
    // Every other kind is terminal for this polling loop — no further
    // scheduling; the user must act (update key or retry via a fresh click).
    const { kind, ...extra } = mapApiKindToRenderStatus(res);
    setEnrichStatus(profileId, kind, { ...extra, createdAt });
  });
}

/**
 * Called the moment a poll reports 'done'. Immediately fetches and caches
 * the result so it survives regardless of subsequent server availability —
 * the "Pull enriched vocab" button then only ever reads the cache.
 */
async function autoFetchEnrichResult(profileId, jobId, createdAt, doneMeta = {}) {
  const profile = getProfile(profileId);
  if (!profile || profile.pendingEnrichJobId !== jobId) return; // superseded/cleared already
  const apiKey = profile.apiKey;

  const res = await getJobResult(ENRICHMENT_API_BASE_URL, apiKey, jobId);

  const current = getProfile(profileId);
  if (!current || current.pendingEnrichJobId !== jobId) return; // superseded/cleared while awaiting

  if (res.kind === 'ok') {
    current.pendingEnrichResult = res.csvText;
    current.pendingEnrichJobId = null; // cached — cut further server contact for this job
    await persistProfiles();
    setEnrichStatus(profileId, 'done', { createdAt, partial: doneMeta.partial, skippedCount: doneMeta.skippedCount });
    return;
  }
  // Auto-fetch failed — report the real failure instead of a misleading
  // 'done'. The job stays tracked (pendingEnrichJobId untouched) since this
  // could be transient (e.g. a key that just got revoked) rather than the
  // job itself being dead.
  const { kind, ...extra } = mapApiKindToRenderStatus(res);
  setEnrichStatus(profileId, kind, { ...extra, createdAt });
}

// ── Actions (called from dashboard.js click handlers) ──────────────────

/**
 * @param {string} profileId
 * @param {string} csvText - already-serialized vocab CSV to upload
 * @returns {Promise<{kind: string, [key:string]: any}>} 'ok' on success,
 *   otherwise a render-status object (same shape as getEnrichStatus()).
 */
export async function startEnrichJob(profileId, csvText) {
  let profile = getProfile(profileId);
  if (!profile) return { kind: 'not_found' };

  // A fresh click always supersedes whatever came before — clear old job
  // tracking up front, so a failed retry never leaves stale info lingering,
  // regardless of whether THIS attempt succeeds or fails.
  profile.pendingEnrichJobId = null;
  profile.pendingEnrichResult = null;
  profile.lastEnrichStatus = null;
  delete lastEnrichStatusByProfile[profileId];
  await persistProfiles();

  uploadingProfileIds.add(profileId);
  notifyChange(profileId);

  const languagePair = getLanguagePair(profile);
  const res = await uploadVocab(ENRICHMENT_API_BASE_URL, profile.apiKey, csvText, profileId, profile.name, languagePair);
  uploadingProfileIds.delete(profileId);

  // Re-fetch — globalProfiles may have been replaced while we awaited.
  profile = getProfile(profileId);
  if (!profile) { notifyChange(profileId); return { kind: 'not_found' }; }

  if (res.kind === 'ok') {
    profile.pendingEnrichJobId = res.jobId;
    profile.pendingEnrichResult = null;
    await persistProfiles();
    const createdAt = jobCreatedAt(res.jobId)?.getTime() ?? Date.now();
    setEnrichStatus(profileId, 'pending', { phase: '', createdAt });
    maybeStartEnrichPolling();
    return { kind: 'ok' };
  }

  const { kind, ...extra } = mapApiKindToRenderStatus(res);
  setEnrichStatus(profileId, kind, extra);
  return { kind, ...extra };
}

/**
 * Returns the enriched CSV for a profile — from cache if already fetched,
 * otherwise fetches it fresh (defensive path; normally autoFetchEnrichResult
 * already cached it the moment the job finished).
 * @returns {Promise<{kind: 'ok', csvText: string} | {kind: string, [k:string]: any}>}
 */
export async function fetchEnrichedResult(profileId) {
  const profile = getProfile(profileId);
  if (!profile) return { kind: 'not_found' };
  if (profile.pendingEnrichResult) {
    return { kind: 'ok', csvText: profile.pendingEnrichResult };
  }
  if (!profile.pendingEnrichJobId) return { kind: 'not_found' };
  const jobId = profile.pendingEnrichJobId;
  const apiKey = profile.apiKey;

  const res = await getJobResult(ENRICHMENT_API_BASE_URL, apiKey, jobId);

  // Re-fetch — see file header.
  const current = getProfile(profileId);
  if (!current || current.pendingEnrichJobId !== jobId) {
    // Superseded while awaiting (e.g. a fresh upload or key reset already
    // happened) — nothing sensible to return, treat as "check again".
    return { kind: 'not_found' };
  }

  if (res.kind !== 'ok') {
    const { kind, ...extra } = mapApiKindToRenderStatus(res);
    setEnrichStatus(profileId, kind, extra);
    if (kind === 'pending') maybeStartEnrichPolling(); // defensive still-pending case
    return { kind, ...extra };
  }

  current.pendingEnrichResult = res.csvText;
  current.pendingEnrichJobId = null;
  stopEnrichPolling();
  await persistProfiles();
  return { kind: 'ok', csvText: res.csvText };
}

/**
 * Called once the user has merged a pulled result into their vocab —
 * clears the cached CSV and terminal status so the bar goes quiet again.
 */
export async function clearEnrichmentState(profileId) {
  const profile = getProfile(profileId);
  if (profile) {
    profile.pendingEnrichResult = null;
    profile.lastEnrichStatus = null;
  }
  delete lastEnrichStatusByProfile[profileId];
  await persistProfiles();
  notifyChange(profileId);
}

/**
 * Called when the user submits a new/updated API key for a profile whose
 * old job was created under the previous key — that job is orphaned now,
 * since the server ties job ownership to the creating key.
 */
export async function resetJobForKeyChange(profileId) {
  const profile = getProfile(profileId);
  if (profile) {
    profile.pendingEnrichJobId = null;
    profile.pendingEnrichResult = null;
    profile.lastEnrichStatus = null;
  }
  delete lastEnrichStatusByProfile[profileId];
  await persistProfiles();
  stopEnrichPolling();
  notifyChange(profileId);
}

/**
 * Called when a profile is deleted — drops its in-memory enrichment cache.
 * Does NOT touch chrome.storage; the caller already removes the profile
 * from the profiles object and persists that separately.
 */
export function forgetProfile(profileId) {
  delete lastEnrichStatusByProfile[profileId];
  uploadingProfileIds.delete(profileId);
}

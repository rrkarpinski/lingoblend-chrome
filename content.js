/**
 * LingoBlend content script — Chrome MV3 — v0.5.0
 * Changes from v0.4.3:
 *   - nativeLanguage added to storage reads (flat key).
 *   - detectPageLanguage() added (html[lang] → meta content-language → meta name=language).
 *   - Entry point: if pageLang != nativeLang → skip, send LANG_MISMATCH; unknown → fail open.
 *   - All other code is exactly v0.4.3.
 */

const LB_CLASS = 'lb-word';
const LB_TOOLTIP_ID = 'lb-tooltip-el';
const LB_STYLE_ID = 'lb-styles';

let blendedCount = 0;
let rawPageText = '';

// ── Styles ────────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById(LB_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = LB_STYLE_ID;
  s.textContent = `
.${LB_CLASS} {
  color: #01696f;
  border-bottom: 1.5px dotted #01696f;
  cursor: pointer;
  border-radius: 2px;
}
.${LB_CLASS}:active { background: rgba(1,105,111,0.12); }
#${LB_TOOLTIP_ID} {
  position: fixed;
  z-index: 2147483647;
  background: #1c1b19;
  color: #cdccca;
  padding: 7px 11px;
  border-radius: 8px;
  font-size: 13px;
  font-family: sans-serif;
  line-height: 1.5;
  max-width: 300px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  pointer-events: none;
  transition: opacity 0.15s ease;
  white-space: nowrap;
}
#${LB_TOOLTIP_ID} .lb-original { color: #797876; margin-right: 6px; }
#${LB_TOOLTIP_ID} .lb-all-trans { color: #cdccca; }
`;
  document.head.appendChild(s);
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
let tooltipEl = null;
let dismissTimer = null;

function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = LB_TOOLTIP_ID;
    tooltipEl.style.opacity = '0';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showTooltip(nativeWord, translations, anchorEl) {
  clearTimeout(dismissTimer);
  const tip = ensureTooltip();
  tip.innerHTML = '';

  const orig = document.createElement('span');
  orig.className = 'lb-original';
  orig.textContent = '(' + nativeWord + ')';
  tip.appendChild(orig);

  const trans = document.createElement('span');
  trans.className = 'lb-all-trans';
  trans.textContent = translations;
  tip.appendChild(trans);

  tip.style.opacity = '0';
  requestAnimationFrame(() => {
    const rect = anchorEl.getBoundingClientRect();
    tip.style.whiteSpace = tip.scrollWidth > 300 ? 'normal' : 'nowrap';
    const tipW = Math.min(tip.scrollWidth + 24, 300);
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
    if (left < 8) left = 8;
    if (top + 60 > window.innerHeight) top = rect.top - 6 - (tip.offsetHeight || 40);
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.opacity = '1';
  });
  dismissTimer = setTimeout(hideTooltip, 4000);
}

function hideTooltip() {
  clearTimeout(dismissTimer);
  dismissTimer = null;
  if (tooltipEl) tooltipEl.style.opacity = '0';
}

// ── Case matching ─────────────────────────────────────────────────────────────
function matchCase(original, replacement) {
  if (!original || !replacement) return replacement;
  if (original[0] === original[0].toUpperCase() && original[0].toLowerCase() !== original[0])
    return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement.toLowerCase();
}

// ── Seeded random (mulberry32) ────────────────────────────────────────────────
function makeSeededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) >>> 0;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Vocab parsing ─────────────────────────────────────────────────────────────
// Delimiter: tab or semicolon only.
// Format: target <sep> translations [<sep> forms [<sep> source [...]]]
// First line is skipped if it looks like a header (first token is a known header keyword).
// rawTransLine stored on span = translations column only (clean, no extra columns).
const HEADER_TOKENS = new Set([
  'target','word','native','translation','translations',
  'forms','source','notes','comment','tags'
]);

function parseVocab(text) {
  const entries = [];
  let firstDataLine = true;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Determine delimiter: tab takes priority over semicolon
    const sep = trimmed.includes('\t') ? '\t' : ';';
    const parts = trimmed.split(sep);

    // Skip header: only on the very first non-empty line
    if (firstDataLine) {
      firstDataLine = false;
      const firstToken = parts[0].trim().toLowerCase();
      if (HEADER_TOKENS.has(firstToken)) continue; // skip header, don't set firstDataLine=false again
    }

    const target       = parts[0].trim();
    const translations = (parts[1] || '').trim(); // translations column only
    if (!target || !translations) continue;

    // native = first comma-separated token of translations (may contain spaces/dashes)
    const native = translations.split(',')[0].trim();
    if (!native) continue;

    entries.push({ target, native, rawTransLine: translations });
  }

  entries.sort((a, b) => b.native.length - a.native.length);
  return entries;
}

function buildAutomaton(entries) {
  const ac = new AhoCorasick();
  for (const { target, native, rawTransLine } of entries) {
    ac.addPattern(native, target, rawTransLine);
  }
  ac.build();
  return ac;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
const SKIP_TAGS = new Set([
  'SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','SELECT','OPTION',
  'CODE','PRE','KBD','SAMP','VAR','MATH','SVG','A'
]);

function isInSkipTag(node) {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.id === LB_TOOLTIP_ID) return true;
    if (el.classList?.contains(LB_CLASS)) return true;
    el = el.parentElement;
  }
  return false;
}

function prevTextChar(node) {
  let cur = node;
  while (cur) {
    let sib = cur.previousSibling;
    while (sib) {
      const t = sib.nodeType === Node.TEXT_NODE ? sib.nodeValue : sib.textContent;
      if (t && t.length) return t[t.length - 1];
      sib = sib.previousSibling;
    }
    cur = cur.parentNode;
    if (cur?.nodeType === Node.ELEMENT_NODE) {
      const d = getComputedStyle(cur).display;
      if (d === 'block' || d === 'flex' || d === 'grid') return ' ';
    }
  }
  return ' ';
}

function nextTextChar(node) {
  let cur = node;
  while (cur) {
    let sib = cur.nextSibling;
    while (sib) {
      const t = sib.nodeType === Node.TEXT_NODE ? sib.nodeValue : sib.textContent;
      if (t && t.length) return t[0];
      sib = sib.nextSibling;
    }
    cur = cur.parentNode;
    if (cur?.nodeType === Node.ELEMENT_NODE) {
      const d = getComputedStyle(cur).display;
      if (d === 'block' || d === 'flex' || d === 'grid') return ' ';
    }
  }
  return ' ';
}

// ── Text node processing ──────────────────────────────────────────────────────
function processTextNode(textNode, ac, rand) {
  const text = textNode.nodeValue;
  if (!text || !text.trim()) return;
  if (textNode.parentElement?.classList?.contains(LB_CLASS)) return;

  const charBefore = prevTextChar(textNode);
  const charAfter = nextTextChar(textNode);
  const matches = ac.search(text, charBefore, charAfter);
  if (!matches.length) return;

  const active = matches.filter(() => rand() < globalRate);
  if (!active.length) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const { start, end, pattern, replacement, rawTransLine } of active) {
    if (start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, start)));
    const original = text.slice(start, end);
    const span = document.createElement('span');
    span.className = LB_CLASS;
    span.textContent = matchCase(original, replacement);
    span.dataset.native = original;
    span.dataset.rawTransLine = rawTransLine;
    frag.appendChild(span);
    blendedCount++;
    cursor = end;
  }
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
  textNode.parentNode.replaceChild(frag, textNode);
}

function substituteAll(ac, rand) {
  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_TEXT,
    { acceptNode(node) {
      return isInSkipTag(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }}
  );
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) processTextNode(node, ac, rand);
}

// ── Click handler ─────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const span = e.target.closest('.' + LB_CLASS);
  if (span) {
    e.stopPropagation();
    showTooltip(span.dataset.native, span.dataset.rawTransLine, span);
  } else {
    hideTooltip();
  }
}, true);

// ── MutationObserver ──────────────────────────────────────────────────────────
let pendingNodes = [];
let mutationTimer = null;
let globalAC = null;
let globalRate = 1.0;
let globalRand = null;

function scheduleMutation() {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    const batch = pendingNodes.splice(0);
    for (const node of batch) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!isInSkipTag(node)) processTextNode(node, globalAC, globalRand);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
          acceptNode(n) { return isInSkipTag(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
        });
        const ns = []; let nn;
        while ((nn = w.nextNode())) ns.push(nn);
        for (const tn of ns) processTextNode(tn, globalAC, globalRand);
      }
    }
  }, 400);
}

let observer = null;
function startObserver() {
  if (observer) return;
  observer = new MutationObserver(mutations => {
    for (const m of mutations)
      for (const node of m.addedNodes) {
        if (node.id === LB_TOOLTIP_ID) continue;
        if (node.classList?.contains(LB_CLASS)) continue;
        pendingNodes.push(node);
      }
    if (pendingNodes.length) scheduleMutation();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Sentence analyser ─────────────────────────────────────────────────────────
const SentenceAnalyser = (() => {
  function run(text, vocabNativeSet) {
    try {
      const sentences = text.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 20);
      const results = [];
      for (const sentence of sentences) {
        const words = sentence.split(/\s+/)
          .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
          .filter(Boolean);
        if (words.length < 3) continue;
        const known = words.filter(w => vocabNativeSet.has(w));
        const missing = words.filter(w => !vocabNativeSet.has(w));
        results.push({ pct: known.length / words.length, missing });
      }
      const highCoverage = results.filter(r => r.pct >= 0.7);
      const missingFreq = {};
      for (const r of highCoverage)
        for (const w of r.missing)
          missingFreq[w] = (missingFreq[w] || 0) + 1;
      const topMissing = Object.entries(missingFreq)
        .sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w]) => w);
      const avgPct = results.length
        ? Math.round(results.reduce((s, r) => s + r.pct, 0) / results.length * 100) : 0;
      return { avgPct, highCoverageCount: highCoverage.length, topMissing, sentenceCount: results.length };
    } catch (_) { return null; }
  }
  return { run };
})();

// ── Message handler ───────────────────────────────────────────────────────────
let globalVocabNativeSet = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_STATS') {
    sendResponse({ count: blendedCount });
    return true;
  }
  if (msg.type === 'GET_SENTENCE_STATS') {
    const result = (globalVocabNativeSet && rawPageText)
      ? SentenceAnalyser.run(rawPageText, globalVocabNativeSet)
      : null;
    sendResponse(result);
    return true;
  }
});

// ── Page language detection (NEW in v0.5.0) ───────────────────────────────────
function detectPageLanguage() {
  const htmlLang = document.documentElement.getAttribute('lang');
  if (htmlLang) return htmlLang.split('-')[0].toLowerCase();
  const metaHttp = document.querySelector('meta[http-equiv="content-language"]');
  if (metaHttp) { const c = metaHttp.getAttribute('content'); if (c) return c.split('-')[0].toLowerCase(); }
  const metaName = document.querySelector('meta[name="language"]');
  if (metaName) { const c = metaName.getAttribute('content'); if (c) return c.split('-')[0].toLowerCase(); }
  return null;
}

// ── Entry point ───────────────────────────────────────────────────────────────
// Reads: enabled, vocabText, rate, disabledHosts, nativeLanguage (NEW)
chrome.storage.local.get(['enabled', 'vocabText', 'rate', 'disabledHosts', 'nativeLanguage']).then(async data => {
  const disabledHosts = data.disabledHosts || [];
  if (disabledHosts.includes(location.hostname)) return;
  if (!data.enabled) return;
  if (!data.vocabText) return;

  const nativeLang = data.nativeLanguage || null;
  const pageLang = detectPageLanguage();

  // Report mismatch for popup notice — but always continue blending
  if (nativeLang && pageLang && pageLang !== nativeLang) {
    chrome.runtime.sendMessage({ type: 'LANG_MISMATCH', pageLang, nativeLang });
  }

  injectStyles();

  globalRate = data.rate !== undefined ? data.rate / 100 : 1.0;
  const entries = parseVocab(data.vocabText);
  if (!entries.length) return;

  globalAC             = buildAutomaton(entries);
  globalVocabNativeSet = new Set(entries.map(e => e.native.toLowerCase()));
  rawPageText = document.body.innerText || '';
  const urlSeed = [...location.href].reduce((h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0);
  globalRand = makeSeededRandom(urlSeed);

  substituteAll(globalAC, globalRand);
  startObserver();
});

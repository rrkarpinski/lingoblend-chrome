/**
 * vocab-header-tokens.js — LingoBlend shared constant
 * Single source of truth for recognized vocab CSV header tokens.
 * Consumed by content.js (classic script, via manifest content_scripts)
 * and vocab-import.js (ES module, via dashboard.html's classic <script>
 * tag loaded before the module script — window globals are visible to
 * ES modules on the same page as long as load order is preserved).
 * Deliberately NOT using import/export — must remain loadable as a
 * plain script in both contexts.
 */
const LB_HEADER_TOKENS = new Set([
  'target', 'word', 'native',
  'translation', 'translations', 'duolingo_translations',
  'forms', 'inflections',
  'word_type', 'wordtype',
  'source', 'notes', 'comment', 'tags'
]);

if (typeof window !== 'undefined') window.LB_HEADER_TOKENS = LB_HEADER_TOKENS;
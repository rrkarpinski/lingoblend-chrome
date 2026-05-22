/**
 * Aho-Corasick — LingoBlend (Chrome MV3)
 * v0.6.0: addEntry() replaces addPattern() — registers all forms (or translations
 * as fallback) as patterns, all pointing to the same entry object.
 * charBefore / charAfter passed in from caller for cross-node boundary awareness.
 */
class AhoCorasick {
  constructor() {
    this.root  = this._node();
    this.built = false;
    this._wc   = /\p{L}|\p{N}/u;
  }

  _node() { return { children: new Map(), fail: null, output: [] }; }

  /**
   * Register all patterns for one vocab entry.
   * Patterns: entry.forms if non-empty, else entry.translations (string[]).
   * All patterns point back to the same entry object.
   */
  addEntry(entry) {
    const patterns = (entry.forms && entry.forms.length > 0)
      ? entry.forms
      : entry.translations;
    for (const pattern of patterns) {
      const p = pattern.toLowerCase();
      if (!p) continue;
      let node = this.root;
      for (const ch of p) {
        if (!node.children.has(ch)) node.children.set(ch, this._node());
        node = node.children.get(ch);
      }
      if (!node.output.some(o => o.pattern === p))
        node.output.push({ pattern: p, entry });
    }
    this.built = false;
  }

  build() {
    const q = [];
    this.root.fail = this.root;
    for (const [, child] of this.root.children) { child.fail = this.root; q.push(child); }
    while (q.length) {
      const curr = q.shift();
      for (const [ch, child] of curr.children) {
        let fail = curr.fail;
        while (fail !== this.root && !fail.children.has(ch)) fail = fail.fail;
        child.fail = fail.children.get(ch) || this.root;
        if (child.fail === child) child.fail = this.root;
        child.output = child.output.concat(child.fail.output);
        q.push(child);
      }
    }
    this.built = true;
  }

  _wchar(str, i) {
    if (i < 0 || i >= str.length) return false;
    return this._wc.test(str[i]);
  }

  /**
   * @param {string} text
   * @param {string} charBefore - char immediately before this text node in the DOM (or ' ')
   * @param {string} charAfter  - char immediately after this text node in the DOM (or ' ')
   * @returns {Array<{start, end, pattern, entry}>}
   */
  search(text, charBefore = ' ', charAfter = ' ') {
    if (!this.built) this.build();
    const lower = text.toLowerCase();
    const hits  = [];
    let node    = this.root;

    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      while (node !== this.root && !node.children.has(ch)) node = node.fail;
      node = node.children.get(ch) || this.root;

      for (const out of node.output) {
        const start = i - out.pattern.length + 1;
        const end   = i + 1;

        const leftChar  = start === 0       ? charBefore : text[start - 1];
        const rightChar = end >= text.length ? charAfter  : text[end];

        const atWordStart = !this._wc.test(leftChar);
        const atWordEnd   = !this._wc.test(rightChar);

        if (atWordStart && atWordEnd) {
          hits.push({ start, end, pattern: out.pattern, entry: out.entry });
        }
      }
    }

    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const result = [];
    let cursor = 0;
    for (const h of hits) {
      if (h.start >= cursor) { result.push(h); cursor = h.end; }
    }
    return result;
  }
}

if (typeof window !== 'undefined') window.AhoCorasick = AhoCorasick;

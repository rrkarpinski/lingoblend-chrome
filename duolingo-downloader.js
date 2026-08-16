// duolingo-downloader.js
// Self-contained Duolingo vocab downloader. No dependencies on core extension code.
// Only runs on https://www.duolingo.com/practice-hub/words

(function () {
  'use strict';

  if (location.hostname !== 'www.duolingo.com') return;
  if (!location.pathname.startsWith('/practice-hub/words')) return;

  const NS = '__duolingoDownloader';
  if (window[NS]) return;
  window[NS] = true;

  let hasRun = false;

  function getLiChildren(ul) {
    return Array.from(ul.children).filter(el => el.tagName === 'LI');
  }

  function getExpandButton(ul) {
    const lis = getLiChildren(ul);
    if (!lis.length) return null;
    const last = lis[lis.length - 1];
    return last.getAttribute('role') === 'button' ? last : null;
  }

  async function expandAllLists() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let guard = 0;
    let changed = true;

    while (changed && guard < 200) {
      
      console.log('[duolingo-downloader] expansion iteration', guard);
      changed = false;
      guard++;
      for (const ul of document.querySelectorAll('ul')) {
        let innerGuard = 0;
        while (innerGuard < 50) {
          innerGuard++;
          const btn = getExpandButton(ul);
          if (!btn) break;
          const before = getLiChildren(ul).length;
          btn.click();
          changed = true;
          await sleep(400);
          const after = getLiChildren(ul).length;
          if (after === before) break;
        }
      }
      if (changed) await sleep(500);
    }
  }

  function extractPairs() {
    const rows = [];
    const seen = new Set();
    for (const li of document.querySelectorAll('li')) {
      if (li.getAttribute('role') === 'button') continue;
      const h3 = li.querySelector('div h3');
      const p = li.querySelector('div p');
      if (!h3 || !p) continue;
      const target = h3.textContent.trim();
      const translation = p.textContent.trim();
      if (!target || !translation) continue;
      const key = target + '|||' + translation;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ target, translation });
    }
    return rows;
  }

  function csvEscape(v) {
    const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
    return (s.includes(';') || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function timestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function downloadCsv(rows) {
    const header = 'target;translations';
    const body = rows.map(r => `${csvEscape(r.target)};${csvEscape(r.translation)}`);
    const csv = [header, ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `duolingo_vocabulary_${timestamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function pageLooksReady() {
    return !!document.querySelector('li div h3');
  }

  async function run() {
    if (hasRun) return;

    console.log('[duolingo-downloader] detected list, prompting load');
    const wantsLoad = confirm(
      'This looks like your Duolingo word list. Load all words? This might take a while if you have a lot of words.'
    );
    if (!wantsLoad) return;

    hasRun = true; // lock immediately, before any DOM mutation from expansion

    await expandAllLists();

    const rows = extractPairs();
    if (!rows.length) {
      alert('No vocabulary entries found.');
      return;
    }

    console.log('[duolingo-downloader] expansion finished, rows:', rows.length);
    const wantsDownload = confirm(`Loaded ${rows.length} words. Download CSV now?`);
    if (!wantsDownload) return;

    downloadCsv(rows);
  }

  function waitForListThenRun() {
    if (pageLooksReady()) {
      run();
      return;
    }
    const observer = new MutationObserver(() => {
      if (pageLooksReady()) {
        observer.disconnect();
        run();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  waitForListThenRun();
})();
# LingoBlend — Changelog
### TODO:
popup bigger on orion
popup - simpler - select profile - if no profile then force create profile (force doing that in dashboard/ or not?)
on profile creation: email, language set, word bank
popup - if profile exists, then no ability to edit, change upload etc word bank. 

profiles - by email > needed for api for file processing
allow preexisting profiles on extension install - presetup for mom, dad
profiles are not secret, no password, just email, language set and related word bank, (and dashboard setings)

### TODO:
- add sleep before applyandReload() or manual refresh button because refreshing instantly doesnt give time for feedback to user what happened
- come with profile/vocab inside - for mom, dad, sis
- add option to download list form duolingo to update
- fix table sizing. now: vocab table has to be cropped   `html, body {overflow-x: hidden;` otherwise the navbar is pushed way down and modal is in the middle of the table instead of middle of the screen
- preprocessing heuristic smaller set wins - exhasberates duolingo bad translations more than matching first translation
a.matches bad duolingo translations with usefull english words (po - across, not after; to - that's instead of this/it)
b. that's/oh should count as function and not be in vocab

- add proper target word translation instead of sometimes inaccurate duolingo ones; use packaged static dictionary > to avoid unknown translations maybe match with duolingo translations
- lemantize target word > match morph tag beween target and native to match usage
- integrate machine translation with Bergamot for offline contextual sentence translation of DeepL through API
- work on making mmorphological tag bucketing/matching better/ verify it
- figure out ES, DE, RU, JP

-!!! maybe handle python script preprocessing with android/iOS app! doesnt have to be in extension!

## [0.6.1] — 2026-05-24
- Fix viewing dashboard on phones
! vocab table has to be cropped for navbar to work
! popup display on phone is still small

## [0.6.0] — 2026-05-21
### Added
- **Inflected forms support** — vocab col3 (comma-separated) stores inflected forms of
  the target word (e.g. all Polish cases of a noun). The Aho-Corasick automaton is now
  built over all forms; if col3 is absent or empty, falls back to col2 translations as
  before. Any matched form is substituted with the same target word. Tooltip continues
  to show the col2 translations string.
- **Function word filtering at import** — new `function-wordlists.js` defines ~350
  function words across EN, PL, ES (prepositions, conjunctions, pronouns, auxiliaries,
  determiners, adverbs). Applied at import time only; the automaton never contains
  function words. Rules: col1 function word → drop row; col2 translations filtered
  individually → drop row if all removed; col3 forms filtered individually.
- Import diff modal now shows a function-word summary line:
  `⊘ Function words: N rows dropped (col1) · N translations removed from N rows`.
- **Unified import pipeline** — `vocab-import.js` new shared ES module owns all pure
  import logic (parse, filter, diff, merge, serialise). Both `dashboard.js` and
  `popup.js` import from it; no logic is duplicated between them.

### Changed
- `aho-corasick.js`: `addPattern()` replaced by `addEntry(entry)` — registers all
  forms (or translations as fallback) as patterns, all pointing to the same entry.
- `content.js`: `parseVocab` reads col3 into `forms[]`; `buildAutomaton` uses
  `addEntry`; sentence analyser vocab set now covers all translations + forms.
- `manifest.json`: `function-wordlists.js` added to `content_scripts` before
  `aho-corasick.js`.

## [0.5.0] — 2026-05-20
### Added
- **Profiles** — Multiple user profiles (e.g. Rafał, Tata, Mama), each with their own
  vocabulary, analytics history, muted sites, native language, and target language.
  Only one profile is active at a time; its data is always mirrored to the flat storage
  keys so `content.js` is unchanged.
- Profile migration: on first load with v0.5.0, existing flat data is wrapped into a
  "Default" profile (nativeLanguage: pl, targetLanguage: en).
- Popup: profile name badge in header (e.g. "Rafał ▾"). Clicking opens an inline
  dropdown listing all profiles; clicking a profile switches to it and closes the popup.
  Dropdown has a "Manage profiles →" link that opens the dashboard Profiles tab.
- Dashboard: new **Profiles** tab (first tab). Each profile shown as a card with name,
  language pair (PL → EN), word count, last-used date. Active profile highlighted with
  teal border. Actions per card: Set active / Rename / Delete (disabled if only one
  profile) / Export. "New profile" button (name + native + target language). "Import
  profile" button (JSON; same id → overwrite, new id → add).
- Dashboard header now shows the active profile name.
- **Page Language Matching** — blending runs on all pages but language mismatch error displays in popup on pages not written in the active
  profile's nativeLanguage. Detection order: `<html lang>` → `<meta http-equiv=
  content-language>` → `<meta name=language>`. Unknown page language → fail open
  (blend anyway).
- Popup shows "Page is not in [LANG]" notice when language mismatches, and visually
  sets the toggle to OFF (without writing to storage).

### Changed
- `nativeLanguage` added as a flat storage key read by `content.js`.
- `background.js` now handles profile migration and
  message relay between content script and popup.
- All existing functionality (import, export, diff, delimiter handling, analytics,
  muted sites, inline vocab editing) now scoped to the active profile.

## [0.4.3] — 2026-05-18
### Fixed
- Popup stats (word count, coverage, high-coverage sentences) now refresh automatically
  after "Blend this page" triggers a tab reload. The popup listens for
  `chrome.tabs.onUpdated` to detect when the reloaded tab reaches `complete`, then
  re-queries GET_STATS / GET_SENTENCE_STATS from the freshly-run content script.

### Changed
- Dashboard Vocabulary tab: removed "+ Add word" button. Rows can still be edited
  inline (✎) and deleted (✕).
- Popup import: the "Import vocab" button is hidden when a vocab file is already
  loaded. Only the ✕ remove button is shown. The button reappears once the vocab is
  cleared.
- Import (popup + dashboard): delimiter is now auto-detected from the first data line
  (tab → semicolon → comma priority). If none is unambiguous a modal asks the user to
  pick tab / semicolon / comma / custom string.
- Import (popup + dashboard): before committing, a diff summary modal shows new /
  updated / unchanged word counts and offers three merge modes:
  Add new only · Add + update · Full replace.
- Import (popup + dashboard): supports a header row (skipped when first token matches
  a known header keyword). Accepts up to N columns; expected order is
  target, translations, forms, source. Extra columns are preserved.
- Dashboard Vocabulary table now displays all columns present in the loaded file.
- Export (dashboard): a delimiter-picker modal now appears before the download,
  letting the user choose tab / semicolon / comma / custom string.

## [0.4.2] — 2026-05-17
### Changed
- Export filename now includes datetime stamp: `vocabname_2026-05-17_0130.txt`
- Import in dashboard now warns user that current vocabulary will be OVERWRITTEN
- Popup redesigned: tighter layout (280px), dashboard icon in header bar,
  rate slider compact (label + value on one line, no tick marks),
  sentence stats shown as two compact stat cards (no missing links — see dashboard),
  site muting moved to bottom as subtle text link
- "Blacklist" renamed to "Mute" in popup for softer language
- "Apply to current page" renamed to "Blend this page"
- "Substitution rate" renamed to "Blend rate"


## [0.4.1] — 2026-05-17
### Added
- Vocabulary tab: inline row editing (click ✎ → edit target + translation in place → Save)
- Vocabulary tab: delete row with confirmation
- Vocabulary tab: add new word via "+ Add word" button
- Vocabulary tab: import .txt directly from dashboard (replaces loaded vocab)
- Vocabulary tab: export current vocab as .txt download

### Changed
- "% coverage" renamed to "Avg sentence coverage" everywhere (popup + dashboard)
- Cumulative missing words section retitled "Missing links — the most contextually
  useful words to add to your vocab next"
- History rows now show "% sentence coverage" and "Missing links:" prefix


## [0.4.0] — 2026-05-17
### Fixed
- Analytics bug: sentence coverage was calculated on post-substitution DOM, so higher
  substitution rates artificially deflated coverage. Fixed by snapshotting
  `document.body.innerText` before `substituteAll()` runs. Coverage is now
  rate-independent.

### Added
- Dashboard page (opens in new tab): Analytics tab with summary cards, cumulative
  missing-word cloud with frequency shading, per-session history; Vocabulary tab with
  searchable table of all loaded entries; Blacklist tab to review and re-enable sites.
- Analytics history: each popup open saves a snapshot (hostname, timestamp, avgPct,
  highCoverageCount, topMissing) to `chrome.storage.local`, capped at 200 entries.
- Site blacklist as inline text link in popup: "Blacklist [hostname]" /
  "re-enable" — replaces the previous toggle widget.

### Changed
- Site toggle removed from popup; replaced with minimal inline text action
- "Open dashboard ↗" link added to popup footer


## [0.3.1] — 2026-05-17
### Fixed
- Cross-node word split bug: words like "Czwórki" split across DOM nodes (e.g. due to
  inline `<b>`/`<em>` tags) no longer incorrectly match substrings. Aho-Corasick now
  receives `charBefore`/`charAfter` from the actual adjacent DOM content.
- `CATS` now maps to `gatos` (lowercase) instead of `GATOS`. Only sentence-initial
  capitalisation is preserved: `Cats → Gatos`, `cats → gatos`, `CATS → gatos`.

## [0.3.0] — 2026-05-17
### Added
- Per-site on/off toggle in popup — disabled hostnames persisted in storage
- Sentence analyser (encapsulated, safe): avg coverage %, high-coverage sentence count,
  suggested missing words shown in popup
- Tooltip reformatted to single line: `(original) translation, alt1, alt2`
- "Words blended in" page counter shown in popup

### Changed
- Popup UI: import button hidden once vocab is loaded; red ✕ replaces clear button;
  bottom hint removed

## [0.2.0] — 2026-05-17
### Added
- Capitalisation matching: `Cats → Gatos`, `CATS → GATOS`
- URL-seeded random (mulberry32) — same page always blends the same words at < 100% rate
- Unicode word boundaries (`/\p{L}|\p{N}/u`) — Polish/Spanish diacritics handled correctly
- Guard against re-processing already-substituted spans
- Duplicate pattern guard in Aho-Corasick

### Changed
- Tooltip shows all comma-separated translations from vocab file verbatim
- Tooltip format: `(native word)` header + full translation string below
- Aho-Corasick now stores `rawTransLine` (full rhs string) end-to-end

## [0.1.0] — 2026-05-16  MVP
### Added
- Aho-Corasick multi-pattern matching engine (longest-match-first, Unicode-aware)
- DOM TreeWalker substitution — skips `<a>` links, script, style, input tags
- MutationObserver for dynamic/SPA content
- Tap tooltip showing native word + translation
- On/off toggle, substitution rate slider (0–100%)
- Vocab import from `.txt` file (semicolon or tab-separated)
- `browser.storage.local` persistence
- Firefox MV2 → Chrome MV3 port (`browser.*` → `chrome.*`, service worker)

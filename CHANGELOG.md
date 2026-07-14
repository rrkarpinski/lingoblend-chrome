# LingoBlend — Changelog

### TODO:
- add option to download list form duolingo to update
- figure out ES, DE, RU, JP

## [0.8.2] - 2026-07-14
### Changed
- Tooltip color/order swapped: native word now shown unbracketed in the lighter shade, Duolingo-style translations now bracketed and shown in a mid-tone (darker than the native word, but lighter than the previous scheme).
### Fixed
- Fixed whitespace collapsing around injected `.lb-word` spans — a plain space sitting directly before, after, or between spans could render with no visible gap on some pages (e.g. headings with custom letter/word-spacing CSS). Boundary spaces adjacent to a span are now swapped to a non-breaking space (`&nbsp;`) at substitution time, leaving all other whitespace in the page untouched.
- Fixed `Uncaught TypeError: Cannot read properties of null (reading 'replaceChild')` on pages with aggressive async DOM mutation (e.g. Google's AI-generated answer box). Debounced mutation-observer processing could fire after a queued text node had already been detached from the DOM by the host page; `processTextNode()` now checks `textNode.parentNode` before processing and again before replacement, skipping detached nodes safely instead of throwing.

## [0.8.1] - 2026-07-14
### Changed
- Removed unused `function-wordlists.js` (EN/PL function-word sets) — dead code left over from an earlier filtering approach; no longer referenced by `content.js` or any other file. Dropped from `manifest.json` content scripts and from `<script>` tags in `popup.html`/`dashboard.html`.
- Standardized on the shorter `generateUUID()` (16-char hex from `crypto.getRandomValues`) across `dashboard.js` and `background.js`, replacing the longer dashed UUID-v4-style format previously used for new profile IDs.
- Removed email field from the new-profile creation flow. Profiles are now created with name, native/target language, and word bank file only; the generated UUID serves as the sole identifier. `field_email` key removed from `en.json`/`pl.json`; `require_fields_alert` copy updated to drop the email mention.
### Fixed
- Corrected a malformed `en.json` (trailing comma) that caused `SyntaxError: Unexpected token` on `i18n.js` dict load, breaking both popup and dashboard on startup.

## [0.8.0] - 2026-07-04
### Added
- UI localization (EN/PL). New `localization/en.json` and `localization/pl.json` files plus shared `i18n.js` helper with `t(key, vars)` lookup and `{placeholder}` interpolation.
- Language auto-detected from browser locale on first run, manually switchable via a language selector in the dashboard header. Preference persists in `chrome.storage.local` as `uiLang`.
### Note
- Pluralization is intentionally simplified — count-based strings use a single fixed template per language (e.g. always "{count} words"/"{count} słów") rather than grammatically correct plural forms, to keep the initial implementation scope manageable.

## [0.7.3] - 2026-07-04
### Fixed
- Mobile bottom navbar (dashboard, <767px) now spans full viewport width instead of shrinking to content (`left: 0; right: 0; width: 100%` on `.tabs`).
- Bottom navbar tabs now squish proportionally via flexbox (`flex: 1 1 auto` + 1% horizontal padding) so tabs shrink gracefully with screen width, keeping full label text visible far longer before truncating.
- Vocabulary table now scrolls horizontally within its own `.data-table-wrap` container (applied unconditionally, not just on mobile) instead of overflowing the page with no way to see clipped columns.
- Fixed popup sizing regression from mid-development where `height: 100%` + `overflow: hidden` collapsed the popup below its header; reverted to `min-height`-based sizing so the popup grows to fit content again.
- Added matching background color on `<html>` (not just `<body>`) to close a hairline transparent gap at the popup's edges.
### Changed
- Language mismatch notice now reads "Looks like the page is in {LANG}, not {LANG}" instead of the shorter previous phrasing.

## [0.7.2] - 2026-07-04
### Added
- Preloaded/seed profiles: extension can now ship with a `profiles/` directory containing individual profile export `.json` files plus an `index.json` listing their filenames. On install or update, any seed profile not already present in storage (matched by id) is merged in automatically, giving users a starting selection of profiles to pick from.

## [0.7.1] - 2026-07-04
### Fixed
- New profiles are now set active immediately upon creation, with flat storage keys synced so popup/content script pick them up without needing a manual profile switch.
- Fixed `diffResolve is not defined` error when importing vocab in the dashboard due to scoping issue in diff-modal button handlers.
- Fixed "no profile / create profile" panel remaining visible in the popup after a profile was created and activated — caused by `[hidden]` attribute being overridden by an author stylesheet rule (`.no-profile-panel { display: flex }` beat the browser's default `[hidden]` rule).
### Removed
- Reverted function-word detection/tagging (introduced in 0.6.4). Word banks are now assumed fully preprocessed externally (e.g. via the user's own Python pipeline); the extension no longer checks for, flags, tags, or reports function words at any stage of import or profile creation.

## [0.7.0] - 2026-07-04
### Changed
- Major UI restructuring: all vocabulary import/management moved exclusively to the dashboard. Popup no longer has file upload, clear-vocab, or diff-modal logic.
- Popup now shows a dedicated empty state ("Create Profile" CTA) when no profiles exist, linking directly to the dashboard's profile-creation flow instead of silently creating a default profile.
- Dashboard's "New profile" flow now requires name, email, language pair, and a word bank file upfront — profiles are fully populated at creation time rather than needing a follow-up vocab import.
- Added `email` field to the profile data schema (defaults to empty string for profiles created before this version).


## [0.6.5] - 2026-07-04
### Changed
- Matching engine now uses only the `forms` column (col3) to build substitution patterns — removed the automatic fallback to `translations` (col2) for rows with empty forms. Word banks must have `forms` populated for a row to be matched on the page (enforced upstream via preprocessing).
- Tooltip display is unaffected and continues to show the `translations` column.

## [0.6.4] - 2026-07-04
### Changed
- Function-word filtering no longer removes words/rows from imported vocab. Instead, each row is tagged with a `functionWordDetected` column (true/false), and the import summary reports how many target words and translations were flagged.
- Word banks are now assumed to already be preprocessed (e.g. via external Python pipeline); the extension performs detection only, not removal.

## [0.6.3] - 2026-07-04
### Changed
- Popup layout now fills available width/height (min-width 320px, max-width 480px) instead of a fixed 280px box, improving usability on Orion (iOS) and other mobile extension hosts.

## [0.6.2] - 2026-07-04
### Changed
- Removed auto-reload-on-change behavior from all popup interactive elements (enable toggle, blend-rate slider, profile switch, site mute, clear vocab, vocab import).
- Added explicit "Refresh page" button (#btn-refresh) as the only trigger that reloads the active tab.
- Settings changes now show a "Settings saved — click refresh to apply" hint instead of reloading immediately.

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

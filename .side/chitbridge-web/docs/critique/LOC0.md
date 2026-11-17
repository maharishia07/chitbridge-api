# Critique · LOC0 (the locale standard + a pseudo-locale guard) — written before any code

**VERDICT: BUILD WITH CHANGES** (four corrections, no blocker).

## (a) What the brief assumes, checked
- "CBLocale already owns direction, numerals, formats, sort, zone" — TRUE (`public/app/locale.js:140-915`). BUT the file is ADOPTED from chitbridge-engines v1.4.0 — *"DO NOT EDIT HERE"* (`locale.js:1`); `engines/src/locale.js` has no `qps` (grep). A `qps` inside CBLocale is an engines change, and this round does not own engines (rule 12).
- "catalogues ~700 each" — TRUE (strings-ta 700 · hi 702 · fr 701 · ar 800 lines). "English is the KEY" — TRUE, `tx()` `accounts-shell.js:113`; plural rules via `Intl.PluralRules` ALREADY EXIST — `txn()` `accounts-shell.js:171` (gettext `\u0005` category keys). No ICU library is needed; full ICU MessageFormat syntax is NOT implemented, and the standard must say which subset we use (`{name}` + plural category).
- Extractor figures 114 · 163 · 12 · 837 — TRUE as of the last run; re-measured in this round.
- "every customer screen in `qps`" — only PARTLY possible today: finance, crm, tasks, employees, network never call `tx()` (grep: 0 hits); employees.html and network.html do not load `locale.js` at all; till.html has NO catalogue (`cb_till_lang` is a label and a hint for voice only, `till.html:3756, 26379`); shop.html has its own 5-key `_L`/`t()` table (`shop.html:302, 316`). The pseudo-locale can only show on screens that load both `locale.js` and `accounts-shell.js` (Home/index, app.html incl. `#/country`, accounts). Everything else measures as 100 % untranslated — which is the honest baseline, not a defect of the guard.
- "directional icons mirror" — the arrow list and the `.arw` mirror class exist (`e2e/rtl-audit.cjs:52, 88`); the standard lists them, nothing new.
- "server sentences carry key + params" — FALSE today: may/why are English sentences (`api lib/adopt.js:94`; 77 `why:` in routes, 492 in lib) with six local `refuse()` helpers (`books.js:32`, `books-manual.js:28`, `country-setup.js:47` …) and no one place. "country-lab" = `app.html#/country` (`cap-country.js renderCountrySetup`) — assumed; UNKNOWN if another screen was meant.
- `hydrate()` (`app.html:5022`) CLEARS `cb_lang` when the server's `locale_prefs` is empty — the walk's `/api/entities/me` stand-in must answer `locale_prefs:{lang:'qps'}` or app.html wipes the pseudo-locale at boot.

## (b) Conflicts with DECISIONS-level rules and existing constructs
- One place per thing: `CBLocale.pack()` already loads `app/strings-<lang>.js` for ANY language on the switch (`locale.js:589-601`) — so `qps` IS a pack, `app/strings-qps.js`, a Proxy that pseudo-translates every key `tx`/`txn` ask for. Zero engines change; and because `LANG_NAMES` has no `qps` (`locale.js:126, 260`) Settings never offers it — "tests/labs only" comes free.
- Rule 5 (no second style): shop.html `_L` and the till's own words are second catalogues; the standard names them for retirement into `tx()` — converted in their own rounds, not this one. till.html is VENDORED (CLAUDE.md): its conversion is an api-master change.
- The standards register is `cap-standards.js STANDARDS` (61 rows; `e2e/standards-page.cjs:100` asserts 61 → 62 with the new row, the one place that count lives).

## (c) Simpler way
A pack, not an engine edit (above). The walk reuses `e2e/lib/walk.cjs` (serve · session · shots), the stand-in shapes of walk-home/finance/tasks/employees, cb-accounts.cjs and the CRM golden fixtures; counting DOM text nodes needs no new dependency. `run-shard.cjs` picks `walk-locale.cjs` up by name (walks.yml) — it must finish under its 240 s slot.

## (d) Risks
- Proxy pack: `m[key] || english` is always truthy — the getter must strip the `\u0004` context and `\u0005` plural suffixes and leave `<tags>`, `{placeholders}` and `&entities;` intact, or a pseudo string breaks markup. Only `tx`/`txn` read `CBSTR`, so nothing else sees it.
- The ratchet counts fixture names (Fixture Shop, Ravi Stores…) as text: they are USER DATA by the standard and are listed as such in the walk, else every screen over-counts. Clipping is a heuristic (scrollWidth > clientWidth with overflow not visible, or past the viewport).
- No api / engines change this round; the server-sentence shape (`why` stays the English rendering; additive `why_key` + `why_params`) is specified in the standard and queued in LOCALE-PLAN with its FIELDS entry. Other rounds touching the same files: W1 (`run-shard.cjs`), TO1 (cap-tasks) — low overlap.

## (e) Changes to the brief
1. `qps` as `app/strings-qps.js` (pack), not inside CBLocale. 2. Plural = existing `txn()`; no ICU library. 3. api untouched; server sentences specified + queued. 4. Register row in cap-standards.js + the 61→62 assertion.

## Report (the PR body — the runner token could not open the PR; paste this at https://github.com/maharishia07/chitbridge-web/pull/new/round/LOC0-38324851671)

**VERDICT: BUILD WITH CHANGES** — `qps` is a PACK (`public/app/strings-qps.js`, loaded by the existing `CBLocale.pack()`), not an edit to `locale.js` (an adopted engines asset); plurals = the existing `txn()` (Intl.PluralRules), no ICU library; api untouched — server-sentence keys are specified (standard § 7) and queued (LOCALE-PLAN round LOC2). Critique: `docs/critique/LOC0.md`.

- **Standard** `docs/design/standards/LOCALE-STANDARD.md` (catalogue · whole sentences + placeholders + plural categories · context notes · pseudo-locale · icons universal, only directional ones mirror (listed) · fallback chain counted never blank · server sentences `why_key`+`why_params` beside `why` · what is never translated). Registered: `cap-standards.js` row 62 (Localisation · Partly) + designer data + glossary; `standards-page.cjs` 147/147.
- **Guard** `e2e/walk-locale.cjs` (reuses `lib/walk.cjs`, the other walks' stand-in shapes, `lib/contract.cjs` M43): 10 screens × 1366/390 in `qps`, counts untranslated text nodes + clipped boxes, FAILS when either rises; `e2e/locale-baseline.json` holds the counts and the distinct strings so a rise names the new words. Run on this runner 3×: 22/22, stable. Shots `e2e/shots/walk-locale-*.png`.
- **Baseline (untranslated 1366 · 390; clipped 0 on every screen):** home 278·197 · till 61·21 (no catalogue at all — vendored, api master) · shop 8·8 (own `_L`) · accounts 30·4 · finance 11·0 · crm 10·1 · tasks 7·1 · employees 24·16 and network 13·4 (neither loads `locale.js`, so no pack can reach them) · country setup 12·12. Extractor: LABEL 114 · PROSE 163 · INTERPOLATED 12 · FRAGMENT 837.
- **Plan** `docs/design/standards/LOCALE-PLAN.md`: LOC1 till + bill (api master) → LOC2 server sentences → LOC3 accounts+finance → LOC4 crm+tasks → LOC5 employees+network → LOC6 country+shop → LOC7 Home. Nothing converted here.
- New paths, each justified: `strings-qps.js` (no pack can be generated statically — a Proxy answers every key so tomorrow's label is covered the day it uses `tx()`); `walk-locale.cjs` (no walk measured language); `locale-baseline.json` (the ratchet's one slot). Flow step: cross-flow tooling (PM1: no flow row). No dependency, no secret, no migration, no engines change. Better than Microsoft's qps-ploc because the bar is a per-screen ratchet the build enforces, not a tester's eye.
- Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses · pack-parity · lazy-screen · screen-reads · process-map all exit 0. Single PR, web only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Critique · SCREEN-ID (written before any code, 2026-10-14)

## (a) What the brief assumes, checked
- "extend the existing registry" — TRUE, it exists: `public/app/screens.js` (CBSCREENS: 932 rows, `byNav/byPanel/byFn`, AAA### codes) is GENERATED from `C:/dev/SCREENS.json` by `C:/dev/screens.cjs`; `e2e/screens-register.cjs:33` guards the pair. FALSE here: the docs checkout (`../chitbridge-docs`) is EMPTY on this runner (no SCREENS.json, screens.cjs, INDEX.md, DISCIPLINES.md, area README) — so the master cannot be extended or regenerated in this round.
- "ACC-01 / TSK-03" code shape — CONFLICTS with the live standard: every code is AAA### (`screens-register.cjs:62`, Athi 2026-09-12 "6 character"). And `ACC` is already taken (`Account › Profile…`, ACC001-005). Existing codes keep their numbers.
- "page-frame header on every small app" — FALSE: only tasks · settings · employees · network · country-lab · kyb · documents mount `CBFrame` (→ CBShell bar, `shell.js:282`); accounts · finance · crm draw their OWN header (`accounts.html:281`, `finance.html:304`, `crm.html:313`) with a `#who` group repainted by `whoPaint()`.
- "CBSheet kinds" — TRUE in effect: `chit-sheet.js:273 kindWord()` = Counter bill · Supplier bill · Task; the sheet is loaded by accounts, finance, crm (+ app.html). The page form (`CBSheet.mount`, crm `#/chit/<id>`) is a CRM screen.
- workshop codes already show (`app.html placeCodeTag`, guarded to ONE placer) — the small apps show none today.

## (b) Conflicts with rules / constructs
- One registry: the small-app + sheet rows go in ONE declared file `public/app/screen-id.js` that MERGES into `window.CBSCREENS` (rows · byApp · bySheet) — the browser has one register; screens.cjs should read it as a declared input (as it declares `_fineScreen` sub-views). No second list in the app.
- Nothing lands in app.html (index-not-app): the workshop keeps placeCodeTag; its sheet shows no chip until app.html loads screen-id.js (a later, allowed one-liner).
- One placer: the chip is ONE singleton element built by `CBScreenId`, moved into each repaint (the bell's pattern, `accounts.html:446`).

## (c) Simpler way
- No per-screen calls where a frame already knows: CBShell resolves its host app, `CBFrame.skeleton.setActive` tells the section, hash-routed pages resolve from `location.hash`; accounts tells it from `chrome()`.

## (d) Risks
- 390 px: the bars are tight (area pitfall). Phone shows the CODE only; the name is in aria-label/title and is the screen's own heading.
- Prefixes must never meet a screens.cjs prefix: new ones only (BKS FIN CRM TSK BIL SET EMP NET CLB KYB DOC HOM), guarded.
- No API, no migration (b472-b474 unused), no engines change. Other rounds touching accounts/finance/crm headers: small one-line hooks only.
- "Pay / Remind" sheets (`acc_sheet` · `fin_sheet` · `crm_sheet`, page-local `modal()`) are not CBSheet: declared later, listed in the report.

## (e) VERDICT: BUILD WITH CHANGES
1. Codes stay AAA### with new prefixes (BKS for CB Accounts, since ACC is taken). 2. Declared rows live in web `screen-id.js` merged into CBSCREENS; screens.cjs should read it (coordinator, docs repo). 3. Inventory: `tools/screen-list.cjs` → `docs/SCREEN-LIST.md` (+ `--check`). 4. Phone shows the code alone. 5. app.html untouched.

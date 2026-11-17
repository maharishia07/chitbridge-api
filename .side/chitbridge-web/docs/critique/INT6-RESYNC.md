# Critique · INT6-RESYNC (2026-10-14) — resync integrate/1014a · integrate/1014b · api SEC1b onto today's main

**VERDICT: BUILD AS BRIEFED** (one clarification in (c)). No feature, no migration (b595–b597 unused), no engines change.

## (a) What the brief assumes, checked
- web #257 (integrate/1014a) conflicts with main — TRUE, but only in 15 binary walk shots `e2e/shots/walk-settings-*.png`
  (main 4e7d5664 09:32 vs 1014a 154d8301 14:30); the contract fixture is already a byte copy of api main's
  `docs/contracts/web-api.json` (sha 2650ac98 both sides) and `public/till.html` = api main's till (728fbcf2) — no drift.
- api main ahead of web main (twin split) — TRUE: api #210 + #219 merged; web #257 open; web #264 (ENG-REW1 web) still OPEN,
  so "ENG-REW1 web if merged" = not yet; it stays a separate PR.
- api #211 (SEC1b) conflicts with api main — TRUE, one hunk: `scripts/guards.cjs` GUARDS list (SEC1b's longer
  `tester-code.test.cjs` comment vs main's new `people-writes-sec2.test.cjs` row). Web SEC1b (#258) is already in web main.
- web 1014b ← 1014a: one commit (228acc82 INT6a-LOCALE) → `public/shop.html` conflict with T2-ENGONCE's `engine/locale.js`.
- web 1014b ← main: the same shots + `public/app/MODULES.md` (generated: `tools/gen-modules-doc.cjs`).
- api 1014b ← main: merges CLEAN (1014a already inside it).

## (b) Conflicts with standing rules / constructs
- Generated or vendored files are never hand-edited: MODULES.md is regenerated; the contract is `--write` in the api then byte-copied;
  till.html stays byte-equal to the api master (verified by sha on every branch). Shots are walk output: on a binary conflict one
  side is TAKEN, never edited — main's side (the SCREEN-ID chip is the newer settings truth); a later walk re-shoots them.
- shop.html: both intents kept — 1014a's `app/accounts-shell.js` string door AND 1014b's one-home `engine/locale.js` (T2-ENGONCE);
  `app/locale.js` no longer exists on 1014b, so taking 1014a's line verbatim would 404.

## (c) Simpler way
- None for the merges. Clarification: the critique lands on integrate/1014a (the first branch touched) and flows into 1014b by the
  step-2 merge — no new PR, as the brief says.

## (d) Risks
- ../chitbridge-docs is an EMPTY checkout (no commits): the INT6a brief, area READMEs and DISCIPLINES.md are not readable here; the
  resolution rules are applied from this brief's inline text. Said in the report.
- Other open rounds branch from main or 1014b (#261/#267, #269/#270, #263 …) — this round touches only the three named branches.
- The locale ratchet (`e2e/locale-baseline.json`) merged clean across 1014a/1014b; `walk-locale` is run after the merge and
  only ever tightened, never loosened.
- api guards need the web checkout beside (contract copy): run with web integrate/1014b checked out at the same time.

# FIX-INT5a critique — three fixes on web `integrate/1013e` (#203), written before any code

**(a) What the brief assumes, checked**
- `docs/process/PRN.md` is tracked and PRN is a Windows device name — TRUE (INT5a wrote it, docs/critique/INT5a.md:19). The generator names a page `f.id + '.md'` at tools/gen-process-docs.cjs:131 and links it at :94 — TRUE; no other writer or reader of `<id>.md` (grep: e2e · tools · scripts · .github).
- walk-compare fails in CI in ~1 s though 12/12 on the build runner — TRUE, and NOT because of api main/#156: with api main + engines beside it passes 12/12 here; with `../chitbridge-engines` moved away it stops at once: "the books engines are not beside this checkout" (e2e/walk-compare.cjs:40). The walks CI (.github/workflows/walks.yml) checks out only the api — engines is private (e2e/run-shard.cjs:27 says so for till-books-offline).
- The api already ships the RELEASED engines the walk needs: lib/ledger.js · accounts-packs.js (withAccounts present) · posting · receivables · bookpack · period — the adopted, pinned copies production runs. books-harness.cjs:13 tries only BOOKS_ENGINES_SRC and the sibling.
- Home's new untranslated words — TRUE: walk-locale names "19 built · 10 coming · 6 being built", "Parallel run", "Their Tally or Xero period…", "Their books beside ours…" (manifest row `compare`, PR1). roadmap.js:113 builds the count line by CONCATENATION and draws `e.name` / `e.fits` raw; shell.js:379-380 draws the tile `name` / `what` raw. `tx` / `txf` are global on Home (index.html:77 loads accounts-shell.js before the shell mounts the roadmap).

**(b) Conflicts with rules / constructs**
- Locale standard §2: a sentence with numbers is ONE catalogue entry with placeholders — the count line becomes `txf('{built} built · {coming} coming · {workshop} being built', …)`, not three tx() glued.
- Baseline only falls: no `--write` that raises; if the count drops below, lowering it is allowed but not needed.
- Walk not loosened: the walk keeps the real routes over real engines — only WHICH copy of the engines it loads changes.

**(c) Simpler way**
- Fix 2 inside the web walk: when the sibling engines are absent, point `BOOKS_ENGINES_SRC` at the api's own adopted `lib/` (no workflow change, no secret, no private-repo checkout). The cleaner home is api books-harness `enginesSrc()` falling back to `API/lib` — named in the report, not changed here (the brief: no api change this round).

**(d) Risks**
- Adopted copies are the RELEASED engines, the sibling may be newer: the walk then proves what production runs (better). Data · money · migrations: none (no b358–b360 used). Twin landing: none — web only.
- roadmap.js / shell.js are shared with app.html and labs; tx may be absent there → a local `typeof tx` fallback to English.
- Reserved-name guard over api/engines: report only, no change there.

**(e) VERDICT: BUILD WITH CHANGES** — fix 2 is an engines-location fix in the walk (the api side is fine; the api harness fallback is the follow-up named in the report).

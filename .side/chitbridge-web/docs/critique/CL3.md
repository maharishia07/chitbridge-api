# CL3 critique — "Where ChitBridge is for <country>" + the standard shell on the Country lab (written before any code, 2026-10-13)

**(a) What the brief assumes, checked**
- Base CL2 on main — FALSE: web #167 is open; branched from `round/CL2-38326873304`, origin/main merged (one conflict, the lab's Home link — CL2's kept).
- Matrix vendored at web `public/data/country-matrix.json` — FALSE: `public/data/` holds only `compat.json`. The master is engines `docs/COUNTRY-MATRIX.json` (v1.43.0 on engines main, 101 rows, per pack MEMBER, sections A1–A10). Nothing copies it (engines `tools/adopt.cjs`, api `scripts/vendor-till.cjs:57 KEEP` — neither names it).
- COUNTRY-COVERAGE.md in web docs — FALSE on main: it is CX0's (#170, open, `acaded05`). It is the only per-AREA × IN/AU/AE source (§1, ✅/⚠️/❌ per sub-area).
- "Per product area" — the matrix has no areas; areas come from COVERAGE §1 (Registration · Country setup · Till · Print · Shop · Catalogue · Accounts · Finance · CRM · Tasks · Connector · Employees · Network · Locale). The matrix gives the pack line (verified · ✅ count) and the "—" rows (A9 `payroll`: out in all three).
- A shared shell exists — TRUE: `app/page-frame.js` CBFrame.mount = CBShell header (avatar, fonts, tokens, text size) + skeleton (sidebar + main) + kural foot; tasks · employees · network wear it. BUT signed out it mounts the one sign-in WINDOW inside the page (page-frame.js mount → shell.js:515-519) — a public page must stay usable: widen CBFrame additively (`signin:false` → the avatar's door is a "Sign in" link to Home's window).
- Lab today: its own `<header>`, its own `:root` palette and font (country-lab.html:37-41, 146) — TRUE, this is what the owner saw.
- Country setup step is in app.html (lazy `cap-country.js`, app.html:3393; INDEX-NOT-APP gap SET1) — TRUE; the block goes into that cap, loaded via `CAP_WITH` (app.html:4828), no new app.html screen.

**(b) Conflicts with rules / constructs**
- One calculation: the area roll-up (all ✅ → ✅ · any ✅ with ❌/⚠️ → ⚠️ · all ❌ → ❌) is done ONCE, offline, by the tool that vendors — screens paint the JSON.
- No new style: the lab paints with its own `.kv`/`.chip`; Country setup with the gov panel's `.govrow .gw .gv .gf`. The unit returns rows, not HTML.
- Country packs: nothing typed per country — every symbol and line is the docs' own words; a country with no row (JP) says "not known yet".

**(c) Simpler**: one unit `app/country-ready.js` (read `public/data/country-ready.json`, give rows) + one tool `scripts/country-ready.cjs` (copy matrix, parse COVERAGE §1, roll up; `--check` = the drift guard). No api change, no migration.

**(d) Risks**: COVERAGE lines are engineer-words (file:line, `code`) — the tool strips code/paths to one plain line; text budget walked. #170 may change the md → the guard fails until re-run (that is the point). skeleton-guard / index-not-app are shared with other rounds (append-only edits). Engines not owned: the matrix copy belongs in engines `tools/adopt.cjs` — queued, not built. b331–b333 unused.

**(e) VERDICT: BUILD WITH CHANGES** — areas from COVERAGE §1 (not the matrix); the md vendored as JSON from #170's text until it lands; CBFrame widened with `signin:false`; the lab's private header/palette replaced by CBFrame + skeleton, its flow untouched.

*Built (corrections found while building):* engines `tools/country-matrix.cjs --web <web>` already writes `public/data/country-matrix.json` — used, no engines request queued. The walk found four shared-shell faults, fixed at their one place: shell.js pulled a page-owned kural into the header on resize · an empty band under the header · the Sign in door 3.4:1 in Dark (avatar.js) · the skeleton sidebar kept Cream under Dark (page-skeleton.css). Also app.html `.auth` `align-items:safe center` — a card taller than the window had an unreachable top.

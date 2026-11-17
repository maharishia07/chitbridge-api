# INT5a critique — `integrate/1013e` (api + web): BR1 · CU2 · CU3 · PR1 · HX2 onto main, written before any merge

**(a) What the brief assumes, checked**
- origin/main holds INT4's integrate/1013d in both repos — TRUE (web aa3256c7 = #202, api 3a2106a2 = #155).
- Every branch exists in both repos — TRUE (BR1 · CU2 · CU3 · PR1 · HX2). CU3 contains CU2 in both (stacked) — TRUE.
- `git merge-tree` against main alone: api BR1 → test-cases.json · FIELDS.md · web-api.json; CU2 → FIELDS.md; CU3 → FIELDS.md · routes/entities.js; PR1 → web-api.json; HX2 clean. Web BR1 → contract copy; CU3 → app/avatar.js; PR1 → contract copy · MODULES.md; CU2 · HX2 clean.
- "engines v1.44.1 merged + tagged; the api adopts it" — tag TRUE (v1.44.1 = highest; it changes ONLY src/bank-recon.js). **The api pins no bank-recon** (api engines.lock.json has no such pin; `adopt --check` green at 48 files) — so the api has nothing to adopt; the web is the adopter (pin bank-recon 1.18.0 → 1.44.1, written by `tools/adopt.cjs`, never the branch's file by hand). Both `--check` after.
- PR1 carries b302/b303 + move-in · repeat-supply already on main — TRUE (main has b302–b307, b315); only b309 is new, unique. PR1's reg-au 1.40 pin is below main's 1.42 → main's pins kept.
- BR1's budget line `GET /api/books/bank/rail` has `awaiting_client` (web BR1) — dropped once web BR1 is in (both land in this pair).

**(b) Rule conflicts** — one prefs write: CU2's merge-patch and CU3's tz/workdays/font/weight go through the ONE `ui_prefs` PATCH in routes/entities.js; CU3 is a superset of CU2, so the CU3 hunk wins where they overlap and main's later edits to entities.js are kept around it. FIELDS.md: each round's new keys added once (union, no duplicate headings). Contract: regenerated (`--write`) after each api merge, `free` lists kept for data-keyed objects, web copy byte-identical. Budget: hand union. flows.json union → gen-process-docs.

**(c) Simpler way** — none; the order is the brief's and each conflict is resolved once.

**(d) Risks** — the contract regenerated mid-sequence must not freeze PR1's compare `sample` keys (PR1 put it in `free`). Till: none of the five change the api master (tools/tally-connector/till.html); PR1 touches lib/tax-engine.browser.js (main's newer copy kept) → `vendor-till --check` decides. Twin landing: api first (contract master; till master unchanged) unless the check shows otherwise. b309 is owner SQL (never run here); this round writes none (b355–b357 unused). Never merged, never force-pushed.

**(e) VERDICT: BUILD WITH CHANGES** — (1) the engines adoption is the web's (bank-recon pin), the api has no bank-recon pin to move; (2) main's higher engines pins kept over PR1's/BR1's older base.

**Found while building** — (1) api guard "nothing mints a chit except sendChit" named cap-bank.js once web BR1 sat beside (BR1 ran its api guards without it): the bank ask now sends through ONE `CBAdvice.sendBody` (rail-advice.js, the advice's own send, widened) — no second createChit. (2) till-vendor: bank-recon v1.44.1 reads the pack registry at load → the test loads it after money + engine/tax.js, as accounts.html does. (3) PR1 hand-put `parts.*` in the compare route's `optional`; `--write` dropped them (walk-compare C9) → kept as `also_optional`. (4) CU3 vs AX1: one ui key list (theme · fs · motion · stripes · edition · font · weight), api and avatar.js alike. (5) PR1's flow PRN had no generated doc → docs/process/PRN.md written by gen-process-docs. Checks: api guards 5375/0; web static · contract · docs-guard green; walk-bank-rec 45/0 · walk-compare 12/12 · walk-settings 15/15.

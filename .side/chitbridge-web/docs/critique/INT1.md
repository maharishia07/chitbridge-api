# INT1 critique — one integration branch per repo (api + web `integrate/1013`), written before any merge

**(a) What the brief assumes, checked**
- All 12 branches exist on origin (api 5, web 7) — TRUE (`git branch -r`, both repos). RI1 (#120 / #155) is not named → left out.
- Twins conflict with main in the shared files — PARTLY TRUE. `git merge-tree` vs main: api BAS1 + L3 conflict in `docs/contracts/web-api.json`; CL1 in `engines.lock.json` + `tests/engine-manifest.js`; F3 in `tests/support/books-memory.cjs` (NOT in the brief's list); BUY1 clean. Web BAS1 + L3 in `e2e/fixtures/web-api.contract.json`; BUY1 in generated `docs/process/O2C.md`; CL1 in `docs/process/flows.json`; F3 · KG1 · CA1 clean vs main. Pairwise conflicts (flows.json, budget) appear only in the sequential merge.
- `awaiting_client` is a mark the budget test reads — TRUE since tonight: api main eb680f0 (#119, guard/awaiting-client) landed AFTER the twins branched; `tests/round-trips-all.test.cjs:105,180-186` keeps a marked route in the fired list, fails a mark older than 14 days, and prints "remove its mark" once the web beside calls it. Three branch budgets carry it (BAS1 `GET /api/books/returns` → web#153, F3 `GET /api/books/cashflow` → web#147, L3 `POST /api/crm/leads/import` → web#149); the callers ARE in web integrate (`cap-period.js` perReturn · `cap-finance-cash.js` booksCashflow · `cap-crm.js` crmLeadImport) so all three marks go.
- "v1.39.0 from BAS1 is on engines main" — TRUE (engines main 03b0746 = BAS1 merge, package.json 1.39.0). A v1.40.0 tag also exists (IM1 on v1.39.0) but no PR here adopts it → not taken (rule 12).
- Pins: api main already has reg-in/au/ae/regulation 1.37.0, so CL1's reg bump is a no-op; CL1's real change is tax + tax-packs 1.37.0 and bundling reg-* into `lib/tax-engine.browser.js`. BAS1 moves gst-returns · reg-au · reg-ae to 1.39.0. Merged lock = per-engine max; re-adopt from tags.
- Contract `--write` is offline-safe — UNKNOWN until run (header says it rewrites "from the live answers" but the check itself is offline via `tests/support/contract-*.cjs`); verified by running it, never hand-merged.

**(b) Rule conflicts** — none added: the branch adds no code. Hand-merging the contract or the till copy would make a second shape; both are regenerated (contract test `--write`, `scripts/vendor-till.cjs`, `tools/adopt.cjs`). Budget is unioned by hand (never `--write`).

**(c) Simpler way** — none; the order given minimises re-resolution (contract rounds first, then pin/till rounds). KG1 and CA1 are additive and clean.

**(d) Risks** — F3's `books-memory.cjs` stand-in conflict is unlisted (resolved by meaning: both branches add stub reads). The bundle tax 1.37.0 + reg-au/ae 1.39.0 has never been adopted together → `adopt.cjs --check` and `tests/tax-vendor.test.js` decide. Generated pages (`docs/process/*.md`) are regenerated, not merged. Twin landing: api `integrate/1013` first (contract master), web second; `guards.cjs` reads the integrated web beside it. Never merged, never force-pushed.

**(e) VERDICT: BUILD AS BRIEFED** (with the note that the `awaiting_client` removal changes no check, only the record).

# Critique · T2-SPLIT — the giant handlers become named steps (written before any code, 2026-10-14)

**(a) What the brief assumes — checked**
- 518-line network build handler in routes/network-design.js — TRUE: `POST /build` at :186, 507 lines (scripts/fn-size.cjs).
- "→ named steps in lib/network-build.js" — CONFLICT: lib/network-build.js is PURE by contract (header :3) and tests/network-build.test.js:461 asserts its only require is `./handle`. DB steps cannot live there.
- "reusing the visible-stores helper" — FALSE as stated: `visibleStores` (routes/network-design.js:786) serves /stores + /availability; the build never lists visible stores. The build's real duplicates are the taken-handles read (:171 /validate and :284 /build, same SQL) and the design read (:162, :276, :67).
- send handler at routes/chits.js ~334, complexity 313 — TRUE place: 1408 lines; my counter says c350 (the MAINT-1 doc is not on this runner, so its own counter is not either).
- deliver-lines (:2974, 115 lines) and trace (:4880, 89 lines) — TRUE. `toName` is written out twice (:4900 trace, :4979 trace/batches).
- CTP one peer-lookup — TRUE: routes/ctp.js :124–140 (/deliver) and :312–319 (/query) run the same installation SELECT and the same three refusals. ctpaddress.js:224 looks up by DOMAIN — a different key, not merged.
- "every existing chit/network/CTP test green" — PARTLY RUNNABLE: the DB-backed CI job is gated off (ci.yml:118). Offline: 84 of the 100 tests touching these files pass on main; 16 already fail (need a server/DB) — the same 16 must be the only failures after.
- MAINT-1 baseline (C:/dev/docs/planning/…, tools/maint1) — MISSING: ../chitbridge-docs is empty. I build the counter (scripts/fn-size.cjs) on the tdz-guard tokenizer, lifted into tests/support/js-scan.cjs.

**(b) Conflicts with rules/constructs**
- 23 tests read routes/chits.js as SOURCE TEXT (e.g. `creditSaleCheck(sender_id, business_json)`, `const now = CLOCK.now()`, claim-series slices from `router.post('/send'`). The send steps must stay in routes/chits.js, after the route, with their text and local names kept — a move to lib/ would break those tests without a change in behaviour.
- moveStatus stays the one status writer; mint.header/party/summary/deliver stay the shape. Nothing new mints.

**(c) Simpler way** — none that meets the bar. A characterisation test is the cheap proof: run /send, /build, deliver-lines and trace through stubbed db/auth on today's code, freeze every SQL statement, param, copy and response, then require the identical trace after the split.

**(d) Risks** — money and sales (/send is every counter bill): mitigated by the golden master. No migration (b463–b465 unused). No web or engines change, so there is no twin landing. Other rounds editing routes/chits.js will hit merge conflicts; the split is mechanical, so a rebase is a re-run.

**(e) VERDICT: BUILD WITH CHANGES** — (1) pure steps go in lib/network-build.js; DB steps go in a new lib/network-build-run.js. (2) The build reuses one `takenUnder()` + `designOf()` instead of visibleStores. (3) Send steps stay in routes/chits.js. (4) Proof comes from golden-master tests + offline suites, not the gated DB job. (5) The counter and ratchet are built here.

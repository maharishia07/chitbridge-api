# Critique · API-4 sweep: assist (22 routes of routes/assist.js, /api/assist) · written before the first route edit

(a) The brief assumes, checked against the code
- 22 routes: TRUE (routes/assist.js: POST / /conform /catalogue-structure /catalogue-adopt /gap /publish /resolve; GET /standards /catalogue-sources /catalogue-mine /catalogue-source/:key /container/:id /erp-handoffs /regions /resolve /penetration /questions /gaps /whoami; PUT /catalogue-source /container /region-override).
- The web client falls through on any non-200 of POST /: TRUE. askLLM (web public/app.html:2192) reads only `reply.answer`; api() throws on a non-OK and answer() catches it. Nothing reads `error`, `code` or `message` of the 503/502, so the Problem form is safe; status, `error` word, `code` (ASSIST_SIGN_IN, ASSIST_GATED) and `message` are kept byte for byte. The unconfigured 503 and the two 502s gain a Problem `code` they never had.
- Every 5xx goes through safeErr (the one generic sentence): TRUE. The lib-thrown 403/404 of PUT /container and PUT /region-override pass `e.message`: the words are fixed in lib/container.js:29 and lib/regional.js:34,39 and a database error carries no `.status` (db/index.js), so no database text rides. `mErr.message` is only logged.
- 200s that carry model text (`answer`, `narrative`, `intro`) are the model's answer, not an error text. No 200 field is filled from an exception.
- web-api.json holds no assist entry: TRUE (grep), so none is regenerated.

(b) Conflicts with rules
- The assistant's non-200s are its contract: kept, status by status. lib/ai.js, the wallet, daily cap, payer rule, softIdentity, CONTEXT_HINTS, ASSIST_KB, catalogue versions, regions, money and owner checks are not touched.
- The schema may not add a refusal: a body that is a list was a 422 "Ask a question." and stays that (the bodies are declared `object or array`), and a repeated query key was read leniently and stays so (query values are declared as any). So no new 400 and nothing to grep in the web for.
- GET /container/:id and GET /catalogue-source/:key answer the record to ANY caller (public reference by design). The foreign-id world will say "another shop's id answered 200": listed as a finding for cb-security, not changed.

(c) Simpler way: none; lib/contract-kit.js, lib/products-contract.js (said, failed) and tests/lib/problem-world.cjs are the construct. Widened, not forked: the kit's `query` may be lenient (any value); the harness gains `env` and `headers` on a scenario (the assistant needs a Bearer token and a provider switch).

(d) Risks: the three source-reading tests (ai-one-pipe, sec-fix3, network-storefront) are run before and after; other sweeps edit guards.cjs, engine-manifest and the register (merged from main before the regenerate).

(e) VERDICT: BUILD WITH CHANGES. Left partial and why: GET /standards, GET /catalogue-sources, GET /gaps (always 200, no refusal and no catch to word); POST /resolve (always 410, no 500 can be reached to test); GET /whoami (its own fault answers 200 `not_read` by design, so its declared 500 is never answered).

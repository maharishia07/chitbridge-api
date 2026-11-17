# Critique · T2-HONEST — a failure is never "nothing there" (written before any code, 14 Oct)

(a) What the brief assumes, checked
1. "lib/knownerr (safeErr)" — FALSE as worded: `safeErr` is `lib/respond.js:5`; `knownerr.known` (lib/knownerr.js:17) translates deliberate DB refusals. Both reused, neither copied.
2. 7 network reads turn "could not read" into "nothing there" — TRUE: `lib/network-membership.js:54,69,95` (roster · brandsOf · standing → `{rows:[]}`), `routes/network-design.js:794,875` (the same tree read twice → `members=[]`, answered "not part of a network"), `lib/network-offers.js:122` (push → `stores:0`), `lib/network-catalogue.js:306` (stores → `[]`).
3. "raw e.message reaches clients in 5 places" — FALSE (under-count): ~119 `status(500)` answers carry `e.message` (till.js 39, testing.js 31, integrations.js 11, quick-keys.js 9, network-offers.js 8, entities.js 6 …). All go to `safeErr`.
4. Two `health()` copies — TRUE: `routes/integrations.js:205`, `routes/connectors.js:51` (identical thresholds).
5. Silent catches in capture / auto-raise / Tally books_log — TRUE: `routes/integrations.js:331` (books_log), `lib/capture.js:46,58,93`, `lib/autoraise.js:118,119`.
6. Baseline "1,201 empty catches" — NOT REPRODUCIBLE here: the docs repo (C:/dev → ../chitbridge-docs) is EMPTY on this runner (no MAINT-1 doc, no tools/maint1). Measured: web `public/` literal `catch(x){}` = 1,199 (the 1,201 is most likely the web's); api lib+routes = 138 literal + 17 `.catch(()=>{})`; api lib+routes silent handlers (empty, or only a literal fallback) = **468**.

(b) Conflicts with standing rules
- logger.js taxonomy already says "a bare catch is a warn" — the fallback logs at warn through ONE helper on lib/logger (no console.log).
- Loud member reads change behaviour ON PURPOSE (the brief names this fix); everything else is refactor-only (a log line added, the same fallback value returned).
- A sentence the client branches on ships with a code: the member-read failure answers 503 `code: NETWORK_READ_FAILED` + words.
- `*.browser.js` files run in the browser (no lib/logger) — counted, not converted.

(c) Simpler way
- One helper pair on lib/logger (`fellBack(what, err)` in a block, `orElse(what, value)` as a `.catch` handler) and a mechanical pass that names the function and the fallback, instead of hand-writing 234 sentences; hand-written words only where a person sees the fallback (network, capture, books_log).
- `health()` lives once in routes/connectors.js (the co-assist rail that owns connector actors) and is exported, as integrations.js already exports kitManifest — no new lib module.

(d) Risks
- Log volume: a parse-of-input catch is normal flow → those log at debug, not warn.
- A loud member read inside a write: publish() reads members BEFORE any write (safe to throw); pushToNetwork runs AFTER the write → it does not throw, it answers `stores:0` + `code` (additive key).
- Other rounds touch till.js / testing.js / chits.js heavily → mechanical, one-line edits keep merge conflicts small. No migration (b460–b462 unused). No engines change. No web change (web is next round).

(e) VERDICT: BUILD WITH CHANGES — (1) safeErr is lib/respond, not knownerr; (2) all ~119 raw 500 messages, not 5; (3) the api metric is the committed counter `scripts/empty-catches.cjs` over lib+routes (468 → ≤ 234), the 1,201 web figure is next round's; (4) docs repo missing on the runner — reported.

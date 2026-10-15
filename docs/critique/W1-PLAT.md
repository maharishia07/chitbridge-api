# W1-PLAT · critique before build (15 Oct) — W4 Limits (LIM2): one pager · idempotency off warns and refuses

(a) What the brief assumes, checked
- "limits.js — widen the existing pager" — FALSE: `lib/limits.js:1` owns body size + request/statement deadlines; the ONE pager is `lib/page-limit.js` (PERF1 `limitOf · pageOf`, T2-PAGING). Widen page-limit, not limits.
- "one shared pager for every list route" still open — TRUE: `node tests/list-paging-guard.test.cjs --list` on integrate/1014d → 99 list GETs · 10 paged · 17 allowed · **72 left** (ratchet MAX_UNPAGED = 76). INT6 did not close it.
- Second pagers exist beside page-limit — TRUE: routes/products.js:506 (`offset/limit` by hand), catalogue.js:1384 (`pg`), chits.js:2147 (`/folder` page/limit), crm.js:118 (timeline cursor `limit`), notifications.js:45 (`total`), chits.js:4664 (`paged/limit/page` spelled inline). The primitive (asked? · page · limit · offset · the envelope) is spelled 6 times.
- "idempotency.js:34,:73" — TRUE: `middleware/idempotency.js:34` `catch (_) { return null; }` (token unreadable → idempotency silently off), `:73` `catch (_) { return next(); }` (body unhashable → off), and `:93` store error → `next()` (off). In all three a retry with the same Idempotency-Key EXECUTES AGAIN with no warning. There is no env switch; "switched off" = store missing (pre-b109) · store error · unhashable body · unscoped token. No test reaches the middleware (only auth-first's mount order).
- C:/dev (DISCIPLINES.md, docs/27 + 28 READMEs, seams.cjs) — MISSING on this runner (`../chitbridge-docs` holds only `.git`). docs/SEAMS.md has no page-limit entry; grep is the search.

(b) Conflicts with standing rules and constructs
- One shape per slot: `total · page · limit` are ADDITIVE top-level keys; every old key (`count`, `items`, `chits`…) stays (the chits queue precedent). No page/limit asked = every row, as before (FIELDS.md:88, :263) — no screen changes behaviour.
- The web↔api contract: 6 unpaged routes are in docs/contracts/web-api.json (books statement · trial-balance · bank/rail · periods · fx-revalue · crm timeline). Of these only the timeline is a growing list; the books five are summaries (allowed with a reason) → only the timeline's answer gains keys → `--write` + byte copy to web (twin PR).
- The guard counts a route as paged only through `limitOf(`; a new reader (`pageArgs`) must be named in the guard in the same PR or every moved route still reads as unpaged.
- A sentence the client branches on ships with a code: the idempotency refusals (422 · 409) carry none today → `code` added; the new refusal is `IDEMPOTENCY_UNVERIFIED` (409).
- No empty catch: :34 and :73 become `log.warn` with the where; the middleware never logs through console.

(c) Simpler way
- Not every one of the 72 is a list: ~30 are summaries, graphs, one record's rows, a fixed vocabulary (books/trial-balance, entities/mis, chits/:id/trace, tax/ledger, till/stock…). They go into ALLOWED with a reason, not onto a pager that would lie (DISCIPLINES §2 pages LISTS).
- The growing lists page through ONE widened reader `pageArgs(query, dflt, max)` + ONE envelope `pageOut(key, rows, pg)`: the statement is unchanged (trips unchanged, budget lines unchanged); SQL `LIMIT/OFFSET` only where the route already limited by hand (products, folder, enquiry, timeline). Keyset where volume justifies it is a later round (PERF2), as books did.
- Idempotency off: no new store. A bounded in-process memory (per scope+key, the same 48 h window, cap 5 000) says "seen" — a retry while the store is off gets 409 `IDEMPOTENCY_UNVERIFIED` with a sentence; the first answer carries `X-Idempotency: unverified` and a warn line. Honest about its limit (per process) in the header name and the doc card.

(d) Risks
- ~25 route files touched by one-line edits (a `pg` read + the envelope at `res.json`) — parallel rounds (W1-*, INT7) touch the same files; edits are confined to the handler's first and last lines to merge cleanly. No migration (b646–b648 unused). No engines change.
- The contract rewrite needs ../chitbridge-engines beside the api (present) — if the books half SKIPs, the timeline line is edited by hand and said so.
- Memory fallback is per process: two api instances could each run a retry once. Stated in the header and the log; the store (b109) remains the real guard.

(e) VERDICT: BUILD WITH CHANGES — widen `lib/page-limit.js` (not limits.js); ~40 growing lists onto `pageArgs/pageOut`, the 6 hand-spelled pagers pointed at it, ~30 non-lists allowed with a reason, ratchet 76 → 0; idempotency :34/:73/:93 log + warn header + in-process refusal of the double post, with a unit test; twin web PR only for the contract byte copy.

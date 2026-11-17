# page-limit — the one pager (area 28 · platform & operations)

Module: `lib/page-limit.js` · CARD `28-platform-and-operations/page-limit` · owner: platform · status: ✅ built and tested (W1-PLAT, 2026-10-15)
Home for this card when C:/dev is present: `C:/dev/docs/28-platform-and-operations/functions/page-limit.md` (the docs checkout was empty on the W1-PLAT runner; this copy lives in the api until it is moved).

## What it does, and why
Every list GET in `routes/*.js` reads the page it was asked for through ONE reader and answers ONE envelope (DISCIPLINES §2: top-level `total` · `page` · `limit`, a sensible default, a server-side maximum, never the client's word). Before: the clamp was spelled per route (PERF1 found `?limit=1000000` obeyed on the Inbox), and after PERF1 the primitive AROUND the clamp — was a page asked, which page, which offset, the envelope — was still spelled six times (products, catalogue, chits ×2, crm, notifications). `/chits/folder` had no maximum at all.

| Function | Does | Rule |
|---|---|---|
| `limitOf(v, dflt, max)` | a whole number in [1, max]; `dflt` when absent / not a number | the server's max always wins |
| `pageOf(v)` | a whole page number ≥ 1 | |
| `pageArgs(query, dflt, max)` → `{ asked, page, limit, offset }` | the page a list was asked for | **not asked = every row, as before** (`limit` null = `LIMIT NULL`, `offset` 0) — no screen changes behaviour until it asks |
| `pageOut(key, rows, pg, total?)` → `{ [key], total, page, limit }` | the envelope | rows = the whole list (cut here when asked) or the statement's own page when `total` is given; every old key stays beside it |

## TRACE matrix
| Requirement | Spec | Design | Flow steps | Unit test | Walks / e2e | Routes served | Tables | Status |
|---|---|---|---|---|---|---|---|---|
| DISCIPLINES §2 "every list endpoint is paginated … top-level total, page, limit"; brief W4 LIM2 "one shared pager for every list route" | DISCIPLINES.md §2 · §3 (PG / lazyWrap) | docs/critique/W1-PLAT.md (c) | cross-flow plumbing: every list step of every flow (O2C · P2P · R2R · L2C … — the task list, the order list, the folder, the feed); no process row of its own | `tests/page-limit.test.cjs` (10 checks: each rule + edges 0 · negative · past the end · empty · non-list) · `tests/list-paging-guard.test.cjs` (0 unpaged, every allowance reasoned, no hand clamp in any routes/*.js) · `tests/testing-pages.test.cjs` · `tests/books-pages.test.cjs` · `tests/notifications-count.test.cjs` | web `e2e/contract.cjs` (the CRM timeline's envelope in the contract) · the web pager walks (PG / CBList remote) | 51 list GETs page through it; 49 reads allowed with a reason (one record, a summary, a graph, a vocabulary) — the list is `node tests/list-paging-guard.test.cjs --list` | none (it owns no table) | ✅ |

## §6 passes (W1-PLAT)
- Pass 0 · seams: `limitOf` · `pageOf` existed (PERF1); `paged / limit / page / offset` were inline in 6 routes → lifted as `pageArgs`; the envelope → `pageOut`.
- Pass 1 · shrink: the module is 4 functions of 3–10 lines, complexity ≤ 4; the 6 inline pagers became one call each.
- Pass 2 · humanify: `WHOLE_LIST` named; `asked · page · limit · offset` read as words; no catch.
- Pass 3 · structure: header with owns · called by · FLOW · CARD; this card; the guard fails a new list GET that does not read it.

# idempotency — at most once per (entity, key), and never silently off (area 28 · platform & operations)

Module: `middleware/idempotency.js` · CARD `28-platform-and-operations/idempotency` · owner: platform · status: ✅ built and tested (W1-PLAT, 2026-10-15)
Home for this card when C:/dev is present: `C:/dev/docs/28-platform-and-operations/functions/idempotency.md` (the docs checkout was empty on the W1-PLAT runner; this copy lives in the api until it is moved).

## What it does, and why
A mutation carrying `Idempotency-Key` runs AT MOST ONCE per (entity, key): the first request runs and its answer is recorded in `idempotency_key` (b109); a replay gets the recorded answer (`X-Idempotent-Replay: true`), a concurrent duplicate 409, the same key with another body 422. So an offline outbox replayed on reconnect never mints a second chit, form or credential.

**W1-PLAT (LIM2): when idempotency is switched off, a retry warns and is refused.** Three paths used to step aside in silence and let the retry execute again: an unreadable token (`catch (_) { return null }`), a body the canon could not fingerprint (`catch (_) { return next() }`), and a store error (a bare stdout line, then `next()`). Now:
- every "off" path writes a `warn` line through lib/logger with the request id, method, path and the why (never `console.*`, never an empty catch);
- the key is held in a bounded per-process memory (`memoryStore`, 5 000 entries, the same `IDEMPOTENCY_WINDOW_HOURS`) with the store's own contract — a retry is replayed or answered 409 `IDEMPOTENCY_IN_PROGRESS`, another body 422 `IDEMPOTENCY_CONFLICT`;
- every such answer carries `X-Idempotency: unverified` so the outbox knows the proof is not durable. Honest about its limit: two api instances could each run a retry once; the store remains the real guard.
- the refusals carry a `code` (a sentence the client branches on ships with a code).

| Function | Does |
|---|---|
| `scopeOf(req)` → `{ entity, why }` | the entity from the same bearer auth uses; `why` says when the token could not be read (the route's auth then refuses) |
| `fingerprint(req)` | sha256 of method · path · canonical body (lib/canon — byte-stable, load-bearing); null + warn when the body cannot be canonicalised |
| `dbStore.begin / finalize` | the b109 row inside the entity's RLS: claim → run → record (a 5xx is not an outcome: the row is released) |
| `memoryStore.begin / finalize` | the same contract in a bounded Map, used only while the store is off |
| `answerExisting(res, held, hash, isVerified)` | replay · 422 conflict · 409 in progress — never a second execution |
| `runAndRecord` · `runUnverified` | capture `res.json` and record through the store the key was claimed in; the unverified path warns and marks the answer |

## TRACE matrix
| Requirement | Spec | Design | Flow steps | Unit test | Walks / e2e | Routes served | Tables | Status |
|---|---|---|---|---|---|---|---|---|
| DISCIPLINES §2 "mutations idempotent where possible"; §7 middleware row (each rule · the refusal path · fail-closed · no empty catch); brief W4 LIM2 "when idempotency is switched off a retry WARNS and refuses a double post" | DISCIPLINES.md §2 · §7 | docs/critique/W1-PLAT.md (c) | cross-flow plumbing: every write step a counter's outbox replays (O2C step "bill" from the till, P2P goods-in, the repeat-supply raise through lib/autoraise); no process row of its own | `tests/idempotency.test.cjs` (11 checks: untouched without a key · store on: replay / conflict · store off: runs + unverified + warn, replay, in-progress 409, conflict 422, a 5xx retries · unfingerprintable body · unreadable token · bounded memory · no empty catch / console) · `tests/auth-first.test.cjs` (mount order) · `tests/canon.test.js` (the fingerprint's byte-identity) | till offline walks (a bill made offline syncs once, never twice) | every `POST · PUT · PATCH · DELETE` under /api that carries the header | `idempotency_key` (b109) | ✅ |

## §6 passes (W1-PLAT)
- Pass 0 · seams: `scope` (SEAMS #8) kept as the seam; lib/canon reused for the fingerprint; lib/logger for the warn.
- Pass 1 · shrink: the 30-line exported function became 8 functions of 3–18 lines (complexity ≤ 5, nesting ≤ 2); one flow for both stores.
- Pass 2 · humanify: `KEY_MAX_LENGTH · DEFAULT_WINDOW_HOURS · UNVERIFIED_MEMORY_MAX · STORE_MISSING_CODES` named; `found · claimed · raced · held · claim` instead of `ex · ins · ex2 · r`; empty catches 2 → 0; `console.*` 2 → 0.
- Pass 3 · structure: header with owns · called by · FLOW · CARD; this card; `tests/idempotency.test.cjs` in `scripts/guards.cjs`.

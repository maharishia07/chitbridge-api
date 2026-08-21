# Performance — the three tools, and which question each answers

**Athi, 2026-08-21:** *"is definitions used internally? Is it having a role in the systems?"* … *"if it is used
then optimise and make a remark how it is used so we know. Also refer it in the document, we should not be
duplicating. Each line of code should have a purpose."*

⚠️⚠️ **HE ASKED BECAUSE I WAS OPTIMISING BY COST RANK, NOT BY USAGE.** I had just collapsed two transactions in
`GET /definitions/:id` — and **nothing calls that endpoint**. The change was correct, harmless, and bought
exactly nothing. A ranked list of round trips says how expensive a call is; it says nothing about whether anyone
makes it.

⭐ **COST × USAGE, NOT COST.** Ranking by cost alone gave 26 endpoints to work through. Crossing it with usage
left **two** worth touching. That is the difference between a week and an afternoon.

---

## The three tools

| | question | run |
|---|---|---|
| `tools/round-trips.cjs` | how many **database** round trips does an endpoint cost? | `node tools/round-trips.cjs [--all]` |
| `tools/endpoint-usage.cjs` | does anything actually **call** it? | `node tools/endpoint-usage.cjs [--called]` |
| `../chitbridge-web/e2e/http-waves.cjs` | do a screen's **HTTP** calls queue or overlap? | `node e2e/http-waves.cjs` |

### The cost model is not a guess — it is in `db/index.js`

`withEntity()` wraps its callback in a transaction so the RLS binding is `SET LOCAL` and cannot leak between
requests. Correct, and it stays. But it costs **four** round trips every time: `BEGIN` · `set_config` · the
query · `COMMIT`. A bare `query()` costs one.

So an endpoint opening three transactions costs twelve round trips, eight of them ceremony. `onEntity(id, db,
fn)` runs on a client the caller already owns — one `BEGIN`, N queries, one `COMMIT`.

---

## ⚠️ The two parallelism rules point OPPOSITE ways

| | budget | so |
|---|---|---|
| **Browser** | six connections per origin | parallel HTTP is close to free — `const p = api(x)` started and awaited later costs nothing |
| **Server** | pool is `max:10` | parallel transactions have a **real** budget: six per request means the third concurrent reader queues |

⚠️ **`Promise.all` on the server trades a slow page for connection timeouts** — a worse failure and much harder
to diagnose. `GET /service/:chit_id` had exactly this: the browser's instinct applied on the server.

---

## What was measured and changed, 2026-08-21

| endpoint | before | after | how it is used |
|---|---|---|---|
| `GET /entities/me` | 9 trips, `identities` read **4×** | 7 trips, read **once** | **the hottest endpoint on the platform** — every screen, every boot |
| `GET /entities/me?include=` | — | +readiness/channels/vault in one call | the profile: **4 HTTP calls → 1** |
| `GET /service/:chit_id` | 3 tx, 12 trips | 1 tx, 6 | `svcGet` — the service panel on an open chit, 2 call sites |
| `POST /service/:chit_id/pause` | 3 tx, 12 trips | 1 tx | `svcPause` — the PAUSE button; ⭐ also a **correctness** fix, see below |
| `GET /products/:id/versions` | 3 tx, 12 trips | 1 tx, 4 | version history on a catalogue item |
| `GET /definitions/:id` | 2 tx | 1 tx | ⚠️ **nothing calls it** — the change bought nothing |

⭐⭐ **`POST /pause` WAS ALSO A RACE.** The "one open pause at a time" check and the insert it guards ran in
SEPARATE transactions, so two requests arriving together could both read zero open pauses and both start one.
`lib/sla` merges overlapping pauses from the same claimant, so the second would look recorded and silently
change nothing — the exact outcome the check exists to prevent. One transaction makes the read and the write one
unit of work.

### Deliberately NOT changed

- **`chits.js`** — the chit lifecycle engine is locked after Athi's manual confirm. `PUT /:chit_id/status`,
  `POST /send` and `POST /:chit_id/disputes` are the three most expensive endpoints in the codebase and they
  stay that way until he says otherwise.
- **`POST /assist/publish`** — the static counter reads 2 transactions, but they are an update-or-insert:
  **branches, not a sequence**. At runtime it opens one.

---

## ⚠️ What these tools cannot tell you

- **`round-trips.cjs` counts static call sites, not executions.** A call inside `if` may not run; a call inside
  a loop runs many times — and a loop is the case it **under**-counts, so a low score is weaker evidence than a
  high one. It found `assist/publish` at 2 transactions when the branches mean 1.
- **"Not called by the web client" is not "dead".** Three real callers it cannot see: the storefront
  (`shop.html`), other services, and anything a person or script hits directly.
- **`http-waves.cjs` reads whether the `await` is on the call, not how long the server takes.** It answers "is
  this a wave or a queue", which is the question that decides what to fix.

⚠️⚠️ **AND EVERY ONE OF THEM WAS WRONG BEFORE IT WAS RIGHT.** `round-trips` sliced handlers to the next route
declaration (swallowing helpers) and counted function names inside **comments** — this codebase comments
heavily and names the very functions being counted, so it charged `GET /chits/:id` five transactions when it
makes two. `endpoint-usage` compared `/api/chits/:id` against `/:chit_id` literally and reported 222 of 264
routes as uncalled. `http-waves` exists **because I overstated a win by counting call sites** and told Athi the
profile cost "over a second" when three of its four calls overlapped.

⭐ The finding is always the same shape: **a scan that under-matches reports its own blindness as a fact about
the code.** Check a new tool against something you already know the answer to before believing it.

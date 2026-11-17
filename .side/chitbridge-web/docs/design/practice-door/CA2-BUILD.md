# CA2-BUILD — the practice door, split into build rounds (written 2026-10-12 in CA1; reworked CA1b 2026-10-13; no code yet)

Every round obeys BRIEF-RULES (cloud form): reuse before build · money in minor units · writes via the M64 action-state helper · the
server decides may/why · a migration is a FILE the owner runs · each new route gets a hand-written line in `tests/round-trips-all.test.cjs`'s
budget · the web↔api contract regenerated from the api (`node tests/web-api-contract.test.cjs --write`, byte-copied to
`e2e/fixtures/web-api.contract.json`) · every new function names its C2V step · twin PRs say the landing order · BETTER, NOT COPIED
(rule 11): every PR carries its "Better than ‹X› because …" line from REQUIREMENT §0.2.

Three decisions must be taken BEFORE CA2 starts (the owner questions in the PR):
1. the anchor for a MONTH's question — the month's pack as a message subject (recommended) or a minted review chit (REQUIREMENT §9);
2. the dashboard reads the nightly recompute, dated on the row, with *Check now* per row as a recompute — accepted;
3. the Bank fact — the client's device posts counts of statement lines with no chit (never the lines), or no Bank column.

---

## CA2 · api — the practice entity, the grant, the cross-client read (no screen yet)

**Lands first.** Code must not break before the migration runs (`schema.hasTable('practice_grant')` → the routes answer
`503 PRACTICE_NOT_MIGRATED` with shopkeeper words, never a 500; the client's To-do simply has no `practice_request` kind).

| # | What | Where | Reuse / why new |
|---|---|---|---|
| 1 | **Migration FILE `migrations/bNNN_practice_grant.sql`** (next free number — b299 is M210's; idempotent; the header rule: DRAFT — NOT RUN · Athi runs it · safe to re-run; RLS stated) | api | tables `practice_grant` (grant_id · practice_entity_id · client_entity_id · status **sent / accepted / rejected / ended** · level_asked · level · can_see_costs · sent_by · sent_at · accepted_by · accepted_at · ended_by · ended_at · reason; UNIQUE one live row per pair; **no expiry column**) · `practice_grant_event` (the `access_events` columns: before_value · after_value · changed_by · reason · at) · `practice_open` (grant_id · person_identity_id · device_id · at). **RLS**: WITH RLS on all three; a row is readable when `app.current_entity` is either side; INSERT/UPDATE of status by the side the state table allows (REQUIREMENT §3) — written as two policies, not one OR. `identities.entity_kind` gains the value `practice` (the b157 CHECK, if one exists, widened). `ops.f_practice_clients(uuid)` SECURITY DEFINER, the `ops.f_books_enabled` shape: accepted grants of the practice → `client_entity_id · display_name · level · can_see_costs · last_check · periods status`. If decision 1 = the pack: `chit_messages.pack_id` nullable beside `chit_id` (CHECK: exactly one subject), in the same file |
| 2 | `lib/entitykind.js`: `'practice'` declared at the mint (never from the body — the file's own rule) | api | one value; `POST /api/entities/register` gains `{ kind: 'practice' }` server-side from a separate door (`signin.door('register-practice')`) |
| 3 | `lib/access.js effectiveLevel(grant, person)` = the lower of the two by RANK; `levelOf` unchanged | api | the ONE place that answers "what may this identity do" (header: eighteen became one). Test `tests/iam-access.test.cjs` widened |
| 4 | `lib/practice.js` (new module; `docs/SOFTWARE-ASSETS.md` row): `request · accept · reject · end · setLevel · open · clients` — one transaction each, one event row each (`access-events.js record` reused for the write shape, a new table name parameter). The verbs are the rail's (`engines rail.js ACTIONS`): no `invite`, no `decline`, no `revoke`, no expiry sweep | api | nothing holds a level between two entities; everything inside it is the existing pieces |
| 5 | `routes/practice.js` — who may call (the server decides): `POST /api/practice/request` (practice owner/editor) · `GET /api/practice/clients` (practice, one trip: `ops.f_practice_clients`) · `POST /api/practice/clients/:id/open` (practice person; mints a client-scoped person session through `lib/person-session.js` — entity = client, actor = the practice person, `access_level = effectiveLevel`, surface `practice`, life 8 h; writes `practice_open`) · `POST /api/practice/clients/:id/end`. Client side on `routes/books.js`: `GET /api/books/practice` · `POST /api/books/practice/request` (by handle) · `/accept` · `/reject` · `/end` (client OWNER only) · `PATCH /api/books/practice/level`. Each: a budget line by hand; `trips per route` in the PR body | api | no route today is called by an entity about another entity's Ledger |
| 6 | `lib/books-nightly.js check()`: store `last_check.summary` (REQUIREMENT §8 list: `sealed_to` · `chain_ok` · packs · months_not_locked · findings · waiting_to_post · bills_to_accept · `threads_waiting_on_client` · manual_entries_quarter · last_entry_date · bank) — counts of reads the check already makes + `todo` count (`books-todo.todo`) + the packs read (`books-pack`) + `bookpack.verify()` over the stored manifests; **FIELDS.md entry** in the same change (number · derived · written by the nightly · read by `ops.f_practice_clients` and `GET /api/books/health`). `sealed_to` = the last month that is locked AND has a chained pack AND `acknowledged_at` — the AND of three stored facts, computed in this one place | api | additive; the one calculation stays where it is |
| 7 | `lib/books-todo.js`: kind `practice_request` with its actions `{ label: 'Accept', … }` · `{ label: 'Reject', … }` (`POST /api/books/practice/accept` · `/reject`); kind `gst_due` reads the PACK's due (`engines reg-au basPeriods` for AU, `gst-returns.dueDate` for IN) — a widening of the one place, not a copy | api | AU1 may have done the second already; check first |
| 8 | messages: **nothing new on the row** — `msg_type = 'query'` exists (baseline CHECK); `thread_type` internal/external exists; the practice person's message is stamped by `app.current_actor` as any co-assist's. If decision 1 = the pack: `POST /api/packs/:id/messages` · `GET …` as thin aliases onto the one messages module with `pack_id` as the subject (the thread list and RLS as today), and `engines rail.js actions()` learns the subject kind (CHANGELOG + tag) | api (+ engines if the pack) | the question lives on the record; no request object, no due, no answered flag |
| 9 | the owner-only gates a practice EDITOR session may pass: `POST /api/books/periods/:fy/:p/:act` · `/gst/close` · `/gst/pay` · `/packs` · `/check` · `/outbox/retry` — the `owner` middleware learns "or a practice session at editor level" in ONE place (`middleware/auth.js`), each route listed in the PR | api | the client's own co-assist rules unchanged |
| 10 | **Tests** (offline, `node scripts/guards.cjs` + the touched tests): `tests/practice-grant.test.cjs` (every state move, who may, the event rows, one live grant per pair, an end delists sessions within 60 s with the fake clock, a SENT request does not expire) · `tests/practice-open.test.cjs` (the session is the client; `effectiveLevel`; RLS parity read: a practice session reads nothing of another client) · `tests/books-nightly-summary.test.cjs` (`sealed_to` is the AND of the three facts; a broken chain is named) · the contract test regenerated | api | — |
| 11 | `docs/contracts/web-api.json` regenerated; `round-trips.budget.json` lines by hand | api | — |

Report lines: the migration file name; trips per route; the owner-only routes widened; "Better than QBOA because a question is a
message on the record, not a request with a due date that can vanish."

---

## CA3 · web — `public/practice.html` + the client-side card (twin PR; lands after CA2's api PR, before the migration is needed by the screen: the page says "Starts after an update" on 503)

| # | What | Reuse |
|---|---|---|
| 1 | `public/practice.html`: the `accounts.html` skeleton (sidebar · pinned header · `CBAvatar` · `CBKural` with a `practice` route in `docs/design/kural-kit/kurals.json` + its copy); sidebar **Clients · Replies · People · Practice** | the shell as it is |
| 2 | S1 Clients = ONE `CBList.mount` (`public/app/list-ctl.js`): columns **Client · Sealed to · Nightly says** shown; On the rail · Waiting on client · Bank · Months not locked · Manual entries · Access · Last entry · Person in ⚙; `head.notices` = the chips of REQUIREMENT §5 (each a filter); `next(row)` = the "Audit me" groups (§6: the seal chain · the nightly found · on the rail · GST) each with its button through `CBAction.run`; every row carries the check's time; `bulk` = Ask n clients; ⬇ CSV | CBList owns the head, resize, scroll, cards, ⚙ |
| 3 | S2 open: `POST /api/practice/clients/:id/open` → the token stored for that tab → `accounts.html` / `finance.html` opened with the strip ("You are in ‹client› as ‹practice› · ‹level›" · ← back); the strip is the `top` bar's `.shop` slot, a greyed action carries `CBRail.WHY` and, beside it, *Ask the client* | the pages unchanged; `accounts-shell.js` reads the session |
| 4 | S3 Replies = `cap-messages.js` mounted across the practice's clients (one list assembled from every chit, as its header says); a row opens `CBThread.mount` on the chit (internal or external channel — the server's `actions` grey the one the level refuses); "waiting on client since ‹date›" is the thread's last message, painted | the ONE composer; the existing Replies screen |
| 5 | S4 People = `employees.html` as it is (a link); S5 Practice = the Settings section pattern | — |
| 6 | Client side in `accounts.html` Setup: the *Who may read your Ledger* card (C1), the To-do row (C2, painted from the feed like every other kind, Accept · Reject), Replies as today (C3) | the Settings card, the To-do painter, `cap-messages.js` |
| 7 | `public/app/cap-bank.js` (if decision 3 = yes): after a reconcile, `POST /api/books/bank-summary { to, no_chit }` — counts only, the statement never leaves the device (its own header's promise) | the existing match result |
| 8 | **Walk** `e2e/walk-practice.cjs` (a stand-in API on a free port, never the live site): 390 px `scrollWidth === 390`, no sideways scroll at 1080, every chip is a filter, every alert line has its button, a viewer-level grant greys the editor buttons WITH the sentence and shows *Ask the client*, every row shows the check's time, the 503 before the migration says "Starts after an update", strings "accounting"/"books of account"/"query"/"request" absent from the screen, shots under `e2e/shots/practice-{laptop,phone,alerts}.png` | the cloud walks pick it up |
| 9 | Guards: `e2e/guard-static.cjs` · `token-guard.cjs` (no new raw colour) · `dup-functions.cjs` · `contract.cjs` · `scripts/check-syntax.js` · `check-app-parses.cjs` · `e2e/process-map.cjs` with the C2V rows filled (module **Practice** added to `modules[]` now that the page exists) | — |

Report line: "Better than Xero HQ because the row says which month is sealed and what the recompute found, dated — not a cached
insight refreshed hourly."

---

## CA4 · both — bulk, BAS figures, the later-phase columns

| What | Where |
|---|---|
| bulk Build packs · Check now (per client through the client session, one `CBAction.run` per row, the outcome said per row) | web |
| BAS figures per client per quarter from `engines reg-au bas()` over the posted ledgers, stored in `last_check.summary.bas` by the nightly WITH the three pack hashes and acknowledgement dates; *Copy BAS figures* (the agent portal) and the quarter CSV | api + web |
| `practice_client_person` (who at the practice is on which client; S4 column; `GET /api/practice/clients` filtered by it) — migration FILE bNNN | api + web |
| a practice tier in `lib/plans.js` once the price is decided | api |

Report line: "Better than MYOB Practice because the BAS figures name the acknowledged packs they rest on — the sign-off trail is
printable because it is the record."

Not in any round until the owner decides the partnerships: bank feeds, STP payroll, ATO lodgement (R1 §5.2 rows 1–3). The screen
says so where a CA looks for them.

---

## Landing order and twin PRs

1. CA2 api PR (migration FILE + routes + tests) — merged first; the owner runs `bNNN_practice_grant.sql`.
2. CA3 web PR — opened in the same round as CA2 or the next; safe to merge before the migration runs (the page shows "Starts after an
   update" on 503), useful only after.
3. CA4 after both.

No engines bump is needed for CA2/CA3 unless decision 1 = the pack: `reg-au.js` (AU1, v1.34.0) already carries `basPeriods` and
`bas`; `rail.js` already carries the ladder and `message_external`; `bookpack.js` already carries `verify`. If the pack becomes a
message subject, `rail.js actions()` gains a subject kind — then an engines CHANGELOG + tag in that round.

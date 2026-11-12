# NET-98 · bulk public view — PLAN (critic before build; no lib code in this PR)

**Revised 2026-11-12 after the critic (CHANGE: 4 MUST, 6 SHOULD, PR #1136 comment).** Changes are marked [R1] to [R10] in place and listed in section 12.

Written 2026-11-12 against api origin/main (read with `git show`, no checkout touched). Area: catalogue (owner of `lib/catalogue-view.js`), with
cb-speed's scoping and cb-network's routes as the callers. Nothing here changes an answer; it changes how many times we cross the wire to make it.

## 0. The problem, in the unit the budget uses

`round-trips.budget.json` counts **ticks** (`lib/trips.js`: one per `query`, one per transaction, one per `readBatch`); its `wire` column counts the real
network trips (a transaction is 4: BEGIN, set_config, work, COMMIT; a `readBatch` is 1). Live on sit-au 2026-11-11:

| route | members | ticks |
|---|---|---|
| GET /api/catalogue/network/:bridge_id | 39 departments | 706 (about 18 per stocked department; 56 at 3, 166 at 9, 454 at 25) |
| POST /api/catalogue/network-store/:networkId/order | 39 stores | 831 (about 21 per store) |

Both loop `for (shop of shops) await publicViewFor(shop)` (routes/catalogue.js:664 `publicItemsOfShops`, :1050 the network loop; the network loop also does one
`resolveEntity` per member, :1054). Each `buildPublicView` (lib/catalogue-view.js:233) is an island of about 18 ticks and about 45 wire trips.

## 1. Reuse first (seams run)

- `node C:/dev/seams.cjs buildPublicView` → used by `ctpquery.js`, `entities.js` (seams misses `relationships.js:603` and `routes/catalogue.js`; grep found them).
- `node C:/dev/seams.cjs readBatch` → "nothing" — **seams does not index `db/index.js`**; `readBatch` exists (db/index.js:366), with the per-statement `entity` widening
  that EFF-TRIPS (docs/critique/EFF-TRIPS.md, 2026-10-15) added for exactly this shape (a store reading each brand's FORCE-RLS rows in one trip). Already used by
  `getFace`, `govresolve.verticalOf`, `entity-header`, `work-rows`. **No new batch engine; none is allowed.**
- Pure halves already waiting: `tax-governance.governedFromRows` / `jurisdictionOf`, `govresolve.verticalStatements`, `stocked.FLAGS_SQL`, `offerFromRow`,
  `catalogue-build.resolve` (pure after its source is loaded), `network-offers.forFinishes` (already "no foreign owner → no read").
- Tell the seams owner (cb-docs): index `db/index.js` exports so the next search finds `readBatch`.

## 2. What one `buildPublicView` reads today (the inventory behind (a))

RLS class decides what can travel together. `FORCE`-RLS tables read as `entity_id = current_setting('app.current_entity')`; `identities`, `entity_schemas`,
`schema_fields`, `catalogue_source`, `product_container`, `product_version`, `cb_entity` are not in `RLS_TENANT_TABLES` (plain `query()`).

| # | read (lib) | table, RLS | ticks | depends on |
|---|---|---|---|---|
| 1 | gate: `catalogueVisibility` | identities, plain | 1 (+1 `sameNetwork` only when tier = network AND a viewer; anonymous → 0) | – |
| 2 | schema + fields | entity_schemas, schema_fields, plain | 2 serial | schema_id |
| 3 | face (`getFace`, again inside `readShelf`) | catalogue_face FORCE | 1 + 1 (`readBatch` each) | – |
| 4 | `schedule.applyDue` (view) and again `applyDue(db)` in `readShelf` | catalogue_item_schedule FORCE | 1 tx + 1 (inside shelf tx); **a WRITE when due** | – |
| 5 | items | catalogue_items, `withEntity(null)` (public policy) or owner | 1 tx | applyDue |
| 6 | policy flags `policy.get` | identities, plain | 1 | – |
| 7 | adoptions | catalogue_adoption FORCE | 1 tx | – |
| 8 | storefront mode / policy_flags / country | identities, plain | 1 | – |
| 9 | ledger `stock-store.onHand` (`sheet`, then `notCountedAmong`: `verticalOf` readBatch + FLAGS_SQL tx) | stock_balance, product flags FORCE | 1 tx + 1 + 1 tx | item ids, sheet kinds |
| 10 | `liveOffers(all)` | definition, definition_version FORCE | 1 tx | – |
| 11 | `readShelf`: defs + gstn (+ governed slabs: `jurisdictionFor` identities read, `regionLayer`) | definition FORCE, identities | 1 tx + 1 + 1 | – |
| 12 | categories | definition FORCE | 1 tx | – |
| 13 | presence | identities (children), plain | 1 | – |
| 14 | `catalogue-build.resolve` per adoption (`loadSource`) | catalogue_source ⟕ identities, plain; **`network-catalogue.applyIfDue` is a WRITE when a publish is pending** | 1 per adoption | adoption rows |
| 15 | `container.resolveMany` | product_container, product_version, plain | 2 | resolved items |
| 16 | `network-offers.forFinishes` | identities, definition FORCE under the BRAND | 0 if all adoptions are own; else about 3 | finishes |
| 17 | `groupsOf` | customer_list FORCE | 0 anonymous (returns [] before any read) | viewer |

Observation the plan rests on: `identities` is read **five times** for one member (rows 1, 6, 8, 11 country, 11 gstn) and the face twice and `applyDue` twice. A
single-member storefront open also pays these; the bundle removes them for it too.

## 3. (a) The prefetch: what goes in, per lib, and what cannot

Principle (this is what makes the answer byte-identical): **each lib keeps its one SQL text and gains one pure reducer; the old path and the bundle path run
the SAME text and the SAME reducer.** No second formula, no second query shape. `pre` carries rows; libs reduce them.

Four stages, each ONE `readBatch` for all members (a statement per member per read, same SQL text as today, own `entity` per statement). A stage exists
only because the next read needs the previous answer.

| stage | what | per lib: SQL stays / reducer split out |
|---|---|---|
| **A** (the gate alone) **[R1]** | ONE plain read of the identities row per member, gate columns only (catalogue_visibility, plan, params_override, bridge_id, business_status); no tenant table, no schema, no probe. The other identities columns (policy_flags, self_copy_pref, storefront_access, country, gstn) ride in B for survivors only | `catalogue-view.catalogueVisibility` takes the row (`gateOfRow`, pure: today's cap/closed/network logic); `policy.readFlags` → `policy.fromRow(row)` (its `applyStored` is already pure); `tax-governance.jurisdictionOf` exists |
| *gate in JS* | members the gate refuses (private/closed/capped/network-not-same) are dropped **before stage B**: a private shop still costs nothing and reveals nothing (the file's standing rule, catalogue-view.js:240) | `sameNetwork` stays a per-member query, only for tier network with a viewer |
| *B0 · the probe* **[R1]** | for SURVIVORS only: the default entity_schemas row and the due probe (gated on `schedule.enabled()`, `LIMIT 1`, under the member's entity). A member with a due row runs `schedule.applyDue(entity)` (a write, per shop, claimed once by PR #1138) and then reads its own items AFTER it (one extra read for that member only) | unchanged |
| **B** | per surviving member: the rest of the identities columns; schema_fields; face; items (entity `''`, the public policy, owner variant not used by bulk callers); adoption rows; `stock_balance` sheet (only if `hasTable` cached true); `liveOffers` rows; categories rows; shelf defs; `verticalStatements`; presence; `regionLayer` once per distinct country | `stock-store.sheet`/`onHand` → SQL + `foldSheet(rows)`; `liveOffers` → rows + existing `offerFromRow`; `tax-shelf.readShelf` → `readShelfRows` + `shelfFromRows` (the pure half exists in its tail); `governedFromRows` |
| **C** | needs B: product flags (`FLAGS_SQL`, ids from items and sheet kinds); `loadSource` per (adoption source, member) | `stocked.flagsFor` → `FLAGS_SQL` + `answerFor` (exist); `catalogue-build.loadSource` row → `sourceFromRow` |
| **D** | needs C: `product_container` + `product_version` for the ids of ALL members in two statements (plain tables, `ANY` is safe and dedupes shared sources); brand offers once per distinct brand (entity = brand, the EFF-TRIPS precedent) | `container.resolveMany` → ids in, rows reduced by its existing body; `network-offers.forStore` reads grouped by brand |

Cannot be prefetched, and why (each stays per member, only in the exceptional member):
1. `sameNetwork` (tier network + signed-in viewer): depends on the viewer and the gate; the anonymous network front never reaches it.
2. Members with a DUE schedule row: they must apply before items are read (a write). Per-member `applyDue`, as today.
3. Members whose adopted source has a PENDING network publish (`loadSource` row `pending` non-null): `network-catalogue.applyIfDue` is a write on read; that source takes today's per-source path.
4. `groupsOf` with a viewer (`customer_list` FORCE, depends on viewer and seller): per member as today; anonymous reads cost 0 already.
5. Anything a stage throws on (a table not migrated: the batch is one transaction and fails whole, EFF-TRIPS (b)): the **whole bundle is abandoned and every member takes today's path**, logged by `log.fellBack`. Answers stay identical; cost returns to today's. Never a half bundle.

`buildPublicView({ ..., pre })`: `pre` = that member's slice (`{ idRow, schemaRow, fields, face, items, adoptions, sheet, offers, categories, shelfRows, vertical, flags, sources, containers, ... }`).
Each read site becomes `pre ? reduce(pre.x) : await readAndReduce()`. Without `pre` the function is byte-for-byte today's behaviour.

## 4. (b) `schedule.applyDue`: the write on the read path

Today: lazy apply by whoever reads first after the due moment (schedule.js header: "no clock, no worker, no second copy of the product"; `catalogue_item_version`
records the change with `applied_at`). Cost for a bulk reader today: `applyDue(entity)` with no client = a transaction (1 tick, 4 wire) per shop, even when nothing
is due, plus a second `applyDue(entity, db)` inside `readShelf`.

Industry practice (searched 2026-11-12; sources are vendor docs and community pages, read as such):
- **Odoo**: a price rule's start/end date is a read-time filter on the order or quotation date; nothing is written when the date passes ("the system applies first prices that match the order date",
  [Odoo 10 pricing doc](https://www.odoo.com/documentation/user/10.0/sales/products_prices/prices/pricing.html); validity period on the pricelist, [Odoo 17](https://www.odoo.com/documentation/17.0/applications/sales/sales/products_prices/prices/pricing.html)).
- **SAP SD**: a condition record carries valid-from / valid-to; pricing takes the record whose validity covers the pricing date ([SAP Learning: condition records for sales prices](https://learning.sap.com/courses/implementing-sap-s-4hana-cloud-public-edition-sales-configuration/managing-condition-records-for-sales-prices)). Also read-time, no write.
- **Shopify**: Launchpad runs a scheduled event that applies price changes at its start time and reverts them at the end ([Shopify App Store: Launchpad](https://apps.shopify.com/launchpad)); a timer/job model, a write at the moment.

Our model is a third thing: read-time trigger, write on apply. Odoo/SAP can skip the write because the price is a dated row; ours patches the product and versions it
(judgeDue re-checks the rules at the moment, status stamps, version row), so an overlay would be a **second calculation** of the effective item: refused.
A timer (Shopify) is a new moving part the product decided against ("there is no cron anywhere" ctptransport.js:28; schedule.js header).

**Decision proposed (Athi's, via cb-critic): keep lazy apply; make the probe part of the batch, and apply per member only when due.**
- The probe is `SELECT schedule_id FROM catalogue_item_schedule WHERE entity_id=$1 AND applied_at IS NULL AND cancelled_at IS NULL AND effective_at <= NOW() LIMIT 1` (the existing SQL, narrowed), a statement in B0 (survivors only, after the gate) under the member's entity.
- Nothing due (the case for almost every member, almost always): zero extra ticks. Members with a due row: today's `applyDue(entity)` once, per shop, before B. After it, the row is applied, so the next reader pays nothing: the worst case is ONE per-shop write sequence per due moment, not one per read.
- The second `applyDue(db)` inside `readShelf` is dropped on the bundle path (B0 already guarantees none due for a survivor; the window between B0 and B is the same few milliseconds today's two calls already leave open).
- **Claim first (critic MUST 3, a live bug on main found by the critic, fixed by PR #1138 `cat/schedule-apply-claim`):** the old probe took no lock and the stamp had no `AND applied_at IS NULL`, so two readers at one due moment BOTH applied the parked patch (the second over the owner's later edit, plus a second version row). "Once per due moment" is true only after #1138: the probe is `FOR UPDATE SKIP LOCKED` and the stamp is guarded. **S2 must not land before #1138.**
- **Cost of keeping it per shop for due members:** 4 wire trips plus the writes per due member, once. For 39 members all due at the same moment: up to 39 writes on the first anonymous GET after the moment; same as today, and not on every request.
- Alternative kept as an option, not recommended: a sweep (`setInterval` like `books-nightly.js`) calling `applyDue` for entities with due rows. It moves the write off the reader but adds a worker and a leader question on 2 api instances. Raise only if first-read latency after a due moment shows up in the walk.

The same rule covers `applyIfDue` on a pending network publish (row 14): detect in the row, per-source path only for the exception.

## 5. (c) RLS identical, no widening

1. **Each statement carries its member's entity**: `{ text, params: [member], entity: member }`. Every table that is FORCE-RLS today is read under the same
   binding it has today (`withEntity(entity.identity_id, …)`); the items read keeps `withEntity(null)` semantics via `entity: ''` (readBatch's `s.entity !== null` accepts `''`), so the
   public visibility policy still decides which rows a stranger gets (not `= ANY(members)` on a tenant table: only on the plain tables, rows 14–15).
2. The bundle is a `Map` keyed by member id built from an array of `[member, kind]` aligned with the results; `pre` for member X is only ever X's slice.
3. The members are the ones the route already resolved and capped (`MAX_DEPARTMENTS`, `visibleShopsOf`); the builder takes shop rows, never ids from the request.
4. The gate is stage A alone **[R1]** (identities, a plain table, gate columns) and drops members **before** B0/B: nothing of a private/closed/capped member's tenant rows (schedule, schema, face, items) is read, as today (catalogue-view.js:240). The first draft put the probe and the schema row in A for everyone; that broke this rule and is withdrawn.
5. **Proof, a test, not a claim (`tests/net-98-scope.test.cjs`):** a recording stub for `db.readBatch`/`withEntity` logs `(entity binding, table, normalised SQL text hash)` for the OLD path and for the
   bundle path over the same fixtures; assert the multiset of (binding, SQL hash) of the bundle is a subset of the old path's (no table read, no binding, no text the member's own scope did not
   read before), that no tenant-table statement lists more than one entity, **[R7]** that every tenant statement itself carries `entity` and `params[0] === entity` (a statement without `entity` silently inherits the previous member's binding, db/index.js:369), and that a gated-out member has zero tenant statements. Mutation: put member B's entity on A's `catalogue_adoption` statement → the test fails.
6. A realstack case on a cb_app role (not superuser) with two members and a third private one: bundle answer equals old answer, and the private one's tenant tables are never in the log.

## 6. (d) readBatch literal inlining and member ids

Read `db/index.js:342-364`. Strings go through `pg.escapeLiteral` (doubles quotes, doubles backslashes and emits `E'…'` when a backslash is present; independent of `standard_conforming_strings`);
numbers must be finite; booleans; Dates ISO; arrays only of strings (`ARRAY[…]`); anything else throws before the text is built. `$n` is replaced in ONE pass by a callback (a value containing `$2` is not re-scanned).
The one-statement guard (`;` followed by SQL after literal stripping) is belt-and-braces: its `'[^']*'` strip is correct for `escapeLiteral` output (checked on `a\';x` → `E'a\\'';x'`).
Residual risks and the answers:
- A NUL byte in a string: not escaped by `escapeLiteral`; Postgres rejects it → the batch errors → whole-bundle fallback (5.5). Not an injection.
- **Member ids never come from the request**: they are `identities.identity_id` / `cb_entity.bridge_id` rows. Still, the builder **refuses to batch** a non-uuid entity (regex check, one helper) and falls back; item-id arrays in stage C come from `catalogue_items.item_id` uuids, cast `::uuid[]`.
- Add to the existing pure inliner test (`readBatch's inliner`): hostile member ids (`'; DROP TABLE x;--`, `\'`, `$1`, `E'`), proving each is either a single literal or refused.
- Statement size: 39 members × about 12 statements is about 470 statements plus an entity switch each (about 940 texts) in one message; the response is the same data as today. **[R4] `readBatch` has no deadline today**: its head is a plain `BEGIN` (db/index.js:376), not `beginSql()`; the pool-connect `SET statement_timeout` is session-level and a transaction pooler may drop it, and Postgres times a multi-statement simple message as ONE statement. Before S2 (its own small PR, S0): put `SET LOCAL statement_timeout` on the head (same trip) so every readBatch caller has a cap; run the callers' tests (getFace, verticalOf, entity-header, work-rows, network-offers); a 57014 goes to the whole-bundle fallback, never a retry.
- **[R5] `PREFETCH_CHUNK` is in S2**: chunk by statement count (about 150 per message), decided with the sit-au bytes. Stage C item-id arrays can be large (about 90 KB of literal for a 2,000-item shop), so the flags SQL uses `item_id IN (SELECT item_id FROM catalogue_items WHERE entity_id = …)` or dedupes ids instead of inlining the list. Each extra chunk is one tick and is counted in the ceilings.
- **[R2] Typing**: readBatch inlines arrays as `ARRAY['…']` (text[]), so every reused SQL written for a bound param (`= ANY($1)`, FLAGS_SQL, `resolveMany`) must carry `::uuid[]` (or `::text[]`) on each array, or the batch fails `uuid = text`. Only the real-Postgres differential (section 8) catches this; a stub cannot.

## 7. (e) Expected trips (ticks; wire equals ticks for batches)

Per-route fixed part: members resolved in one read (replaces one `resolveEntity` per member; see the note below), the tree read, then A, B, C, D.

| route | members | today | after S2 (about) | after S3 | ceiling for the budget test |
|---|---|---|---|---|---|
| GET /network/:bridge_id | 3 | 56 | about 25 | **7** (root resolve 1, treeOf 1, members 1, A, B, C, D) | 10 |
| same | 39 | 706 | about 220 | **7** | 12 |
| POST network-store/:id/order | 39 | 831 | about 230 | **10** (brand resolve, members, liveShopsOf, ids read, A–D) | 14 |
| GET /:bridge_id (one storefront) | 1 | about 18 | about 6 | **6** (A–D + resolve) | 8 |

Plus 1 per exceptional member (due schedule, pending publish, network tier with a viewer). The "after S2" figures are estimates (residual per member: stage C/D reads about 5 to 8);
the proof is the sit-au run, not this table. **[R9] Interim ceilings for S2** (the 7, 10, 12, 14 figures hold only after S3): network GET 30 at 3 members, 260 at 39; network-store 270 at 39; storefront 10 at 1 member; each set from the sit-au run plus 1 per exceptional member. 12 at 39 members after S3 tolerates only 5 exceptional members, so the final ceiling is also set from the run, not from this table. The ceiling is the number in `round-trips.budget.json` (the 706 row's `basis` becomes the new measured run; the fixture row for network-store
is 26 today). Wire drops further than ticks: a tick that was a transaction (4 wire) becomes a batch statement (0 extra).

Members note: today the network loop calls `resolveEntity(bid)` (bridge_id OR lower(user_id), exact bridge first). The batched read is `liveShopsOf`-shaped (`bridge_id = ANY`). They differ only when a LIVE bridge's id is also another account's user_id and the bridge itself is not live (today the other account is served: a latent mix-up). Declared, tested, and a deliberate narrowing.

## 8. (f) Slices (each lands alone; byte-identical answers on 3 and 39 members)

**Differential harness (in S1, used by all) [R2].** Two levels. (i) **Real Postgres, the proof**: `tests/net-98-differential.realstack.cjs` creates `CREATE DATABASE … TEMPLATE cb_local` (local stack, port 55432), connects as `cb_app` (NOBYPASSRLS), seeds the fixtures through `withEntity`, **freezes the clock** (`availability.withLedger` stamps `new Date()`, catalogue-view ~:300, so output is not byte-stable otherwise; the due probe uses a fixed `effective_at`), runs the OLD path and, from S2, the bundle path, and compares `JSON.stringify` per member and for the assembled network front. (ii) a stub-db unit level for the pure reducers only. The "missing table" fixture is NOT evidence of equality (the batch fails and the old path answers: circular); it is a fallback case only. Fixtures of **3 and 39 members**
covering: public, private, closed, over-cap, network-tier (anonymous and a same-network viewer), sign-in-first, unavailable item, qty-zero-hides, own and adopted sources, a foreign-owned adoption with brand offers, a due schedule row,
a retired and a pending network publish, **the same adopted source in two members (shared-object aliasing: `items` is mutated in place at catalogue-view.js :328-:348 and `r.item_data =` at :381, so a shared parsed object must not leak between members)**, a member with null policy_flags, **members in reverse tree order**, **the non-live-bridge / user_id collision [R8]**, a shop with no GSTIN, a shop with a connector, and (fallback only) an unmigrated table. Assertion: `JSON.stringify(oldPath) === JSON.stringify(bundlePath)` for each member and for the assembled network front.

- **S0 · readBatch deadline [R4]** (own PR, before S2): `SET LOCAL statement_timeout` on the head; callers' tests green; a unit asserting the head text and that a 57014 surfaces as an error the caller falls back on.
- **S1 · split the libs, no behaviour change.** Each of policy, stock-store, stocked, tax-shelf, liveOffers/categories, catalogue-build.loadSource, container.resolveMany, catalogue-view.catalogueVisibility exposes its SQL constant and its pure reducer; the old paths call them. No `pre`, no route change, budget unchanged.
  Tests: a unit per reducer (row in, answer out, the old cases), the existing suites green, the real-Postgres differential landed with the old path only (it pins today's answers for 3 and 39 members and the fixtures above), **[R10] a one-reducer guard**: each reducer has exactly one definition and the old path imports it (a grep test over lib/ that fails on a second definition or a re-implementation of the same SQL). cb-maintainability reviews (readability ratchet, fn-size). Value alone: five identities reads become one reducer each, the face and `applyDue` duplicates named.
- **S2 · stages A and B, `pre` into `buildPublicView`, the network GET.** `lib/catalogue-prefetch.js` (`prefetchViews(shops, opts) → Map`, the stage builders, the uuid refuse, the whole-bundle fallback); `buildPublicView` accepts `pre` **[R10]** through ONE `viewInputs(pre | reads)` function (no `pre ? … : …` branches scattered through the already oversized function); **[R6]** failure kinds are memoised (a missing table is learned once via `hasTable`, as `stock_balance` already does; the probe is gated on `schedule.enabled()`), so an unmigrated table never fails the batch on every request (a failed batch costs the batch plus today's path, and pg-pool destroys the errored connection); GET /network/:bridge_id and `publicItemsOfShops` use it; the due probe and per-member `applyDue`.
  Tests: differential at 3 and 39 (identical), scope test (5.5, with its mutation), hostile-id inliner cases, fallback case (a missing table), due-schedule case (applies once, second read pays 0), `PREFETCH_CHUNK` by statement count, a trips test counting ticks at 3/39 against the interim ceilings (section 7), the resolveEntity narrowing **[R8]** stated as a FIX in the PR (today a non-live bridge whose id equals another live account's user_id serves that account on the network front; the batch serves nobody; tree order, the root skip and `slice(0, 40)` kept; test added), payload-size note from sit-au. Budget row for GET /network updated with the new live basis; api-register re-signed (signed route body changed: cb-api).
- **S3 · stages C and D, the other callers, the budget.** Product flags, sources, containers across members, brand offers once per brand; GET network-store, POST network-store order (`orderableOf`), and the single storefront `GET /:bridge_id` (a bundle of one) take the bundle; `ctpquery` and `relationships.js:603` adopt it where they loop.
  Tests: differential extended, trips ceilings in `round-trips.budget.json` (network 12, network-store 14, storefront 8), a sit-au run attached as the proof (not a green re-run: the 706 and 831 rows re-measured). Twin: none (api only; web reads the same JSON).

Order is by risk: S1 is a refactor with no route change; S2 is the big win with the fallback as the net; S3 widens callers once S2's differential has held.

## 9. (g) Who else benefits

`buildPublicView` callers (grep, not seams): `routes/catalogue.js` (`publicViewFor`: GET /:bridge_id storefront, GET /network/:bridge_id, GET and POST network-store, `orderableOf`),
`lib/ctpquery.js` (CTP pull returns exactly the storefront answer), `routes/entities.js:1228` (publish check), `routes/relationships.js:603` (supplier catalogues, a loop over suppliers).
A bundle of one still removes the 5 identities reads and the duplicate face / `applyDue`, so the storefront open itself drops from about 18 ticks to about 6.

## 10. Risks, and the checks that answer them

- A reducer that drifts from the old read: both paths call it; differential test.
- A batch statement that widens scope: the scope test with its mutation (5.5).
- One failing statement poisoning a transaction: the whole bundle falls back (5.5); a test per optional table (`stock_balance`, `catalogue_item_schedule`, `catalogue_face`) unmigrated.
- The answer to an unauthenticated GET still writes (apply) for due members: unchanged, now bounded to once per due moment per shop and visible in the log.
- The 40-member cap and the `truncated` report stay as they are.
- Sizes: nothing here changes what a response contains; Athi's O(1)-per-shop rule becomes O(1) per route plus O(exceptions).

## 11. Verdict

**BUILD WITH CHANGES** (changes are the plan itself): reuse `readBatch` with per-statement entity (no new engine); reducers shared by both paths; gate before data; lazy `applyDue` kept with a batched probe; whole-bundle fallback; three slices.
Open question for Athi (functionality, not code): none blocks S1/S2. The sweep-timer alternative in section 4 stays unbuilt unless first-read latency after a due moment is seen in a walk.

## 12. Revision log (critic, 2026-11-12)

- MUST 1: stage A is the identities gate columns only; probe and schema row move to B0 for survivors; a due member applies, then re-reads its items. (sections 3, 5.4)
- MUST 2: differential on real Postgres (TEMPLATE copy of cb_local, cb_app, frozen clock), ARRAY typing and shared-source aliasing fixtures, the fallback case demoted. (sections 6, 8)
- MUST 3: applyDue claim is PR #1138, a prerequisite of S2; the plan's "once per due moment" depends on it. (section 4)
- MUST 4: S0, `SET LOCAL statement_timeout` in readBatch before S2. (sections 6, 8)
- SHOULD 5 chunking in S2; 6 memoise failure kinds and gate the probe on enabled(); 7 scope test asserts `entity` and `params[0]`; 8 resolveEntity narrowing stated as a fix; 9 interim ceilings; 10 one-reducer guard and `viewInputs`.
- The Odoo, SAP and Shopify citations came from search snippets and were not re-fetched; read them as unconfirmed.

## 13. S2 gate list (what must be green before S2 lands)

1. PR #1138 (applyDue claim) landed. 2. S0 (readBatch `SET LOCAL statement_timeout`) landed. 3. S1 (#1140) landed, including **`tests/net-98-differential.realstack.cjs` reproducing its golden (written by origin/main code) with the bundle path switched on, at 3 and 39 members, identical**, and the one-reducer guard checking call sites outside comments. 4. The scope test (5.5) with its mutation. 5. Interim ceilings (section 7) set from the sit-au run.

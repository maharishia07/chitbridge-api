# SEC-75 · entity_schemas + schema_fields: the closing design (DRAFT r2, no build)

Date 2026-11-14 · owner cb-security · r2 after the critic's CHANGE (PR #1291 comment 6872751525) · source: origin/main fd5193a3 and db/rls-baseline.json (api #1288 branch `db/rls-class-fix-1114`).
Standards: OWASP API1 (broken object-level authorization), PostgreSQL row security (FORCE, per-command policies), the b857 definer pattern (`ops` schema, `search_path=''`, grants to cb_app only).
**Landing order: api #1275 (SEC-185) first.** `queryAs` (db/index.js:414) and tools/identities-sweep.cjs exist only there (still OPEN). This design builds on both and duplicates neither.

## 1. The problem
Both tables are class `entity` in db/rls-baseline.json with RLS OFF and 0 policies. Any statement as cb_app can read or edit every shop's schema and column declarations.
A SQL-only close would make every plain `query()` (no `app.current_entity`) return 0 rows for non-public shops, so the reads must be moved, or given a narrower door, first. Code ships before the policy file (the b842 / b851 order).

## 2. Call sites (re-grepped on origin/main fd5193a3; each site's branch and pipeline read, not only its name)
Classes: OWN = the predicate names the caller's shop (bind). OWNER-BRANCH = own shop on one branch only (bind that branch). PUBLIC = any shop's public rows (the policy serves it, no bind). DEFINER = needs existence or two values of another shop (narrow door). OPERATOR = the platform writes another shop's row.

**OWN-SHOP, bind with `queryAs` / `withEntity(shop)` (31 statements):**
- lib/catalogue-columns.js: readDeclaration :264/:267, commitFields :283 :295 :303, resolveColumns :423 = 5. `query` is injected, so the callers are the real sites: products.js :360 :956 :1265 :1290 :1494 and schemas.js :90 must pass a bound `query` (a plain one returns empty rows silently).
- lib/catalogue-write.js :36 (defaultSchemaId) :52 (schemaFieldsOf) = 2 · lib/schema-bootstrap.js :41 :80 :104 = 3 (a new shop writes its own first schema)
- routes/schemas.js :41 :85 :100 :183 :206 :235 :244 :263 :300 :375 :395 = 11 (`auth` routes, shop = `auth.entityOf(req)`)
- routes/products.js :285 (the duplicate defaultSchemaId, see below) :1282 :1432 = 3 · routes/assist.js :677 :697 :723 = 3 (a help desk reads its own Q&A schema; the desk id is the shop bound)
- routes/catalogue-face.js :48 = 1 (`es.entity_id = $1`, `e = ent(req)` on an `auth` route; the baseline `why` called it cross-shop, it is not). It ends in `.catch(log.orElse(..., { rows: [] }))`, so a binding miss would be silent: keep the log line and test it (section 4).
- routes/chits.js :2447 sendFreeze (`sender_id = entityId(req)`, own; also not cross-shop) = 1
- routes/till.js :571 readDeclared = 1 (catch-to-`[]`, same rule; hot path, so `queryAs`) · routes/entities.js :1240 = 1
- Callers of the shared helpers that move with them: defaultSchemaId at products.js :359 :410 :684 :954 :1423 :1598 :1665, adopt.js :202, combo-templates.js :153 :184 (via `productsRouter.defaultSchemaId`); schemaFieldsOf at products.js :317 :1251 :1304 and catalogue-write.js :136 :171.

**OWNER-BRANCH (1 site, 2 statements):** lib/catalogue-view.js :300 and :308 (buildPublicView). With `asOwner` the statement drops `visibility='public'` and reads the caller's OWN shop, which may be private (the gate at :287 admits the owner's preview); `query` is injected. Unbound under RLS the owner's preview of a private catalogue returns nothing. Fix: the `asOwner` branch runs bound to the owner (`queryAs` / `withEntity(owner)`); the public branch stays unbound and is served by the public policy. :308 reads the `schema_id` found by :300 in the same pipeline, so both take the same binding. Test: the owner's preview of a private shop returns its schema and its columns.

**DEFINER (narrow doors; no public route is ever bound as another shop):**
| # | site | what it needs | door |
|---|------|---------------|------|
| 1 | lib/business-search.js:126 | "has this listed shop a default catalogue": an EXISTS in a search over other shops | `ops.shop_has_catalogue(uuid)` |
| 2 | routes/relationships.js:304 (inside `withEntity(owner)`) | the supplier's `has_catalogue` flag | same |
| 3 | routes/relationships.js:575 | same flag | same |
| 4 | routes/catalogue.js:1628 order freeze (A10) | the shop's active default `schema_id` and `schema_version` | `ops.shop_default_schema(uuid)` |

**Q1 is answered YES.** `shopFor` is `resolveEntity(bridge_id)` (routes/catalogue.js:623, used at :1190 and :1410) with no visibility gate. Only the commerce pipeline is held to public, because `repriceAgainstCatalogue` reads items under `withEntity(null)` (:237). The `payload` pipeline (forms, enquiries) never reprices, so a private shop can be ordered from. Under the policy the freeze read would return 0 rows and `frozen_schema_id` would silently become null (freeze-at-send A10 lost). Binding the public route as the shop would reopen a cross-shop door, so: a second narrow definer.

**OPERATOR WRITE (1):** lib/network-build-run.js :514 `mirrorSchema`: `UPDATE entity_schemas ... WHERE entity_id = (SELECT identity_id FROM identities WHERE bridge_id = $2)`. Two problems under RLS: it writes ANOTHER shop's row, and the subselect reads `identities`, which #1275 puts under RLS (it sees no row, so the UPDATE changes 0 rows with no error; the catch only swallows 42703/42P01). Fix: pass the identity id the build run already holds for the node into `mirrorSchema` and run the UPDATE in `withEntity(thatShop)`; if a path lacks the id, take it from the b857-style lookup, never a bare `identities` read. No new write door, no BYPASSRLS.

**One helper, not two (`defaultSchemaId`).** lib/catalogue-write.js:34 and routes/products.js:283 hold identical SQL (products.js re-exports its copy at :1544 for combo-templates). Plan: delete the products.js copy, keep the lib one, have products.js, combo-templates.js and adopt.js import it, and bind ONCE inside it (`queryAs(entity_id, ...)`).

**`schemaFieldsOf(schema_id)` has no shop** (catalogue-write.js:48), so it cannot be bound as written. New signature `schemaFieldsOf(entity_id, schema_id)`; every caller passes the shop it already holds. Where a caller does `defaultSchemaId` then `schemaFieldsOf` back to back (catalogue-write.js :136 and :168-171, products.js :359-360), one `defaultSchemaWithFields(entity_id)` returns both in a single bound trip.

**Scripts.** scripts/reference-stores.cjs:175 (`UPDATE entity_schemas SET visibility='private'`, via `c.query`) and scripts/reset-and-seed.js:312 (`DELETE FROM schema_fields`, via `db.query`) would change 0 rows with no error as cb_app. They are local and SIT seed and reset tools, run as the owner role (postgres), never against production; each checks `current_user` at the top and refuses to run as cb_app (reference-stores may bind per store with `withEntity` instead). scripts/WIPE.sql, cleanup-2-delete.sql and cleanup-test-entities.sql are SQL for Athi run as postgres (bypasses FORCE): unchanged. The sweep covers `scripts/`.

**DB functions touching the tables as invoker:** create_from_blueprint, is_instance_of, is_helpdesk. No JS caller on origin/main. They are fine only as the table owner; a cb_app caller would have to be bound or made a definer, and the sweep lists the names so it is noticed. No view references the tables (cb_catalogue_liveness does not).

**Total:** 31 own + 2 owner-branch + 1 operator write + the definer reads (sites 1-4), in 19 lib/route files plus 2 scripts. About **28 test files** name the tables, and **tests/fixtures/send-golden.json pins the freeze SQL 26 times** (section 4).

## 3. The one closing design
**Policies** (literal statements, db-85 rule). The b851 two-policy split, so a write stays own-only:
```
entity_schemas : ENABLE + FORCE
  rls_entity                 FOR ALL    USING / WITH CHECK  entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
  entity_schemas_public_read FOR SELECT USING               visibility = 'public' AND status = 'active'
schema_fields  : ENABLE + FORCE   (no shop key of its own: it follows the parent)
  rls_entity                 FOR ALL    USING / WITH CHECK  EXISTS (SELECT 1 FROM entity_schemas s WHERE s.schema_id = schema_fields.schema_id
                                                                    AND s.entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  schema_fields_public_read  FOR SELECT USING               EXISTS (SELECT 1 FROM entity_schemas s WHERE s.schema_id = schema_fields.schema_id
                                                                    AND s.visibility = 'public' AND s.status = 'active')
```
The baseline `why` says one policy `entity_id = current OR visibility = public`. A single FOR ALL policy lets USING on UPDATE and DELETE reach another shop's public row (the b851 finding on catalogue_items), so the public clause is a separate FOR SELECT policy; the `why` is rewritten when the fix lands.
**Broader than b851, on purpose.** catalogue_items_public_read also requires `is_default`; this one does not, so a public active non-default schema is readable. That is right (the shop window shows it) and is stated here so it is not read as a slip. A `draft`, `restricted` or `private` schema is never readable across shops.
**Column exposure.** The policy is row-level, and schema_fields also carries default_value, xref, via and leg. "The public columns are public anyway" holds only because catalogue-view selects six explicit columns (:308). A guard (T8) fails if any route returns `SELECT *`, or those columns, from a row that is not the caller's.

**Definers (b857 form), created and owned by postgres (the role that bypasses FORCE):**
1. `ops.shop_has_catalogue(p_entity uuid) RETURNS boolean`, `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`, body `SELECT EXISTS (SELECT 1 FROM public.entity_schemas WHERE entity_id = p_entity AND status = 'active' AND is_default = true)`.
2. `ops.shop_default_schema(p_entity uuid) RETURNS TABLE (schema_id uuid, schema_version <the column's type>)`, same attributes, body `SELECT s.schema_id, s.schema_version FROM public.entity_schemas s WHERE s.entity_id = p_entity AND s.status = 'active' AND s.is_default = true ORDER BY s.created_at DESC LIMIT 1` (the exact filter and order of catalogue.js:1628). Two values, never a name, a column or another row.
Both: fully schema-qualified, no dynamic SQL; `REVOKE ALL ... FROM PUBLIC, anon, authenticated` in the same transaction as the CREATE; `GRANT USAGE ON SCHEMA ops` kept; `GRANT EXECUTE ... TO cb_app` only; `ops` is not an exposed PostgREST schema (Athi confirms, as for b857). Callable by any bound shop for any uuid: that is today's `has_catalogue` meaning and today's freeze read, not a new door. Perf: the per-row call in the business-search predicate is an index hit on idx_entity_schemas_default (entity_id, is_default); noted in the perf check.

**Own-shop sites** use `queryAs(shop, sql, params)` (#1275: `set_config` and the statement in one simple-protocol message, one trip, no BEGIN/SET/COMMIT) by default, and `withEntity(shop, ...)` only where several statements need one transaction. Write sites keep `entity_id = $n` in the SQL (name the predicate as well as relying on RLS).

**Shipping order. No "fallback while the function is missing":** it cannot run inside `withEntity` (relationships.js:304 is inside `withEntity(owner)`, and a missing function aborts the whole transaction). Instead the functions go first, alone, where they are harmless, and the deploy fails without them (the #1275 boot-check lesson).
0. api #1275 lands (queryAs, identities sweep, boot check).
1. `migrations/RUN-<date>-bNNN-entity-schemas-fns.sql`: the two definers only. AS postgres, SIT first. Harmless without the policy.
2. PR A, code: the own-shop binds, the owner-branch split, the definer sites call the functions, defaultSchemaId collapsed, schemaFieldsOf signature, scripts guarded, the widened sweep. A boot check (lib/db-role.js style) refuses to start if either `ops.shop_*` function is missing.
3. Deploy.
4. `migrations/RUN-<date>-bNNN-entity-schemas-rls.sql`: the policies, AS postgres, SIT first, run at sweep 0. The RUN- prefix keeps CI fresh-db from auto-applying either file (b797 and #1275 precedent); the fresh-db job applies both explicitly, functions first.
**Rollback drill** (rehearsed on SIT before production, then the suites must be green): `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` on both tables (step 1: always safe, the code needs no policy), then `DROP FUNCTION` on both (step 2: only with the previous code release, since PR A calls them). The footer of the RUN file carries both statements.

Rejected: a public VIEW with an explicit column list (a view runs as its owner and bypasses RLS, the same effect as a definer, and it would have to serve catalogue-view's join). A BYPASSRLS role (refused at boot, lib/db-role.js). Binding a public route as the shop (reopens a cross-shop door). Leaving the tables open (class `entity` stays owed).

## 4. Proof
**DB layer** (rls-context style): tests/rls-fresh-db.test.cjs and tests/rls-sec75-tables.cjs. Both tables join the list (`entity_schemas: { key: 'entity_id', cols: {} }` for the generic probe, plus a shared-style block like catalogue_source for the public clause). Fixture per shop: a public, a restricted and a private schema, plus one public `draft`.
- T1 shop A bound sees its own schema and fields (positive control), not B's private ones (unique canary in B's field_name).
- T2 shop B bound reads A's `public` active schema and fields but NOT A's `restricted` or `private`.
- T2b a public schema with `status='draft'` is unreadable by B, fields included.
- T3 B cannot UPDATE, DELETE or INSERT an entity_schemas row carrying A's entity_id, public or not. Prove it red by temporarily making the public policy FOR ALL.
- T4 (corrected) an UNBOUND read returns exactly the public active rows and nothing else, because `public_read` needs no binding; "0 rows" holds only for non-public rows. An unbound INSERT fails (fail closed).
- T5 `ops.shop_has_catalogue`: true for a private shop with a default schema, false for none, one boolean; EXECUTE denied to anon, authenticated and PUBLIC; same answer for a caller bound to a third shop. `ops.shop_default_schema`: schema_id and schema_version for a private payload-pipeline shop, no row for none, only those two columns, same grants.
- T5b function property checks from the catalog: `prosecdef` true on both; `proconfig` holds `search_path=""`; the result type is `boolean` for the first and the two-column table for the second; `proacl` names cb_app and no PUBLIC, anon or authenticated.
- T6 schema_fields INSERT: B cannot insert a field under A's schema_id (the FK check bypasses RLS, so WITH CHECK refuses it).
- T6b schema_fields UPDATE and DELETE: B cannot update or delete a field under A's schema_id, public or not; the red-on-FOR-ALL probe is repeated on the schema_fields public policy.
- T7 b851's `catalogue_items_public_read` still lets B read A's public items once RLS is on (its subselect runs under entity_schemas RLS and sees the public row).
- T8 column exposure guard: no route returns `SELECT *`, or default_value / xref / via / leg, from another shop's row.

**Code paths, not only the DB layer.** The suites that exercise the moved sites run on the **fresh-db job with the RUN files applied, on a SIT box, never on a laptop**: schemas, products (import, adopt, combo templates), till snapshot, order/confirm in BOTH pipelines (a private shop on the payload pipeline must still freeze its schema id and version: T-Q1), owner preview of a private shop (returns its schema and columns), supplier list and search `has_catalogue`, network-build visibility mirror (id from the run, not `identities`), business-search. A binding miss is not silent: catalogue-face and till readDeclared keep their log line, and a test feeds a miss and asserts the line is logged.

**Offline doubles.** About **28 files** name the tables: cat-m9a-product-doors, cat-m9c-till-doors, cat124-adopt-refusal-atomic, cat210-rate-owner-only, cat235-create-cost-gate, cat282-parallel-merge, cat326-parked-column, catalogue-visibility, column-parity, column-rules, con-54-storefront-presence, ctry-28-order-subject-currency, field-ledger, net-39-search, net-98-differential (realstack), rev04-cost-leak, rls-fresh-db, sec-126-network-store-public, sec-fix2, sec-fix3, send-golden, storefront-stock-ledger, visibility-mirror, fixtures/network-build-golden.json, fixtures/send-golden.json, lib/entities-scenes, lib/products-scenes, lib/schemas-scenes. Each regex double must ENFORCE the entity predicate (a missed regex reads as empty rows and looks green): one shared helper makes a double reject an unbound statement on the two tables. **send-golden.json pins the freeze SQL 26 times.** The freeze moving to `ops.shop_default_schema` changes all 26; the golden is refreshed once, reason stated in the PR: "freeze read moved to a definer, same two values", reviewed as a diff of the SQL text only.

**Sweep: widen #1275's, add no tool.** tools/identities-sweep.cjs (db/identities-sweep.baseline.json) takes a table list (`identities`, `entity_schemas`, `schema_fields`) instead of a new tools/entity-schemas-sweep.cjs; the baseline gains per-table counts. Keep the mutation proof: a raw `db.query`, a `pool.query` and a renamed import must each go red in a temp copy (ledger SEC-185: a callee-name ratchet is blind to aliases). It also scans `scripts/` and names the three invoker functions.

**Guard rows:** db/rls-baseline.json moves both tables to `fix` (rls true, forced true, 2 policies) in the build PR with the `why` rewritten; tests/rls-open-ratchet.test.cjs gets the tests/rls-sec75-tables.cjs entries; tests/rls-context.test.cjs scans `FROM <tenant table>` for a missing bind once the tables are on its list.

**Round-trip budgets** (measured in the build PR by tests/round-trips-all; before and after quoted):
- till snapshot readDeclared: 1 trip today. `withEntity` would make it 4 (BEGIN, SET, SELECT, COMMIT); with `queryAs` it stays 1, so the budget is unchanged.
- products create / import: defaultSchemaId + schemaFieldsOf is 2 trips today; `defaultSchemaWithFields` makes it 1 (budget down by 1). No schema read inside a per-product loop (declaration read once, catalogue-columns.js :326).
- buildPublicView: owner branch +0 (queryAs replaces query), public branch unchanged.
- order freeze: 1 today, 1 after (the definer call).
A budget that rises is raised in round-trips.budget.json with the reason in the PR, never silently.

## 5. Risks
1. The ~28 test files and the 26 golden pins (section 4). Keep the SQL text unchanged where possible; doubles enforce the predicate.
2. Round trips: `queryAs` is the default so hot reads do not pay BEGIN/SET/COMMIT.
3. A policy-only design would turn a private supplier's `has_catalogue` false and null the order freeze; the two definers avoid both.
4. Dynamic SQL the grep missed fails closed with empty rows. The widened sweep counts, and the SIT real-stack run comes before production. Silent-empty swallowers keep their log line and are tested.
5. network-build-run is operator code: no BYPASSRLS, and no resolving the shop through `identities` once #1275 has put it under RLS.
6. Seed and reset scripts silently change 0 rows as cb_app: each refuses to run as cb_app.
7. Lands after #1275; if #1275 slips, this design does not start (no queryAs, no sweep to widen).

Consulted: cb-db shapes (b842, b851, b855, b857, rls-baseline `why`), cb-catalogue (order path, pipelines), cb-speed (round trips), own ledger (SEC-75 b855, SEC-185 alias blindness). cb-catalogue owns the catalogue-columns and catalogue-view sites; the build PR asks it.

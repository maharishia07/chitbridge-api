# SEC-75 · entity_schemas + schema_fields: the closing design (DRAFT, no build)

Date 2026-11-14 · owner cb-security · critic first, then build · source: origin/main fd5193a3 and db/rls-baseline.json (api #1288 branch `db/rls-class-fix-1114`).
Standards: OWASP API1 (broken object-level authorization), PostgreSQL row security (FORCE, per-command policies), the b857 definer pattern (`ops` schema, `search_path=''`, grants to cb_app only).

## 1. The problem
Both tables are class `entity` in db/rls-baseline.json with RLS OFF and 0 policies. Any statement as cb_app can read or edit every shop's schema and column declarations.
A SQL-only close would make every plain `query()` (no `app.current_entity`) return 0 rows, so the reads must be moved, or given a narrower door, first. Code ships first, the policy file last (the b842 / b851 order).

## 2. Call sites (git grep on origin/main; code statements only, not comments, tests or archived migrations)
"Own" = the predicate names the caller's shop. Every one is a plain `query()` today unless noted. Totals: **31 own + 1 operator write + 6 cross-shop reads = 38 statements in 19 files.**

OWN-SHOP (31), each moves under `withEntity(shop, ...)`:
- lib/catalogue-columns.js: readDeclaration :264/:267, commitFields :283 :295 :303, resolveColumns :423 (the `query` is injected, so sweep the callers) = 5
- lib/catalogue-write.js :36 :52 = 2 · lib/schema-bootstrap.js :41 :80 :104 (a new shop writes its own first schema) = 3
- routes/schemas.js :41 :85 :100 :183 :206 :235 :244 :263 :300 :375 :395 = 11 (`auth` routes, shop = `auth.entityOf(req)`)
- routes/products.js :285 :1282 :1432 = 3 · routes/assist.js :677 :697 :723 (a help desk reads its own Q&A schema) = 3
- routes/catalogue-face.js :48 = 1. Own, not cross-shop: `es.entity_id = $1` with the caller's shop. The baseline `why` listed it as cross-shop.
- routes/chits.js :2447 sendFreeze = 1. Own: `sender_id = entityId(req)`, the caller. Also listed as cross-shop in the `why`; it is not.
- routes/till.js :571 readDeclared = 1 · routes/entities.js :1240 (visibility mirror on the shop's own update) = 1

OPERATOR WRITE (1): lib/network-build-run.js :514, `UPDATE entity_schemas ... WHERE entity_id = (SELECT identity_id FROM identities WHERE bridge_id = $2)`. The platform writes ANOTHER shop's row. Under FORCE it would fail closed. Fix: resolve the identity id, then run the statement in `withEntity(thatShop)`. No definer, no new write door.

CROSS-SHOP READS (6 statements, 5 sites), why, and the narrower path:
| # | site | what it needs | narrower path |
|---|------|---------------|---------------|
| 1 | lib/business-search.js:126 | "has this listed shop a default catalogue": an EXISTS in a product search over other shops | existence only: `ops.shop_has_catalogue(uuid)` |
| 2 | routes/relationships.js:304 (supplier list, inside withEntity(owner)) | the supplier's `has_catalogue` flag; the supplier is another shop | same function |
| 3 | routes/relationships.js:575 (supplier catalogue search) | same flag | same function |
| 4 | lib/catalogue-view.js:300 and :308 (public view of any shop; already adds `visibility='public'` unless `asOwner`) | the public schema name and its column list | public-read SELECT policy: the shop window is public by definition |
| 5 | routes/catalogue.js:1628 (a customer orders from a shop: freeze the SHOP's schema id and version) | the shop's active default schema row | public-read SELECT policy; if the order gate admits a non-public shop, bind that read as the shop (open question Q1) |

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
The baseline `why` says one policy `entity_id = current OR visibility = public`. A single FOR ALL policy lets USING on UPDATE and DELETE reach another shop's public row (the exact b851 finding on catalogue_items), so the public clause is a separate FOR SELECT policy. The `why` text is rewritten when the fix lands.

**Existence door** (b857 pattern), in the same RUN file:
`ops.shop_has_catalogue(p_entity uuid) RETURNS boolean`, `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`, body `SELECT EXISTS (SELECT 1 FROM public.entity_schemas WHERE entity_id = p_entity AND status = 'active' AND is_default = true)`. REVOKE from PUBLIC, anon, authenticated in the same transaction as the CREATE; GRANT EXECUTE to cb_app only; `ops` is not an exposed PostgREST schema (Athi confirms, as for b857). It returns one boolean and never a row, a name or a column, so a private or restricted shop's schema is never readable across shops, and `has_catalogue` keeps today's meaning. Sites 1-3 call it as `ops.shop_has_catalogue(i.identity_id)`.

**Own-shop sites** move to `withEntity(shop, db => ...)` (or `queryAs` once api#1275 lands: same bind, one trip). The write sites already carry `entity_id = $n` in the SQL; keep it (name the predicate in SQL as well as relying on RLS).

**Shipping order.**
1. PR A, code: move the 31 + 1 sites, switch sites 1-3 to the function (a fallback to today's EXISTS only while the function is missing, one logged warning, as b857), add the ratchet.
2. Deploy.
3. SQL file `migrations/RUN-<date>-bNNN-entity-schemas-rls.sql` for Athi, run AS postgres, SIT first. The RUN- prefix keeps CI fresh-db from auto-applying it (b797 and #1275 precedent); the fresh-db job applies it explicitly. Run it at ratchet 0.
Roll back: DISABLE RLS on both tables and DROP the function (the api falls back).

Rejected: a public VIEW with an explicit column list (a view runs as its owner and bypasses RLS, the same effect as a definer, and it would also have to serve catalogue-view's join; the policy is simpler and the public columns are public anyway). A BYPASSRLS role (refused at boot, lib/db-role.js). Leaving the tables open (class `entity` stays owed).

## 4. Proof
Isolation, rls-context style: tests/rls-fresh-db.test.cjs and tests/rls-sec75-tables.cjs. Both tables join the list (`entity_schemas: { key: 'entity_id', cols: {} }` for the generic probe, plus a shared-style block like catalogue_source, because of the public clause).
- T1 shop A bound sees its own schema and fields (positive control), not B's private ones (unique canary in B's field_name).
- T2 shop B bound reads A's `public` schema and fields but NOT A's `restricted` or `private` (three rows per shop).
- T3 B cannot UPDATE, DELETE or INSERT a row carrying A's entity_id, public or not. Prove it red by temporarily making the public policy FOR ALL.
- T4 an unbound statement returns 0 rows and an unbound INSERT fails (fail closed).
- T5 `ops.shop_has_catalogue`: true for a private shop with a default schema, false for none, returns a boolean only; EXECUTE denied to anon, authenticated and PUBLIC; same answer for a caller bound to a third shop.
- T6 schema_fields: B cannot insert a field under A's schema_id (the FK check bypasses RLS, so the WITH CHECK is what refuses it).
- T7 b851's `catalogue_items_public_read` still lets B read A's public items once RLS is on (its subselect now runs under entity_schemas RLS and still sees the public row).

Guard rows: db/rls-baseline.json moves both tables to `fix` (rls true, forced true, 2 policies) in the build PR, with the `why` rewritten; tests/rls-open-ratchet.test.cjs needs the tests/rls-sec75-tables.cjs entries; a new `tools/entity-schemas-sweep.cjs` with `db/entity-schemas-sweep.baseline.json` counts every unbound statement naming either table across every query spelling (open and in-tx), proved red on a raw `db.query` and on `pool.query` in a temp copy (ledger 2026-11-14, SEC-185); tests/rls-context.test.cjs scans `FROM <tenant table>` for a missing withEntity once the tables are on its list.

## 5. Risks
1. About 10 offline tests answer by regex on the SQL text (`/SELECT schema_id FROM entity_schemas/`, `/FROM schema_fields WHERE schema_id/`). Keep the SQL text unchanged where possible and make the doubles enforce the predicate (a missed match reads as empty rows).
2. Round trips: withEntity adds BEGIN/SET/COMMIT per bound read, and schemas, products and the till snapshot are hot paths. tests/round-trips-all budgets move (say why), or use queryAs.
3. A policy-only design would turn a private supplier's `has_catalogue` false (a behaviour change). The definer function avoids it.
4. Q1: does the order route at catalogue.js:1628 admit a non-public shop? Confirm in the build, before the policy runs.
5. Dynamic SQL the grep missed fails closed with empty rows. The ratchet counts, and the SIT real-stack run comes before production.
6. network-build-run is operator code: it must not be given BYPASSRLS to "fix" this.

Consulted: cb-db shapes (b842, b851, b855, b857, rls-baseline `why`), own ledger (SEC-75 b855, SEC-185). cb-catalogue owns the catalogue-columns and catalogue-view sites; the build PR asks it.

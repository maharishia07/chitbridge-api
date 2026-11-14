'use strict';
/**
 * tests/sec-75-entity-schemas.realstack.cjs — SEC-75: row security on entity_schemas and schema_fields, on a REAL Postgres, read and written as cb_app (NOBYPASSRLS).
 * CARD      18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * PROVES    T1 own rows + canary · T2 another shop's PUBLIC ACTIVE schema only · T2b a public DRAFT is unreadable · T3 no cross-shop UPDATE/DELETE/INSERT on entity_schemas ·
 *           T4 unbound = public active rows only, unbound INSERT fails · T5 the two definers answer for a private shop and are closed to anon/authenticated/PUBLIC ·
 *           T5b catalogue facts AND a real CALL of both definers (schema_version arrives with the column's own type) · T6 schema_fields INSERT under another shop's schema refused ·
 *           T6b schema_fields UPDATE/DELETE refused, and the mutation (public policy made FOR ALL) turns T3/T6b RED · T7 b851's catalogue_items_public_read still lets B read A's public items ·
 *           T-Q1 a private shop on the payload pipeline still freezes its schema id and version through the definer (the plain read of it returns nothing under the policy).
 * HOW       it applies migrations/RUN-2026-11-14-b861 (functions) THEN b862 (policies) itself, as the OWNER (CB_OWNER_DB_URL), plants rows as the owner, drives everything else as cb_app (DATABASE_URL),
 *           and in `finally` puts both tables back to their open state and drops the functions, so the realstack tests after it plant and read unbound, as they do today.
 *   CB_OWNER_DB_URL=postgres://postgres:postgres@localhost:5432/cb_s41 DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/sec-75-entity-schemas.realstack.cjs
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.CB_OWNER_DB_URL || '';
const hostOk = (u) => { const m = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(u); return !!m && /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(m[2]); };
if (!hostOk(url) || !hostOk(ownerUrl)) { console.error('REFUSED: needs DATABASE_URL (cb_app) and CB_OWNER_DB_URL (owner) on localhost, the compose db or a SIT host'); process.exit(3); }
const { query, queryAs } = require('../db');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'r75' + (Date.now() % 1e9).toString(36);
const migration = (name) => fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');
const B861 = migration('RUN-2026-11-14-b861-entity-schemas-fns.sql');
const B862 = migration('RUN-2026-11-14-b862-entity-schemas-rls.sql');
const failsWith = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };

(async () => {
  console.log('\n── SEC-75 · entity_schemas + schema_fields row security on real Postgres · run ' + RUN + ' ──');
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  const shops = [];
  try {
    await owner.query(B861);
    await owner.query(B862);
    await owner.query(B862); /* a second run is harmless */
    const state = (await owner.query(`SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)::int AS policies FROM pg_class c WHERE c.oid IN ('public.entity_schemas'::regclass, 'public.schema_fields'::regclass) ORDER BY 1`)).rows;
    ok('R-0 b861 then b862 applied: RLS on, FORCE on, two policies on each table', state.length === 2 && state.every((row) => row.rls && row.forced && row.policies === 2), JSON.stringify(state));
    const role = (await query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
    ok('R-1 the api role is not a superuser and does not bypass row security (else FORCE is a silent no-op)', role.rolsuper === false && role.rolbypassrls === false, JSON.stringify(role));

    const shop = async (tag) => {
      const r = await owner.query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, status, country, currency_code) VALUES ($1, $2, $3, $4, 'entity', 'active', 'IN', 'INR') RETURNING identity_id`,
        ['B' + RUN + tag, 'Shop ' + tag + ' ' + RUN, RUN + tag + '@sec75.test', 'u-' + tag + '-' + RUN]);
      shops.push(r.rows[0].identity_id); return r.rows[0].identity_id;
    };
    const schema = async (entity, name, visibility, status, isDefault) => (await owner.query(
      `INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default, visibility) VALUES ($1, $2, 'product', 'manual', $3, $4, $5) RETURNING schema_id`,
      [entity, name + ' ' + RUN, status, isDefault, visibility])).rows[0].schema_id;
    const field = async (schemaId, key) => (await owner.query(`INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order) VALUES ($1, $2, $3, 'text', false, 1) RETURNING field_id`, [schemaId, key + '_' + RUN, key + '_' + RUN])).rows[0].field_id;

    const A = await shop('a'), B = await shop('b'), C = await shop('c'), D = await shop('d');
    const pubA = await schema(A, 'pubA', 'public', 'active', true);
    const resA = await schema(A, 'resA', 'restricted', 'active', false);
    const privA = await schema(A, 'privA', 'private', 'active', false);
    const draftA = await schema(A, 'draftA', 'public', 'draft', false);
    const ownB = await schema(B, 'ownB', 'private', 'active', true);
    const privC = await schema(C, 'privC', 'private', 'active', true); /* a private shop on the payload pipeline (forms, enquiries) */
    const f = { pubA: await field(pubA, 'fpub'), resA: await field(resA, 'fres'), privA: await field(privA, 'fpriv'), draftA: await field(draftA, 'fdraft'), ownB: await field(ownB, 'fownb'), privC: await field(privC, 'fprivc') };
    const nameOf = (rows) => rows.map((row) => row.schema_name.replace(' ' + RUN, '')).sort();
    const keysOf = (rows) => rows.map((row) => row.field_key.replace('_' + RUN, '')).sort();
    const fieldsOf = (id, entity) => queryAs(entity, `SELECT field_key FROM schema_fields WHERE schema_id = ANY($1::uuid[])`, [id]);

    // ── T1 · own rows, positive control, and no other shop's canary ───────────────────────────────────────
    const ownA = await queryAs(A, 'SELECT schema_name FROM entity_schemas WHERE entity_id = $1', [A]);
    ok('T1 bound to shop A: all four of A\'s schemas are readable (public, restricted, private, draft)', JSON.stringify(nameOf(ownA.rows)) === JSON.stringify(['draftA', 'privA', 'pubA', 'resA']), JSON.stringify(nameOf(ownA.rows)));
    ok('T1 bound to shop A: A\'s fields are readable, and B\'s private canary is not', keysOf((await fieldsOf([pubA, resA, privA, draftA, ownB], A)).rows).join() === 'fdraft,fpriv,fpub,fres', keysOf((await fieldsOf([ownB], A)).rows).join());
    ok('T1 bound to shop B: B\'s own private schema and field read back', (await queryAs(B, 'SELECT 1 FROM entity_schemas WHERE schema_id = $1', [ownB])).rowCount === 1 && (await fieldsOf([ownB], B)).rowCount === 1);

    // ── T2 / T2b · another shop's schema: public + active only, fields included ────────────────────────────
    const seenByB = await queryAs(B, 'SELECT schema_name FROM entity_schemas WHERE entity_id = $1', [A]);
    ok('T2 bound to shop B: A\'s PUBLIC ACTIVE schema is readable, A\'s restricted and private ones are not', JSON.stringify(nameOf(seenByB.rows)) === JSON.stringify(['pubA']), JSON.stringify(nameOf(seenByB.rows)));
    ok('T2 bound to shop B: A\'s public schema\'s fields are readable, the restricted and private schemas\' fields are not', keysOf((await fieldsOf([pubA, resA, privA], B)).rows).join() === 'fpub');
    ok('T2b a public schema with status draft is unreadable by B, and so are its fields', (await queryAs(B, 'SELECT 1 FROM entity_schemas WHERE schema_id = $1', [draftA])).rowCount === 0 && (await fieldsOf([draftA], B)).rowCount === 0);

    // ── T3 · no cross-shop write on entity_schemas, public row or not ──────────────────────────────────────
    const writesOf = async (id) => ({
      upd: (await queryAs(B, `UPDATE entity_schemas SET schema_name = 'taken ' || schema_name WHERE schema_id = $1`, [id])).rowCount,
      del: (await queryAs(B, 'DELETE FROM entity_schemas WHERE schema_id = $1', [id])).rowCount
    });
    const onPublic = await writesOf(pubA), onPrivate = await writesOf(privA);
    ok('T3 bound to shop B: UPDATE and DELETE of A\'s PUBLIC schema change nothing (the public clause is SELECT-only)', onPublic.upd === 0 && onPublic.del === 0, JSON.stringify(onPublic));
    ok('T3 bound to shop B: UPDATE and DELETE of A\'s private schema change nothing', onPrivate.upd === 0 && onPrivate.del === 0, JSON.stringify(onPrivate));
    const planted = await failsWith(() => queryAs(B, `INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default, visibility) VALUES ($1, 'forged', 'product', 'manual', 'active', false, 'public')`, [A]));
    ok('T3 bound to shop B: a schema planted under shop A is refused by the policy (42501)', planted === '42501', planted);
    const mineB = await queryAs(B, `INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default, visibility) VALUES ($1, 'mineB ${RUN}', 'product', 'manual', 'active', false, 'private') RETURNING schema_id`, [B]);
    ok('T3 bound to shop B: a schema under B itself is accepted (INSERT ... RETURNING works)', mineB.rowCount === 1);
    ok('T3 A\'s rows are untouched as the owner sees them', (await owner.query(`SELECT count(*)::int AS n FROM entity_schemas WHERE entity_id = $1 AND schema_name LIKE 'taken%'`, [A])).rows[0].n === 0 && (await owner.query('SELECT count(*)::int AS n FROM entity_schemas WHERE entity_id = $1', [A])).rows[0].n === 4);

    // ── T4 · unbound: public active rows only, never anything else; an unbound INSERT fails closed ─────────
    const unbound = await query(`SELECT schema_name FROM entity_schemas WHERE schema_name LIKE '% ${RUN}'`);
    ok('T4 unbound read: exactly the public ACTIVE row (pubA), not restricted, private, draft or another shop\'s private', JSON.stringify(nameOf(unbound.rows)) === JSON.stringify(['pubA']), JSON.stringify(nameOf(unbound.rows)));
    ok('T4 unbound read of fields: only the public schema\'s field', keysOf((await query(`SELECT field_key FROM schema_fields WHERE field_key LIKE '%\\_${RUN}'`)).rows).join() === 'fpub');
    const bare = await failsWith(() => query(`INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default, visibility) VALUES ($1, 'bare', 'product', 'manual', 'active', false, 'private')`, [A]));
    ok('T4 an unbound INSERT fails closed (42501)', bare === '42501', bare);

    // ── T5 · the two doors answer for a PRIVATE shop, one boolean / two values, same for any bound caller ───
    const has = async (caller, target) => (await queryAs(caller, 'SELECT ops.shop_has_catalogue($1) AS has', [target])).rows[0];
    ok('T5 shop_has_catalogue: true for private shop C seen from B, from D and unbound; false for a shop without a schema; one boolean', (await has(B, C)).has === true && (await has(D, C)).has === true && (await query('SELECT ops.shop_has_catalogue($1) AS has', [C])).rows[0].has === true && (await has(B, D)).has === false && typeof (await has(B, C)).has === 'boolean');
    const cutB = await queryAs(B, 'SELECT * FROM ops.shop_default_schema($1)', [C]);
    const cutD = await queryAs(D, 'SELECT * FROM ops.shop_default_schema($1)', [C]);
    ok('T5 shop_default_schema: private shop C answers schema id + version to B and to D, nothing else', cutB.rowCount === 1 && cutB.rows[0].schema_id === privC && JSON.stringify(Object.keys(cutB.rows[0])) === JSON.stringify(['schema_id', 'schema_version']) && cutD.rows[0].schema_id === privC);
    ok('T5 shop_default_schema: no row for a shop that has none', (await queryAs(B, 'SELECT * FROM ops.shop_default_schema($1)', [D])).rowCount === 0);
    const closed = (await owner.query(`SELECT p.proname, has_function_privilege('cb_app', p.oid, 'EXECUTE') AS app,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_function_privilege('anon', p.oid, 'EXECUTE') ELSE false END AS anon,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') ELSE false END AS authenticated,
        (SELECT count(*)::int FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_grants
      FROM pg_proc p WHERE p.oid IN ('ops.shop_has_catalogue(uuid)'::regprocedure, 'ops.shop_default_schema(uuid)'::regprocedure) ORDER BY 1`)).rows;
    ok('T5 EXECUTE: cb_app yes; anon, authenticated and PUBLIC no (both functions)', closed.length === 2 && closed.every((row) => row.app && !row.anon && !row.authenticated && row.public_grants === 0), JSON.stringify(closed));

    // ── T5b · catalog properties AND a real call; the declared type is the column's type ───────────────────
    const facts = (await owner.query(`SELECT p.proname, p.prosecdef AS definer, EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""') AS pinned, pg_get_function_result(p.oid) AS result,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = pg_get_userbyid(p.proowner)) AS owner_bypasses
      FROM pg_proc p WHERE p.oid IN ('ops.shop_has_catalogue(uuid)'::regprocedure, 'ops.shop_default_schema(uuid)'::regprocedure) ORDER BY 1`)).rows;
    ok('T5b both are SECURITY DEFINER with search_path pinned to empty, owned by a role that bypasses RLS', facts.every((row) => row.definer && row.pinned && row.owner_bypasses), JSON.stringify(facts));
    ok('T5b result types: boolean, and TABLE(schema_id uuid, schema_version integer)', facts.find((row) => row.proname === 'shop_has_catalogue').result === 'boolean' && facts.find((row) => row.proname === 'shop_default_schema').result === 'TABLE(schema_id uuid, schema_version integer)', JSON.stringify(facts.map((row) => row.result)));
    const colType = (await owner.query(`SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'entity_schemas' AND column_name = 'schema_version'`)).rows[0].data_type;
    const direct = (await owner.query('SELECT schema_version FROM entity_schemas WHERE schema_id = $1', [privC])).rows[0].schema_version;
    ok('T5b the CALLED definer returns the column\'s own value and JS type (a type drift would fail here, not at the first order)', colType === 'integer' && cutB.rows[0].schema_version === direct && typeof cutB.rows[0].schema_version === typeof direct, colType + ' ' + typeof cutB.rows[0].schema_version);

    // ── T6 / T6b · schema_fields: parent decides ──────────────────────────────────────────────────────────
    const fkInsert = (shopBound, schemaId) => failsWith(() => queryAs(shopBound, `INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order) VALUES ($1, 'x', 'x_${RUN}', 'text', false, 9)`, [schemaId]));
    ok('T6 bound to shop B: a field under A\'s schema (public or private) is refused (42501): the FK check bypasses RLS, WITH CHECK does not', (await fkInsert(B, pubA)) === '42501' && (await fkInsert(B, privA)) === '42501');
    ok('T6 bound to shop A: a field under A\'s own schema is accepted', (await fkInsert(A, pubA)) === null);
    const fieldWrites = async (id) => ({
      upd: (await queryAs(B, `UPDATE schema_fields SET field_name = 'taken' WHERE schema_id = $1`, [id])).rowCount,
      del: (await queryAs(B, 'DELETE FROM schema_fields WHERE schema_id = $1', [id])).rowCount
    });
    const fieldsPublic = await fieldWrites(pubA), fieldsPrivate = await fieldWrites(privA);
    ok('T6b bound to shop B: UPDATE and DELETE of fields under A\'s public and private schemas change nothing', fieldsPublic.upd + fieldsPublic.del + fieldsPrivate.upd + fieldsPrivate.del === 0, JSON.stringify([fieldsPublic, fieldsPrivate]));

    // ── the mutation: the public clause as FOR ALL makes T3 and T6b RED (proof the checks can fail) ────────
    await owner.query(`DROP POLICY entity_schemas_public_read ON entity_schemas; CREATE POLICY entity_schemas_public_read ON entity_schemas USING (visibility = 'public' AND status = 'active')`);
    await owner.query(`DROP POLICY schema_fields_public_read ON schema_fields; CREATE POLICY schema_fields_public_read ON schema_fields USING (EXISTS (SELECT 1 FROM entity_schemas s WHERE s.schema_id = schema_fields.schema_id AND s.visibility = 'public' AND s.status = 'active'))`);
    const mutatedSchema = await queryAs(B, `UPDATE entity_schemas SET schema_name = schema_name WHERE schema_id = $1`, [pubA]);
    const mutatedFields = await queryAs(B, `UPDATE schema_fields SET field_name = field_name WHERE schema_id = $1`, [pubA]);
    ok('MUTATION a public policy written FOR ALL lets B update A\'s public schema and fields: T3 and T6b would be RED (the checks can fail)', mutatedSchema.rowCount === 1 && mutatedFields.rowCount >= 1, mutatedSchema.rowCount + '/' + mutatedFields.rowCount);
    await owner.query(B862); /* back to the shipped policies */
    ok('MUTATION undone: b862 re-applied, B changes nothing again', (await queryAs(B, `UPDATE entity_schemas SET schema_name = schema_name WHERE schema_id = $1`, [pubA])).rowCount === 0);

    // ── T7 · b851 catalogue_items_public_read still works once entity_schemas is row-secured ──────────────────
    await owner.query(`INSERT INTO catalogue_items (entity_id, schema_id, item_data) VALUES ($1, $2, $3)`, [A, pubA, JSON.stringify({ name: 'canary ' + RUN })]);
    const items = await queryAs(B, `SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND item_data->>'name' = $2`, [A, 'canary ' + RUN]);
    ok('T7 bound to shop B: A\'s public catalogue item is readable (b851\'s subselect runs under entity_schemas row security and sees the public row)', items.rowCount === 1, items.rowCount);

    // ── T-Q1 · the order freeze of a PRIVATE shop on the payload pipeline ─────────────────────────────────
    const plain = await query(`SELECT schema_id, schema_version FROM entity_schemas WHERE entity_id = $1 AND status = 'active' AND is_default = true`, [C]);
    const frozen = await query('SELECT schema_id, schema_version FROM ops.shop_default_schema($1)', [C]);
    ok('T-Q1 the freeze read of a private shop: the plain table read returns nothing under the policy (why a definer is needed), the definer returns the schema id AND version (A10 kept)', plain.rowCount === 0 && frozen.rowCount === 1 && frozen.rows[0].schema_id === privC && frozen.rows[0].schema_version === direct, plain.rowCount + '/' + frozen.rowCount);
  } catch (e) {
    fail++; console.log('  FAIL the run stopped: ' + (e.stack || e.message));
  } finally {
    const undo = async (sql) => { try { await owner.query(sql); } catch (e) { console.log('  (cleanup) ' + e.message); } };
    await undo('ALTER TABLE schema_fields NO FORCE ROW LEVEL SECURITY; ALTER TABLE schema_fields DISABLE ROW LEVEL SECURITY; ALTER TABLE entity_schemas NO FORCE ROW LEVEL SECURITY; ALTER TABLE entity_schemas DISABLE ROW LEVEL SECURITY');
    await undo('DROP POLICY IF EXISTS rls_entity ON schema_fields; DROP POLICY IF EXISTS schema_fields_public_read ON schema_fields; DROP POLICY IF EXISTS rls_entity ON entity_schemas; DROP POLICY IF EXISTS entity_schemas_public_read ON entity_schemas');
    if (shops.length) {
      await undo(`DELETE FROM catalogue_items WHERE entity_id = ANY('{${shops.join(',')}}'::uuid[])`);
      await undo(`DELETE FROM schema_fields WHERE schema_id IN (SELECT schema_id FROM entity_schemas WHERE entity_id = ANY('{${shops.join(',')}}'::uuid[]))`);
      await undo(`DELETE FROM entity_schemas WHERE entity_id = ANY('{${shops.join(',')}}'::uuid[])`);
      await undo(`DELETE FROM identities WHERE identity_id = ANY('{${shops.join(',')}}'::uuid[])`);
    }
    await undo(B861); /* the doors stay: later CI steps (CAT-316, order/confirm) call them; the policies are off again, so they are harmless alone */
    await owner.end();
    try { await require('../db').pool.end(); } catch (_) {}
  }
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

'use strict';
/**
 * tests/sec-75-entity-schemas.test.cjs — SEC-75 (entity_schemas + schema_fields), the offline half: the widened sweep ratchet and its break checks, the boot check, the two held RUN files,
 * the one defaultSchemaId, the bound readers of catalogue-columns, the freeze through the definer, and T8 (no route returns another shop's schema row beyond the public columns).
 * CARD      18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * Run: node tests/sec-75-entity-schemas.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (an unbound read of the two tables is a ratchet failure, not a silent empty list)
 * The behaviour on a real Postgres is tests/sec-75-entity-schemas.realstack.cjs (CI job `integration`, T1-T7, T-Q1); this file needs no database.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sweepTool = require('../tools/identities-sweep.cjs');
const dbRole = require('../lib/db-role');
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String(e && e.message).slice(0, 300)); } };
const FNS = read('migrations/RUN-2026-11-14-b861-entity-schemas-fns.sql');
const RLS = read('migrations/RUN-2026-11-14-b862-entity-schemas-rls.sql');
const code = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const base = () => JSON.parse(read('db/identities-sweep.baseline.json'));
const TABLES = ['entity_schemas', 'schema_fields'];
const ENTITY_ROWS = (present) => dbRole.ENTITY_DOORS.map((sig) => ({ sig, present, may_run: present }));
/** T8: a SELECT that names a whole row or one of the columns a public schema must not hand over, from either table */
const EXPOSES = /SELECT[^;`'"]{0,200}?(\*|\bdefault_value\b|\bxref\b|\bvia\b|\bleg\b)[^;`'"]{0,200}?FROM\s+(entity_schemas|schema_fields)\b/i;

/** a temp copy of the runtime dirs with ONE extra statement appended to lib/policy.js: the verdict for `table` the ratchet then gives */
const withExtraLine = (table, line) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec75-'));
  try {
    for (const dir of ['lib', 'routes', 'middleware']) fs.cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
    fs.appendFileSync(path.join(tmp, 'lib', 'policy.js'), '\n' + line + '\n');
    return sweepTool.judge(sweepTool.count(sweepTool.sweep(tmp, table)), base().tables[table]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); sweepTool.sweep(); }
};

(async () => {
  await check('ratchet: neither table\'s open nor in-tx count has risen above db/identities-sweep.baseline.json', () => {
    const verdict = sweepTool.judgeTables(base());
    assert(verdict.ok, verdict.problems.join(' | '));
  });
  await check('precondition for b862: both tables have open 0 (every statement is bound, public-by-design or an injected reader that tests below prove bound)', () => {
    for (const table of TABLES) {
      const by = sweepTool.count(sweepTool.sweep(null, table));
      assert(!by.open, table + ' still has ' + by.open + ' unbound statements');
    }
    sweepTool.sweep();
  });
  for (const table of TABLES) {
    await check('break check (' + table + '): a temp copy with no new statement stays green', () => assert(withExtraLine(table, '/* a comment only */').ok));
    await check('break check (' + table + '): a raw module query() of the table turns the ratchet RED (open rises)', () => {
      const verdict = withExtraLine(table, "async function probe() { return query('SELECT 1 FROM " + table + " WHERE x = $1', [1]); }");
      assert(!verdict.ok && /open/.test(verdict.problems.join()), JSON.stringify(verdict));
    });
    await check('break check (' + table + '): a pool.query of the table turns the ratchet RED (open rises: the module pool is never bound)', () => {
      const verdict = withExtraLine(table, "async function probe(db) { return db.pool.query('SELECT 1 FROM " + table + " WHERE x = $1', [1]); }");
      assert(!verdict.ok && /open/.test(verdict.problems.join()), JSON.stringify(verdict));
    });
    await check('break check (' + table + '): a renamed import (statement(...)) is counted too, as in-tx', () => {
      const verdict = withExtraLine(table, "async function probe(statement) { return statement('SELECT 1 FROM " + table + " WHERE x = $1', [1]); }");
      assert(!verdict.ok, JSON.stringify(verdict)); /* never silently green: counted as in-tx, or as open when an earlier call within 14 lines names the module query */
    });
  }
  await check('classifier: queryFor / queryAs are bound; a sweep:public marker is public; lib/catalogue-columns.js is injected; identities keep their old classes', () => {
    const cls = (file, text, table) => sweepTool.classify(file, [text, 'SELECT x FROM ' + table + ' WHERE a = $1'], 1, table).cls;
    assert.strictEqual(cls('lib/x.js', 'const r = await queryFor(shop)(', 'schema_fields'), 'bound');
    assert.strictEqual(cls('lib/x.js', 'const r = await queryAs(shop,', 'entity_schemas'), 'bound');
    assert.strictEqual(cls('lib/x.js', '/* sweep:public */ const r = await query(', 'entity_schemas'), 'public');
    assert.strictEqual(cls('lib/catalogue-columns.js', 'const r = await query(', 'schema_fields'), 'injected');
    assert.strictEqual(cls('lib/x.js', 'const r = await query(', 'entity_schemas'), 'open');
    assert.strictEqual(cls('lib/x.js', '/* sweep:public */ const r = await query(', 'identities'), 'open', 'the marker never excuses identities');
  });

  await check('boot: the two-door verdict is fatal when either function is missing or not executable (warn on a local stack), ok when both are present and executable', () => {
    const row = (sig, present, may_run) => ({ sig, present, may_run });
    const [has, cut] = dbRole.ENTITY_DOORS;
    assert.strictEqual(dbRole.entityDoorVerdict([row(has, true, true), row(cut, true, true)], false).level, 'ok');
    assert.strictEqual(dbRole.entityDoorVerdict([row(has, true, true), row(cut, false, false)], false).level, 'fatal');
    assert.strictEqual(dbRole.entityDoorVerdict([row(has, true, false), row(cut, true, true)], false).level, 'fatal', 'present but not executable');
    assert.strictEqual(dbRole.entityDoorVerdict([row(has, true, true)], false).level, 'fatal', 'a missing row counts as missing');
    assert.strictEqual(dbRole.entityDoorVerdict([], false).level, 'fatal');
    assert.strictEqual(dbRole.entityDoorVerdict([], true).level, 'warn');
    assert(/entity_schemas functions file in migrations/.test(dbRole.entityDoorVerdict([], false).reason), 'the reason names what to run, with no migration id in the message');
    assert(/has_function_privilege\(current_user/.test(dbRole.ENTITY_SQL) && /to_regprocedure/.test(dbRole.ENTITY_SQL), 'the facts come from the catalog, for the role the api connects as');
  });

  await check('boot: bootCheck asks the entity doors THIRD (after the role and the sign-in door), is fatal on a missing door, and a fatal earlier step stops before the doors are asked', async () => {
    const asked = [];
    const log = { critical() {}, info() {}, warn() {} };
    const runWith = (role, signin, entity) => async (sql) => {
      asked.push(sql === dbRole.ROLE_SQL ? 'role' : sql === dbRole.SIGNIN_SQL ? 'signin' : sql === dbRole.ENTITY_SQL ? 'entity' : 'other');
      if (sql === dbRole.ROLE_SQL) return { rows: [role] };
      if (sql === dbRole.SIGNIN_SQL) return { rows: [signin] };
      return { rows: entity };
    };
    const ok = { current_user: 'cb_app', rolsuper: false, rolbypassrls: false };
    const door = { present: true, may_run: true };
    assert.strictEqual(await dbRole.bootCheck(runWith(ok, door, ENTITY_ROWS(true)), false, log), false);
    assert.deepStrictEqual(asked, ['role', 'signin', 'entity']);
    asked.length = 0;
    assert.strictEqual(await dbRole.bootCheck(runWith(ok, door, ENTITY_ROWS(false)), false, log), true, 'a missing entity door is fatal');
    asked.length = 0;
    assert.strictEqual(await dbRole.bootCheck(runWith(ok, { present: false, may_run: false }, ENTITY_ROWS(true)), false, log), true);
    assert.deepStrictEqual(asked, ['role', 'signin'], 'a fatal sign-in door stops the run before the entity doors are asked');
    assert(read('server.js').includes("dbRole.bootCheck((sql, params) => require('./db').query(sql, params)"), 'server.js hands the params through: the entity read carries the door list as a parameter');
  });

  await check('RUN files: held out of the migrate chain, numbered b861 then b862, and the policies file states it ships last', () => {
    const chain = require('../tools/migrate.cjs');
    assert(!(chain.chainFiles ? chain.chainFiles() : []).some((f) => /b861|b862/.test(f)), 'the chain must not apply either file on its own');
    assert(fs.existsSync(path.join(ROOT, 'migrations/RUN-2026-11-14-b861-entity-schemas-fns.sql')) && fs.existsSync(path.join(ROOT, 'migrations/RUN-2026-11-14-b862-entity-schemas-rls.sql')));
    assert(/RUN ORDER/.test(FNS) && /RUN ORDER/.test(RLS) && /SHIPS LAST/.test(RLS) && /b861/.test(RLS) && /identities-sweep\.cjs --check/.test(RLS));
    assert(/ROLL BACK/.test(FNS) && /ROLL BACK[\s\S]*NO FORCE ROW LEVEL SECURITY/.test(RLS) && /CHECK \(read-only/.test(FNS) && /CHECK \(read-only\)/.test(RLS));
  });
  await check('b861: both definers are SECURITY DEFINER, search_path empty, fully qualified, grants closed in the same transaction, EXECUTE to cb_app only, type guard present', () => {
    const sql = code(FNS);
    assert(/^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql));
    assert((sql.match(/SECURITY DEFINER/g) || []).length === 2 && (sql.match(/SET search_path = ''/g) || []).length === 2);
    assert(!/\bFROM entity_schemas\b/.test(sql) && /FROM public\.entity_schemas/.test(sql), 'every object is schema-qualified');
    assert(/REVOKE ALL ON FUNCTION ops\.shop_has_catalogue\(uuid\) FROM PUBLIC/.test(sql) && /REVOKE ALL ON FUNCTION ops\.shop_default_schema\(uuid\) FROM PUBLIC/.test(sql));
    assert(/FROM anon/.test(sql) && /FROM authenticated/.test(sql) && /GRANT EXECUTE ON FUNCTION ops\.shop_has_catalogue\(uuid\) TO cb_app/.test(sql) && /GRANT EXECUTE ON FUNCTION ops\.shop_default_schema\(uuid\) TO cb_app/.test(sql));
    assert(!/GRANT EXECUTE[^;]*\bTO (PUBLIC|anon|authenticated)/i.test(sql), 'never granted to the open roles');
    assert(/DROP FUNCTION IF EXISTS ops\.shop_default_schema\(uuid\)/.test(sql), 'RETURNS TABLE re-runs (migration-rerunnable)');
    assert(/RETURNS TABLE \(schema_id uuid, schema_version integer\)/.test(sql) && /data_type[\s\S]*'integer'/.test(sql), 'the declared type is the column\'s, and a drifted database stops here');
    assert(/ORDER BY s\.created_at DESC LIMIT 1/.test(sql) && /s\.status = 'active' AND s\.is_default = true/.test(sql), 'the exact filter and order of the freeze read');
    assert(!/EXECUTE\s+(format|')/i.test(sql.replace(/GRANT EXECUTE/g, '')), 'no dynamic SQL');
  });
  await check('b862: ENABLE + FORCE on both, four policies each DROP IF EXISTS then CREATE, the public clause is FOR SELECT, the key is the NULLIF form, no open policy', () => {
    const sql = code(RLS);
    for (const table of TABLES) assert(new RegExp('ALTER TABLE ' + table + ' ENABLE ROW LEVEL SECURITY').test(sql) && new RegExp('ALTER TABLE ' + table + ' FORCE ROW LEVEL SECURITY').test(sql), table);
    for (const [policy, table] of [['rls_entity', 'entity_schemas'], ['entity_schemas_public_read', 'entity_schemas'], ['rls_entity', 'schema_fields'], ['schema_fields_public_read', 'schema_fields']]) {
      assert(new RegExp('DROP POLICY IF EXISTS ' + policy + ' ON ' + table + ';\\s*CREATE POLICY ' + policy + ' ON ' + table).test(sql), policy + ' on ' + table);
    }
    assert(/CREATE POLICY entity_schemas_public_read ON entity_schemas FOR SELECT/.test(sql) && /CREATE POLICY schema_fields_public_read ON schema_fields FOR SELECT/.test(sql));
    assert(/visibility = 'public' AND status = 'active'/.test(sql) && /s\.visibility = 'public' AND s\.status = 'active'/.test(sql), 'a draft or private schema is never public');
    assert((sql.match(/NULLIF\(current_setting\('app\.current_entity', true\), ''\)::uuid/g) || []).length >= 4);
    assert(!/USING\s*\(\s*true\s*\)/i.test(sql), 'no open policy');
  });
  await check('break check: b862 without FORCE, without the SELECT-only public clause, or with an open policy fails the same structure checks', () => {
    const sql = code(RLS);
    assert(!/FORCE ROW LEVEL SECURITY/.test(sql.split('ALTER TABLE schema_fields FORCE ROW LEVEL SECURITY;').join('').split('ALTER TABLE entity_schemas FORCE ROW LEVEL SECURITY;').join('')));
    assert(!/CREATE POLICY entity_schemas_public_read ON entity_schemas FOR SELECT/.test(sql.replace('entity_schemas_public_read ON entity_schemas FOR SELECT', 'entity_schemas_public_read ON entity_schemas')));
    assert(/USING\s*\(\s*true\s*\)/i.test(sql.replace("visibility = 'public' AND status = 'active'", 'true')), 'the open-policy detector sees an open clause');
  });

  await check('one defaultSchemaId: routes/products.js defines none and takes lib/catalogue-write\'s, which binds it to the shop (queryAs); combo-templates and adopt use that one', () => {
    assert(!/(async )?function defaultSchemaId/.test(read('routes/products.js')), 'a second copy came back');
    assert(/const \{ defaultSchemaId \} = catwrite/.test(read('routes/products.js')));
    assert(/async function defaultSchemaId\(entity_id\) \{\s*const r = await queryAs\(\s*entity_id,/.test(read('lib/catalogue-write.js')));
    assert(/async function schemaFieldsOf\(entity_id, schema_id\)/.test(read('lib/catalogue-write.js')), 'schemaFieldsOf takes the shop');
    assert(/async function defaultSchemaWithFields\(entity_id\)/.test(read('lib/catalogue-write.js')), 'schema id and rules in one bound trip');
  });
  await check('every caller of the injected readers binds them: ensureDeclared, ensureDeclaredMany, commitFields, resolveColumns and mintProduct never get a bare query', () => {
    const CALL = /\b(ensureDeclaredMany|ensureDeclared|commitFields|resolveColumns|mintProduct)\(\{/g;
    const BOUND = /\bquery\s*:\s*(queryFor\(|require\('\.\.\/db'\)\.queryFor\(|\(text, params\) => db\.query\()/;
    const BARE = /[{,]\s*query\s*[,}]/;
    let seen = 0;
    for (const dir of ['lib', 'routes']) {
      for (const name of fs.readdirSync(path.join(ROOT, dir))) {
        if (!/\.js$/.test(name) || /^(catalogue-columns|mint-product)\.js$/.test(name)) continue; /* the two files that RECEIVE the reader */
        const text = read(dir + '/' + name);
        let m;
        while ((m = CALL.exec(text))) {
          const lineStart = text.lastIndexOf('\n', m.index) + 1;
          if (/^\s*(\*|\/\/|\/\*)/.test(text.slice(lineStart, m.index + 5)) || /function/.test(text.slice(lineStart, m.index))) continue;
          const window = text.slice(m.index, m.index + 260);
          seen++;
          assert(BOUND.test(window) && !BARE.test(window), dir + '/' + name + ' ' + m[1] + '() is given an unbound reader: ' + window.replace(/\s+/g, ' ').slice(0, 110));
        }
      }
    }
    assert(seen >= 10, 'the scan found the callers: ' + seen);
  });
  await check('the order freeze of a private shop reads through ops.shop_default_schema (routes/catalogue.js), and the has_catalogue sites through ops.shop_has_catalogue; no FROM entity_schemas is left in them', () => {
    const catalogue = read('routes/catalogue.js');
    assert(/FROM ops\.shop_default_schema\(\$1\)/.test(catalogue) && !/FROM entity_schemas/.test(catalogue));
    assert(/ops\.shop_has_catalogue\(i\.identity_id\)/.test(read('lib/business-search.js')) && !/entity_schemas/.test(code(read('lib/business-search.js').split('\n').map((l) => l.replace(/\/\*.*\*\//, '')).join('\n'))));
    assert((read('routes/relationships.js').match(/ops\.shop_has_catalogue\(i\.identity_id\)/g) || []).length === 2 && !/FROM entity_schemas/.test(read('routes/relationships.js')));
  });
  await check('the owner\'s preview binds to the owner and the public branch stays unbound (lib/catalogue-view.js: ONE reader for both statements of the pipeline)', () => {
    const view = read('lib/catalogue-view.js');
    assert(view.includes('const readSchema = schemaReader(asOwner, entity.identity_id, query);') && view.includes('(asOwner ? readers.bound(shopId) : query)') && view.includes("bound: (shopId) => require('../db').queryFor(shopId)"), 'the owner reader is readers.bound (the seam), which is the real bound reader');
    assert(/_pSchema = readSchema\(/.test(view) && /await readSchema\(\s*`SELECT field_key/.test(view), 'both statements take the same reader');
    assert(/\$\{asOwner \? '' : " AND visibility = 'public'"\}/.test(view), 'the public branch keeps its visibility predicate');
  });
  await check('network-build mirrorSchema writes the STORE\'s row bound to the store, with the id the identities UPDATE returned; no read of identities', () => {
    const run = read('lib/network-build-run.js');
    assert(/RETURNING bridge_id, identity_id/.test(run) && /mirrorSchema\(r\.rows\[0\]\.identity_id, nextVis\)/.test(run));
    const body = run.slice(run.indexOf('async function mirrorSchema'), run.indexOf('// ── PARTNERS'));
    assert(/withEntity\(shopId,/.test(body) && /entity_id = \$2/.test(body) && !/FROM identities/.test(body));
  });
  await check('a miss is not silent: catalogue-face and till readDeclared keep their log line on the bound read', () => {
    assert(/queryAs\(\s*e,[\s\S]{0,260}\.catch\(log\.orElse\('catalogue-face PUT \/: the read failed/.test(read('routes/catalogue-face.js')));
    assert(/queryAs\(\s*entity_id,[\s\S]{0,900}log\.fellBack\('till GET \/snapshot: the read failed/.test(read('routes/till.js')));
  });
  await check('T8 column exposure: only routes/schemas.js (own shop, auth route) selects whole schema rows or default_value / xref / via / leg; lib/catalogue-view names six explicit columns', () => {
    const offenders = [];
    for (const dir of ['lib', 'routes']) {
      for (const name of fs.readdirSync(path.join(ROOT, dir))) {
        if (!/\.js$/.test(name)) continue;
        const text = read(dir + '/' + name);
        const re = new RegExp(EXPOSES.source, 'gi');
        let m;
        while ((m = re.exec(text))) if (!(dir === 'routes' && name === 'schemas.js')) offenders.push(dir + '/' + name + ': ' + m[0].replace(/\s+/g, ' ').slice(0, 90));
      }
    }
    assert(!offenders.length, offenders.join(' | '));
    assert(/SELECT field_key, field_name, field_type, required, min_value, display_order\s+FROM schema_fields/.test(read('lib/catalogue-view.js')), 'the public view selects six explicit columns');
    assert(/auth\.entityOf/.test(read('routes/schemas.js')), 'routes/schemas.js reads the caller\'s own shop');
  });
  await check('T8 break: a route that returns SELECT * of entity_schemas is caught by the same detector', () => {
    assert(EXPOSES.test('SELECT * FROM entity_schemas WHERE entity_id = $1') && EXPOSES.test('SELECT default_value FROM schema_fields sf') && !EXPOSES.test('SELECT field_key, field_name FROM schema_fields WHERE schema_id = $1'));
  });
  await check('the offline guard is listed in scripts/guards.cjs and the CI step names the realstack file', () => {
    assert(/sec-75-entity-schemas\.test\.cjs/.test(read('scripts/guards.cjs')));
    assert(/tests\/sec-75-entity-schemas\.realstack\.cjs/.test(read('.github/workflows/ci.yml')) && /RUN-2026-11-14-b861-entity-schemas-fns\.sql/.test(read('.github/workflows/ci.yml')));
  });

  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

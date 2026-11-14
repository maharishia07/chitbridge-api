'use strict';
/**
 * tests/sec-185-identities-sweep.test.cjs — SEC-185 (step B of SEC-184), the offline half: the sweep ratchet, the migration text, the door helpers and the removed fallback.
 * CARD      18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * Run: node tests/sec-185-identities-sweep.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (an unbound or foreign read of identities answers no row; the fallback that answered one is gone)
 * The behaviour on a real Postgres is tests/sec-185-identities-rls.realstack.cjs (CI job `integration`); this file needs no database.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sweepTool = require('../tools/identities-sweep.cjs');
const { boundRead, boundEach } = require('../lib/bound-read');
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String(e && e.message).slice(0, 300)); } };
const B860 = read('migrations/RUN-2026-11-14-b860-identities-rls.sql');
const code = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

(async () => {
  await check('ratchet: the open (unbound) count has not risen above db/identities-sweep.baseline.json', () => {
    const base = JSON.parse(read('db/identities-sweep.baseline.json'));
    const open = sweepTool.count(sweepTool.sweep()).open || 0;
    assert(open <= base.open, 'open ' + open + ' > baseline ' + base.open + ': a new unbound read of identities (use db.queryAs / boundRead / withEntity)');
  });
  await check('classifier: a module query() is open, boundRead / queryAs is bound, a handle is in-tx, scripts are jobs', () => {
    const cls = (file, text) => sweepTool.classify(file, [text, 'SELECT x FROM identities WHERE identity_id = $1'], 1).cls;
    assert.strictEqual(cls('lib/x.js', 'const r = await query('), 'open');
    assert.strictEqual(cls('lib/x.js', 'const r = await boundRead(query, id,'), 'bound');
    assert.strictEqual(cls('lib/x.js', 'const r = await db.queryAs(id,'), 'bound');
    assert.strictEqual(cls('lib/x.js', 'const r = await db.query('), 'in-tx');
    assert.strictEqual(cls('scripts/x.js', 'await query('), 'job');
  });
  await check('migration: not in the migrate chain (RUN- prefix), ENABLE + FORCE, three policies each DROP IF EXISTS then CREATE, a rollback line and a CHECK', () => {
    const chain = require('../tools/migrate.cjs');
    assert(!(chain.chainFiles ? chain.chainFiles() : []).some((f) => /b860/.test(f)), 'the chain must not apply b860 on its own');
    assert(/ENABLE ROW LEVEL SECURITY/.test(code(B860)) && /FORCE ROW LEVEL SECURITY/.test(code(B860)));
    for (const p of ['identities_own_tree', 'identities_created_by_me', 'identities_read_counterparty']) {
      assert(new RegExp('DROP POLICY IF EXISTS ' + p + ' ON identities;\\s*CREATE POLICY ' + p + ' ON identities').test(code(B860)), p);
    }
    assert(/ROLL BACK[\s\S]*NO FORCE ROW LEVEL SECURITY/.test(B860) && /CHECK \(read-only\)/.test(B860) && /^BEGIN;/m.test(code(B860)) && /^COMMIT;/m.test(code(B860)));
  });
  await check('migration header: says it IS the file b857 calls b858, names the run order, and the key is the same NULLIF form as b855', () => {
    assert(/THIS IS THE FILE THE b857 HEADER MEANS BY "b858"/.test(B860) && /b857/.test(B860) && /RUN ORDER/.test(B860) && /identities-sweep\.cjs --check/.test(B860));
    assert(/NULLIF\(current_setting\('app\.current_entity', true\), ''\)::uuid/.test(code(B860)));
    assert(!/USING\s*\(\s*true\s*\)/i.test(code(B860)), 'no open policy');
  });
  await check('door helpers: the real query binds (.as), any other run is called with plain SQL (a unit stub keeps seeing what it saw)', async () => {
    const sent = [];
    const plain = async (sql, p) => { sent.push([sql, p]); return { rows: [] }; };
    await boundRead(plain, 'id1', 'SELECT 1', [1]); await boundEach(plain, ['a', 'b'], 'SELECT 2', (id) => [[id]], [['a', 'b']]);
    assert.deepStrictEqual(sent, [['SELECT 1', [1]], ['SELECT 2', [['a', 'b']]]]);
    const bound = []; const real = Object.assign(plain, { as: (id, sql, p) => { bound.push(['as', id]); return { rows: [] }; }, asEach: (ids) => { bound.push(['each', ids]); return { rows: [] }; } });
    await boundRead(real, 'id1', 'SELECT 1', [1]); await boundEach(real, ['a'], 'SELECT 2', (id) => [[id]], [['a']]);
    assert.deepStrictEqual(bound, [['as', 'id1'], ['each', ['a']]]);
    const db = require('../db'); assert(typeof db.query.as === 'function' && typeof db.query.asEach === 'function' && typeof db.queryAs === 'function');
  });
  await check('no fallback: lib/signin-lookup.js carries no FROM identities and no retry window; login sends the function only', () => {
    const src = read('lib/signin-lookup.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert(!/FROM identities|DIRECT|RETRY_MS|missingUntil/.test(src));
  });
  await check('break check: a direct read put back into signin-lookup is caught by the same detector', () => {
    const mutated = read('lib/signin-lookup.js').replace("'SELECT * FROM ops.signin_candidates($1, $2)'", "'SELECT identity_id FROM identities WHERE email = $2'");
    const src = mutated.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert(/FROM identities/.test(src), 'the detector must see it');
  });
  await check('credential doors bind: identity-auth, otp, signin, person-session, auth middleware and policy use boundRead / boundEach for the by-id identities statements', () => {
    for (const f of ['lib/identity-auth.js', 'lib/otp.js', 'routes/signin.js', 'lib/person-session.js', 'middleware/auth.js', 'lib/policy.js']) assert(/boundRead|boundEach/.test(read(f)), f);
    assert(/idx_identities_user_id/.test(read('routes/signin.js')), 'the cross-shop uniqueness of a User ID rests on the unique index, and the code says so');
  });
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

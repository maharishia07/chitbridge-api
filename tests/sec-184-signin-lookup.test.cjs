'use strict';
/**
 * tests/sec-184-signin-lookup.test.cjs — SEC-184 step A: the SECURITY DEFINER sign-in lookup (migrations/b857) and the api reading through it.
 *   1  the function's SQL text: definer, search_path pinned empty, every object qualified, LIMIT 10, exactly the eight columns, no secret column, no LIKE,
 *      REVOKE from PUBLIC / anon / authenticated and GRANT to cb_app, all inside ONE transaction, in schema ops (not an exposed one)
 *   2  lib/signin-lookup.js: what it sends, the short key, the unknown kind, and the fallback (a missing function → today's read, ONE logged warning, retried later)
 *   3  every pre-binding caller goes through the lookup (routes/signin.js, routes/entities.js, lib/identity-auth.js, lib/iddoc-verify.js), driven for real
 *   4  the connecting role: lib/db-role.js refuses a role that bypasses RLS (rolbypassrls) and server.js asks it before it listens
 *   B  a BREAK CHECK per fix: each detector is run on a mutated copy of the thing it guards and must go red
 * No network, no database. Run: node tests/sec-184-signin-lookup.test.cjs
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(API, rel), 'utf8');
let pass = 0;
const check = (what, fn) => {
  try { fn(); pass++; console.log('  ok   ' + what); } catch (e) { console.log('  FAIL ' + what + '\n         ' + String(e.message).slice(0, 300)); process.exitCode = 1; }
};
const checkAsync = async (what, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + what); } catch (e) { console.log('  FAIL ' + what + '\n         ' + String(e.message).slice(0, 300)); process.exitCode = 1; }
};

/* ── 1 · the migration's text ─────────────────────────────────────────────────────────────────────────────── */
const SQL = read('migrations/b857_signin_candidates_definer.sql');
/** the executable part: comment lines dropped */
const code = (text) => text.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
/** every problem the function's text has (empty = clean); the break checks feed it mutated copies */
function problemsOf(text) {
  const c = code(text);
  const out = [];
  if (!/CREATE OR REPLACE FUNCTION ops\.signin_candidates\(p_kind text, p_key text\)/.test(c)) out.push('not ops.signin_candidates(text, text)');
  if (!/SECURITY DEFINER/.test(c)) out.push('not SECURITY DEFINER');
  if (!/SET search_path = ''/.test(c)) out.push('search_path is not pinned empty');
  if (!/RETURNS TABLE \(identity_id uuid, identity_type text, parent_entity_id uuid, bridge_id text, display_name text, user_id text, email text, status text\)/.test(c)) out.push('columns are not the eight');
  if (/\bLIKE\b|\bILIKE\b|~~/i.test(c)) out.push('a wildcard match');
  const selects = c.match(/RETURN QUERY SELECT[\s\S]*?LIMIT 10;/g) || [];
  if (selects.length !== 6) out.push('expected 6 branches, found ' + selects.length);
  if (selects.some((b) => !/ORDER BY i\.identity_id LIMIT 10;/.test(b))) out.push('a branch without ORDER BY and LIMIT 10');
  if (selects.some((b) => /\b(otp_code|otp_code_hash|pin_hash|pin_attempts|policy_flags|connector_config|provision_key_hash)\b/.test(b.replace(/i\.otp_contact/g, '')))) out.push('a secret column is selected');
  if (selects.some((b) => /\bphone\b/.test(b.split('FROM')[0]))) out.push('phone is returned');
  const bare = c.replace(/pg_catalog\.\w+/g, '').replace(/public\.\w+/g, '').replace(/\bi\.\w+/g, '');
  if (/\bFROM\s+(?!public\.|pg_catalog\.)[a-z_]+\s+(i|d)\b/.test(c)) out.push('an unqualified table');
  if (/\b(lower|length|btrim|split_part|substr|strpos|string_to_array)\s*\(/.test(bare)) out.push('an unqualified function (path is empty)');
  const begin = c.indexOf('BEGIN;'); const commit = c.lastIndexOf('COMMIT;');
  const create = c.indexOf('CREATE OR REPLACE FUNCTION'); const grant = c.indexOf('GRANT EXECUTE ON FUNCTION ops.signin_candidates(text, text) TO cb_app;');
  if (begin < 0 || commit < 0 || !(begin < create && create < grant && grant < commit)) out.push('create and grants are not in one transaction');
  if (!/REVOKE ALL ON FUNCTION ops\.signin_candidates\(text, text\) FROM PUBLIC;/.test(c)) out.push('no REVOKE from PUBLIC');
  if (!/REVOKE ALL ON FUNCTION ops\.signin_candidates\(text, text\) FROM anon;/.test(c)) out.push('no REVOKE from anon');
  if (!/REVOKE ALL ON FUNCTION ops\.signin_candidates\(text, text\) FROM authenticated;/.test(c)) out.push('no REVOKE from authenticated');
  if (c.indexOf('REVOKE ALL ON FUNCTION') > c.indexOf('GRANT EXECUTE')) out.push('grant before revoke');
  if (/GRANT EXECUTE[^;]*\b(PUBLIC|anon|authenticated)\b/.test(c)) out.push('EXECUTE granted to a closed role');
  return out;
}
check('b857: the function text is clean (definer, search_path empty, qualified, 8 columns, LIMIT 10, no secret, revoke then grant in one transaction)', () => assert.deepStrictEqual(problemsOf(SQL), []));
check('b857: it lives in schema ops, never public (the Data API exposes public)', () => { assert(!/FUNCTION public\./i.test(code(SQL))); assert(/ATHI CONFIRMS/.test(SQL) && /Exposed schemas/.test(SQL)); });
check('b857: anon and authenticated are revoked only when the role exists (a fresh CI database has none) and the ROLL BACK is written', () => { assert(/pg_roles WHERE rolname = 'anon'/.test(SQL)); assert(/DROP FUNCTION IF EXISTS ops\.signin_candidates\(text, text\)/.test(SQL)); });
check('b857: every kind the api can send is a branch, and an unknown kind raises 22023', () => {
  const lookup = require('../lib/signin-lookup');
  for (const k of lookup.KINDS) assert(new RegExp("p_kind = '" + k + "'").test(code(SQL)) , k);
  assert(/ERRCODE = '22023'/.test(SQL));
  assert.deepStrictEqual(lookup.COLUMNS.split(',').map((c) => c.trim()), ['identity_id', 'identity_type', 'parent_entity_id', 'bridge_id', 'display_name', 'user_id', 'email', 'status']);
});

/* ── 2 · lib/signin-lookup.js ─────────────────────────────────────────────────────────────────────────────── */
const logger = require('../lib/logger');
const warnings = [];
const realWarn = logger.warn;
logger.warn = (msg, meta) => { warnings.push({ msg, meta }); };
delete require.cache[require.resolve('../lib/signin-lookup')];
const lookup = require('../lib/signin-lookup');
const missing = (code) => Object.assign(new Error('function ops.signin_candidates(text, text) does not exist'), { code });
const ROW = { identity_id: '11111111-1111-4111-8111-111111111111', identity_type: 'entity', parent_entity_id: null, bridge_id: 'B1', display_name: 'Tea Shop', user_id: 'teashop', email: 'a@x.com', status: 'active' };

(async () => {
  await checkAsync('lookup: one statement, the function, kind then key as parameters (never in the text)', async () => {
    const sent = [];
    const rows = await lookup.candidates(async (sql, p) => { sent.push([sql, p]); return { rows: [ROW] }; }, 'email', 'a@x.com');
    assert.deepStrictEqual(rows, [ROW]); assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0][0], 'SELECT * FROM ops.signin_candidates($1, $2)'); assert.deepStrictEqual(sent[0][1], ['email', 'a@x.com']);
  });
  await checkAsync('lookup: a key under three characters answers nothing and sends nothing (the function does the same)', async () => {
    let n = 0; const run = async () => { n++; return { rows: [ROW] }; };
    assert.deepStrictEqual(await lookup.candidates(run, 'handle', 'ab'), []); assert.deepStrictEqual(await lookup.candidates(run, 'name', '  x '), []); assert.deepStrictEqual(await lookup.candidates(run, 'email', null), []);
    assert.strictEqual(n, 0);
  });
  await checkAsync('lookup: an unknown kind throws (a programming error, as the function raises)', async () => {
    await assert.rejects(() => lookup.candidates(async () => ({ rows: [] }), 'like', 'abc'), /unknown kind/);
  });
  for (const code of ['42883', '42501']) {
    await checkAsync('no fallback (SEC-185): ' + code + ' → the error is thrown, logged, and NO direct read of identities is sent', async () => {
      warnings.length = 0; const errors = []; const realError = logger.error; logger.error = (msg, meta) => { errors.push({ msg, meta }); }; const sent = [];
      const run = async (sql) => { sent.push(sql); throw missing(code); };
      try { await assert.rejects(() => lookup.candidates(run, 'handle', 'teashop'), /does not exist/); await assert.rejects(() => lookup.candidates(run, 'name', 'Tea Shop'), /does not exist/); } finally { logger.error = realError; }
      assert.strictEqual(sent.length, 2, 'one statement per call, the function only'); assert(sent.every((s) => /ops\.signin_candidates/.test(s)), 'only the function is asked'); assert(sent.every((s) => !/FROM identities/.test(s)));
      assert.strictEqual(errors.length, 2); assert.strictEqual(errors[0].msg, 'signin.lookup.function_unavailable'); assert.strictEqual(errors[0].meta.code, code); assert.strictEqual(warnings.length, 0);
    });
  }
  await checkAsync('3F000 (invalid schema) is thrown too, not logged as a missing function', async () => {
    await assert.rejects(() => lookup.candidates(async () => { throw missing('3F000'); }, 'email', 'a@x.com'), /does not exist/);
  });
  await checkAsync('doc kind: a PAN or GSTIN hash finds nothing (stand-in and the SQL text both name PHONE and EMAIL only)', async () => {
    const stub = require('./lib/signin-lookup-stub.cjs');
    const docs = [{ identity_id: ROW.identity_id, scheme: 'PAN', value_hash: 'hp', status: 'verified', verified_at: 'x' }, { identity_id: ROW.identity_id, scheme: 'PHONE', value_hash: 'hh', status: 'verified', verified_at: 'x' }];
    assert.deepStrictEqual(stub.lookup([ROW], 'doc', 'PAN:hp', docs), []); assert.deepStrictEqual(stub.lookup([ROW], 'doc', 'GSTIN:hp', docs), []); assert.strictEqual(stub.lookup([ROW], 'doc', 'PHONE:hh', docs).length, 1);
    assert(code(SQL).includes("d.scheme IN ('PHONE', 'EMAIL')"));
  });
  await checkAsync('any other error is thrown, not swallowed (a broken database is not "no account")', async () => {
    await assert.rejects(() => lookup.candidates(async () => { throw Object.assign(new Error('boom'), { code: '57P01' }); }, 'email', 'a@x.com'), /boom/);
  });
  check('the module has no direct read left: no DIRECT table, no reset, no retry window, no FROM identities', () => {
    assert.strictEqual(lookup.DIRECT, undefined); assert.strictEqual(lookup.reset, undefined); assert.strictEqual(lookup.RETRY_MS, undefined);
    assert(!/FROM identities/.test(read('lib/signin-lookup.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')));
  });

  /* ── 3 · every pre-binding caller goes through the lookup ───────────────────────────────────────────── */
  const DIRECT_READ = /FROM identities\s+WHERE\s+(LOWER\(user_id\)|LOWER\(display_name\)|email\s*=|phone|otp_contact|\$\{COLS\})|WHERE (email|LOWER\(user_id\)) = /;
  /** the lines of a source file that read identities by what the person TYPED without the lookup (empty = clean) */
  const directLookups = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /identities|identity_documents/.test(l) && /(email = \$|LOWER\(user_id\) = |LOWER\(display_name\) = |phone = \$|otp_contact = \$|value_hash = )/.test(l) && !/signin_candidates/.test(l));
  const CALLERS = ['routes/signin.js', 'routes/entities.js', 'lib/identity-auth.js', 'lib/iddoc-verify.js'];
  check('callers: no typed-key read of identities or identity_documents is left outside lib/signin-lookup.js', () => {
    for (const f of CALLERS) assert.deepStrictEqual(directLookups(read(f)).map((l) => l.trim().slice(0, 100)), [], f + ' still reads directly');
  });
  check('callers: each names the lookup', () => { for (const f of CALLERS) assert(/signin-lookup/.test(read(f)), f); });
  check('callers: the credential read after the lookup is BY ID (rowsOfCandidates), one statement, ANY(uuid[])', () => assert(/identity_id = ANY\(\$1::uuid\[\]\)/.test(read('lib/identity-auth.js'))));
  check('rest of the list: auth.js actorRow and otp.js read BY ID from a signed token / a known identity (no typed key), unchanged by step A', () => {
    assert(/WHERE identity_id = \$1 AND identity_type = 'actor'/.test(read('middleware/auth.js'))); assert(!/signin-lookup/.test(read('middleware/auth.js')));
    for (const l of read('lib/otp.js').split('\n')) assert(!/email = \$|LOWER\(user_id\)/.test(l));
  });

  /** drive findLoginIdentity / findEntityByNameOrHandle / identitiesByVerifiedContact with a recording db and assert what it sent */
  const identityAuth = require('../lib/identity-auth');
  const iddoc = require('../lib/iddoc-verify');
  const driven = async (fn) => { const sent = []; const run = async (sql, p) => { sent.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), p }); if (/ops\.signin_candidates/.test(sql)) return { rows: p[0] === 'handle' && p[1] === 'teashop' ? [ROW] : [] }; return { rows: [{ ...ROW, pin_hash: null }] }; }; await fn(run); return sent; };
  await checkAsync('driven: a typed handle → the function (kind handle), then ONE read by id; no direct handle read', async () => {
    const sent = await driven((run) => identityAuth.findLoginIdentity(run, 'teashop'));
    assert(sent.some((s) => /ops\.signin_candidates/.test(s.sql) && s.p[0] === 'handle' && s.p[1] === 'teashop'));
    assert(sent.some((s) => /identity_id = ANY\(\$1::uuid\[\]\)/.test(s.sql))); assert(sent.every((s) => !/WHERE LOWER\(user_id\)|WHERE email =/.test(s.sql)), JSON.stringify(sent.map((s) => s.sql)));
  });
  await checkAsync('driven: a typed e-mail → the function (email, contact kinds), then ONE read by id', async () => {
    const sent = await driven((run) => identityAuth.findLoginIdentity(run, 'a@x.com'));
    const kinds = sent.filter((s) => /ops\.signin_candidates/.test(s.sql)).map((s) => s.p[0]);
    assert(kinds.includes('email') && kinds.includes('contact'), kinds.join()); assert(sent.every((s) => !/WHERE email = /.test(s.sql)));
    assert.strictEqual(sent.filter((s) => /identity_id = ANY/.test(s.sql)).length >= 1, true);
  });
  await checkAsync('driven: a hit and a miss cost the same number of database trips (the by-id read always runs)', async () => {
    const hit = await driven((run) => identityAuth.rowsOfCandidates(run, [ROW.identity_id]));
    const miss = await driven((run) => identityAuth.rowsOfCandidates(run, []));
    assert.strictEqual(hit.length, miss.length);
  });
  await checkAsync('driven: a mobile number → the function (phone), a name → the function (name)', async () => {
    const a = await driven((run) => identityAuth.findLoginIdentity(run, '+919812345678')); assert(a.some((s) => /ops\.signin_candidates/.test(s.sql) && s.p[0] === 'phone'), JSON.stringify(a.map((s) => s.p)));
    const b = await driven((run) => identityAuth.findEntityByNameOrHandle(run, 'Tea Shop')); assert(b.some((s) => s.p[0] === 'handle') && b.some((s) => s.p[0] === 'name'));
  });
  await checkAsync('driven: a verified document → the function (doc, SCHEME:hash[,hash]) in ONE trip, not a second reader of identity_documents', async () => {
    const sent = await driven((run) => iddoc.identitiesByVerifiedContact(run, 'EMAIL', ['h1', 'h2']));
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].p[0], 'doc'); assert.strictEqual(sent[0].p[1], 'EMAIL:h1,h2'); assert(!/identity_documents/.test(sent[0].sql));
  });
  await checkAsync('driven: register and profile ask "handle taken?" through the function', async () => {
    const src = read('routes/entities.js'); assert((src.match(/signinLookup\.candidates\(query, 'handle'/g) || []).length === 2);
  });
  await checkAsync('the refusal stays generic: signin.js unknownAccount still spends the time and answers SIGNIN_REFUSED, unchanged', async () => {
    const s = read('routes/signin.js'); assert(/const unknownAccount = async \(req, res\) => \{\s+await identityAuth\.spendCheckTime\(\);\s+await identityAuth\.padHashes\(req\.contactPad \|\| 0\);\s+return refused\(req, res, 'NO_ACCOUNT'\);/.test(s));
  });

  /* ── 4 · the connecting role must not bypass row security ───────────────────────────────────────────── */
  const dbRole = require('../lib/db-role');
  check('role: rolbypassrls = false and rolsuper = false → ok; either true → fatal off a local stack, warn on one', () => {
    assert.strictEqual(dbRole.verdict({ current_user: 'cb_app', rolsuper: false, rolbypassrls: false }, false).level, 'ok');
    assert.strictEqual(dbRole.verdict({ current_user: 'postgres', rolsuper: false, rolbypassrls: true }, false).level, 'fatal');
    assert.strictEqual(dbRole.verdict({ current_user: 'postgres', rolsuper: true, rolbypassrls: false }, false).level, 'fatal');
    assert.strictEqual(dbRole.verdict({ current_user: 'postgres', rolsuper: false, rolbypassrls: true }, true).level, 'warn');
    assert.strictEqual(dbRole.verdict(null, false).level, 'warn');
  });
  check('role: the boot asks db-role before it listens (server.js), and the SQL reads rolbypassrls of current_user', () => {
    const server = read('server.js'); assert(/bootCheck/.test(server) && /db-role/.test(server)); assert(server.indexOf('bootCheck') < server.indexOf('.listen(')); assert(read('lib/db-role.js').includes('roleFacts(runQuery)'));
    assert(/rolbypassrls FROM pg_roles WHERE rolname = current_user/.test(dbRole.ROLE_SQL));
  });

  /* ── B · break checks: each detector goes red on a mutated copy ─────────────────────────────────────── */
  const mutated = (from, to) => { assert(SQL.includes(from), 'mutation anchor: ' + from); return SQL.split(from).join(to); };
  check('break: search_path pin removed → caught', () => assert(problemsOf(mutated("SET search_path = ''", '')).includes('search_path is not pinned empty')));
  check('break: SECURITY DEFINER removed → caught', () => assert(problemsOf(mutated('SECURITY DEFINER\nSET', 'SET')).includes('not SECURITY DEFINER')));
  check('break: REVOKE from authenticated removed → caught', () => assert(problemsOf(mutated('REVOKE ALL ON FUNCTION ops.signin_candidates(text, text) FROM authenticated;', '')).includes('no REVOKE from authenticated')));
  check('break: REVOKE from PUBLIC removed → caught', () => assert(problemsOf(mutated('REVOKE ALL ON FUNCTION ops.signin_candidates(text, text) FROM PUBLIC;', '')).includes('no REVOKE from PUBLIC')));
  check('break: GRANT EXECUTE to PUBLIC added → caught', () => assert(problemsOf(mutated('TO cb_app;\n\nCOMMIT', 'TO cb_app;\nGRANT EXECUTE ON FUNCTION ops.signin_candidates(text, text) TO PUBLIC;\n\nCOMMIT')).includes('EXECUTE granted to a closed role')));
  check('break: LIMIT 10 removed from a branch → caught', () => assert(problemsOf(mutated("i.otp_contact = p_key ORDER BY i.identity_id LIMIT 10;", "i.otp_contact = p_key;")).length > 0));
  check('break: pin_hash added to a branch → caught', () => assert(problemsOf(mutated("i.email::text, i.status::text\n      FROM public.identities i WHERE i.email", 'i.email::text, i.pin_hash::text\n      FROM public.identities i WHERE i.email')).includes('a secret column is selected')));
  check('break: a LIKE match added → caught', () => assert(problemsOf(mutated('WHERE i.email = pg_catalog.lower(p_key)', "WHERE i.email LIKE p_key || '%'")).includes('a wildcard match')));
  check('break: an unqualified function (lower) → caught', () => assert(problemsOf(mutated('i.email = pg_catalog.lower(p_key)', 'i.email = lower(p_key)')).includes('an unqualified function (path is empty)')));
  check('break: the COMMIT before the GRANT (grants outside the transaction) → caught', () => assert(problemsOf(mutated('TO cb_app;\n\nCOMMIT;', 'TO cb_app;\n').replace('GRANT USAGE ON SCHEMA', 'COMMIT;\nGRANT USAGE ON SCHEMA')).includes('create and grants are not in one transaction')));
  check('break: a caller that reads the typed key directly again → caught by the caller detector', () => {
    const src = read('routes/signin.js').replace("signinLookup.candidates(query, 'email', email)", "query('SELECT identity_id FROM identities WHERE email = $1', [email])");
    assert(directLookups(src).length > 0);
    assert.strictEqual(directLookups(read('lib/iddoc-verify.js').replace('/* SEC-184:', "const x = 'SELECT identity_id FROM identity_documents WHERE value_hash = ANY($1)';\n  /* SEC-184:")).length > 0, true);
  });
  check('break: the doc kind open to any scheme → caught', () => assert(!code(mutated("d.scheme IN ('PHONE', 'EMAIL') AND ", '')).includes("d.scheme IN ('PHONE', 'EMAIL')")));
  check('break: a role that bypasses RLS is not "ok"', () => assert.notStrictEqual(dbRole.verdict({ current_user: 'x', rolsuper: false, rolbypassrls: true }, false).level, 'ok'));
  logger.warn = realWarn;
  console.log('\n' + pass + ' checks');
})();

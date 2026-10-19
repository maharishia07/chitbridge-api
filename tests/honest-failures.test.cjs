/**
 * honest-failures.test.cjs — A FAILURE IS NEVER "NOTHING THERE" (round T2-HONEST, 14 Oct).
 *
 *   1. a network member read on a failing database ANSWERS AN ERROR (words + NETWORK_READ_FAILED, 503) — never "no members"
 *   2. no route answers a 500 with the raw error text — safeErr (lib/respond) everywhere a route catches
 *   3. ONE health(last_seen) for a connector — routes/connectors.js; integrations reads it
 *   4. the silent-catch count over lib/ + routes/ never rises above the ratchet (scripts/empty-catches.cjs)
 *
 * Run: node tests/honest-failures.test.cjs   · no DB (the query is stubbed to fail), no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

/* ⚠️ stub the read BEFORE network-membership takes its own reference to it: every statement fails, as when the DB is down */
const db = require(path.join(API, 'db'));
db.query = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); };
const logger = require(path.join(API, 'lib', 'logger'));
const LOGGED = [];
['warn', 'error'].forEach((lv) => { logger[lv] = (m) => { LOGGED.push(lv + ':' + m); }; });
const membership = require(path.join(API, 'lib', 'network-membership.js'));
const net = require(path.join(API, 'lib', 'network-offers.js'));

/** ⭐ THE RATCHET — lower it when the count falls; never raise it. 468 on main (14 Oct) → 46 after T2-HONEST (the rest: browser /
 *  vendored / zero-dependency / engine TIER B files that may not take lib/logger — tests/engine-manifest.js). */
const SILENT_CATCH_RATCHET = 46;

let pass = 0, fail = 0;
const tests = [];
const it = (name, fn) => tests.push([name, fn]);
const BRAND = '11111111-1111-4111-8111-111111111111', STORE = '22222222-2222-4222-8222-222222222222';

async function failsLoudly(what, p) {
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert.ok(err, what + ' answered as if the read worked');
  assert.strictEqual(err.code, 'NETWORK_READ_FAILED', what + ' failed without the code');
  assert.strictEqual(err.status, 503);
  assert.ok(/could not read who is in the network/i.test(err.message), what + ' failed without the words');
}

it('⭐⭐ roster · members · brandsOf · standing · treeOf on a failing DB throw NETWORK_READ_FAILED, never an empty answer', async () => {
  await failsLoudly('roster', membership.roster(BRAND));
  await failsLoudly('members', membership.members(BRAND));
  await failsLoudly('brandsOf', membership.brandsOf(STORE, [BRAND]));
  await failsLoudly('standing', membership.standing(STORE, [BRAND]));
  await failsLoudly('treeOf', membership.treeOf('cb-abc'));
  await failsLoudly('treeOf under self', membership.treeOf('cb-abc', { under: 'self' }));
  assert.ok(LOGGED.some((l) => /^error:network member read failed/.test(l)), 'the failure was not logged');
});

it('⭐ nothing asked → nothing read: an empty question still answers empty without touching the DB', async () => {
  assert.deepStrictEqual(await membership.roster(null), []);
  assert.strictEqual((await membership.brandsOf(STORE, [])).size, 0);
  assert.deepStrictEqual(await membership.standing(STORE, []), {});
});

it('⭐⭐ answerReadFailed sends 503 + words + code; anything else is left to the route', () => {
  const sent = {};
  const res = { status(c) { sent.status = c; return this; }, json(b) { sent.body = b; return this; } };
  const e = Object.assign(new Error('x'), { code: 'NETWORK_READ_FAILED' });
  assert.strictEqual(membership.answerReadFailed(res, e), true);
  assert.strictEqual(sent.status, 503);
  assert.strictEqual(sent.body.code, 'NETWORK_READ_FAILED');
  assert.ok(sent.body.message && !/ECONNREFUSED/.test(sent.body.message), 'the DB text reached the client');
  assert.strictEqual(membership.answerReadFailed(res, new Error('other')), false);
});

it('⭐ orElse: an optional part falls back on its own failure, but a failed member read still fails the answer', async () => {
  assert.deepStrictEqual(await Promise.reject(new Error('x')).catch(membership.orElse('t', [])), []);
  await failsLoudly('orElse', Promise.reject(Object.assign(new Error('could not read who is in the network'), { code: 'NETWORK_READ_FAILED', status: 503 }))
    .catch(membership.orElse('t', [])));
});

it('⭐⭐ the push after a saved change does not throw, and SAYS no store was told (code + words), never a silent 0', async () => {
  const p = await net.pushToNetwork(BRAND, 'test');
  assert.strictEqual(p.stores, 0);
  assert.strictEqual(p.code, 'NETWORK_READ_FAILED');
  assert.ok(p.why && /not told/.test(p.why));
});

it('⭐⭐ no route answers a 500 with the raw error text — safeErr everywhere a route catches', () => {
  const RAW = /status\(500\)[^;]*(\b(e|err|error|ex)\.message\b|String\(\s*(e|err)\s*\))/;
  /* SEC-FIX2 L2: a 200 `ok:false` that carries the raw text as `why` is the same leak by another door (entities routing/preview, till listen) */
  const RAW_WHY = /res\.json\(\{[^}]*\bwhy:\s*String\(\s*(e|err)(?:\s*&&\s*\1)?\.message\b/;
  const bad = [];
  for (const f of fs.readdirSync(path.join(API, 'routes')).filter((x) => x.endsWith('.js'))) {
    fs.readFileSync(path.join(API, 'routes', f), 'utf8').split('\n').forEach((l, i) => { if (RAW.test(l) || RAW_WHY.test(l)) bad.push(f + ':' + (i + 1)); });
  }
  assert.deepStrictEqual(bad, [], 'a 500 (or an ok:false why) sends the error text to the caller — use safeErr(e) (lib/respond)');
});

it('⭐ ONE health(last_seen): defined in routes/connectors.js only; integrations reads that one', () => {
  const defs = [];
  for (const dir of ['routes', 'lib']) for (const f of fs.readdirSync(path.join(API, dir)).filter((x) => x.endsWith('.js'))) {
    if (/function health\s*\(\s*last_seen\s*\)/.test(fs.readFileSync(path.join(API, dir, f), 'utf8'))) defs.push(dir + '/' + f);
  }
  assert.deepStrictEqual(defs, ['routes/connectors.js']);
  /* SET-35: integrations reads the rows from lib/connector-rows, the one reader of routes/connectors.health */
  assert.ok(/require('../routes/connectors')/.test(fs.readFileSync(path.join(API, 'lib', 'connector-rows.js'), 'utf8')));
  assert.ok(/require('../lib/connector-rows')/.test(fs.readFileSync(path.join(API, 'routes', 'integrations.js'), 'utf8')));
  const { health } = require(path.join(API, 'routes', 'connectors.js'));
  assert.strictEqual(health(null), 'offline');
  assert.strictEqual(health(new Date().toISOString()), 'live');
  assert.strictEqual(health(new Date(Date.now() - 5 * 60e3).toISOString()), 'slow');
  assert.strictEqual(health(new Date(Date.now() - 20 * 60e3).toISOString()), 'offline');
});

it('⭐⭐ THE RATCHET: silent catches over lib/ + routes/ stay at or under ' + SILENT_CATCH_RATCHET, () => {
  const { count, SCOPE } = require(path.join(API, 'scripts', 'empty-catches.cjs'));
  const { total, where } = count(SCOPE);
  assert.ok(total <= SILENT_CATCH_RATCHET, total + ' silent catches (ratchet ' + SILENT_CATCH_RATCHET + ') — log it: log.fellBack(what, e) / '
    + '.catch(log.orElse(what, value)). Where: ' + JSON.stringify(where));
});

it('the counter: silent handlers count, logged ones do not', () => {
  const { silentCatches } = require(path.join(API, 'scripts', 'empty-catches.cjs'));
  assert.strictEqual(silentCatches('try { a() } catch (_) {}\nq().catch(() => ({ rows: [] }));\ntry { b() } catch (e) { return null; }').length, 3);
  assert.strictEqual(silentCatches("try { a() } catch (e) { log.fellBack('x', e); }\nq().catch(log.orElse('x', []));\ntry { b() } catch (e) { throw e; }").length, 0);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();

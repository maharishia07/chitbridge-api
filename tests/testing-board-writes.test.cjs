'use strict';
/**
 * tests/testing-board-writes.test.cjs — WHO WRITES WHAT EVERY SHOP READS (SEC-SMALL item 3, 2026-10-14).
 *
 * The test board is platform data: one shared board, read by every signed-in person (lib/testboard.js). Writing a
 * shared row — a case, a CMDB record — was gated for the CMDB on 2026-09-28 (testboard.canWrite) and deliberately NOT
 * for the older case routes: "a separate, reviewed step". This is that step. Any signed-in shop could reseed, rebuild,
 * close or author the product's own suite that every other shop reads.
 *
 * ⭐ ONE DOOR: routes/testing.js boardRefused → testboard.canWrite = the board's own entity · TEST_BOARD_WRITERS · the
 * platform root (lib/platformroot — the "platform role"). The SERVER decides and answers 403 with a code.
 * ⚠️ AND THE PER-RAISER WRITES STAY OPEN. A tester records results, raises incidents, writes requirements and attaches
 * evidence under their own entity (testboard.entityForFinding / mine) — gating those would lock out every tester and
 * the CI key (middleware/auth.js KEY_ROUTES.testing). This file fails if one of them grows the gate by accident.
 *
 * Run: node tests/testing-board-writes.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(API, 'routes', 'testing.js'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/** comments blanked, so a route named in prose never counts */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
const lines = CODE.split('\n');
const HANDLERS = [];
lines.forEach((l, i) => { const m = l.match(/^router\.(get|post|patch|put|delete)\('([^']+)'/); if (m) HANDLERS.push({ verb: m[1].toUpperCase(), route: m[2], from: i }); });
HANDLERS.forEach((h, i) => { h.to = i + 1 < HANDLERS.length ? HANDLERS[i + 1].from : lines.length; h.body = lines.slice(h.from, h.to).join('\n'); });
const handler = (verb, route) => { const h = HANDLERS.find((x) => x.verb === verb && x.route === route); assert.ok(h, verb + ' ' + route + ' is gone'); return h; };

console.log('\nTHE SHARED-BOARD WRITES ASK THE GATE FIRST\n');

/** the acts of judgement on the SHARED board — the same set middleware/auth.js withholds from a CI key, plus the CMDB */
const SHARED_WRITES = [['POST', '/cases/close'], ['POST', '/cases/import'], ['POST', '/cases/seed'], ['POST', '/cases/gherkin'], ['PUT', '/cmdb/:ci'], ['POST', '/cmdb/seed']];
for (const [v, r] of SHARED_WRITES) {
  it('⚠️⚠️ ' + v + ' ' + r + ' refuses a non-writer BEFORE any read or write', () => {
    const h = handler(v, r);
    const gate = h.body.indexOf('boardRefused(req, res)');
    assert.ok(gate > 0, 'no boardRefused in the handler');
    const firstDb = Math.min(...['withEntity(', 'query(', 'importCases(', 'upsertVersioned('].map((k) => { const i = h.body.indexOf(k); return i < 0 ? Infinity : i; }));
    assert.ok(firstDb > gate, 'the database is touched at ' + firstDb + ', the gate asked at ' + gate);
  });
}

console.log('\nTHE PER-RAISER WRITES AND THE READS STAY OPEN TO EVERY SIGNED-IN PERSON\n');

const OPEN = [['POST', '/results'], ['POST', '/results/junit'], ['POST', '/requirements'], ['PATCH', '/requirements/:id'],
  ['POST', '/incidents'], ['PATCH', '/incidents/:id'], ['POST', '/evidence'], ['POST', '/changes'], ['POST', '/releases'], ['POST', '/trace']];
for (const [v, r] of OPEN) {
  it(v + ' ' + r + ' is NOT behind the board gate (a tester is not a board writer)', () => {
    assert.ok(handler(v, r).body.indexOf('boardRefused(') < 0, 'the gate crept onto a per-raiser route — every tester and the CI key would be refused');
  });
}
it('no GET asks the gate — reading the board was always the point', () => {
  HANDLERS.filter((h) => h.verb === 'GET').forEach((h) => assert.ok(h.body.indexOf('boardRefused(') < 0, 'GET ' + h.route + ' asks the write gate'));
});
it('the refusal carries a CODE the screen can branch on, and the sentence', () => {
  assert.ok(/code: 'NOT_BOARD_WRITER'/.test(SRC) && /Not a writer of the shared board/.test(SRC));
});
it('cmdbRefused is gone — one gate, one name', () => { assert.ok(!/cmdbRefused/.test(CODE)); });

console.log('\nTHE DOOR ITSELF — testboard.canWrite with the platform root\n');

/** reload testboard + platformroot under a given environment (both read env at require time) */
function fresh(env) {
  const keys = ['TEST_BOARD_ENTITY', 'TEST_BOARD_WRITERS', 'PLATFORM_ROOT_ENTITY'];
  const prev = {}; keys.forEach((k) => { prev[k] = process.env[k]; if (env[k]) process.env[k] = env[k]; else delete process.env[k]; });
  for (const f of ['testboard.js', 'platformroot.js']) delete require.cache[require.resolve(path.join(API, 'lib', f))];
  require(path.join(API, 'lib', 'platformroot.js'));   /* reads PLATFORM_ROOT_ENTITY at require time — load it while the env is set */
  const tb = require(path.join(API, 'lib', 'testboard.js'));
  keys.forEach((k) => { if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k]; });
  return tb;
}
const BOARD = '00000000-0000-4000-8000-0000000000b0', SHOP = '11111111-1111-4111-8111-111111111111', ROOT = '33333333-3333-4333-8333-333333333333';
it('⭐ the platform root writes the shared board without being named in TEST_BOARD_WRITERS', () => {
  const tb = fresh({ TEST_BOARD_ENTITY: BOARD, PLATFORM_ROOT_ENTITY: ROOT });
  assert.strictEqual(tb.canWrite(ROOT), true, 'the operator was refused their own board');
  assert.strictEqual(tb.canWrite(BOARD), true);
  assert.strictEqual(tb.canWrite(SHOP), false, 'a shop got in');
});
it('no root configured → nothing extra opens (a shop is still refused)', () => {
  const tb = fresh({ TEST_BOARD_ENTITY: BOARD });
  assert.strictEqual(tb.canWrite(SHOP), false);
  assert.strictEqual(tb.canWrite(ROOT), false, 'an unconfigured root uuid must mean nothing');
});
it('per-tenant board (no TEST_BOARD_ENTITY): a shop still writes its own board', () => {
  assert.strictEqual(fresh({}).canWrite(SHOP), true);
});
fresh({});   /* leave the modules as the environment has them */

console.log('\n' + (process.exitCode ? '✗ failed' : '✓ ' + pass + ' passed') + ' · ' + pass + ' checks\n');

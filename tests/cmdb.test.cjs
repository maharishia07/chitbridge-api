'use strict';
/**
 * cmdb.test.cjs — THE CMDB RECORDS, AND WHO MAY WRITE THEM (2026-09-28).
 *
 * Athi: *"can it be linked in the cmdb database as part of this capability, so anyone can look at this?"* — then
 * *"store it in the cloud database"*. Records live on the shared board as `definition` kind 'cmdb'; their shape is
 * lib/cmdb.js; the routes are in routes/testing.js; every shop can read them and only a board writer can change them.
 *
 * Run: node tests/cmdb.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const cmdb = require('../lib/cmdb');
const ROUTES = fs.readFileSync(path.join(API, 'routes', 'testing.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('\nTHE SHIPPED RECORDS\n');
const DIR = path.join(API, 'data', 'cmdb');
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((n) => /\.json$/.test(n)) : [];
it('the API ships at least one record (the seed has something to load)', () => {
  assert.ok(files.length >= 1, 'data/cmdb/ is empty or missing');
});
files.forEach((n) => it(n + ' fits the shape, and its file is named after its CI id', () => {
  const r = JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
  const v = cmdb.shape(r);
  assert.ok(v.ok, v.why);
  assert.strictEqual(n, r.ci + '.json', 'a record file must be named <CI>.json');
}));
it('⭐ CAP-SIGNIN has a way in, a way out, and tests (Athi\'s rule for a useful capability)', () => {
  const r = JSON.parse(fs.readFileSync(path.join(DIR, 'CAP-SIGNIN.json'), 'utf8'));
  assert.deepStrictEqual(cmdb.flags(r), [], 'CAP-SIGNIN raises flags: ' + cmdb.flags(r).join(', '));
});

console.log('\nNO NEW CAPABILITY WITHOUT A WAY IN, A WAY OUT AND A TEST\n');
/**
 * ⭐⭐ Athi's rule as a gate. The generated records (C:/dev/cmdb.cjs, source "generated") carry flags; today's
 * orphans are recorded in data/cmdb-orphans.json as findings. A NEW orphan fails; a recorded one that has been
 * fixed also fails until its entry is removed — so the list can only shrink. "never run" is left out: it depends
 * on whether a suite has run, not on the capability.
 */
const ORPHANS = JSON.parse(fs.readFileSync(path.join(API, 'data', 'cmdb-orphans.json'), 'utf8')).known;
const structural = (r) => cmdb.flags(r).filter((f) => f !== 'never run');
const generated = files.map((n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'))).filter((r) => r.source === 'generated');
it('there are generated records to hold to the rule (the generator has run)', () => {
  assert.ok(generated.length >= 10, 'only ' + generated.length + ' generated records — run node C:/dev/cmdb.cjs');
});
it('⚠️⚠️ no capability has a flag that is not already a recorded finding', () => {
  const fresh = [];
  generated.forEach((r) => structural(r).forEach((f) => {
    if (!(ORPHANS[r.ci] && ORPHANS[r.ci].flags.indexOf(f) >= 0)) fresh.push(r.ci + ': ' + f);
  }));
  assert.deepStrictEqual(fresh, [], 'a capability with no way in / no way out / no test: ' + fresh.join(' · ')
    + ' — wire it in or give it a test; recording it in data/cmdb-orphans.json is a decision for Athi, not a fix');
});
it('a recorded finding that is no longer true is removed (the list only shrinks)', () => {
  const stale = [];
  Object.keys(ORPHANS).forEach((ci) => {
    const r = generated.find((x) => x.ci === ci);
    if (!r) { stale.push(ci + ' (no such record any more)'); return; }
    ORPHANS[ci].flags.forEach((f) => { if (structural(r).indexOf(f) < 0) stale.push(ci + ': ' + f + ' is fixed'); });
  });
  assert.deepStrictEqual(stale, [], 'remove these from data/cmdb-orphans.json: ' + stale.join(' · '));
});

console.log('\nTHE SHAPE REFUSES, IT DOES NOT TRIM\n');
const good = () => JSON.parse(fs.readFileSync(path.join(DIR, 'CAP-SIGNIN.json'), 'utf8'));
it('a CI id that is not CAP-… is refused', () => { const r = good(); r.ci = 'signin'; assert.ok(!cmdb.shape(r).ok); });
it('an edge to a node that does not exist is refused, by name', () => {
  const r = good(); r.edges = r.edges.concat([['e1', 'zz9']]);
  const v = cmdb.shape(r); assert.ok(!v.ok && /zz9/.test(v.why), v.why);
});
it('a map tile pointing at a missing node is refused', () => { const r = good(); r.map[1].node = 'nope'; assert.ok(!cmdb.shape(r).ok); });
it('a test result outside pass/fail/not run/blocked is refused', () => { const r = good(); r.tests[0].result = 'green'; assert.ok(!cmdb.shape(r).ok); });
it('a record over 64 KB is refused, not cut', () => { const r = good(); r.summary = 'x'.repeat(590); r.relationships = Array(200).fill({ this: 'a', rel: 'b', that: 'y'.repeat(590) }); assert.ok(!cmdb.shape(r).ok); });

console.log('\nTHE FLAGS — no way in, no way out, not useful\n');
it('no entries → "no entry"; no exits → "no exit"; no tests → "no test"; tests never run → "never run"', () => {
  assert.deepStrictEqual(cmdb.flags({ exits: [{}], tests: [{ result: 'pass' }] }), ['no entry']);
  assert.deepStrictEqual(cmdb.flags({ entries: [{}], tests: [{ result: 'pass' }] }), ['no exit']);
  assert.deepStrictEqual(cmdb.flags({ entries: [{}], exits: [{}] }), ['no test']);
  assert.deepStrictEqual(cmdb.flags({ entries: [{}], exits: [{}], tests: [{ result: 'not run' }] }), ['never run']);
});

console.log('\nWHO MAY WRITE A SHARED ROW\n');
function freshBoard(board, writers) {
  const prevB = process.env.TEST_BOARD_ENTITY, prevW = process.env.TEST_BOARD_WRITERS;
  if (board) process.env.TEST_BOARD_ENTITY = board; else delete process.env.TEST_BOARD_ENTITY;
  if (writers) process.env.TEST_BOARD_WRITERS = writers; else delete process.env.TEST_BOARD_WRITERS;
  delete require.cache[require.resolve('../lib/testboard.js')];
  const tb = require('../lib/testboard.js');
  if (prevB == null) delete process.env.TEST_BOARD_ENTITY; else process.env.TEST_BOARD_ENTITY = prevB;
  if (prevW == null) delete process.env.TEST_BOARD_WRITERS; else process.env.TEST_BOARD_WRITERS = prevW;
  return tb;
}
const BOARD = '00000000-0000-4000-8000-0000000000b0', SHOP = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
it('per-tenant board (no TEST_BOARD_ENTITY): a shop writes its own board', () => {
  assert.strictEqual(freshBoard(null, null).canWrite(SHOP), true);
});
it('⚠️ shared board: a shop that is not the board and not a named writer is refused', () => {
  const tb = freshBoard(BOARD, null);
  assert.strictEqual(tb.canWrite(SHOP), false);
  assert.strictEqual(tb.canWrite(BOARD), true, 'the board\'s own entity must be able to write');
});
it('a named writer may write; a malformed id in the list trusts nobody extra', () => {
  /* TEST_BOARD_WRITERS is read when canWrite is ASKED (so a Railway change needs no redeploy) — hold it across the call */
  const tb = freshBoard(BOARD, null);
  const prev = process.env.TEST_BOARD_WRITERS;
  process.env.TEST_BOARD_WRITERS = OTHER + ', not-a-uuid';
  try {
    assert.strictEqual(tb.canWrite(OTHER), true);
    assert.strictEqual(tb.canWrite('not-a-uuid'), false);
    assert.strictEqual(tb.canWrite(SHOP), false, 'a shop not on the list got in');
  } finally { if (prev == null) delete process.env.TEST_BOARD_WRITERS; else process.env.TEST_BOARD_WRITERS = prev; }
});

console.log('\nTHE ROUTES\n');
function handler(verb, route) {
  const at = ROUTES.indexOf("router." + verb + "('" + route + "'");
  assert.ok(at >= 0, verb.toUpperCase() + ' ' + route + ' is gone');
  return ROUTES.slice(at, ROUTES.indexOf('\n});', at));
}
it('reading is open to every signed-in user: GET /cmdb and GET /cmdb/:ci use auth and the board entity', () => {
  for (const r of ['/cmdb', '/cmdb/:ci']) {
    const h = handler('get', r);
    assert.ok(/, auth, /.test(h) && /testboard\.entityFor\(/.test(h), 'GET ' + r + ' does not read the shared board');
  }
});
it('⚠️⚠️ both writes check the gate BEFORE anything is written', () => {
  for (const [v, r] of [['put', '/cmdb/:ci'], ['post', '/cmdb/seed']]) {
    const h = handler(v, r);
    const gate = h.indexOf('cmdbRefused(req, res)'), write = h.indexOf('upsertVersioned(');
    assert.ok(gate > 0 && write > gate, v.toUpperCase() + ' ' + r + ' writes without asking canWrite first');
  }
});
it('a record is versioned only when it changes (the upsert compares before it writes)', () => {
  const up = ROUTES.slice(ROUTES.indexOf('async function upsertVersioned('));
  assert.ok(/JSON\.stringify\(cur\.rows\[0\]\.rules \|\| \{\}\) === JSON\.stringify\(rules\)/.test(up.slice(0, 2500)), 'the no-change check is gone');
});

console.log('\n' + pass + ' checks passed\n');

/**
 * stuck-close.test.cjs - A COUNTER'S OWN CHIT CLOSES WHEN THE BOOKS HOLD IT (round 2, "stuck = 0", Athi 2026-10-09).
 *   closeDone(): moves only the shop's OWN, still-OPEN received copies, to 'completed', through moveStatus (the one status writer);
 *   a failed close never throws; nothing asked -> no read. The posting branches call it (walk-in covered / late / bill-grain,
 *   the day summary, a week/month summary). Offline: db stubbed, the mover stubbed. Run: node tests/stuck-close.test.cjs
 */
'use strict';
const path = require('path'), fs = require('fs');
const CF = require('../tools/chits-files.cjs'); /* the ONE list of chits files (tools/chits-files.cjs) */
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
let pass = 0, fail = 0;
const ok = (n, c, w) => { if (c) { pass++; console.log('   ok   ' + n); } else { fail++; console.log('   FAIL ' + n + (w ? '\n          ' + w : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got ' + JSON.stringify(g) + ' want ' + JSON.stringify(w));

const SHOP = '11111111-1111-4111-8111-111111111111';
const asked = []; let rowsBack = [], dbThrows = false;
require.cache[require.resolve(path.join(API, 'db'))] = { exports: {
  withEntity: async (e, fn) => { if (dbThrows) throw new Error('db down'); return fn({ query: async (t, p) => { asked.push({ t: String(t), p }); return { rows: rowsBack }; } }); },
  query: async () => ({ rows: [] }), trySavepoint: async (d, fn, fb) => { try { return await fn(d); } catch (_) { return fb; } }, onEntity: async (e, fn) => fn({}),
} };

(async () => {
  console.log('\n== A COUNTER-SALE CHIT CLOSES WHEN POSTED ==\n');
  const K = require(path.join(API, 'lib', 'books-hooks'));
  const moves = [];
  K._mover.fn = async (entity, chit, to, by, note, me) => { moves.push([entity, chit, to, by.id, note]); return { code: 200, moved: true }; };

  eq('nothing asked -> no read, nothing moved', [await K.closeDone(SHOP, [], 'x'), asked.length], [0, 0]);
  rowsBack = [{ chit_id: 'a' }, { chit_id: 'b' }];
  eq('two open own copies -> both move to completed through the mover, with the shop as the actor',
    [await K.closeDone(SHOP, ['a', 'b', 'a', null], 'Posted in the day summary - done'), moves.map((m) => [m[1], m[2], m[3]])], [2, [['a', 'completed', SHOP], ['b', 'completed', SHOP]]]);
  const q = asked.filter((x) => /FROM chit_status/.test(x.t))[0], oc = asked.filter((x) => /UPDATE books_outbox/.test(x.t));
  ok('the read is the shop\'s OWN received copy, SENT BY THE SHOP, still OPEN (never revives cancelled / rejected / completed, never someone else\'s)',
    /cs\.direction = 'received'/.test(q.t) && /h\.sender_entity_id = \$1/.test(q.t) && /current_status = ANY\(\$3/.test(q.t) && q.p[0] === SHOP && !q.p[2].includes('completed') && !q.p[2].includes('cancelled') && !q.p[2].includes('rejected'), q.t);
  ok('one read for the whole list (no per-row query), ids de-duplicated', asked.filter((x) => /FROM chit_status/.test(x.t)).length === 1 && q.p[1].length === 2);
  /* FX-F10W2: the same path closes the chits' own Waiting rows — ONE statement for the list, with the sentence that says why */
  ok('FX-F10W2 · …and their open Waiting rows close in ONE statement, ids de-duplicated, the note as the why',
    oc.length === 1 && /done_at = now\(\)/.test(oc[0].t) && /done_at IS NULL/.test(oc[0].t) && oc[0].p[1].length === 2 && oc[0].p[2] === 'Posted in the day summary - done', JSON.stringify(oc));
  rowsBack = [{ chit_id: 'c' }, { chit_id: 'd' }];
  K._mover.fn = async (e, c) => { if (c === 'c') throw new Error('boom'); return { code: 200, moved: true }; };
  eq('one failing close does not stop the rest and never throws', await K.closeDone(SHOP, ['c', 'd']), 1);
  K._mover.fn = async () => ({ code: 400, body: {} });
  eq('a refused move (code 400) is not counted as closed', await K.closeDone(SHOP, ['c']), 0);
  dbThrows = true;
  eq('a read that fails leaves everything open and resolves', await K.closeDone(SHOP, ['c']), 0);

  const src = fs.readFileSync(path.join(API, 'lib', 'books-hooks.js'), 'utf8');
  const n = (src.match(/closeDone\(entity/g) || []).length;
  ok('every end is wired: day post, day already posted, covered, late, bill-grain, day summary chit, week/month summary (>= 7 call sites)', n >= 7, 'sites ' + n);
  /* sit/run6 (RAIL-106): chit-move also exports the two cancel stamps and the bell; the rule is that none of them writes a status, only moveStatus does */
  const chitMove = fs.readFileSync(path.join(API, 'lib', 'chit-move.js'), 'utf8');
  const noSecondWriter = ['stampCancelRequested', 'stampCancelConfirmed', 'ringStatus'].every((name) => {
    const at = chitMove.indexOf('function ' + name + '(');
    const body = at < 0 ? '' : chitMove.slice(at, chitMove.indexOf('\n}\n', at));
    return at >= 0 && !/SET\s+status\s*=|,\s*status\s*=/.test(body);
  });
  ok('it goes through lib/chit-move moveStatus (no second status writer, no route reached from lib)', /require\('\.\/chit-move'\)\.moveStatus/.test(src) && !/require\('\.\.\/routes\/chits'\)/.test(src) && /^module\.exports = \{ moveStatus\b/m.test(chitMove) && noSecondWriter && !/router\.moveStatus/.test(CF.read(API)));

  console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

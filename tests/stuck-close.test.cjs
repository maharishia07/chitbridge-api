/**
 * stuck-close.test.cjs - A COUNTER'S OWN CHIT CLOSES WHEN THE BOOKS HOLD IT (round 2, "stuck = 0", Athi 2026-10-09).
 *   closeDone(): moves only the shop's OWN, still-OPEN received copies, to 'completed', through moveStatus (the one status writer);
 *   a failed close never throws; nothing asked -> no read. The posting branches call it (walk-in covered / late / bill-grain,
 *   the day summary, a week/month summary). Offline: db stubbed, the mover stubbed. Run: node tests/stuck-close.test.cjs
 */
'use strict';
const path = require('path'), fs = require('fs');
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
  const q = asked[0];
  ok('the read is the shop\'s OWN received copy, SENT BY THE SHOP, still OPEN (never revives cancelled / rejected / completed, never someone else\'s)',
    /cs\.direction = 'received'/.test(q.t) && /h\.sender_entity_id = \$1/.test(q.t) && /current_status = ANY\(\$3/.test(q.t) && q.p[0] === SHOP && !q.p[2].includes('completed') && !q.p[2].includes('cancelled') && !q.p[2].includes('rejected'), q.t);
  ok('one read for the whole list (no per-row query), ids de-duplicated', asked.length === 1 && q.p[1].length === 2);
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
  ok('it goes through the route\'s moveStatus (no second status writer)', /require\('\.\.\/routes\/chits'\)\.moveStatus/.test(src) && /router\.moveStatus = moveStatus/.test(fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8')));

  console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

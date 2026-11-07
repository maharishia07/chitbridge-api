/**
 * tests/dispute-audience.test.cjs — RAIL-187: lib/dispute-audience.audienceOf, the ONE reading of who receives a dispute's message.
 * A non-party is refused (null, never an audience); a chit-wide dispute is the whole chit; a targeted one is its roster plus the asker;
 * an unreadable roster fails closed to the asker alone, never down to the chit. Run: node tests/dispute-audience.test.cjs
 */
'use strict';
const path = require('path');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
let ROW, ROSTER;
const dbPath = require.resolve(path.join(__dirname, '..', 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }), withEntity: async (id, fn) => fn({ query: async (s) => {
  if (/chit_dispute_roster/.test(s)) { if (ROSTER instanceof Error) throw ROSTER; return { rows: ROSTER }; }
  return { rows: ROW ? [ROW] : [] };
} }) } };
const { audienceOf } = require(path.join(__dirname, '..', 'lib', 'dispute-audience'));
let fail = 0; const ok = (n, c, w) => { console.log((c ? '   ok   ' : '   FAIL ') + n + (c ? '' : '  ' + w)); if (!c) fail++; };
(async () => {
  ROW = null; ROSTER = [];
  ok('a non-party is refused: null, no audience (never the chit)', (await audienceOf('a', 'c', 'd')) === null);
  ROW = { scope: 'chit_wide' };
  const wide = await audienceOf('a', 'c', 'd');
  ok('a chit-wide dispute is the whole chit: wide, no roster', wide && wide.wide === true && wide.ids === null);
  ROW = { scope: 'targeted' }; ROSTER = [{ entity_id: 'a' }, { entity_id: 'b' }];
  const t = await audienceOf('a', 'c', 'd');
  ok('a targeted dispute is its roster (a, b), once each', t && t.wide === false && t.ids.join() === 'a,b', JSON.stringify(t));
  ROSTER = [{ entity_id: 'b' }];
  ok('…and the asker is always in it', (await audienceOf('a', 'c', 'd')).ids.join() === 'a,b');
  ROW = { scope: null }; ROSTER = new Error('down');
  const closed = await audienceOf('a', 'c', 'd');
  ok('a roster that cannot be read fails closed: the asker alone, not the chit', closed && closed.wide === false && closed.ids.join() === 'a', JSON.stringify(closed));
  console.log('\n' + (fail ? fail + ' failed' : 'all passed') + '\n'); process.exit(fail ? 1 : 0);
})();

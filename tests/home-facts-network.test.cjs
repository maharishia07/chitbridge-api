'use strict';
/**
 * tests/home-facts-network.test.cjs — the Home card `network` (lib/home-facts-network.js), no database.
 *
 * OWNS      the proof that the card says "N request(s) to connect" (tone dn, state needs_you) to the owner, says nothing is waiting when nothing is, and that a staff seat or a key is refused
 *           the answer (it reads 0 and the reader is never called: fail closed, never a count of somebody else's requests).
 * CALLED BY scripts/guards.cjs
 * CARD      26-reporting-mis-and-bi/home-facts
 */
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
const API = path.join(__dirname, '..');
const asksPath = require.resolve(path.join(API, 'lib', 'connect-asks.js'));
let waiting = { to_me: [], by_me: [] };
let calls = 0;
const real = require(asksPath);
require.cache[asksPath].exports = Object.assign({}, real, { asksOf: async () => { calls++; return waiting; } });
const { network } = require(path.join(API, 'lib', 'home-facts-network.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + JSON.stringify(info) : '')); } };
const OWNER = { identity: { identity_id: 'o', parent_entity_id: null } };
const STAFF = { identity: { identity_id: 's', parent_entity_id: 'o' } };
const KEY = { identity: { identity_id: 'o', parent_entity_id: null }, api_key: { jti: 'k' } };
const ask = { edge_id: 'e1', kind: 'firm', i_am: 'shop', name: 'Smith', bridge_id: 'CB1', country: 'AU', asked_at: '2026-11-28T00:00:00Z' };

(async () => {
  waiting = { to_me: [ask], by_me: [] };
  const one = await network({ entity: 'o', req: OWNER });
  ok('one waiting request reads "1 request to connect", tone dn, 1 in figures', one.lines[0].text === '1 request to connect' && one.lines[0].tone === 'dn' && one.figures.requests === 1, one);
  waiting = { to_me: [ask, ask], by_me: [] };
  ok('two read "2 requests to connect" (plural)', (await network({ entity: 'o', req: OWNER })).lines[0].text === '2 requests to connect');
  waiting = { to_me: [], by_me: [ask] };
  const mine = await network({ entity: 'o', req: OWNER });
  ok('only a request I asked and wait on reads as waiting, with no dn tone (nothing for the owner to answer)', mine.figures.requests === 0 && mine.figures.waiting === 1 && !mine.lines[0].tone, mine);
  waiting = { to_me: [], by_me: [] };
  const none = await network({ entity: 'o', req: OWNER });
  ok('nothing waiting: "No requests to connect", not_started', none.state === 'not_started' && none.figures.requests === 0, none);
  waiting = { to_me: [ask], by_me: [] };
  calls = 0;
  const staff = await network({ entity: 'o', req: STAFF });
  const keyed = await network({ entity: 'o', req: KEY });
  ok('a staff seat and a key are refused the answer: 0 requests, not_started, the reader never called (fail closed)', staff.figures.requests === 0 && keyed.figures.requests === 0 && staff.state === 'not_started' && calls === 0, { staff, keyed, calls });
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

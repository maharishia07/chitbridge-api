/**
 * tests/pay-out-gate.test.cjs — UNIT of lib/pay-out-gate.js: who may pay a supplier (AK-F-02), rule by rule, with stand-in deps (no DB, no server).
 *
 * OWNS      the gate's rules: owner and in-house accountant pass · any other seat passes money in · a payment out is 403 OWNER_ONLY · a stored payment's direction is read for propose and confirm · a bad id or a failing read closes the door with the refusal mapper's answer
 * CALLED BY scripts/guards.cjs (every push). tests/ak-f02-seat-gates.test.cjs proves the same gate through real Express.
 * CARD      04-books/books-payments
 * UNIT      lib/pay-out-gate.js
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 */
'use strict';
const { make, directionOf, PAY_OUT_WORDS } = require('../lib/pay-out-gate');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name); } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = 'aaaaaaaa-7777-4111-8111-111111111111';

function gateFor({ owner = false, accountant = false, stored = null, readFails = false }) {
  const said = [];
  const deps = {
    UUID, ctx: () => 'shop', problem: (req, res, answer) => said.push(answer), refusalOf: (err) => ({ status: 500, code: 'X', detail: err.message }),
    isOwner: () => owner, isInHouseAccountant: () => accountant,
    withEntity: async (e, fn) => { if (readFails) throw new Error('read failed'); return fn('handle'); },
    store: { payment: async () => stored }
  };
  const { payOut } = make(deps);
  const run = async (from, req) => { let passed = false; await payOut(from)(req, {}, () => { passed = true; }); return passed; };
  return { run, said };
}

(async () => {
  ok('directionOf: absent is in, out is out, both is a question', directionOf({}) === 'in' && directionOf({ direction: 'in' }) === 'in' && directionOf({ direction: 'out' }) === 'out' && directionOf({ direction: 'both' }) === null);
  const own = gateFor({ owner: true });
  ok('the owner pays out', (await own.run('body', { body: { direction: 'out' } })) === true && own.said.length === 0);
  const acc = gateFor({ accountant: true });
  ok("the shop's accountant pays out", (await acc.run('body', { body: { direction: 'out' } })) === true);
  const seat = gateFor({});
  ok('a counter seat records money in (body)', (await seat.run('body', { body: { direction: 'in' } })) === true);
  ok('a counter seat paying out is refused 403 OWNER_ONLY with the one sentence', (await seat.run('body', { body: { direction: 'out' } })) === false && seat.said[0].status === 403 && seat.said[0].code === 'OWNER_ONLY' && seat.said[0].detail === PAY_OUT_WORDS && seat.said[0].legacy.may === false);
  const confirmOut = gateFor({ stored: { direction: 'out' } });
  ok('confirm of a stored payment OUT is refused for a counter seat', (await confirmOut.run('stored', { params: { id: ID } })) === false && confirmOut.said[0].code === 'OWNER_ONLY');
  const confirmIn = gateFor({ stored: { direction: 'in' } });
  ok('confirm of a stored payment IN passes for a counter seat', (await confirmIn.run('stored', { params: { id: ID } })) === true);
  const noRow = gateFor({ stored: null });
  ok('no stored payment: the door passes (the route answers not found)', (await noRow.run('stored', { params: { id: ID } })) === true);
  ok('a bad id passes the gate (the route refuses it) and reads nothing', (await gateFor({ stored: { direction: 'out' } }).run('stored', { params: { id: 'nope' } })) === true);
  const broken = gateFor({ readFails: true });
  ok('a failing read closes the door with the refusal mapper answer, never next()', (await broken.run('stored', { params: { id: ID } })) === false && broken.said[0].status === 500);
  console.log(pass + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

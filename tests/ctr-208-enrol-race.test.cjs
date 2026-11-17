'use strict';
/**
 * tests/ctr-208-enrol-race.test.cjs — CTR-208: the claim that LOST a race is refused with the one held answer and its key is closed, offline.
 *
 * owns: the shape of the refusal and the loser's clean-up, on a recording stand-in for the transaction client. A stand-in has no row lock, so it
 *       CANNOT prove the race: tests/ctr-208-enrol-race-truth.realstack.cjs does that on real Postgres (two enrols at once, one winner).
 * FLOW  writeClaim(db, shop, 'C1', minted, seenHolder): the register is read FOR UPDATE, holder now vs holder at the check
 *   same  → null, the key is written and held_by is set          different → 409 COUNTER_HELD naming the winner, the minted key closed and released
 * CARD  09-counter/counters-and-keys-pair-enrol-open-release
 * Run: node tests/ctr-208-enrol-race.test.cjs   · no DB, no network.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nobody:nobody@127.0.0.1:1/none';
const assert = require('assert'), fs = require('fs'), path = require('path');
const store = require('../lib/counters-store');

let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** a transaction client that answers the locked read from `flags` and records every other statement */
const fakeDb = (flags) => {
  const log = [];
  return { log, query: async (sql, params) => { log.push({ sql: String(sql), params }); return /SELECT policy_flags/.test(sql) ? { rows: [{ policy_flags: flags }] } : { rows: [], rowCount: 1 }; } };
};
const shopWith = (holder) => ({
  counters: { C1: { id: 'C1', name: 'Front', next: 1, held_by: holder } },
  api_keys: holder ? [{ jti: holder, name: 'counter C1 · pc one', last4: 'abcd', scopes: ['till'], counter: 'C1', till: { id: 'C1' } }] : []
});
const minted = { jti: 'loserjti', key: 'k' };

(async () => {
  console.log('\nCTR-208 · THE CLAIM THAT LOST\n');
  await it('the refusal is the one COUNTER_HELD 409 and names the holder and when it was seen', () => {
    const refused = store.heldRefusal({ id: 'C1', held_by: { name: 'pc one', seen: { at: '2026-11-13T05:00:00Z' } } }, 'C1');
    assert.strictEqual(refused.status, 409);
    assert.strictEqual(refused.body.code, 'COUNTER_HELD');
    assert.strictEqual(refused.body.held_by, 'pc one');
    assert.strictEqual(refused.body.seen, '2026-11-13T05:00:00Z');
    assert.ok(!('key' in refused.body), 'a refusal never carries a key');
  });
  await it('another claim wrote held_by since the check: refused 409 COUNTER_HELD, and this minted key is closed and released', async () => {
    const db = fakeDb(shopWith('winnerjti'));
    const lost = await store.writeClaim(db, 'ent1', 'C1', minted, null);
    assert.ok(lost && lost.status === 409 && lost.body.code === 'COUNTER_HELD', 'answered ' + JSON.stringify(lost));
    assert.strictEqual(lost.body.held_by, 'counter C1 · pc one', 'the winner is named');
    const wrote = db.log.filter((q) => !/^SELECT/.test(q.sql));
    assert.ok(wrote.length === 1 && /closed_at/.test(JSON.stringify(wrote[0].params)) && /released/.test(JSON.stringify(wrote[0].params)), 'the loser key is closed: ' + JSON.stringify(wrote));
    assert.ok(!wrote.some((q) => /held_by/.test(JSON.stringify(q.params))), 'the loser never writes held_by');
  });
  await it('nobody moved the counter since the check: the claim wins, null, and held_by is written', async () => {
    const db = fakeDb(shopWith(null));
    const won = await store.writeClaim(db, 'ent1', 'C1', minted, null);
    assert.strictEqual(won, null);
    assert.ok(db.log.some((q) => /held_by/.test(JSON.stringify(q.params)) && /loserjti/.test(JSON.stringify(q.params))), 'held_by was not set to the minted key');
  });
  await it('claim() writes through writeClaim, comparing the holder seen at the check (source shape)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'counters-store.js'), 'utf8');
    assert.ok(/writeClaim\(db, entity_id, want, minted, claimResult\.counter\.held_by \|\| null\)/.test(src), 'claim no longer hands writeClaim the holder it saw');
    assert.ok(/nowHolder !== seenHolder/.test(src), 'the holder comparison is gone');
  });
  console.log('\n' + pass + ' passed');
})();

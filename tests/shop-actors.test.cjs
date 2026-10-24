'use strict';
/**
 * shop-actors.test.cjs — lib/shop-actors.js: actorOwned() answers true only for an actor of THIS shop (SEC-103).
 *
 * Runs the real actorOwned against a stand-in db that models the identities table (no DB, no network):
 *   · the shop's own actor is true, and the question names the shop in an explicit predicate
 *   · another shop's actor, an unknown id and text that is no uuid are all false, and the text that is no uuid never reaches the database
 *   · a database that is down is never read as "yes": the error goes up and the caller's write is refused (fail closed)
 * Run: node tests/shop-actors.test.cjs · MIN unit-per-rule · refusal-path · fail-closed
 */
const assert = require('assert');
const { actorOwned } = require('../lib/shop-actors');

const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '66666666-6666-4666-8666-666666666666';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0a01';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0b01';
const GHOST = 'cccccccc-cccc-4ccc-8ccc-cccccccc0a09';
const OWNERS = new Map([[ACTOR_A, SHOP_A], [ACTOR_B, SHOP_B]]);

function standIn() {
  const asked = [];
  return { asked, query: async (sql, args) => (asked.push({ sql, args }), { rows: OWNERS.get(args[0]) === args[1] ? [{ ok: 1 }] : [] }) };
}

(async () => {
  const db = standIn();
  assert.strictEqual(await actorOwned(db, SHOP_B, ACTOR_B), true, 'own actor');
  assert.ok(/parent_entity_id = \$2/.test(db.asked[0].sql) && db.asked[0].args[1] === SHOP_B, 'the shop is an explicit predicate');
  assert.strictEqual(await actorOwned(db, SHOP_B, ACTOR_A), false, "another shop's actor is refused");
  assert.strictEqual(await actorOwned(db, SHOP_B, GHOST), false, 'an unknown actor is refused');
  const before = db.asked.length;
  assert.strictEqual(await actorOwned(db, SHOP_B, 'not-a-uuid'), false, 'text that is no uuid is refused');
  assert.strictEqual(db.asked.length, before, 'text that is no uuid never reaches the database');
  await assert.rejects(() => actorOwned({ query: async () => { throw new Error('connection down'); } }, SHOP_B, ACTOR_B), /connection down/, 'a database that is down is an error, never a yes (fail closed)');
  console.log('shop-actors: 7 checks, 0 failed');
})().catch((failure) => {
  console.log('shop-actors FAILED:', failure.message);
  process.exit(1);
});

'use strict';
/**
 * tests/sec103-truth.realstack.cjs — SEC-103 TRUTH, on the REAL stack: real Postgres, real api. PUT /api/entities/routing stores no other shop's person as the assignee.
 *
 * OWNS      the T2 proof of entity_work_routing.assignee_actor_id, a column with NO foreign key: shop B asks with shop A's actor id and with a well-formed id nobody owns, and the database is
 *           READ afterwards. The offline twin (a stand-in that models ownership) is tests/sec100-folder-fk.test.cjs, its SEC-103 block.
 * CALLED BY the S41 job of .github/workflows/ci.yml (every tests/*-truth.realstack.cjs, one file at a time); locally: node tests/sec103-truth.realstack.cjs (one realstack file at a time on :3100).
 * FLOW      two fresh shops (A has a person, B has a person) → B names A's person / an unknown person → both answers equal (404) and B's routing row is unchanged → B names its own person and
 *           clears it → the rows are read back
 * CARD      28-platform-and-operations/api-standard
 *
 * SEC103-01 foreign and unknown assignee: same 404, routing row unchanged · SEC103-02 own person and the clear still work.
 * Every fallback id is its own constant (two cases sharing one uuid collided once, api #394, BELL-02).
 * NOT RUN where this was written (no Docker there): the S41 job is its first run. LOCAL ONLY.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 's3' + (Date.now() % 1e10).toString(36);
const GHOST_ASSIGNEE = '00000000-0000-4000-8000-0000000103a1'; /* a well-formed id nobody owns */
const KIND = 'incident';
let pg = null;

/** an answer without the request id (it differs on every request), to compare two answers word for word */
const plain = (reply) => JSON.stringify({ status: reply.status, body: Object.assign({}, reply.b, { request_id: null }) });
const rowsOf = async (sql, args) => (await pg.query(sql, args)).rows;
const routingOf = async (shop) => (await rowsOf('SELECT assignee_actor_id FROM entity_work_routing WHERE entity_id = $1 AND kind = $2', [shop.entity, KIND]))[0];
const setAssignee = (shop, actor) => j('/api/entities/routing', { method: 'PUT', token: shop.token, body: { kind: KIND, folder_id: null, assignee_actor_id: actor, route_to_entity_id: null } });
/** a person of a shop, made the way the people test makes one (POST /api/actors); the row is read back by name so the id is the database's own */
async function personOf(shop, name, tag) {
  const key = (RUN + tag).toLowerCase();
  ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: name, actor_key: key, email: key + '@local.test', access_level: 'editor' } }), 'actor ' + name);
  return (await rowsOf(`SELECT identity_id FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND display_name = $2`, [shop.entity, name]))[0].identity_id;
}

(async () => {
  console.log('\n── SEC-103 truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Sec103 A');
    const B = await freshShop(RUN + 'b', 'Sec103 B');
    const pA = await personOf(A, 'Asha ' + RUN, 'pa');
    const pB = await personOf(B, 'Bala ' + RUN, 'pb');

    await kase('SEC103-01', "PUT /api/entities/routing assignee_actor_id: another shop's person is refused (404) exactly as an unknown person is; B's routing row does not name it", async () => {
      const before = await routingOf(B);
      const asForeign = await setAssignee(B, pA);
      const asGhost = await setAssignee(B, GHOST_ASSIGNEE);
      const after = await routingOf(B);
      expect(JSON.stringify(before) === JSON.stringify(after) && (!after || after.assignee_actor_id === null) && asForeign.status === 404 && asGhost.status === 404 && plain(asForeign) === plain(asGhost),
        'routing row ' + JSON.stringify(after) + " · A's person " + plain(asForeign).slice(0, 160) + ' · unknown ' + plain(asGhost).slice(0, 160));
    });
    await kase('SEC103-02', 'own-shop success paths: B names its own person (stored), then clears it with null and with empty text', async () => {
      const set = await setAssignee(B, pB);
      const setRow = await routingOf(B);
      const nulled = await setAssignee(B, null);
      const nulledRow = await routingOf(B);
      const again = await setAssignee(B, pB);
      const emptied = await setAssignee(B, '');
      const emptiedRow = await routingOf(B);
      expect(set.status === 200 && setRow.assignee_actor_id === pB && nulled.status === 200 && nulledRow.assignee_actor_id === null && again.status === 200 && emptied.status === 200 && emptiedRow.assignee_actor_id === null,
        'set ' + set.status + ' ' + JSON.stringify(setRow) + ' · null ' + nulled.status + ' ' + JSON.stringify(nulledRow) + ' · empty ' + emptied.status + ' ' + JSON.stringify(emptiedRow));
    });
  } finally {
    await pg.end();
  }
  finish('sec103-truth', process.env.TRUTH_JSON);
})().catch((failure) => {
  console.error('sec103-truth crashed:', failure.message);
  process.exit(2);
});

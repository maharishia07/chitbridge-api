'use strict';
/**
 * tests/r2-reissue-truth.realstack.cjs — R2-01 RED TEST, on REAL Postgres (T2; docs/critique/FABLE-RISK-2-ACCESS.md R2-01, plan docs/critique/R2-PLAN.md).
 *
 * OWNS      the door POST /api/network-design/reissue. A network head may mint a new claim code for a store it built ONLY while that store is unclaimed.
 *   R2-01a  control: an unclaimed store gets a code from its head, and the code signs in as the store (the door works, so a refusal below is not a dead door)
 *   R2-01b  once the owner has signed in, the head is refused 403 NETWORK_STORE_CLAIMED and no code is written (this is the fix already on main, c531caaf)
 *   R2-01c  RED. The owner's first sign-in lands BETWEEN the door's read and its write (the claim commits while the door's UPDATE waits on the row).
 *           The read said "unclaimed", the UPDATE names the row by identity_id alone, so it writes a fresh 7-day code over the claimed store and ANSWERS it.
 *           Expected: refused, no code, and a code the head holds does not sign in as the store. Seen on main today: 200 with a working claim_code.
 *           The race is made certain (not hoped for): the test holds the claim's row lock itself, lets the door read, waits until the door's UPDATE is queued behind the lock, then commits.
 * CALLED BY the T2 job of ci.yml (it picks up every *-truth.realstack.cjs) · by hand on the local stack. NOT run on the laptop that wrote it: written, runs in CI.
 * Shares tests/lib/truth-harness.cjs. LOCAL OR A NAMED SIT BOX ONLY. Run: node tests/r2-reissue-truth.realstack.cjs
 * CARD 01-rail-core-the-chit/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, freshShop, finish } = H;
const RUN = 'rr' + (Date.now() % 1e10).toString(36);
let pg = null;

const DESIGN = (root) => ({
  nodes: [
    { key: root, name: 'R2 Network', parent_key: null, root: true, owned: true, holds: [] },
    { key: 'n_a', name: 'Alpha', parent_key: root, owned: true, holds: ['catalogue'], exposure: 'public' },
    { key: 'n_b', name: 'Bravo', parent_key: root, owned: true, holds: ['catalogue'], exposure: 'public' }
  ]
});

/** the head builds two stores of its own; each answer carries the store's handle and its first claim code */
async function build(head) {
  ok(await j('/api/network-design', { method: 'PUT', token: head.token, body: { draft: DESIGN('root_' + RUN) } }), 'save design');
  const built = ok(await j('/api/network-design/build', { method: 'POST', token: head.token, body: {} }), 'build').b;
  const made = built.created || [];
  expect(made.length === 2 && made.every((one) => one.claim_code), 'build created ' + made.length + ' stores: ' + JSON.stringify(built).slice(0, 300));
  return made;
}
const signIn = (store, code) => j('/api/entities/verify', { method: 'POST', body: { user_id: store.handle, otp: code } });
const rowOf = async (store) => (await pg.query(`SELECT identity_id, otp_code IS NOT NULL AS has_code, last_active_at FROM identities WHERE LOWER(user_id) = LOWER($1)`, [store.handle])).rows[0];
/** true once a statement of the door ('UPDATE identities SET otp_code') is waiting on a row lock held by another session */
async function updateIsQueued() {
  const waiting = await pg.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE identities SET otp_code%'`);
  return waiting.rows.length > 0;
}

(async () => {
  console.log('\n── R2-01 reissue truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  const lock = new Client({ connectionString: DB }); await lock.connect();
  try {
    const head = await freshShop(RUN, 'R2 head');
    const [alpha, bravo] = await build(head);

    await kase('R2-01a', 'control: the head reissues for an unclaimed store and the new code signs in as the store', async () => {
      const again = ok(await j('/api/network-design/reissue', { method: 'POST', token: head.token, body: { user_id: alpha.handle } }), 'reissue').b;
      expect(!!again.claim_code && again.claim_code !== alpha.claim_code, 'no fresh code: ' + JSON.stringify(again));
      const entered = await signIn(alpha, again.claim_code);
      expect(entered.status === 200 && !!entered.b.token, 'the fresh code did not sign in: ' + entered.status + ' ' + JSON.stringify(entered.b).slice(0, 200));
      expect((await rowOf(alpha)).last_active_at, 'the first sign-in did not stamp last_active_at: the claim marker is missing');
    });

    await kase('R2-01b', 'once the owner has signed in the head is refused 403 NETWORK_STORE_CLAIMED and no code is written', async () => {
      const refused = await j('/api/network-design/reissue', { method: 'POST', token: head.token, body: { user_id: alpha.handle } });
      expect(refused.status === 403 && refused.b.code === 'NETWORK_STORE_CLAIMED', 'claimed store reissue answered ' + refused.status + ' ' + JSON.stringify(refused.b).slice(0, 240));
      expect(!(await rowOf(alpha)).has_code, 'a code was written on a claimed store');
    });

    await kase('R2-01c', 'a claim that commits between the door\'s read and its write is not overwritten with a head-held code', async () => {
      expect(!(await rowOf(bravo)).last_active_at, 'bravo is not unclaimed');
      await lock.query('BEGIN');
      await lock.query(`UPDATE identities SET last_active_at = NOW(), otp_code = NULL, status = 'active' WHERE identity_id = $1`, [(await rowOf(bravo)).identity_id]); /* the owner's first sign-in, uncommitted */
      const door = j('/api/network-design/reissue', { method: 'POST', token: head.token, body: { user_id: bravo.handle } }); /* reads "unclaimed", its UPDATE queues behind the lock */
      let queued = false;
      for (let tries = 0; tries < 40 && !queued; tries++) { await pause(250); queued = await updateIsQueued(); }
      await lock.query('COMMIT');
      const answer = await door;
      expect(queued, 'the door never queued behind the claim: the race was not staged (' + answer.status + ')');
      const row = await rowOf(bravo);
      expect(!!row.last_active_at, 'the claim did not commit');
      expect(answer.status === 403 && !answer.b.claim_code, 'the claimed store was reissued: ' + answer.status + ' ' + JSON.stringify(answer.b).slice(0, 240));
      expect(!row.has_code, 'a head-held code now sits on the claimed store');
      if (answer.b.claim_code) {
        const entered = await signIn(bravo, answer.b.claim_code);
        expect(entered.status !== 200, 'the head signed in as the claimed store with the code from the door');
      }
    });
  } finally {
    try { await lock.query('ROLLBACK'); } catch (_) { /* nothing open */ }
    await lock.end();
    await pg.end();
  }
  finish('R2-01 reissue truth', process.env.R2_TRUTH_JSON || null);
})().catch((failure) => { console.error(failure); process.exitCode = 1; });

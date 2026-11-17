'use strict';
/**
 * tests/ctr-208-enrol-race-truth.realstack.cjs — CTR-208 on REAL Postgres: two POST /api/till/enrol at once for one counter, ONE winner.
 *
 * owns: the proof a stand-in cannot give (it has no row lock). lib/counters-store.js claim() checked "held" in one transaction and wrote held_by in
 *       a later one, so two racers both passed the check, both minted, and both keys stayed valid (SIT hunt CTR-H14). writeClaim() now re-reads the
 *       register FOR UPDATE and refuses the claim that lost. The offline twin (tests/ctr-208-enrol-race.test.cjs) proves the refusal's shape.
 * FLOW  fresh IN shop → POST /api/counters makes C1 → two enrols raced (Promise.all) → read the key list with SELECT
 *   RACE-1  one 200 with a key, one 409 COUNTER_HELD; the winner's key answers GET /api/till/counters 200; ONE live till key holds C1 in the shop's list
 *   RACE-2  two takeovers at once (both ask takeover:true): exactly one key answers, one live key, never two
 * Name ends -truth.realstack.cjs, so the S41 job's T2 loop (ci.yml "every area truth test") runs it against the seeded api; no workflow edit.
 * Run: API_BASE=http://127.0.0.1:<port> node tests/ctr-208-enrol-race-truth.realstack.cjs   ⚠️ LOCAL ONLY (the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;

const RUN = 'c208' + (Date.now() % 1e10).toString(36);
const said = (reply) => JSON.stringify([reply.status, reply.b && (reply.b.code || reply.b.error)]);
const enrol = (shop, name, extra) => j('/api/till/enrol', { method: 'POST', token: shop.token, body: Object.assign({ counter: 'C1', name }, extra || {}) });
/** the till keys of the shop that hold C1 and are not closed — read straight from the row */
const liveKeys = async (pg, shop) => {
  const row = (await pg.query('SELECT policy_flags FROM identities WHERE identity_id = $1', [shop.entity])).rows[0];
  const list = (row && row.policy_flags && row.policy_flags.api_keys) || [];
  return list.filter((k) => k && (k.scopes || []).includes('till') && k.counter === 'C1' && !(k.till && k.till.closed_at));
};

(async () => {
  console.log('\n══ CTR-208 · enrol race on real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    await kase('RACE-1', 'two enrols of a free C1 at once: one 200 with a key, one 409 COUNTER_HELD, one live key, the winner answers', async () => {
      const shop = await freshShop(RUN + 'a', 'Enrol Race');
      ok(await j('/api/counters', { method: 'POST', token: shop.token, body: { name: 'Front' } }), 'make C1');
      const pair = await Promise.all([enrol(shop, 'pc one'), enrol(shop, 'pc two')]);
      const won = pair.filter((r) => r.status === 200), lost = pair.filter((r) => r.status !== 200);
      expect(won.length === 1 && lost.length === 1, 'statuses ' + pair.map(said).join(' | '));
      expect(lost[0].status === 409 && lost[0].b.code === 'COUNTER_HELD' && !lost[0].b.key, 'loser ' + said(lost[0]) + ' ' + JSON.stringify(lost[0].b).slice(0, 200));
      expect(typeof won[0].b.key === 'string' && won[0].b.key.length > 20, 'winner carries no key');
      const asWinner = await j('/api/till/counters', { token: won[0].b.key });
      expect(asWinner.status === 200, "the winner's key answered " + asWinner.status);
      const live = await liveKeys(pg, shop);
      expect(live.length === 1, 'live till keys holding C1: ' + live.length);
      return pair.map(said).join(' | ');
    });

    await kase('RACE-2', 'two takeovers at once of a held C1: still one winner and one live key', async () => {
      const shop = await freshShop(RUN + 'b', 'Enrol Race Takeover');
      ok(await j('/api/counters', { method: 'POST', token: shop.token, body: { name: 'Front' } }), 'make C1');
      ok(await enrol(shop, 'first pc'), 'first enrol');
      const pair = await Promise.all([enrol(shop, 'pc two', { takeover: true }), enrol(shop, 'pc three', { takeover: true })]);
      /* a takeover is a decided act, so one may run whole after the other (both 200, the later key the live one): what may never hold is two LIVE keys */
      expect(pair.every((r) => r.status === 200 || (r.status === 409 && r.b.code === 'COUNTER_HELD' && !r.b.key)), 'statuses ' + pair.map(said).join(' | '));
      const answers = await Promise.all(pair.filter((r) => r.status === 200).map((r) => j('/api/till/counters', { token: r.b.key })));
      expect(answers.filter((r) => r.status === 200).length === 1, 'keys that answer 200: ' + answers.map((r) => r.status).join(','));
      const live = await liveKeys(pg, shop);
      expect(live.length === 1, 'live till keys holding C1 after two takeovers: ' + live.length);
      return pair.map(said).join(' | ');
    });
  } finally {
    await pg.end();
  }
  finish('CTR-208 enrol race', null);
})().catch((e) => { console.error(e); process.exit(1); });

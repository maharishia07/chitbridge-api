'use strict';
/**
 * tests/kyb-truth.realstack.cjs — KNOW YOUR BUSINESS TRUTH, on the LOCAL stack (T2: real Postgres; API-STANDARD R2-10, API-4 sweep of routes/kyb.js).
 *
 * The five routes of /api/kyb read the shop from the token: no id sits in any path, so there is no foreign-id (404) case. Two things in them write, and each has ONE case here:
 *   POST /credential  a paper the shop adds lands `declared`; a chit named as its evidence rises it to `documented` only when the shop OWNS that chit (row security hides another
 *                     shop's chit, so a foreign chit id is dropped exactly as an unknown one is); and a client cannot mint a rung (`verified`) or write for another shop.
 *   POST /field       the metered search: while no trade-data source is plugged in it answers "not connected", charges nothing and keeps no cache row (the 24h cache and the
 *                     usage_ledger row are written only for a real search).
 * KY-01 a paper added by title is held, `declared`, nothing verified · KY-02 a client's rung, verification and entity are ignored · KY-03 evidence: own chit kept, foreign chit dropped,
 * same answer · KY-04 POST /field charges and keeps nothing while no source is connected · KY-05 the three free sections answer for a new shop and make no governance claim.
 * Not here: a metered search with a real provider (none is connected: lib/kyb.js fieldProvider returns null), and the days a paper has left (they move with the clock).
 * A `gap:` FAIL is a RECORDED finding, never fixed here. LOCAL ONLY; the database is only ever SELECTed. Needs DEV_OTP armed (lib/dev-otp.js).
 * Run: node tests/kyb-truth.realstack.cjs   (one realstack file at a time on :3100; picked up by the S41 job in CI, not run on a laptop without Docker)
 * CARD 21-compliance-attestation-and-trade/know-your-business
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, receipt, freshShop, finish } = H;
const RUN = 'ky' + (Date.now() % 1e10).toString(36);
let pg = null;

/** the entity_compliance row of a standard, read-only */
async function held(shop, standard) {
  const r = await pg.query('SELECT status, evidence_ref, verification FROM entity_compliance WHERE entity_id = $1 AND standard_key = $2', [shop.entity, standard]);
  return r.rows;
}
/** a chit the shop owns (a receipt to itself), read back from its own copy */
async function ownChit(shop) {
  const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name: 'Evidence item', unit: 'piece', price: 10 } } }), 'a product').b;
  const P = { id: made.item.item_id, name: 'Evidence item', unit: 'piece', price: 10 };
  ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: receipt(RUN + '-EV' + shop.entity.slice(0, 4), [[P, 1, 10]]) }), 'a chit to use as evidence');
  const r = await pg.query('SELECT chit_id FROM chit_header WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1', [shop.entity]);
  expect(r.rows[0], 'the shop holds no chit copy after sending one');
  return r.rows[0].chit_id;
}
const credential = (shop, body) => j('/api/kyb/credential', { method: 'POST', token: shop.token, body });

async function cases(A, B) {
  await kase('KY-01', 'a paper added by title is held, declared, nothing verified', async () => {
    const r = ok(await credential(A, { title: 'Village NOC' }), 'credential');
    expect(r.b.added && r.b.added.standard === 'custom-village-noc' && r.b.added.doc === 'certificate' && r.b.added.title === 'Village NOC', 'answer ' + JSON.stringify(r.b));
    const rows = await held(A, 'custom-village-noc');
    expect(rows.length === 1 && rows[0].status === 'gathered' && rows[0].evidence_ref === null && Object.keys(rows[0].verification || {}).length === 0, 'row ' + JSON.stringify(rows));
    const again = ok(await credential(A, { title: 'Village NOC' }), 'the same paper again');
    expect((await held(A, 'custom-village-noc')).length === 1 && again.b.added.standard === 'custom-village-noc', 'a second add made a second row');
  });
  await kase('KY-02', "a client's rung, verification and entity are ignored: the row is the caller's, declared", async () => {
    ok(await credential(A, { title: 'Ward licence', rung: 'verified', verification: { method: 'registry', verified_at: '2026-01-01' }, status: 'expired', entity_id: B.entity }), 'credential');
    const mine = await held(A, 'custom-ward-licence');
    expect(mine.length === 1 && mine[0].status === 'gathered' && Object.keys(mine[0].verification || {}).length === 0, 'the caller row ' + JSON.stringify(mine));
    expect((await held(B, 'custom-ward-licence')).length === 0, 'a row was written for another shop');
  });
  await kase('KY-03', "evidence: the shop's own chit is kept, another shop's chit is dropped, and the answer is the same", async () => {
    const mineChit = await ownChit(A);
    const theirs = await ownChit(B);
    const withOwn = ok(await credential(A, { standard_key: 'custom-own-proof', doc_key: 'certificate', evidence_ref: mineChit }), 'own evidence');
    const withForeign = ok(await credential(A, { standard_key: 'custom-foreign-proof', doc_key: 'certificate', evidence_ref: theirs }), 'foreign evidence');
    const withUnknown = ok(await credential(A, { standard_key: 'custom-unknown-proof', doc_key: 'certificate', evidence_ref: '00000000-0000-4000-8000-000000000000' }), 'unknown evidence');
    expect((await held(A, 'custom-own-proof'))[0].evidence_ref === mineChit, 'the shop\'s own chit was not kept as the evidence');
    expect((await held(A, 'custom-foreign-proof'))[0].evidence_ref === null, "another shop's chit was kept as the evidence: " + JSON.stringify(await held(A, 'custom-foreign-proof')));
    expect((await held(A, 'custom-unknown-proof'))[0].evidence_ref === null, 'an unknown chit was kept as the evidence');
    expect(withForeign.status === withUnknown.status && Object.keys(withForeign.b).join() === Object.keys(withUnknown.b).join() && withOwn.status === 200, 'the answers differ: ' + JSON.stringify([withForeign.b, withUnknown.b]));
  });
  await kase('KY-04', 'POST /field with no source connected: "not connected", nothing charged, no cache row', async () => {
    const first = ok(await j('/api/kyb/field', { method: 'POST', token: A.token }), 'field').b;
    const second = ok(await j('/api/kyb/field', { method: 'POST', token: A.token }), 'field again').b;
    expect(first.section === 'field' && first.charged === false && first.cached === false && first.configured === false && Array.isArray(first.results) && first.results.length === 0, 'answer ' + JSON.stringify(first));
    expect(JSON.stringify(first) === JSON.stringify(second), 'two searches answered differently');
    const ledger = await pg.query("SELECT count(*)::int AS n FROM usage_ledger WHERE entity_id = $1 AND meter = 'kyb.field'", [A.entity]);
    const cache = await pg.query('SELECT count(*)::int AS n FROM kyb_field_cache WHERE entity_id = $1', [A.entity]);
    expect(ledger.rows[0].n === 0 && cache.rows[0].n === 0, 'a search was charged or cached: ' + JSON.stringify([ledger.rows[0], cache.rows[0]]));
  });
  await kase('KY-05', 'the free sections answer for a new shop and name no governance claim', async () => {
    const yours = ok(await j('/api/kyb/yourself', { token: B.token }), 'yourself').b;
    const place = ok(await j('/api/kyb/position', { token: B.token }), 'position').b;
    const risk = ok(await j('/api/kyb/risk', { token: B.token }), 'risk').b;
    expect(yours.section === 'yourself' && yours.facts && yours.facts.summary && /declared/.test(yours.note) && /documented/.test(yours.note), 'yourself ' + JSON.stringify(yours).slice(0, 200));
    expect(place.section === 'position' && place.facts && place.facts.reach && Array.isArray(place.facts.lanes), 'position ' + JSON.stringify(place).slice(0, 200));
    expect(risk.section === 'risk' && /not advice/.test(risk.note) && risk.facts.concentration.chits === 0, 'risk ' + JSON.stringify(risk).slice(0, 200));
    expect(![yours.note, place.note, risk.note].some((line) => /governance (claim|approved)|certified by/i.test(line)), 'a note makes a claim');
  });
}

(async () => {
  console.log('\n── kyb truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Kyb truth');
    const B = await freshShop(RUN + 'b', 'Kyb truth');
    await cases(A, B);
  } finally {
    await pg.end();
  }
  finish('kyb truth', process.env.KYB_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('kyb truth could not run:', e && e.message); process.exit(2); });

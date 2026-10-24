'use strict';
/**
 * tests/privacy-truth.realstack.cjs — PRIVACY TRUTH, on the LOCAL stack (T2: real Postgres; API-STANDARD R2-10, API-4 sweep of routes/privacy.js).
 *
 * ⚠️ PERSONAL DATA: every e-mail below is a throwaway address on local.test made for this run; no real-looking name, phone or e-mail is written or printed.
 *
 * The four routes of /api/privacy take NO id: the shopper and the shop are the storefront token's (a customer who ordered, as /my-orders reads them). Two kinds of case, one per write:
 *   POST /me/consent   a "yes" then a "no" are two new rows (append-only), written as the shopper at the token's shop.
 *   POST /me/requests  a request is one new register entry for that shopper, with the clock of the shop's country.
 * PV-01 the facts are public (no sign-in) and say the notice is unpublished · PV-02 the shopper's own page needs a shopper's token (none, or an owner's: 401) · PV-03 consent yes then no:
 * two rows in b306, the newest says no · PV-04 a request of each of two kinds: two entries in b307, the shopper's own, due 30 days on in India · PV-05 a body that names another shop's shopper
 * writes for the token's shopper only, and the other shop's shopper sees none of it · PV-06 shop B's shopper is told nothing of shop A's rows.
 * Not here: the sentences of the migration not run (the local database has b306/b307), and a token with no shop (a shopper token always carries its shop).
 * A `gap:` FAIL is a RECORDED finding, never fixed here. LOCAL ONLY; the database is only ever SELECTed.
 * Run: node tests/privacy-truth.realstack.cjs   (one realstack file at a time on :3100; picked up by the S41 job in CI, not run on a laptop without Docker)
 * CARD 11-crm-and-marketing/privacy-consent
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, CUSTOMER_OTP, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'pv' + (Date.now() % 1e10).toString(36);
let pg = null;

/** the rows b306 and b307 hold for a shop and a shopper, read-only */
async function held(table, shopId, partyId) {
  const r = await pg.query('SELECT * FROM ' + table + ' WHERE owner_entity_id = $1 AND party_id = $2 ORDER BY 1', [shopId, partyId]);
  return r.rows;
}
const get = (shopper, path) => j('/api/privacy' + path, { token: shopper.token });
const post = (shopper, path, body) => j('/api/privacy' + path, { method: 'POST', token: shopper.token, body });

/** a shopper of a shop: they ordered once and the order answered their token */
async function shopperOf(shop, tag) {
  const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
  const door = '/api/catalogue/' + shop.bridge;
  const email = RUN + tag + '@local.test';
  ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Truth Shopper ' + tag } }), 'order start');
  const order = ok(await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: made.item.item_id, quantity: 1 }] } }), 'order confirm').b;
  const me = JSON.parse(Buffer.from(order.token.split('.')[1], 'base64url').toString('utf8'));
  return { token: order.token, id: me.identity_id, shop: shop.entity };
}

async function cases(A, B, a, b) {
  await kase('PV-01', 'the facts are public and say, in words, what the owner has not published', async () => {
    const r = ok(await j('/api/privacy/facts'), 'facts').b;
    expect(Array.isArray(r.processors) && r.processors.some((p) => /Supabase/.test(p.name)) && typeof r.notice === 'string' && typeof r.contact_line === 'string', 'facts ' + JSON.stringify(r).slice(0, 200));
  });
  await kase('PV-02', "the shopper's own page needs a shopper's token: none or an owner's is the sign-in's 401", async () => {
    const none = await j('/api/privacy/me');
    const owner = await get({ token: A.token }, '/me');
    expect(none.status === 401 && owner.status === 401, 'answers ' + none.status + '/' + owner.status);
    const mine = ok(await get(a, '/me'), 'me').b;
    expect(mine.consent && mine.consent.migrated === true && Array.isArray(mine.held), 'page ' + JSON.stringify(mine).slice(0, 200));
  });
  await kase('PV-03', 'a yes then a no are two new rows, the newest says no, written as the shopper at the shop', async () => {
    ok(await post(a, '/me/consent', { channel: 'sms', purpose: 'marketing', allowed: true }), 'yes');
    const no = ok(await post(a, '/me/consent', { channel: 'sms', purpose: 'marketing', allowed: false }), 'no').b;
    const rows = await held('party_contact_pref', a.shop, a.id);
    expect(rows.length === 2 && rows.every((r) => r.noted_by === a.id) && no.pref.allowed === false && no.pref.withdrawn_at !== null, 'rows ' + rows.length + ' pref ' + JSON.stringify(no.pref));
  });
  await kase('PV-04', "a request is a new register entry for the shopper, due 30 days on in India; each is its own entry", async () => {
    const first = ok(await post(a, '/me/requests', { kind: 'access' }), 'access').b.request;
    ok(await post(a, '/me/requests', { kind: 'correct' }), 'correct');
    const rows = await held('privacy_request', a.shop, a.id);
    const days = Math.round((Date.parse(first.due_at) - Date.parse(first.received_at)) / 86400000);
    expect(rows.length === 2 && first.party_id === a.id && days === 30 && first.answered_at === null, 'rows ' + rows.length + ' days ' + days);
  });
  await kase('PV-05', "a body that names another shop's shopper writes for the token's shopper only", async () => {
    ok(await post(a, '/me/consent', { channel: 'email', purpose: 'marketing', allowed: true, party_id: b.id, shop: B.entity, noted_by: b.id }), 'consent');
    ok(await post(a, '/me/requests', { kind: 'erase', party_id: b.id, who: 'Somebody Else', country: 'AU' }), 'request');
    expect((await held('party_contact_pref', B.entity, b.id)).length === 0 && (await held('privacy_request', B.entity, b.id)).length === 0, 'rows were written against the other shop\'s shopper');
    const asked = await held('privacy_request', a.shop, a.id);
    expect(asked.every((r) => r.who !== 'Somebody Else' && r.country === 'IN'), 'a request took the name or country of the body');
  });
  await kase('PV-06', "the other shop's shopper is told nothing of the first shop's rows", async () => {
    const theirs = ok(await get(b, '/me'), 'me').b;
    expect(theirs.consent.history.length === 0 && theirs.requests.total === 0 && !JSON.stringify(theirs).includes(a.id), 'page ' + JSON.stringify(theirs).slice(0, 200));
  });
}

(async () => {
  console.log('\n── privacy truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Privacy truth');
    const B = await freshShop(RUN + 'b', 'Privacy truth');
    const a = await shopperOf(A, 'a');
    const b = await shopperOf(B, 'b');
    await cases(A, B, a, b);
  } finally {
    await pg.end();
  }
  finish('privacy truth', process.env.PRIVACY_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('privacy truth could not run:', e && e.message); process.exit(2); });

'use strict';
/**
 * tests/net-46-foreign-seller-tax.realstack.cjs — NET-46 (written 2026-11-14, NOT YET RUN: needs a SIT box): an Indian buyer's order to a seller on a foreign tax regime.
 * W10/W16 (WALK-2026-10-25-IN-AU): the BUYER worked out an Indian CGST/SGST summary on an order to an Australian seller, and the seller's copy showed a buyer-side GST summary in rupees.
 * Decided: the SELLER computes, the buyer SHOWS (sellerMoney, api f6ddcabd + UX-121).
 *
 * Hand-computed: Indian buyer (INR), Australian seller (AUD, GST 10%). One order, 2 units at A$100 = A$200 (+ A$20 GST if the seller states it). Both copies must then
 *   N46-1 the send is accepted (HTTP 200) and the chit is priced in the SELLER's money: both copies' currency is AUD, never INR
 *   N46-2 neither copy carries an Indian CGST/SGST/IGST head: no key named cgst|sgst|igst anywhere in business_json.invoice, business_json.by_rate or summary_json.money
 *   N46-3 the buyer's copy states no rupee tax figure: summary_json.money.currency is not INR
 *   N46-4 the seller's copy carries no buyer-side GST summary in rupees: same read on the seller's copy
 * A case reports what it SAW in its answer line (the first run settles the exact keys; the assertions read only the three above, never a guessed field).
 *
 * Runs ON a SIT box inside its api container (tests/lib/run-target.cjs allow-list), one box that holds both shops (same installation, two countries):
 *   register the pack in toolset/gorilla-packs.json ("net46": entry tests/net-46-foreign-seller-tax.realstack.cjs, json TRUTH_JSON) then  sh toolset/sit-box-run.sh sit-root gorilla --only net46
 * or locally: API_BASE=http://127.0.0.1:3100 TRUTH_DB=... node tests/net-46-foreign-seller-tax.realstack.cjs
 * CARD 04-network/README
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'n46' + (Date.now() % 1e9).toString(36);
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true } };
const HEADS = /"(cgst|sgst|igst)"/i;

/** the copy of a chit as the shop that holds it reads it: GET /api/chits/:id */
const copyOf = async (shop, id) => ok(await j('/api/chits/' + id, { token: shop.token }), 'read copy').b;
const moneyIn = (copy) => JSON.stringify([(copy.business_json || {}).invoice || null, (copy.business_json || {}).by_rate || null, (copy.summary_json || {}).money || null]);
const currencyOf = (copy) => String(((copy.summary_json || {}).money || {}).currency || copy.currency_code || '').toUpperCase();

(async () => {
  console.log('\n── NET-46 foreign seller on ' + H.API + ' · run ' + RUN + ' ──');
  const buyer = await freshShop(RUN + 'b', 'Indian buyer');
  const seller = await freshShop(RUN + 's', 'Australian seller', AU);
  let sent = null, mine = null, theirs = null;

  await kase('N46-1', 'the order to the Australian seller is accepted and priced in the SELLER\'s money (AUD)', async () => {
    const body = H.order('n46' + RUN, [[{ name: 'Timber', unit: 'piece', price: 100 }, 2, 100]], { to: { bridge: seller.bridge, name: seller.name } });
    const r = await j('/api/chits/send', { method: 'POST', token: buyer.token, body });
    expect(r.status === 200, 'send → HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
    sent = r.b.chit_id || (r.b.chit && r.b.chit.chit_id);
    expect(sent, 'no chit id in ' + JSON.stringify(r.b).slice(0, 200));
    mine = await copyOf(buyer, sent);
    expect(currencyOf(mine) === 'AUD', 'the buyer\'s copy is in ' + currencyOf(mine) + ', want AUD');
  });
  await kase('N46-2', 'the buyer\'s copy carries no Indian CGST/SGST/IGST head', async () => {
    expect(mine, 'no copy (N46-1 failed)');
    expect(!HEADS.test(moneyIn(mine)), 'buyer copy holds an Indian head: ' + moneyIn(mine).slice(0, 300));
  });
  await kase('N46-3', 'the buyer\'s copy states no rupee tax figure', async () => {
    expect(mine && currencyOf(mine) !== 'INR', 'currency ' + (mine && currencyOf(mine)));
  });
  await kase('N46-4', 'the seller\'s copy carries no buyer-side GST summary in rupees', async () => {
    theirs = await copyOf(seller, sent);
    expect(!HEADS.test(moneyIn(theirs)) && currencyOf(theirs) !== 'INR', 'seller copy: ' + currencyOf(theirs) + ' ' + moneyIn(theirs).slice(0, 300));
  });
  finish('net-46-foreign-seller-tax', process.env.TRUTH_JSON);
})().catch((e) => { console.error(e); process.exitCode = 1; });

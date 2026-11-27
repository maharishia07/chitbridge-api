/**
 * acc-setoff-both-roles-1138.test.cjs - ACC-new-1 (AU business run round 2, gap 6, 28 Nov 2026): a trader that is BOTH a shop's supplier and its customer.
 * Before: lib/chits-send-bill addReceiverToCustomerList skipped the customer row when the receiver was already on the sender's supplier list (a Jun 2026 rule,
 * d9f0630dc), although rail-actions.receiverIsCustomer already says from the chit's own direction whether the receiver is a customer. So the sale's buyer held only the
 * supplier flag, books-pay-side.sideOf read the money coming IN as a supplier refund, and the payment door answered 409 "Nothing is owed" and offered the shop's own payable bill.
 * Hand figures (AUD; the scenario's H and W): H sold W a service T7 = 150.00 + 15.00 GST = 165.00; H bought T1 = 260.00 from W (GST-free). The set-off is 165.00; H then pays 95.00.
 *   party W in H's list: customer AND supplier (one party)
 *   W pays H 165.00 (direction in)  -> proposes T7 165.00 only (H's receivable), never T1
 *   H pays W  95.00 (direction out) -> proposes T1 for 95.00 of 260.00 (H's payable)
 * Run: node tests/acc-setoff-both-roles-1138.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-aaaaaaaa1138', TRADER = '55555555-5555-4555-8555-aaaaaaaa1138';
const T1 = 'b1111111-1111-4111-8111-aaaaaaaa1138', T7 = 'b7777777-7777-4777-8777-aaaaaaaa1138';
const S_AU = { enabled: true, walkin_grain: 'bill', country: 'AU', functional_currency: 'AUD', timezone: 'Australia/Sydney' };
const TAX = require(path.join(H.API, 'lib', 'tax'));
const party = () => ({ Abn: '51824753556', LglNm: 'X', Country: 'AU', RegType: 'regular' });

/** part 1: the cause - the customer row is written for a receiver that is already a supplier (the send step, its db stubbed to record the SQL it is asked) */
async function sendStep() {
  const run = async (purpose) => {
    const asked = [];
    const db = { query: async (text) => { asked.push(text); return { rows: /FROM supplier_list/.test(text) ? [{ one: 1 }] : [] }; } };
    require.cache[require.resolve(path.join(H.API, 'db'))] = { exports: { withEntity: async (e, fn) => fn(db), query: db.query } };
    delete require.cache[require.resolve(path.join(H.API, 'lib', 'chits-send-bill'))];
    await require(path.join(H.API, 'lib', 'chits-send-bill')).addReceiverToCustomerList({ sender_id: SHOP, purpose }, { entity_id: TRADER });
    delete require.cache[require.resolve(path.join(H.API, 'db'))];
    return asked.some((t) => /INSERT INTO customer_list/.test(t));
  };
  eq('an invoice to a receiver that is already a supplier adds its customer row (one party, both roles)', await run('invoice'), true);
  eq('a credit note and a debit note do the same', [await run('credit_note'), await run('debit_note')], [true, true]);
  /* hostile: what is not a sale never refiles a supplier as a customer (d9f0630dc stays true) */
  eq('an order, a payment advice and a receipt to a supplier add none', [await run('order'), await run('payment_advice'), await run('receipt')], [false, false, false]);
}

(async () => {
  await sendStep();
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP books part: ' + X.src.why); console.log('\n   ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { B, T, db } = X;
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-22T06:00:00Z');
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  require('../lib/country-setup').registrationOfShop = async () => 'regular';
  const copies = {};
  const entryOf = (copy) => {
    const sells = copy.sender_entity_id === SHOP;
    return { sells, seller: { entity_id: copy.sender_entity_id }, buyer: { entity_id: sells ? TRADER : SHOP }, me: { entity_id: SHOP }, invoice: copy.business_json.invoice };
  };
  TC.copyOf = async (id) => copies[id] || null;
  TC.entryFor = async (copy) => entryOf(copy);
  T.identities.push({ identity_id: SHOP, display_name: 'H Cycles', country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney', policy_flags: {} });
  await X.store.saveSetting(db, SHOP, S_AU); await B.enable(db, SHOP, { by: SHOP, today: '2026-10-01', country: 'AU' }); K.forget(SHOP);
  T.parties.push({ owner: SHOP, party_id: TRADER, name: 'W Wheels', supplier: true, customer: true, credit_days: 30 });
  const inv = (price, rate) => Object.assign(TAX.determine({ seller: party(), buyer: party(), country: 'AU', lines: [{ name: 'Item', qty: 1, unit_price: price, rate, kind: rate ? 'standard' : 'zero_rated' }] }), { currency: 'AUD' });
  const mk = (id, purpose, sender, day, invoice) => (copies[id] = { chit_id: id, purpose, sender_entity_id: sender, currency_code: 'AUD', current_status: 'accepted', created_at: day + 'T04:30:00Z', business_json: { bill_no: 'N-' + id.slice(0, 2), billed_at: day + 'T04:30:00Z', invoice } });
  mk(T1, 'invoice', TRADER, '2026-11-10', inv(260, 0));
  mk(T7, 'invoice', SHOP, '2026-11-17', inv(150, 10));
  await K.postChit(SHOP, T1, {}); await K.postChit(SHOP, T7, {});

  const ask = (direction, amount) => B.proposeFor(db, SHOP, { party: TRADER, direction, amount_minor: amount, currency: 'AUD' });
  const incoming = await ask('in', 16500);
  eq('W pays H 165.00: the proposal is H\'s receivable T7 alone, 165.00 open, 165.00 applied', [incoming.proposal.map((x) => x.against_ref), incoming.open_minor, incoming.apply_minor], [[T7], 16500, 16500]);
  const outgoing = await ask('out', 9500);
  eq('H pays W 95.00: the proposal is H\'s payable T1, 260.00 open, 95.00 applied', [outgoing.proposal.map((x) => x.against_ref), outgoing.open_minor, outgoing.apply_minor], [[T1], 26000, 9500]);

  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   CRASH ' + (e && e.stack)); process.exit(1); });

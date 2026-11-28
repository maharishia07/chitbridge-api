/**
 * acc413-named-credit-both-sides.test.cjs - ACC-413 (AU business run round 2, 27 Nov 2026): a rail credit note that NAMES a bill settles THAT bill at the buyer, as it does at the seller.
 * Before: the buyer's purchase_return carried no against_ref (books-hooks creditNoteVerdict), so the note sat on account and the per-bill view read it oldest-first.
 * Hand figures (AUD, the write-up's G/H pair): bill T2 1,136.00 (older, GST-free), bill T9 264.00 = 240.00 + 24.00 GST; credit note on T9: 72.00 + 7.20 = 79.20.
 *   named note   -> T9 184.80, T2 1,136.00 (seller and buyer alike); party total 1,320.80 both sides
 *   unnamed note -> oldest first (DECISIONS): T2 1,056.80, T9 264.00; party total 1,320.80
 * Both sides are the one classifier (books-hooks classify): the seller's `return` and the buyer's `purchase_return` are read from the same note, per bill from the party items by the one allocator (receivables.outstanding).
 * Run: node tests/acc413-named-credit-both-sides.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const BUYER = '11111111-1111-4111-8111-aaaaaaaa0413', SELLER = '55555555-5555-4555-8555-aaaaaaaa0413';
const T2 = 'b2222222-2222-4222-8222-aaaaaaaa0413', T9 = 'b9999999-9999-4999-8999-aaaaaaaa0413';
const S_AU = { enabled: true, walkin_grain: 'bill', country: 'AU', functional_currency: 'AUD', timezone: 'Australia/Sydney' };
const TAX = require(path.join(H.API, 'lib', 'tax'));
const party = () => ({ Abn: '51824753556', LglNm: 'X', Country: 'AU', RegType: 'regular' });
(async () => {
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const { B, T, db } = X;
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-22T06:00:00Z');
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  require('../lib/country-setup').registrationOfShop = async () => 'regular';
  const copies = {};
  const entryOf = (invoice) => ({ sells: false, seller: { entity_id: SELLER, LglNm: 'G Components' }, buyer: { entity_id: BUYER }, me: { entity_id: BUYER }, invoice });
  TC.copyOf = async (id) => copies[id] || null;
  TC.entryFor = async (copy) => entryOf(copy && copy.business_json && copy.business_json.invoice);
  T.identities.push({ identity_id: BUYER, display_name: 'H Cycles', country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney', policy_flags: {} });
  await X.store.saveSetting(db, BUYER, S_AU); await B.enable(db, BUYER, { by: BUYER, today: '2026-10-01', country: 'AU' }); K.forget(BUYER);
  T.parties.push({ owner: BUYER, party_id: SELLER, name: 'G Components', supplier: true, credit_days: 30 });
  const inv = (price, rate) => Object.assign(TAX.determine({ seller: party(), buyer: party(), country: 'AU', lines: [{ name: 'Part', qty: 1, unit_price: price, rate, kind: rate ? 'standard' : 'zero_rated' }] }), { currency: 'AUD' });
  const mk = (id, purpose, day, invoice, extra) => (copies[id] = { chit_id: id, purpose, sender_entity_id: SELLER, currency_code: 'AUD', current_status: 'accepted', created_at: day + 'T04:30:00Z', business_json: Object.assign({ bill_no: 'N-' + id.slice(0, 2), billed_at: day + 'T04:30:00Z', invoice }, extra || {}) });
  mk(T2, 'invoice', '2026-11-10', inv(1136, 0));
  mk(T9, 'invoice', '2026-11-20', inv(240, 10));
  await K.postChit(BUYER, T2, {}); await K.postChit(BUYER, T9, {});
  /* the per-bill view every screen reads: books-engines.netOpen (each bill net of its allocations and of credits on account, oldest first) */
  const open = () => {
    const rows = T.items.filter((i) => i.entity_id === BUYER && i.party_id === SELLER).map(X.E.itemOf);
    const by = X.E.netOpen(rows).by_ref;
    const t2 = by[T2] ? by[T2].outstanding_minor : null, t9 = by[T9] ? by[T9].outstanding_minor : null;
    return { t2, t9, total: t2 + t9 };
  };
  eq('before any note: T2 113600, T9 26400', [open().t2, open().t9], [113600, 26400]);

  /* the classifier reads ONE note for both sides: the seller's return names the bill, so must the buyer's purchase_return */
  const noteBj = (against) => ({ against, refund: { parts: [] } });
  const asBuyer = K.classify({ chit: { chit_id: 'n1', created_at: '2026-11-22T05:00:00Z', purpose: 'credit_note', business_json: noteBj({ chit_id: T9, bill_no: 'N-b9' }) }, entry: entryOf(inv(72, 10)), setting: S_AU });
  const asSeller = K.classify({ chit: { chit_id: 'n1', created_at: '2026-11-22T05:00:00Z', purpose: 'credit_note', business_json: Object.assign(noteBj({ chit_id: T9, bill_no: 'N-b9' }), { refund: { parts: [{ how: 'Cash', amount: 79.2 }] } }) }, entry: Object.assign(entryOf(inv(72, 10)), { sells: true, buyer: { entity_id: BUYER } }), setting: S_AU });
  eq('seller: the return names the bill (as before)', [asSeller.event.type, asSeller.event.against_chit], ['return', T9]);
  eq('buyer: the purchase_return names the same bill (ACC-413)', [asBuyer.event.type, asBuyer.event.against_ref], ['purchase_return', T9]);
  const unnamed = K.classify({ chit: { chit_id: 'n0', created_at: '2026-11-22T05:00:00Z', purpose: 'credit_note', business_json: noteBj(null) }, entry: entryOf(inv(72, 10)), setting: S_AU });
  ok('a note that names no bill carries no against_ref (on account, oldest first)', unnamed.event && !('against_ref' in unnamed.event), JSON.stringify(unnamed.event));

  /* posted through the one writer: the buyer's per-bill figures */
  mk('n1', 'credit_note', '2026-11-22', inv(72, 10), { against: { chit_id: T9, bill_no: 'N-b9' } });
  await K.postChit(BUYER, 'n1', {});
  const named = open();
  eq('named note: T9 18480, T2 113600 (a note names its bill, on both sides)', [named.t9, named.t2], [18480, 113600]);
  eq('party total 132080 (1,320.80), as the seller', named.total, 132080);

  mk('n2', 'credit_note', '2026-11-22', inv(72, 10), {});
  const before = open();
  await K.postChit(BUYER, 'n2', {});
  const after = open();
  eq('an unnamed second note of 79.20 goes oldest first (DECISIONS): T2 down by 7920, T9 unchanged', [before.t2 - after.t2, before.t9 - after.t9], [7920, 0]);
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   CRASH ' + (e && e.stack)); process.exit(1); });

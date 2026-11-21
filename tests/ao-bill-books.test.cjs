/**
 * ao-bill-books.test.cjs - walk AO (UAE, 22 Nov 2026): AO-F-03 a USD bill posts in AED at the bill day's rate with the USD kept (the ONE fx engine; the send door carries the currency: tests/aj-currency-door.test.cjs),
 * and an invoice that carries no lines is said in words, not "Not posted: nothing to post" at every retry; AO-F-02 a rail credit note I received posts after the bill it reduces (the bill disputed = not in the books).
 * Hand (minor units): USD 100.00 = 10000 at 3.6725 -> 36725 fils (AED 367.25); the 105.00 bill 5% = 100.00 + 5.00 tax -> Cr supplier 38561 (385.6125 half-up), input VAT 1836; credit note USD 52.50 -> 19281 (192.8063).
 * Run: node tests/ao-bill-books.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-aaaaaaaaaa01', SUP = '55555555-5555-4555-8555-aaaaaaaaaa01';
const BILL = 'b1111111-1111-4111-8111-aaaaaaaaaa01';
const S_AE = { enabled: true, walkin_grain: 'bill', country: 'AE', functional_currency: 'AED', timezone: 'Asia/Dubai' };
const TAX = require(path.join(H.API, 'lib', 'tax'));
const party = () => ({ Trn: '100123456789003', LglNm: 'X', Country: 'AE', RegType: 'regular', State: 'DU', Pos: 'DU' });
(async () => {
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const { B, T, db } = X;
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const FX = require(path.join(H.API, 'lib', 'fx-rates'));
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-22T06:00:00Z');
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const copies = {};
  const entryOf = (invoice) => ({ sells: false, seller: { entity_id: SUP, LglNm: 'Chip Co' }, buyer: { entity_id: SHOP }, me: { entity_id: SHOP }, invoice });
  TC.copyOf = async (id) => copies[id] || null;
  TC.entryFor = async (copy) => entryOf(copy && copy.business_json && copy.business_json.invoice);
  T.identities.push({ identity_id: SHOP, display_name: 'AE Shop', country: 'AE', currency_code: 'AED', timezone: 'Asia/Dubai', policy_flags: {} });
  await X.store.saveSetting(db, SHOP, S_AE); await B.enable(db, SHOP, { by: SHOP, today: '2026-10-01', country: 'AE' }); K.forget(SHOP);
  T.fxReady = true; T.fxLines = true;
  T.parties.push({ owner: SHOP, party_id: SUP, name: 'Chip Co', supplier: true, credit_days: 30 });
  const s = await B.settingOf(db, SHOP);
  const posted = (id) => T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'chit:' + id);
  const waitRows = (id) => T.outbox.filter((o) => o.entity_id === SHOP && o.source_chit_id === id && !o.done_at);
  const linesOf = (entryId) => T.lines.filter((l) => l.entry_id === entryId);
  const mk = (id, purpose, cur, invoice, status, extra) => (copies[id] = { chit_id: id, purpose, sender_entity_id: SUP, currency_code: cur, current_status: status, created_at: '2026-11-22T04:30:00Z', business_json: Object.assign({ bill_no: 'N-' + id, billed_at: '2026-11-22T04:30:00Z', invoice }, extra || {}) });
  const inv = (price, rate) => Object.assign(TAX.determine({ seller: party(), buyer: party(), country: 'AE', lines: [{ name: 'Dirham item', qty: 1, unit_price: price, rate, kind: rate ? 'standard' : 'zero_rated' }] }), { currency: 'USD' });

  /* AO-F-03 · no rate yet: said in words, nothing posted; then the rate: USD 100.00 -> AED 367.25 */
  mk('u1', 'invoice', 'USD', inv(100, 0), 'accepted');
  const w = await K.postChit(SHOP, 'u1', {});
  ok('a USD bill with no USD rate for the day waits in words (the rate sentence), nothing posted', w.queued === true && /^No USD rate for 22 Nov/.test(String((waitRows('u1').pop() || {}).why)) && posted('u1').length === 0, JSON.stringify([w, waitRows('u1').map((o) => o.why)]));
  await FX.add(db, SHOP, s, { date: '2026-11-22', currency: 'USD', rate: 3.6725 }, SHOP);
  await K.retryOutbox(SHOP, 20);
  const e1 = posted('u1')[0], l1 = e1 ? linesOf(e1.entry_id) : [];
  const cr1 = l1.find((l) => l.role === 'creditors');
  eq('USD 100.00 at 3.6725: Cr the supplier 36725 fils, the line keeps USD 100.00 (amount_txn 10000) and the rate', cr1 && [cr1.cr_minor, cr1.txn_currency, cr1.amount_txn_minor, Number(cr1.fx_rate)], [36725, 'USD', 10000, 3.6725]);
  /* the 105.00 bill at 5%: the books' rounding, once */
  mk('u2', 'invoice', 'USD', inv(100, 5), 'accepted');
  await K.postChit(SHOP, 'u2', {});
  const l2 = posted('u2')[0] ? linesOf(posted('u2')[0].entry_id) : [];
  eq('USD 105.00 (5%) at 3.6725: Cr the supplier 38561, input VAT 1836 (never AED 105.00)', [(l2.find((l) => l.role === 'creditors') || {}).cr_minor, l2.filter((l) => /input/i.test(String(l.role))).reduce((t, l) => t + l.dr_minor, 0)], [38561, 1836]);

  /* an invoice with no lines */
  mk('u3', 'invoice', 'USD', { currency: 'USD', TranDtls: { TaxSch: 'VAT' }, _cb: { currency: 'USD' } }, 'accepted');
  const a3 = await K.postChit(SHOP, 'u3', {});
  const why3 = String((waitRows('u3').pop() || {}).why);
  ok('an invoice with no lines is said in words, once (not "nothing to post")', a3.queued === true && /carries no lines/.test(why3), why3);
  ok('...and posts nothing', posted('u3').length === 0);

  /* AO-F-02 · a credit note for a bill still disputed waits; after the bill posts it posts */
  mk(BILL, 'invoice', 'USD', inv(100, 5), 'disputed');
  const cn = mk('c1', 'credit_note', 'USD', inv(50, 5), 'accepted', { against: { chit_id: BILL, bill_no: 'N-bill' } });
  const c1 = await K.postChit(SHOP, 'c1', {});
  const wc = String((waitRows('c1').pop() || {}).why);
  ok('a rail credit note whose bill is disputed (not posted) waits, in words, and posts nothing', c1.queued === true && /is not in the books yet, so the note waits for it/.test(wc) && posted('c1').length === 0, JSON.stringify([c1, wc]));
  copies[BILL].current_status = 'accepted';
  await K.postChit(SHOP, BILL, {});
  ok('the bill posts after its resolve', posted(BILL).length === 1);
  await K.retryOutbox(SHOP, 20);
  const ce = posted('c1')[0];
  ok('the next retry posts the note, after the bill (purchase_return)', !!ce && ce.event_type === 'purchase_return' && waitRows('c1').length === 0, JSON.stringify(ce));
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   CRASH ' + (e && e.stack)); process.exit(1); });

/**
 * acc-263-credit-refund.test.cjs — ACC-263: A TILL CREDIT NOTE REFUNDED "ON CREDIT" POSTS AGAINST THE CUSTOMER'S RECEIVABLE.
 *
 *   Before: the refund tender 'credit' went to the engine as a refund MODE and the posting failed on the ledger "?credit"
 *   (queued "Not posted: the account "?credit" is not in the chart", never done). Now a credit-only refund takes the engine's party
 *   path — Dr sales returns + output tax · Cr debtors (the customer) — exactly as a sale on credit is Dr debtors. A money tender is
 *   unchanged (Cr that mode). Credit mixed with money (engines L13: one or the other) and credit with no customer WAIT in words.
 *   Runs on the in-memory twin for an IN shop and an AU shop.
 * Run: node tests/acc-263-credit-refund.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const IN_SHOP = '11111111-1111-4111-8111-263263263263', AU_SHOP = 'aaaaaaaa-2222-4111-8111-263263263263', CUST = '22222222-2222-4222-8222-222222222222';
const S_IN = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
const S_AU = { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 };
const invIn = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } };
const invAu = { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 100, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 10, CesAmt: 0 }], ValDtls: { TotInvVal: 110 } };

(async () => {
  console.log('\n══ ACC-263 · a credit note refunded on credit reduces what the customer owes ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const note = (cur, parts, withCustomer) => ({ chit_id: 'n1', purpose: 'credit_note', currency_code: cur, created_at: '2026-10-17T05:00:00Z',
    business_json: Object.assign({ till: { id: 'C1' }, bill_no: 'CN-1', against: 'C1-0001', refund: { parts } }, withCustomer === false ? {} : { customer: { name: 'Ravi', identity_id: CUST } }) });
  const run = (setting, invoice, parts, withCustomer) => K.classify({ chit: note(invoice.currency, parts, withCustomer), entry: { sells: true, invoice }, setting });

  const cIn = run(S_IN, invIn, [{ how: 'On credit', amount: 118 }]);
  eq('IN · ₹118 refunded On credit → return on the customer, no refund mode', [cIn.kind, cIn.event.type, cIn.event.party, 'refund' in cIn.event], ['post', 'return', CUST, false]);
  const cAu = run(S_AU, invAu, [{ how: 'On credit', amount: 110 }]);
  eq('AU · A$110 refunded On credit → return on the customer, no refund mode', [cAu.kind, cAu.event.party, 'refund' in cAu.event], ['post', CUST, false]);
  const cash = run(S_IN, invIn, [{ how: 'Cash', amount: 118 }]);
  eq('cash refund unchanged (Cr cash, customer carried)', [cash.event.refund, cash.event.party], [{ cash: 118 }, CUST]);
  const mixed = run(S_IN, invIn, [{ how: 'Cash', amount: 50 }, { how: 'On credit', amount: 68 }]);
  ok('credit + cash in one note WAITS, in words (no single-event rule)', mixed.kind === 'queue' && /two credit notes/.test(mixed.why), JSON.stringify(mixed));
  const noCust = run(S_IN, invIn, [{ how: 'On credit', amount: 118 }], false);
  ok('On credit with no customer WAITS, naming the customer', noCust.kind === 'queue' && /customer/.test(noCust.why), JSON.stringify(noCust));

  /* ── through the hook onto the twin books: the receivable falls, nothing leaves the till ── */
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf, wasE = TC.entryFor; let now = null, entry = null;
  TC.copyOf = async () => now; TC.entryFor = async () => entry;
  const shop = async (id, s, row) => { X.T.identities.push(Object.assign({ identity_id: id, display_name: 'Shop ' + id.slice(-4) }, row));
    await X.store.saveSetting(X.db, id, s); await X.B.enable(X.db, id, { by: id, today: '2026-10-17' }); K.forget(id); };
  const lines = (id) => { const e = X.T.entries.find((x) => x.entity_id === id && x.source_ref === 'chit:n1'); if (!e) return null;
    return X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => { const a = X.T.accounts.find((y) => y.account_id === l.account_id); return [a && (a.role || a.code), Number(l.dr_minor || 0), Number(l.cr_minor || 0), l.party_id || null]; }); };
  /* the twin cannot answer the original-bill lookup (real SQL), so the posted notes carry no `against` here; classify above covers it */
  const stuck = (id) => X.T.outbox.filter((o) => o.source_chit_id === 'n1' && !o.done_at).map((o) => o.why);
  X.T.parties.push({ owner: IN_SHOP, party_id: CUST, name: 'Ravi', customer: true }, { owner: AU_SHOP, party_id: CUST, name: 'Ravi', customer: true });

  await shop(IN_SHOP, S_IN, { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} });
  now = note('INR', [{ how: 'On credit', amount: 118 }]); delete now.business_json.against; entry = { sells: true, invoice: invIn };
  const ri = await K.postChit(IN_SHOP, 'n1', {});
  const li = lines(IN_SHOP);
  console.log('        IN lines:', JSON.stringify(li), JSON.stringify(stuck(IN_SHOP)));
  ok('IN · posted, not queued, nothing "Not posted"', !ri.queued && !!li && stuck(IN_SHOP).length === 0, JSON.stringify([ri, stuck(IN_SHOP)]));
  eq('IN · Dr returns 100 + CGST 9 + SGST 9 · Cr debtors 118 (the customer)', [li.reduce((t, l) => t + l[1], 0), li.reduce((t, l) => t + l[2], 0), li.filter((l) => l[2]).map((l) => [l[0], l[2], l[3]])], [11800, 11800, [['debtors', 11800, CUST]]]);

  X.T.entries.length = 0; X.T.lines.length = 0; X.T.outbox.length = 0;
  await shop(AU_SHOP, S_AU, { country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney', policy_flags: {} });
  now = note('AUD', [{ how: 'On credit', amount: 110 }]); delete now.business_json.against; entry = { sells: true, invoice: invAu };
  const ra = await K.postChit(AU_SHOP, 'n1', {});
  const la = lines(AU_SHOP);
  console.log('        AU lines:', JSON.stringify(la), JSON.stringify(stuck(AU_SHOP)));
  ok('AU · posted, not queued', !ra.queued && !!la && stuck(AU_SHOP).length === 0, JSON.stringify([ra, stuck(AU_SHOP)]));
  eq('AU · Dr returns 100 + GST 10 · Cr debtors 110 (the customer)', [la.reduce((t, l) => t + l[1], 0), la.filter((l) => l[2]).map((l) => [l[0], l[2], l[3]])], [11000, [['debtors', 11000, CUST]]]);
  TC.copyOf = wasC; TC.entryFor = wasE;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

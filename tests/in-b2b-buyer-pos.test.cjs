#!/usr/bin/env node
/**
 * in-b2b-buyer-pos.test.cjs — IN-F-01 (walk IN, 21 Nov 2026): A BILL TO A GST-REGISTERED PARTY IS A B2B INVOICE, NOT A WALK-IN SALE.
 * @type regression
 * OWNS      the proof that (1) the counter's customer read hands the till the buyer's tax id from BOTH its homes (identities.gstn and
 *           party_tax_id — the party editor wrote only the second, so the till billed a registered buyer as B2C in the shop's state),
 *           (2) with that GSTIN the one engine (lib/tax-lines invoiceFor = tax.determine) issues SupTyp B2B + BuyerDtls Gstin + Pos,
 *           intra-state CGST+SGST, inter-state (a recorded despatch, IGST Act s.10(1)(a)) IGST at POS 29, an unregistered walk-in stays B2C,
 *           and (3) GSTR-1 puts the registered bills in b2b under the GSTIN and the walk-in in b2cs; 3B 3.1(a) carries the IGST.
 * CALLED BY scripts/guards.cjs · CI. No database. Hand case (shop Tamil Nadu 33, ₹1,000.00 incl 18%):
 *   A  to Kovai Traders 33AAAAA0000A1Z5, over the counter → taxable 847.46 · CGST 76.27 · SGST 76.27 · POS 33 · B2B
 *   B  to Bengaluru Tools 29AABCN4321M1ZB, despatched to 29 → taxable 847.46 · IGST 152.54 · POS 29 · B2B
 *   C  walk-in, no GSTIN → taxable 847.46 · CGST 76.27 · SGST 76.27 · B2C → b2cs INTRA 33 @18
 *   GSTR-1: b2b = [29AABCN4321M1ZB: B, 33AAAAA0000A1Z5: A]; b2cs INTRA 33 @18 = taxable 847.46, camt 76.27, samt 76.27.
 *   3B 3.1(a): taxable 2,542.38 · IGST 152.54 · CGST 152.54 · SGST 152.54.
 * Run: node tests/in-b2b-buyer-pos.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = path.join(__dirname, '..');
const T = require(path.join(HERE, 'lib', 'tax-lines'));
const tax = require(path.join(HERE, 'lib', 'tax'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const ME = { Gstin: '33AAAAA0000A1Z5', State: '33', RegType: 'regular', Country: 'IN' };
/* the buyer the till builds (till.html billMoney): Gstin and State from the party, Pos = the engine's placeOfSupply(delivery, shop state) */
const buyerOf = (name, gstin, delivery) => ({ LglNm: name, Gstin: gstin, State: /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : '', RegType: gstin ? 'regular' : 'unregistered', Country: 'IN', Pos: tax.placeOfSupply({ delivery }, '33') });
const bill = (no, buyer) => T.invoiceFor({ lines: [{ name: 'Service', quantity: 1, price: 1000, gst_rate: 18, hsn: '9987', unit: 'nos' }], seller: ME, buyer, priceIncludesTax: true, chit_id: no, at: '2026-11-21' }).invoice;
const heads = (inv) => { const m = tax.moneyOf(inv); return { taxable: m.taxable, cgst: m.cgst, sgst: m.sgst, igst: m.igst, total: m.total, pos: m.pos_state, supply: m.supply }; };
const row = (no, inv) => ({ chit_id: no, doc_no: no, direction: 'sent', sells: true, side: 'output', invoice: inv, provisional: false, seller: { entity_id: 'me' }, buyer: { entity_id: null }, at: '2026-11-21', day: '2026-11-21' });

(async () => {
  console.log('\n══ IN-F-01 · a registered buyer makes a B2B invoice ══\n');
  const A = bill('C1/26-27/0001', buyerOf('Kovai Traders', '33AAAAA0000A1Z5', null));
  const B = bill('C1/26-27/0004', buyerOf('Bengaluru Tools', '29AABCN4321M1ZB', { state_code: '29' }));
  const C = bill('C1/26-27/0005', buyerOf('Walk-in', '', null));

  eq('A intra-state registered: 847.46 + CGST 76.27 + SGST 76.27 = 1,000, POS 33', heads(A), { taxable: 847.46, cgst: 76.27, sgst: 76.27, igst: 0, total: 1000, pos: '33', supply: 'intra' });
  eq('A is B2B with the buyer GSTIN and Pos', [A.TranDtls.SupTyp, A.BuyerDtls.Gstin, A.BuyerDtls.Pos], ['B2B', '33AAAAA0000A1Z5', '33']);
  eq('B inter-state registered (despatched to 29): 847.46 + IGST 152.54 = 1,000, POS 29', heads(B), { taxable: 847.46, cgst: 0, sgst: 0, igst: 152.54, total: 1000, pos: '29', supply: 'inter' });
  eq('B is B2B with the buyer GSTIN and Pos 29', [B.TranDtls.SupTyp, B.BuyerDtls.Gstin, B.BuyerDtls.Pos], ['B2B', '29AABCN4321M1ZB', '29']);
  eq('C unregistered walk-in: CGST+SGST in the shop state, B2C, no buyer GSTIN', [heads(C).cgst, heads(C).sgst, heads(C).igst, C.TranDtls.SupTyp, C.BuyerDtls.Gstin || ''], [76.27, 76.27, 0, 'B2C', '']);

  const rows = [row('A', A), row('B', B), row('C', C)];
  const g1 = T.gstr1({ rows }, ME, '112026');
  eq('GSTR-1 b2b lists the two registered buyers by GSTIN', (g1.b2b || []).map((p) => [p.ctin, p.inv.map((x) => x.inum + ':' + x.pos)]).sort(), [['29AABCN4321M1ZB', ['B:29']], ['33AAAAA0000A1Z5', ['A:33']]]);
  const cs = (g1.b2cs || []);
  eq('GSTR-1 b2cs holds only the walk-in: INTRA 33 @18 taxable 847.46, camt 76.27, samt 76.27', cs.map((r) => [r.sply_ty, r.pos, r.rt, r.txval, r.camt, r.samt]), [['INTRA', '33', 18, 847.46, 76.27, 76.27]]);
  const led = T.ledger(rows.map((r) => Object.assign({}, r, { seller: { Country: 'IN', entity_id: 'me' }, buyer: { entity_id: 'b' } })), { RegType: 'regular' });
  const g3 = T.gstr3b(led, ME, '112026');
  const o = (g3.sup_details || {}).osup_det || {};
  eq('3B 3.1(a): taxable 2,542.38 · IGST 152.54 · CGST 152.54 · SGST 152.54', [o.txval, o.iamt, o.camt, o.samt], [2542.38, 152.54, 152.54, 152.54]);

  /* the till's customer read carries the buyer's tax id from both homes, in the one query (no extra round trip) */
  const src = fs.readFileSync(path.join(HERE, 'routes', 'till.js'), 'utf8');
  const q = src.slice(src.indexOf('function customersRead('), src.indexOf('function suppliersRead('));
  ok('customersRead reads the GSTIN · ABN · TRN of party_tax_id when identities.gstn is empty', /NULLIF\(i\.gstn, ''\)/.test(src) && /party_tax_id/.test(src) && /\$\{BUYER_TAX_ID_SQL\} AS gstn/.test(q), 'the till would again see a party saved on the party screen as a walk-in');

  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();

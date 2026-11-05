#!/usr/bin/env node
/**
 * acc-225-gstr1-b2cl.test.cjs — ACC-225: ONE GSTR-1 BUILDER, AND IT HAS TABLE 5 (B2CL).
 * @type regression
 * OWNS      the proof that the api's GSTR-1 (lib/tax-lines gstr1, read by GET /api/tax/gstr and the CA's book pack) is the ADOPTED engine's
 *           (lib/gst-returns gstr1): an inter-state B2C invoice whose VALUE (incl. tax) is over the month's B2CL limit lands in Table 5 b2cl
 *           invoice by invoice, one under it is summed into b2cs, an intra-state one stays b2cs INTRA; the limit is ₹1,00,000 from August 2024
 *           (Notification 12/2024-Central Tax) and ₹2,50,000 before; a large inter-state B2C credit note is a cdnur B2CL row; the HSN
 *           summary's uqc is the portal's code; a shop with no 15-character GSTIN is refused in words; and no second builder is left in tax-lines.
 * CALLED BY scripts/guards.cjs · CI. No database: the frozen invoices come from tax-lines.invoiceFor (the engine), the rows are built by hand.
 * FLOW      hand case (cb-business) → tax-lines.invoiceFor → ledger rows → tax-lines.gstr1 (→ gst-returns.gstr1) → the tables, compared
 *
 * THE HAND CASE (October 2026, shop in Tamil Nadu 33, every line 18%):
 *   INV-0001  inter-state B2C (POS 29)  taxable 1,50,000  IGST 27,000     value 1,77,000.00  > 1,00,000 → b2cl
 *   INV-0002  inter-state B2C (POS 29)  taxable     5,000  IGST    900     value     5,900.00  ≤ limit    → b2cs INTER 29 @18
 *   INV-0003  intra-state B2C (POS 33)  taxable     1,000  CGST 90 SGST 90 value     1,180.00             → b2cs INTRA 33 @18
 *   INV-0004  inter-state B2C (POS 29)  taxable    84,746  IGST 15,254.28  value 1,00,000.28  > limit    → b2cl (the VALUE decides, not the taxable)
 *   INV-0005  inter-state B2C (POS 29)  taxable    84,745  IGST 15,254.10  value    99,999.10  ≤ limit    → b2cs INTER 29 @18
 *   CN-0001   inter-state B2C (POS 29)  taxable 1,50,000  IGST 27,000     value 1,77,000.00  > limit    → cdnur typ B2CL
 *   b2cs INTER 29 @18 = 5,000 + 84,745 = 89,745 taxable · IGST 900 + 15,254.10 = 16,154.10.  b2cs INTRA 33 @18 = 1,000 · 90 · 90.
 *   BEFORE (the builder this replaces, origin/main 6f0eefc9): no b2cl key; b2cs INTER 29 @18 = 1,50,000 + 5,000 + 84,746 + 84,745 − 1,50,000 (the note
 *   netted off) = 1,74,491 · IGST 31,408.38; cdnur [] (the note's 1,77,000 was under its ₹2,50,000).
 * Run: node tests/acc-225-gstr1-b2cl.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = path.join(__dirname, '..');
const T = require(path.join(HERE, 'lib', 'tax-lines'));

let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const ME = { Gstin: '33AAAAA0000A1Z5', State: '33', RegType: 'regular' };
/** one frozen invoice through the engine (tax-lines.invoiceFor → tax.determine): one line at `rate`, unit 'pcs' (the seller's word) */
const invoice = (buyer, rate, price, no, at) =>
  T.invoiceFor({ lines: [{ name: 'Pump', quantity: 1, price, gst_rate: rate, hsn: '8413', unit: 'pcs' }], seller: ME, buyer, chit_id: no, at }).invoice;
/** a ledger row as tax-lines.ledger hands them to gstr1: side 'output' (a sale) or 'output_cn' (a credit note), `day` the shop's day */
const row = (no, buyer, rate, price, side, at) => ({ chit_id: no, doc_no: no, direction: 'sent', sells: true, side, invoice: invoice(buyer, rate, price, no, at), provisional: false, seller: { entity_id: 'me' }, buyer: { entity_id: null }, at, day: at });
const INTER = { Pos: '29' },
  INTRA = { Pos: '33' };
const month = (rows) => ({ rows });
const itm = (x) => x.itms[0].itm_det;

(async () => {
  console.log('\n══ ACC-225 · one GSTR-1 builder, with Table 5 (B2CL) ══\n');

  /* ── 1 · the hand case, October 2026 (limit ₹1,00,000) ── */
  const led = month([
    row('INV-0001', INTER, 18, 150000, 'output', '2026-10-03'),
    row('INV-0002', INTER, 18, 5000, 'output', '2026-10-04'),
    row('INV-0003', INTRA, 18, 1000, 'output', '2026-10-05'),
    row('INV-0004', INTER, 18, 84746, 'output', '2026-10-06'),
    row('INV-0005', INTER, 18, 84745, 'output', '2026-10-07'),
    row('CN-0001', INTER, 18, 150000, 'output_cn', '2026-10-08')
  ]);
  const g = T.gstr1(led, ME, '102026');
  eq('the file names the shop, the period and the version the offline tool reads', [g.gstin, g.fp, g.version], ['33AAAAA0000A1Z5', '102026', 'GST3.1.4']);
  eq('_cb says the limit the month filed on: ₹1,00,000 (Notification 12/2024, from the August 2024 period)', g._cb && g._cb.b2cl_limit, 100000);
  eq('Table 5 b2cl: POS 29 holds INV-0001 (1,77,000) and INV-0004 (1,00,000.28) — the invoice VALUE decides, 28 paise over', (g.b2cl || []).map((p) => [p.pos, p.inv.map((x) => [x.inum, x.idt, x.val])]), [['29', [['INV-0001', '03-10-2026', 177000], ['INV-0004', '06-10-2026', 100000.28]]]]);
  eq('…each b2cl invoice carries its own rate row: 1,50,000 @18 IGST 27,000; 84,746 @18 IGST 15,254.28', g.b2cl[0].inv.map((x) => [itm(x).rt, itm(x).txval, itm(x).iamt, itm(x).camt, itm(x).samt]), [[18, 150000, 27000, 0, 0], [18, 84746, 15254.28, 0, 0]]);
  eq('b2cs INTER POS 29 @18 is the two SMALL bills only: 5,000 + 84,745 = 89,745 · IGST 16,154.10 (99,999.10 stays under the limit)', g.b2cs.filter((x) => x.sply_ty === 'INTER').map((x) => [x.pos, x.rt, x.txval, x.iamt, x.camt, x.samt]), [['29', 18, 89745, 16154.1, 0, 0]]);
  eq('b2cs INTRA POS 33 @18: 1,000 · CGST 90 · SGST 90, as before', g.b2cs.filter((x) => x.sply_ty === 'INTRA').map((x) => [x.pos, x.rt, x.txval, x.iamt, x.camt, x.samt]), [['33', 18, 1000, 0, 90, 90]]);
  eq('cdnur: the 1,77,000 inter-state B2C credit note is a B2CL row (the old builder tested it against ₹2,50,000 and netted it off b2cs)', g.cdnur.map((x) => [x.typ, x.ntty, x.nt_num, x.nt_dt, x.val, x.pos, itm(x).txval, itm(x).iamt]), [['B2CL', 'C', 'CN-0001', '08-10-2026', 177000, '29', 150000, 27000]]);
  eq('b2b and cdnr: none (no registered buyer in the month)', [g.b2b, g.cdnr], [[], []]);
  eq('the HSN summary is net of the note and its uqc is the portal\'s code (pcs → PCS, tax-lines uqcFor), never the seller\'s word', g.hsn.data.map((h) => [h.hsn_sc, h.uqc, h.qty, h.txval, h.iamt, h.camt, h.samt]), [['8413', 'PCS', 4, 175491, 31408.38, 90, 90]]);
  eq('Table 13: five invoices INV-0001…INV-0005 and one credit note, none cancelled', g.doc_issue.doc_det.map((d) => [d.doc_typ, d.docs[0].from, d.docs[0].to, d.docs[0].totnum, d.docs[0].cancel]), [['Invoices for outward supply', 'INV-0001', 'INV-0005', 5, 0], ['Credit Note', 'CN-0001', 'CN-0001', 1, 0]]);
  eq('_cb.summary: 5 invoices, 1 note; taxable net of the note 1,75,491', [g._cb.summary.invoices, g._cb.summary.notes, g._cb.summary.taxable], [5, 1, 175491]);
  eq('the engine had nothing to warn about on this month', g._cb.warnings, []);

  /* ── 2 · an old month files on its own limit: July 2024 was still ₹2,50,000 ── */
  const old = T.gstr1(month([row('INV-0001', INTER, 18, 150000, 'output', '2024-07-03'), row('CN-0001', INTER, 18, 150000, 'output_cn', '2024-07-08')]), ME, '072024');
  eq('July 2024: limit ₹2,50,000 — the same 1,77,000 bill is b2cs, the note nets it off, nothing in b2cl or cdnur', [old._cb.b2cl_limit, old.b2cl, old.b2cs.map((x) => [x.sply_ty, x.txval, x.iamt]), old.cdnur], [250000, [], [['INTER', 0, 0]], []]);
  const aug = T.gstr1(month([row('INV-0001', INTER, 18, 150000, 'output', '2024-08-03')]), ME, '082024');
  eq('August 2024: the first period on ₹1,00,000 — the same bill is b2cl', [aug._cb.b2cl_limit, aug.b2cl.length, aug.b2cs.length], [100000, 1, 0]);

  /* ── 3 · a registered buyer is b2b whatever the value; an export / SEZ supply is said, not filed as a plain row ── */
  const b2b = T.gstr1(month([row('INV-0009', { Gstin: '29BBBBB0000B1Z5', Pos: '29' }, 18, 150000, 'output', '2026-10-09')]), ME, '102026');
  eq('a 1,77,000 bill to a REGISTERED buyer is b2b under its GSTIN, not b2cl', [b2b.b2b.map((x) => [x.ctin, x.inv[0].inum, x.inv[0].val, x.inv[0].inv_typ]), b2b.b2cl], [[['29BBBBB0000B1Z5', 'INV-0009', 177000, 'R']], []]);
  const sezRow = row('INV-0010', { Gstin: '29CCCCC0000C1Z5', Pos: '29' }, 18, 1000, 'output', '2026-10-10');
  sezRow.invoice = Object.assign({}, sezRow.invoice, { TranDtls: Object.assign({}, sezRow.invoice.TranDtls, { SupTyp: 'SEZWOP' }) });
  const sez = T.gstr1(month([sezRow]), ME, '102026');
  ok('an SEZ supply (SupTyp SEZWOP) is handed to the engine as zero-rated: in no b2b row, and the warning names it (Table 6 is not built — engines request)', sez.b2b.length === 0 && sez._cb.warnings.some((w) => /zero-rated/.test(w)), JSON.stringify([sez.b2b, sez._cb.warnings]));

  /* ── 4 · refusals in words, never a half file ── */
  eq('no 15-character GSTIN on me → { ok: false, why } (GET /api/tax/gstr answers 422 GSTR_REFUSED; the book pack lists it as pending)', [T.gstr1(led, { Gstin: null }, '102026').ok, typeof T.gstr1(led, { Gstin: '33S' }, '102026').why], [false, 'string']);
  eq('an empty month is an empty file, not a refusal', [T.gstr1(month([]), ME, '102026').ok, T.gstr1(month([]), ME, '102026').b2cs], [undefined, []]);

  /* ── 5 · one builder: tax-lines holds no second GSTR-1 arithmetic, and both readers call it ── */
  const taxLines = fs.readFileSync(path.join(HERE, 'lib', 'tax-lines.js'), 'utf8');
  ok('lib/tax-lines.js has no B2CL limit of its own and no b2cs summing (the engine\'s B2CL_LIMITS is the one home)', !/const B2CL_LIMIT\b/.test(taxLines) && !/b2cs\.set\(/.test(taxLines) && /require\('\.\/gst-returns'\)/.test(taxLines));
  const gstReturns = fs.readFileSync(path.join(HERE, 'lib', 'gst-returns.js'), 'utf8');
  ok('lib/gst-returns.js is the ADOPTED engine copy carrying B2CL_LIMITS with the 2024-08 row', /ADOPTED from chitbridge-engines/.test(gstReturns.split('\n')[0]) && /from: '2024-08', limit: 100000/.test(gstReturns));
  for (const [file, pattern] of [['routes/tax.js', /T\.gstr1\(ledger, meParty, bounds\.period\)/], ['lib/books-pack.js', /T\.gstr1\(led\.ledger, led\.me, led\.bounds\.period\)/]])
    ok(file + ' reads GSTR-1 through tax-lines.gstr1 (the one door to the engine)', pattern.test(fs.readFileSync(path.join(HERE, file), 'utf8')));

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();

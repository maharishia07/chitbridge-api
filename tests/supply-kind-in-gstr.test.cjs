/**
 * tests/supply-kind-in-gstr.test.cjs - INDIA'S SUPPLY KIND ON THE API PATH (AE-F-11, Athi 21 Nov 2026 Q2: ASK THE OWNER): the api's GSTR-3B (lib/tax-lines.gstr3b) and GSTR-1 read the ONE non-GST
 * reader of the engine (gst-returns.zeroWordOf / asksZeroKind), so a line is filed in the same box by both.
 *
 * OWNS      the proof, on the api path, of the design's 3.1(e) 150.00 test and of the unanswered 0% line. No database: the month's rows are handed to gstr3b / gstr1 as tax-copy.ledgerFor builds them.
 * CALLED BY scripts/guards.cjs - CI. Needs the ENGINES' pack IN 1.1.0 (CB_ENGINES_DIR: the vendored copies carry it only after the engines tag is adopted; without it the test SKIPs, said).
 * FLOW      engines tax.determine (frozen invoice) -> ledger rows { side, invoice, day } -> tax-lines.gstr3b / gstr1 -> compared with the hand figures below
 *
 * HAND FIGURES (rupees), one bill to an unregistered buyer in the shop's state: A taxable 1,000.00 at 18% (CGST 90.00 + SGST 90.00), B nil-rated 400.00 (tax_kind nil), C exempt 250.00 (tax_kind exempt),
 * D non-GST 150.00 (tax_kind non_gst), E 0% with no kind 100.00; one export bill 500.00 (SEZ supply type); output taxable of the bill 1,900.00.
 *   Dated 10 Nov 2026 (as first filed):  3.1(a) 1,000.00 | 3.1(c) 750.00 (400 + 250 + E 100) | 3.1(e) 150.00 | unanswered 0.
 *   Dated 10 Jan 2027 (the ask):         3.1(a) 1,000.00 | 3.1(c) 650.00 | 3.1(e) 150.00 | unanswered 100.00; the box taxable values add up to 1,900.00 minus the 100.00 that waits.
 *   The export bill (SEZWOP) is 3.1(b) 500.00 whatever its lines name.
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/supply-kind-in-gstr.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'gst-returns.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const E = { tax: require(path.join(engines, 'tax')), gst: require(path.join(engines, 'gst-returns')), reg: require(path.join(engines, 'regulation')) };
if (!E.gst.zeroWordOf || !E.gst.asksZeroKind) { console.log('skip: the engines checkout has no zeroWordOf (pack IN 1.1.0 not there yet)'); process.exit(0); }
require('./support/engines-checkout.cjs'); /* the api's vendored engine copies are the released ones; the pack IN 1.1.0 is not adopted yet, so the engines this path reads are the checkout's */
const TL = require('../lib/tax-lines');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '33AABCY1234F1Z5';
const seller = { Gstin: SHOP, LglNm: 'Walk Shop', State: '33', Pos: '33', Country: 'IN' };
const walk = { State: '33', Pos: '33', Country: 'IN' };
const frozen = (lines, buyer, extra) => JSON.parse(JSON.stringify(E.tax.determine(Object.assign({ seller, buyer: buyer || walk, lines }, extra || {}))));
const kinded = (word, price) => ({ name: 'L ' + word, qty: 1, unit_price: price, rate: 0, tax_kind: word });
const BILL = frozen([{ name: 'A', qty: 1, unit_price: 1000, rate: 18, hsn: '1905', unit: 'NOS' }, kinded('nil', 400), kinded('exempt', 250), kinded('non_gst', 150), { name: 'E no kind', qty: 1, unit_price: 100, rate: 0 }]);
const EXPORT = frozen([{ name: 'Export', qty: 1, unit_price: 500, rate: 0 }], { LglNm: 'Zone Buyer', Gstin: '33DDDDD0000D1Z5', State: '33', Pos: '33', Country: 'IN', RegType: 'sez' }, { supplyKind: 'SEZWOP' });
const month = (day, invoices) => ({ rows: invoices.map((invoice, n) => ({ side: 'output', invoice, day, at: day + 'T05:00:00.000Z', doc_no: 'INV/' + day.slice(5, 7) + '/' + (n + 1) })), output: { taxable: 1900, igst: 0, cgst: 90, sgst: 90, cess: 0 }, net: 0 });
const me = { Gstin: SHOP, Country: 'IN' };

console.log('\n== INDIA SUPPLY KIND: GSTR-3B AND GSTR-1 ON THE API PATH ==\n');
ok('the export fixture really is an SEZ supply (the api reads TranDtls.SupTyp)', EXPORT.TranDtls.SupTyp === 'SEZWOP', EXPORT.TranDtls.SupTyp);

const old3b = TL.gstr3b(month('2026-11-10', [BILL]), me, '112026');
eq('as first filed: 3.1(a) 1,000.00 with CGST 90.00 + SGST 90.00', old3b.sup_details.osup_det, { txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 });
eq('as first filed: 3.1(c) 750.00 (nil 400 + exempt 250 + the unkinded 100 as nil-rated)', old3b.sup_details.osup_nil_exmp.txval, 750);
eq('as first filed: 3.1(e) 150.00 (the non-GST line, on the one reader)', old3b.sup_details.osup_nongst.txval, 150);
eq('as first filed: nothing waits', old3b._cb.unanswered, 0);

const new3b = TL.gstr3b(month('2027-01-10', [BILL]), me, '012027');
eq('from 1 Jan: 3.1(a) unchanged (the unkinded 0% is no longer in it)', new3b.sup_details.osup_det, { txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 });
eq('from 1 Jan: 3.1(c) 650.00', new3b.sup_details.osup_nil_exmp.txval, 650);
eq('from 1 Jan: 3.1(e) 150.00', new3b.sup_details.osup_nongst.txval, 150);
eq('from 1 Jan: the 100.00 waits for the owner, named in _cb.unanswered', new3b._cb.unanswered, 100);
eq('the boxes and the waiting part add up to the 1,900.00 the books hold', [new3b.sup_details.osup_det.txval, new3b.sup_details.osup_zero.txval, new3b.sup_details.osup_nil_exmp.txval, new3b.sup_details.osup_nongst.txval, new3b._cb.unanswered].reduce((a, b) => a + b, 0), 1900);

const exp3b = TL.gstr3b(Object.assign(month('2027-01-10', [EXPORT]), { output: { taxable: 500, igst: 0, cgst: 0, sgst: 0, cess: 0 } }), me, '012027');
eq('an export / SEZ bill is 3.1(b) 500.00 and asks nothing', [exp3b.sup_details.osup_zero.txval, exp3b.sup_details.osup_nil_exmp.txval, exp3b._cb.unanswered], [500, 0, 0]);

const g1 = TL.gstr1(month('2027-01-10', [BILL]), me, '012027');
eq('GSTR-1 Table 8 (Jan): nil 400.00 - exempt 250.00 - non-GST 150.00, the same words as 3B', g1.nil.inv, [{ sply_ty: 'INTRAB2C', expt_amt: 250, nil_amt: 400, ngsup_amt: 150 }]);
eq('GSTR-1 names the 100.00 that waits', g1._cb.unanswered, 100);
const g1old = TL.gstr1(month('2026-11-10', [BILL]), me, '112026');
eq('GSTR-1 as first filed: nil 500.00, nothing waits', [g1old.nil.inv[0].nil_amt, g1old._cb.unanswered], [500, 0]);

console.log('\n   ' + pass + ' checks' + (fail ? ' - ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);

/**
 * tests/supply-kind-in-note-day.test.cjs - A CREDIT NOTE OF AN EARLIER MONTH'S UNKINDED 0% LINE TAKES BACK THE ROW THE ORIGINAL WAS FILED IN (EGM-T1 M4, 21 Nov 2026; India).
 *
 * OWNS      the proof that the api reads a note by the day of its ORIGINAL bill (tax-lines.againstDayOf: the till's against.billed_at, in the shop's day) on both returns: GSTR-3B 3.1(c) and
 *           GSTR-1 Table 8 (engine against_date). Needs the engines checkout (CB_ENGINES_DIR; SKIP without it). Dates follow the pack's own rule row (ask from 2027-01-01).
 * CALLED BY scripts/guards.cjs - CI. Hand figures (rupees): invoice 2026-12-20, one 0% line with no kind, 100.00 (before the rule: nil-rated). Credit note of it 2027-01-05 (after the rule).
 *           Read by the original's day: 3.1(c) -100.00, unanswered 0, Table 8 nil -100.00. Read by its own day (the defect): 3.1(c) 0, unanswered -100.00, December's nil never reduced.
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/supply-kind-in-note-day.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'gst-returns.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const T = require(path.join(engines, 'tax'));
if (!require(path.join(engines, 'gst-returns')).asksZeroKind) { console.log('skip: the engines checkout has no asksZeroKind'); process.exit(0); }
require('./support/engines-checkout.cjs');
const TL = require('../lib/tax-lines');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '33AABCY1234F1Z5';
const me = { Gstin: SHOP, Country: 'IN' };
const ZERO = JSON.parse(JSON.stringify(T.determine({ seller: { Gstin: SHOP, LglNm: 'Walk Shop', State: '33', Pos: '33', Country: 'IN' }, buyer: { State: '33', Pos: '33', Country: 'IN' }, lines: [{ name: 'E no kind', qty: 1, unit_price: 100, rate: 0 }] })));
const noteRow = (extra) => Object.assign({ side: 'output_cn', invoice: ZERO, day: '2027-01-05', at: '2027-01-05T05:00:00.000Z', doc_no: 'CN/01/1' }, extra || {});
const ledger = (rows) => ({ rows, output: { taxable: -100, igst: 0, cgst: 0, sgst: 0, cess: 0 } });

console.log('\n== INDIA: A NOTE IS READ BY ITS ORIGINAL BILL\'S DAY ==\n');
eq('againstDayOf: a counter credit note names its bill\'s moment; the shop day comes back', TL.againstDayOf({ against: { bill_no: 'INV/1', billed_at: '2026-12-20T09:30:00.000Z' } }, 'credit_note', { Country: 'IN' }), '2026-12-20');
eq('againstDayOf: an invoice, or a note that names no moment, gives null', [TL.againstDayOf({ against: { billed_at: '2026-12-20T09:30:00.000Z' } }, 'order', {}), TL.againstDayOf({ against: { bill_no: 'INV/1' } }, 'credit_note', {}), TL.againstDayOf({}, 'credit_note', {})], [null, null, null]);

const own = TL.gstr3b(ledger([noteRow()]), me, '012027');
eq('the defect (no original day): 3.1(c) 0 and a NEGATIVE unanswered -100.00', [own.sup_details.osup_nil_exmp.txval, own._cb.unanswered], [0, -100]);
const read = TL.gstr3b(ledger([noteRow({ against_day: '2026-12-20' })]), me, '012027');
eq('GSTR-3B: with the original day 3.1(c) is -100.00 and nothing is unanswered', [read.sup_details.osup_nil_exmp.txval, read._cb.unanswered], [-100, 0]);
const t1 = TL.gstr1(ledger([noteRow({ against_day: '2026-12-20' })]), me, '012027');
ok('GSTR-1 reads the same day: no unanswered figure, the note\'s nil is taken back', !t1._cb.unanswered && JSON.stringify(t1).indexOf('"unanswered":-100') < 0, JSON.stringify(t1._cb));
eq('GSTR-1 Table 8: the January note takes the December nil row back: nil -100.00', (t1.nil.inv || []).map((row) => row.nil_amt), [-100]);



console.log('\n   ' + pass + ' checks' + (fail ? ' - ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);

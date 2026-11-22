/**
 * tests/ag-counter-kinds.test.cjs — THE SERVER DOES NOT TRUST THE CLIENT FOR THE TAX KIND (AG-F-01 + AG-F-02, walk AG, UAE; the AU words alike). Batch 1129.
 *
 * OWNS      the proof of lib/counter-kinds (stamp + adopt) through the real chain: the catalogue shelf -> tax-lines.itemOf/resolveItem (the online sale's reader) -> the server's own check compute
 *           (tax-copy.serverCheckOf) -> the invoice's _cb.kinds -> books-hooks byRateOf -> the engines' posting -> the VAT 201 boxes. A till bill with NO _cb.kinds (the 1125 till) posts its zero-rated line
 *           to 4010 and its exempt line to 4030 (VAT 201 Box 4 / Box 5), not to 4000; the client's kind that disagrees with the catalogue is replaced, with a note on the bill; a kind-less credit note
 *           is filled from the catalogue (AG-F-02: the return then debits the kind's ledger 4010, not 4090); a credit note that carries a kind is left as sent (fill-only).
 * CALLED BY scripts/guards.cjs · CI. No database, no browser. Run: CB_ENGINES_DIR=../chitbridge-engines node tests/ag-counter-kinds.test.cjs
 * HAND FIGURES (AED, walk AG bill C1/0001, prices include 5% VAT): Karak 2 x 10.50 = 21.00 + Dates 33.33 -> standard 54.33, VAT 2.59 (5433 x 5/105 = 258.7), taxable 51.74; Rice 30.00 + Gold 100.00 zero-rated = 130.00;
 * Bus 7.00 exempt. Box 1 taxable 5174 fils, Box 4 13000, Box 5 700; total 191.33. Return of Rice 30.00: Dr 4010 3000, Box 4 falls to 10000.
 */
'use strict';
const path = require('path'), fs = require('fs');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const COUNTRY = require('../lib/country'), ENGINE_COUNTRY = require(path.join(engines, 'country'));
COUNTRY.packFor = ENGINE_COUNTRY.packFor;
const TL = require('../lib/tax-lines'), H = require('../lib/books-hooks'), CK = require('../lib/counter-kinds'), TC = require('../lib/tax-copy');
const R = require(path.join(engines, 'regulation')), { makePost } = require(path.join(engines, '..', 'tests', 'helpers', 'books.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const shelf = { items: [
  { item_id: 'k', item_data: { name: 'Karak tea', gst_rate: 5 } }, { item_id: 'd', item_data: { name: 'Dates box', gst_rate: 5 } },
  { item_id: 'r', item_data: { name: 'Rice 5kg', gst_rate: 0, tax_kind: 'zero_rated' } }, { item_id: 'b', item_data: { name: 'Bus ticket', gst_rate: 0, tax_kind: 'exempt' } },
  { item_id: 'g', item_data: { name: 'Gold bar', gst_rate: 0, tax_kind: 'zero_rated' } }, { item_id: 'u', item_data: { name: 'Unanswered', gst_rate: 0 } } ], slabs: [], categories: [], face: {} };
const line = (id, name, price, qty, extra) => Object.assign({ item_id: id, particulars: name, quantity: qty || 1, price, gst_rate: id === 'k' || id === 'd' ? 5 : 0 }, extra);
const seller = { country: 'AE', reg: 'regular', tax_id: '100000000000003' };
const asked = (lines) => ({ lines, seller, buyer: { country: 'AE' }, currency: 'AED', at: '2026-11-20', priceIncludesTax: true });
const sentLines = [line('k', 'Karak tea', 10.5, 2), line('d', 'Dates box', 33.33), line('r', 'Rice 5kg', 30), line('b', 'Bus ticket', 7), line('g', 'Gold bar', 100)]; /* the 1125 till: no tax_kind on a line */
/** what the till issued: the engine over the lines, with the kinds taken out (no `_cb.kinds`) */
const issued = (lines) => { const inv = JSON.parse(JSON.stringify(TL.invoiceFor(asked(lines)).invoice)); delete inv._cb.kinds; return inv; };
const rolesOf = (rows, type, extra) => { const p = makePost('E', 0, { pack: R.packFor('AE') }); return p(Object.assign({ type, ref: 'T', date: '2026-11-20', by_rate: rows }, extra)).map((l) => (l.code || l.account) + ':' + (l.cr_minor || 0) + '/' + (l.dr_minor || 0)); };

console.log('\n== AG-F-01: a bill with no _cb.kinds takes its kinds from the catalogue ==\n');
const bill = issued(sentLines);
eq('the till bill as sent names no kind: every 0% line is one plain row (the bug: all of it on 4000)', H.byRateOf(bill, 'AED').rows.map((r) => 'kind' in r), [false, false]);
const st = CK.stamp(sentLines, shelf);
eq('stamp: Rice and Gold are zero_rated, Bus exempt (from the catalogue); Karak and Dates untouched', st.lines.map((l) => l.tax_kind || null), [null, null, 'zero_rated', 'exempt', 'zero_rated']);
eq('stamp says what it changed: lines 2, 3, 4, from none', st.changes, [{ line: 2, from: '', to: 'zero_rated' }, { line: 3, from: '', to: 'exempt' }, { line: 4, from: '', to: 'zero_rated' }]);
const check = TC.serverCheckOf(bill, asked(st.lines));
eq('the server check names no difference in the figures (kinds are a tag, never a figure)', check.differences, []);
const said = CK.adopt(bill, check.server_kinds, st.changes);
eq('three notes on the bill, one per line, in words', said.length, 3);
ok('a note says the till sent none and the catalogue kind is taken', /^Line 3: the till sent no tax kind; "zero_rated" is taken from the catalogue\.$/.test(said[0]), said[0]);
ok('the notes are on the invoice (the warning on the bill)', said.every((n) => bill._cb.notes.indexOf(n) >= 0));
const rows = H.byRateOf(bill, 'AED').rows;
eq('the books read three rows: 5% standard taxable 51.74, zero_rated 130.00, exempt 7.00', rows.map((r) => [r.rate, r.kind || null, r.taxable]), [[5, null, 51.74], [0, 'zero_rated', 130], [0, 'exempt', 7]]);
const cash = rolesOf(rows, 'walkin_day', { modes: { cash: 191.33 } });
console.log('   posted', JSON.stringify(cash));
ok('posts 4010 Cr 13000 and 4030 Cr 700, and nothing of the 0% lines to 4000 (4000 Cr 5174 only)', cash.indexOf('4010:13000/0') >= 0 && cash.indexOf('4030:700/0') >= 0 && cash.indexOf('4000:5174/0') >= 0, JSON.stringify(cash));
const VAT = require(path.join(engines, 'reg-ae'));
const box = VAT.returns.vat201({ period: '2026-11' }, [{ role: 'sales', dr_minor: 0, cr_minor: 5174 }, { role: 'output_vat', dr_minor: 0, cr_minor: 259 }, { role: 'sales_zero_rated', dr_minor: 0, cr_minor: 13000 }, { role: 'sales_exempt', dr_minor: 0, cr_minor: 700 }]);
ok('VAT 201: Box 1 5174, Box 4 13000, Box 5 700 (hand)', box.boxes[1].amount_minor === 5174 && box.boxes[4].amount_minor === 13000 && box.boxes[5].amount_minor === 700, JSON.stringify([box.boxes[1], box.boxes[4], box.boxes[5]]));
ok('the same bill again: nothing more to say (idempotent)', CK.adopt(bill, check.server_kinds, st.changes).length === 0);

console.log('\n== the client says one kind and the catalogue another: the catalogue wins, with a warning ==\n');
const wrong = sentLines.map((l) => (l.item_id === 'r' ? Object.assign({}, l, { tax_kind: 'exempt' }) : l));
const stw = CK.stamp(wrong, shelf);
eq('Rice sent as exempt comes back zero_rated', [stw.lines[2].tax_kind, stw.changes.find((c) => c.line === 2)], ['zero_rated', { line: 2, from: 'exempt', to: 'zero_rated' }]);
const billW = issued(sentLines); billW._cb.kinds = [{ line: 2, kind: 'exempt', rate: 0 }];
const notesW = CK.adopt(billW, TC.serverCheckOf(billW, asked(stw.lines)).server_kinds, stw.changes);
ok('the note names both kinds', notesW.some((n) => /^Line 3: the till sent "exempt", the catalogue says "zero_rated"; the catalogue's kind is used\.$/.test(n)), JSON.stringify(notesW));
eq('the invoice now names zero_rated on line 3', billW._cb.kinds.filter((k) => k.line === 2).map((k) => k.kind), ['zero_rated']);
const rated = CK.stamp([line('k', 'Karak tea', 10.5, 2, { tax_kind: 'zero_rated' })], shelf);
eq('a product the catalogue rates at 5% loses a 0% kind the till sent', [rated.lines[0].tax_kind, rated.changes], [undefined, [{ line: 0, from: 'zero_rated', to: '' }]]);
const silent = CK.stamp([line('u', 'Unanswered', 5, 1, { tax_kind: 'exempt' }), { particulars: 'Not in catalogue', quantity: 1, price: 4, gst_rate: 0, tax_kind: 'zero_rated' }], shelf);
eq('a 0% product nobody answered, and one not in the catalogue, keep what the till sent (the catalogue is silent)', [silent.lines.map((l) => l.tax_kind), silent.changes], [['exempt', 'zero_rated'], []]);

console.log('\n== AG-F-02: a return of a zero-rated line debits 4010 (the kind ledger), never 4090 ==\n');
const creditLine = [line('r', 'Rice 5kg', 30)];
const noKind = TL.invoiceFor(Object.assign(asked(creditLine), { purpose: 'credit_note' })).invoice;
eq('a credit note whose line carries no kind posts to sales returns 4090 (what the walk saw)', rolesOf(H.byRateOf(noKind, 'AED').rows, 'return', { refund: { cash: 30 } }).filter((x) => /^4/.test(x)), ['4090:0/3000']);
const stn = CK.stamp(creditLine, shelf, { note: true });
const note = TL.invoiceFor(Object.assign(asked(stn.lines), { purpose: 'credit_note' })).invoice;
eq('the note is filled from the catalogue, and the return debits 4010 3000 (Box 4 falls by 30.00)', rolesOf(H.byRateOf(note, 'AED').rows, 'return', { refund: { cash: 30 } }).filter((x) => /^4/.test(x)), ['4010:0/3000']);
const kept = CK.stamp([line('r', 'Rice 5kg', 30, 1, { tax_kind: 'exempt' })], shelf, { note: true });
eq('a credit note that carries a kind keeps it (the original bill, from the till)', [kept.lines[0].tax_kind, kept.changes], ['exempt', []]);
const boxR = VAT.returns.vat201({ period: '2026-11' }, [{ role: 'sales', dr_minor: 0, cr_minor: 5174 }, { role: 'sales_zero_rated', dr_minor: 0, cr_minor: 13000 }, { role: 'sales_zero_rated', dr_minor: 3000, cr_minor: 0 }]);
ok('VAT 201 Box 4 after the return: 10000 (13000 less 3000)', boxR.boxes[4].amount_minor === 10000, JSON.stringify(boxR.boxes[4]));

console.log('\n== fails closed: when the catalogue or the check is unavailable the server refuses to guess, and nothing throws ==\n');
const bare = issued(sentLines), before = JSON.stringify(bare);
eq('the server check unavailable (no kinds list): adopt touches nothing and says nothing', [CK.adopt(bare, undefined, st.changes), JSON.stringify(bare) === before], [[], true]);
eq('no shelf (the catalogue could not be read): stamp returns the lines as sent, no change, no throw', (() => { const r = CK.stamp(sentLines, null); return [r.changes.length, r.lines.every((l, i) => l === sentLines[i])]; })(), [0, true]);
eq('an invoice with no _cb stays without one when there is nothing to say', (() => { const inv = { ItemList: [] }; CK.adopt(inv, [], []); return '_cb' in inv; })(), false);

console.log('\n== AU: the same rule with the AU words ==\n');
const auShelf = { items: [{ item_id: 'f', item_data: { name: 'Fresh bread', gst_rate: 0, tax_kind: 'gst_free' } }, { item_id: 'i', item_data: { name: 'Rent', gst_rate: 0, tax_kind: 'input_taxed' } }], slabs: [], categories: [], face: {} };
const au = CK.stamp([{ item_id: 'f', particulars: 'Fresh bread', quantity: 1, price: 4, gst_rate: 0 }, { item_id: 'i', particulars: 'Rent', quantity: 1, price: 9, gst_rate: 0 }], auShelf);
eq('GST-free and input-taxed come from the catalogue', au.lines.map((l) => l.tax_kind), ['gst_free', 'input_taxed']);
console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));

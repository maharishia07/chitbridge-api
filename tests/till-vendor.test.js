/**
 * till-vendor.test.js — ONE COUNTER SCREEN, AND THE ARITHMETIC IT DOES (2026-09-07).
 *
 * The page is served by two hosts — the little program on a shop PC, and the web for a phone or tablet — so the first thing to hold is
 * that there is ONE of it. The second is the money: a counter's total, its offer and the split out of a tax-inclusive shelf price are
 * computed in the page, and a mistake there is money, not pixels. The page's own functions are lifted out and exercised here rather
 * than trusted to a screenshot.
 *
 * Run: node tests/till-vendor.test.js   · no DB, no browser, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');

const API = path.join(__dirname, '..');
const PAGE = path.join(API, 'tools', 'tally-connector', 'till.html');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— the counter —');

it('every copy of the screen is current (the master is the kit\'s till.html)', () => {
  try { execFileSync(process.execPath, [path.join(API, 'scripts', 'vendor-till.cjs'), '--check'], { encoding: 'utf8' }); }
  catch (e) { throw new Error((e.stdout || '').trim() || 'scripts/vendor-till.cjs --check failed'); }
});

it('the page never talks to the internet except through the two hosts', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  /* every fetch is either a local path (the program) or CloudHost.api + a path — a hard-coded third address would be a leak */
  const bad = (html.match(/fetch\(\s*['"]https?:\/\/[^'"]+/g) || []);
  assert.deepStrictEqual(bad, [], 'a hard-coded address in a fetch: ' + bad.join(', '));
});

it('it declares what it will not do — the boundary is written where the next person edits', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  for (const word of ['never blocks a sale', 'never sends a bill twice', 'never invents money'])
    assert.ok(html.indexOf(word) >= 0, 'the page no longer says it ' + word);
});

/* ── the money, lifted out of the page and run ─────────────────────────────────────────────────────────────── */
function load() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const js = html.slice(html.indexOf('/* ═══ 0 · state'), html.lastIndexOf('applyLook();'));
  const sandbox = {
    window: {}, document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: () => {} }, navigator: { onLine: false }, location: { origin: 'http://x', hash: '', protocol: 'http:' },
    indexedDB: { open: () => ({}) }, fetch: () => Promise.reject(new Error('no network in a test')), setInterval: () => {}, addEventListener: () => {},
    console,
  };
  sandbox.window = sandbox; vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  return sandbox;
}
const P = load();

it('a bill with no offer and no tax adds up to what the customer pays', () => {
  P.CART = [{ price: 200, qty: 2, gross: 400, net: 400, save: 0 }, { price: 30, qty: 3, gross: 90, net: 90, save: 0 }];
  P.S = { shop: { reg_type: 'unregistered' } };
  const m = P.billMoney();
  assert.strictEqual(m.net, 490); assert.strictEqual(m.tax, 0); assert.strictEqual(m.save, 0);
});

it('an offer comes off the total and is shown as a saving, never as a lower price', () => {
  P.CART = [{ price: 30, qty: 3, gross: 90, net: 81, save: 9 }];
  P.S = { shop: { reg_type: 'unregistered' } };
  const m = P.billMoney();
  assert.strictEqual(m.gross, 90); assert.strictEqual(m.save, 9); assert.strictEqual(m.net, 81);
});

it('a registered shop splits the tax OUT of the shelf price — the customer pays what the shelf said', () => {
  P.CART = [{ price: 118, qty: 1, gross: 118, net: 118, save: 0, gst_rate: 18 }];
  P.S = { shop: { reg_type: 'regular' } };
  const m = P.billMoney();
  assert.strictEqual(m.net, 118, 'the total is the shelf price');
  assert.strictEqual(m.base, 100); assert.strictEqual(m.tax, 18);
});

it('mixed rates and a zero-rated line, to the paisa', () => {
  P.CART = [
    { price: 250, qty: 1, gross: 250, net: 250, save: 0, gst_rate: 5 },
    { price: 200, qty: 2, gross: 400, net: 400, save: 0, gst_rate: 0 },
    { price: 30, qty: 3, gross: 90, net: 81, save: 9, gst_rate: 18 },
  ];
  P.S = { shop: { reg_type: 'regular' } };
  const m = P.billMoney();
  assert.strictEqual(m.net, 731);
  assert.strictEqual(Math.round((m.base + m.tax) * 100) / 100, 731, 'taxable plus tax is the total, always');
  assert.ok(m.byRate['5'] && m.byRate['18'], 'each rate is reported on its own, as a slip must show it');
});

it('the financial year in a bill number starts in April, as India\'s does', () => {
  assert.strictEqual(P.fyOf(new Date('2026-03-31T00:00:00Z')), '25-26');
  assert.strictEqual(P.fyOf(new Date('2026-04-01T00:00:00Z')), '26-27');
});

it('the chit a bill becomes carries the bill number as client_ref, so a replay cannot bill twice', () => {
  const chit = P.chitOf({ no: 'C1/26-27/0007', at: '2026-09-07T10:00:00Z', till: 'C1', total: 100, payments: [{ how: 'Cash', amount: 100 }],
    customer: { name: 'Walk-in' }, lines: [{ name: 'Oil', qty: 1, unit: 'litre', price: 100, net: 100 }] });
  assert.strictEqual(chit.client_ref, 'C1/26-27/0007');
  assert.strictEqual(chit.business_json.bill_no, 'C1/26-27/0007');
  assert.strictEqual(chit.recipients[0].self, true, 'a counter sale is the shop\'s own record');
  assert.strictEqual(chit.line_items[0].total, 100);
});

it('a discounted line travels with its offer, so the server does not apply one again', () => {
  const chit = P.chitOf({ no: 'C1/26-27/0008', at: '2026-09-07T10:00:00Z', lines: [{ name: 'Soap', qty: 3, unit: 'piece', price: 30, net: 81, off: true, save: 9, off_label: 'Diwali' }] });
  /* the object comes from the page's own context, so compare the values rather than the prototype */
  assert.strictEqual(chit.line_items[0].offer.off, 9);
  assert.strictEqual(chit.line_items[0].offer.label, 'Diwali');
});

/* ── the quantity typed in front of the name (2026-09-08) ───────────────────────────────────────────────────── */
function typing(text) { P.document.getElementById = () => ({ value: text }); return P.typed(); }

it('"3*rice" is three of what you choose, and the search is for "rice"', () => {
  const t = typing('3*rice');
  assert.strictEqual(t.qty, 3); assert.strictEqual(t.text, 'rice');
});

it('a weight off the scale reaches the bill: "0.75 x tomato"', () => {
  const t = typing('0.75 x tomato');
  assert.strictEqual(t.qty, 0.75); assert.strictEqual(t.text, 'tomato');
});

it('⚠️ a product called "2x4 nail" is still searched for, not read as two of a "4 nail"', () => {
  const t = typing('2x4 nail');
  assert.strictEqual(t.qty, 1); assert.strictEqual(t.text, '2x4 nail');
});

it('an ordinary word is an ordinary search', () => {
  const t = typing('  rice  ');
  assert.strictEqual(t.qty, 1); assert.strictEqual(t.text, 'rice');
});

/* ── the day-close sheet ────────────────────────────────────────────────────────────────────────────────────── */
const DAY = [
  { no: 'C1/26-27/0001', at: '2026-09-08T04:00:00Z', kind: 'tax', total: 236, taxable: 200, tax: 36, saved: 0,
    payments: [{ how: 'Cash', amount: 236 }], by: { id: 'a1', name: 'Kavitha' },
    lines: [{ name: 'Oil 1 L', qty: 2, unit: 'litre', price: 118, net: 236, gst_rate: 18 }] },
  { no: 'C1/26-27/0002', at: '2026-09-08T05:00:00Z', kind: 'tax', total: 105, taxable: 100, tax: 5, saved: 9,
    payments: [{ how: 'UPI', amount: 105 }], by: { id: 'a2', name: 'Murugan' },
    lines: [{ name: 'Rice 5 kg', qty: 1, unit: 'bag', price: 105, net: 105, gst_rate: 5 }] },
];

it('a day close says from which bill to which, and what was taken', () => {
  P.WHO = { id: 'a1', name: 'Kavitha', float: 500 };
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.bills, 2);
  assert.strictEqual(d.first, 'C1/26-27/0001');
  assert.strictEqual(d.last, 'C1/26-27/0002');
  assert.strictEqual(d.total, 341);
  assert.strictEqual(d.saved, 9);
  assert.strictEqual(d.gross, 350, 'what the shelf said, before what the shop gave away');
});

it('the tax is split BY RATE — the figure a return has to be reconciled against', () => {
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.rate[18].base, 200); assert.strictEqual(d.rate[18].tax, 36);
  assert.strictEqual(d.rate[5].base, 100); assert.strictEqual(d.rate[5].tax, 5);
  assert.strictEqual(d.tax, 41);
});

it('⭐ only cash is expected in the drawer, and the float is part of it', () => {
  P.WHO = { id: 'a1', name: 'Kavitha', float: 500 };
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.modes.Cash, 236);
  assert.strictEqual(d.modes.UPI, 105);
  assert.strictEqual(d.expected_cash, 736, 'UPI is not in the drawer');
});

it('who billed is on the sheet, per person', () => {
  const d = P.dayCloseSheet(DAY);
  assert.strictEqual(d.people.Kavitha.bills, 1);
  assert.strictEqual(d.people.Murugan.total, 105);
});

it('a day with nothing on it still closes, and says nothing was taken', () => {
  P.WHO = null;
  const d = P.dayCloseSheet([]);
  assert.strictEqual(d.bills, 0); assert.strictEqual(d.total, 0); assert.strictEqual(d.expected_cash, 0);
  assert.ok(P.dayCloseHTML(d).indexOf('nothing taken') > 0, 'an empty day must say so on the paper');
});

/* ── RECEIVE: landed cost, and the difference that must be named (2026-09-08) ────────────────────────────────── */

it('⭐⭐ freight is spread by value, and the parts add back to the whole', () => {
  const share = P.apportion([40000, 8000, 2000], 2000);
  assert.deepStrictEqual(share, [1600, 320, 80]);
  assert.strictEqual(share.reduce((a, b) => a + b, 0), 2000);
});

it('⚠️ a division that does not come out evenly still sums to the paisa — the remainder goes to the largest line', () => {
  const share = P.apportion([100, 100, 100], 100);
  const sum = Math.round(share.reduce((a, b) => a + b, 0) * 100) / 100;
  assert.strictEqual(sum, 100, 'three thirds of ₹100 lost ' + (100 - sum));
});

it('no freight is no apportionment, and a receipt of free samples does not divide by zero', () => {
  assert.deepStrictEqual(P.apportion([100, 50], 0), [0, 0]);
  assert.deepStrictEqual(P.apportion([0, 0], 500), [0, 0]);
});

it('the landed cost of a line is its own value plus its share, per unit', () => {
  P.RCV = { task: null, vendor: '', bill_no: '', bill_date: '', bill_total: null,
            costs: { freight: 2000, loading: 0, duty: 0, other: 0 },
            lines: [{ name: 'Rice', unit: 'bag', counted: 40, rate: 1000, ordered: 40, reason: '' },
                    { name: 'Oil', unit: 'btl', counted: 100, rate: 80, ordered: 100, reason: '' }] };
  const landed = P.rcvLanded();
  assert.strictEqual(P.rcvGoods(), 48000);
  assert.strictEqual(landed[0].share + landed[1].share, 2000);
  assert.strictEqual(landed[0].cost, 41666.67);
  assert.strictEqual(Math.round(landed[0].unit_cost * 100) / 100, 1041.67, 'a bag of rice cost more than its invoice line');
});

it('⭐ what we counted is never the supplier\'s figure — short and excess are both kept, and named', () => {
  P.RCV = { costs: { freight: 0, loading: 0, duty: 0, other: 0 },
            lines: [{ name: 'Rice', ordered: 40, counted: 38, rate: 1000, unit: 'bag', reason: 'damaged' },
                    { name: 'Oil', ordered: 100, counted: 104, rate: 80, unit: 'btl', reason: 'extra sent' }] };
  assert.strictEqual(P.rcvDiff(P.RCV.lines[0]), -2, 'short by two');
  assert.strictEqual(P.rcvDiff(P.RCV.lines[1]), 4, 'four more than ordered, and accepted');
  assert.strictEqual(P.rcvGoods(), 46320, 'the value follows what was COUNTED, not what was ordered');
});

it('a receipt with no order at all is still a receipt', () => {
  P.RCV = { costs: { freight: 0, loading: 0, duty: 0, other: 0 },
            lines: [{ name: 'Toor dal', ordered: null, counted: 25, rate: 126, unit: 'kg', reason: '' }] };
  assert.strictEqual(P.rcvDiff(P.RCV.lines[0]), 0, 'nothing was ordered, so nothing differs');
  assert.strictEqual(P.rcvGoods(), 3150);
});

/* ── the two documents, as chits ─────────────────────────────────────────────────────────────────────────────── */

it('a receipt becomes OUR OWN chit, numbered in its own series, with the vendor inside', () => {
  const chit = P.chitOfDoc({ kind: 'receipt', no: 'GRN/C1/26-27/0007', at: '2026-09-08T05:00:00Z', till: 'C1',
    vendor: { name: 'Anand Traders' }, their_bill: { no: '4471', date: '2026-09-08', total: 46000 },
    against: null, costs: { freight: 2000 }, goods: 46320, extras: 2000, landed_total: 48320,
    lines: [{ name: 'Rice', unit: 'bag', ordered: 40, counted: 38, difference: -2, reason: 'damaged', rate: 1000, value: 38000, landed: 39640, unit_cost: 1043.16, item_id: 'i1', line_id: 'L1' }] });
  assert.strictEqual(chit.purpose, 'receipt');
  assert.strictEqual(chit.recipients[0].self, true, 'a till key may address nobody but itself');
  assert.strictEqual(chit.client_ref, 'GRN/C1/26-27/0007', 'a replay must not record the lorry twice');
  assert.strictEqual(chit.business_json.party.name, 'Anand Traders');
  assert.strictEqual(chit.business_json.their_bill.no, '4471');
  assert.strictEqual(chit.business_json.differences[0].by, -2);
  assert.strictEqual(chit.line_items[0].quantity, 38, 'the chit carries what was counted');
  assert.strictEqual(chit.line_items[0].item_data.lot, null, '⚠️ the lot seam travels from day one, empty');
});

it('a despatch note carries the carton and the shortfall, and no price', () => {
  const chit = P.chitOfDoc({ kind: 'despatch', no: 'DC/C1/26-27/0004', at: '2026-09-08T06:00:00Z', till: 'C1',
    against: { chit_id: 'c-1', party: 'Chola Auto Care' }, ref: 'TN01 AB 1234', cartons: 2, weight: 14.2,
    lines: [{ name: 'Brake pad set', unit: 'set', ordered: 12, picked: 12, short: 0, reason: null, carton: 1, line_id: 'L1', item_id: 'i9' },
            { name: 'Clutch plate', unit: 'piece', ordered: 4, picked: 2, short: 2, reason: 'no stock', carton: 2, line_id: 'L2', item_id: 'i8' }] });
  assert.strictEqual(chit.purpose, 'delivery_note');
  assert.strictEqual(chit.business_json.party.name, 'Chola Auto Care');
  assert.strictEqual(chit.business_json.cartons, 2);
  assert.strictEqual(chit.business_json.differences[0].by, -2, 'the shortfall is on the document, the same day');
  assert.strictEqual(chit.line_items[1].price, null, 'a packing slip is not a bill');
  assert.strictEqual(chit.line_items[1].item_data.carton, 2);
});

it('⭐ what MOVED goes onto the order, in both copies — and only when there was an order', () => {
  const doc = { kind: 'receipt', no: 'GRN/C1/26-27/0007', against: { chit_id: 'c-7' },
    lines: [{ line_id: 'L1', counted: 38, unit: 'bag', reason: 'damaged' }, { line_id: 'L2', counted: 0, unit: 'btl' }] };
  const moves = P.movesOfDoc(doc);
  assert.strictEqual(moves.chit_id, 'c-7');
  assert.strictEqual(moves.rows.length, 1, 'a line where nothing arrived is not a movement');
  assert.strictEqual(moves.rows[0].quantity, 38);
  assert.strictEqual(moves.rows[0].reference, 'GRN/C1/26-27/0007');
  assert.strictEqual(P.movesOfDoc(Object.assign({}, doc, { against: null })), null, 'no order, nothing to record against');
});

/* ── DESPATCH: the rules that make a scan worth trusting ─────────────────────────────────────────────────────── */

it('⭐⭐ a scan cannot pick more than was ordered', () => {
  P.MODE = 'despatch';
  P.DSP = { task: { chit_id: 'c-1', party: 'Chola' }, ref: '', weight: null, carton: 1,
            lines: [{ line_id: 'L1', item_id: 'i9', name: 'Brake pad set', unit: 'set', ordered: 12, picked: 11, reason: '', carton: 1 }] };
  let said = '';
  P.alert = (m) => { said = m; };
  P.dspScan({ item_id: 'i9', name: 'Brake pad set' }, 5);
  assert.strictEqual(P.DSP.lines[0].picked, 12, 'it filled the line and refused the rest');
  assert.ok(said.indexOf('dispute') > 0, 'it must say why, in words a picker understands: ' + said);
});

it('⚠️ something that is not on the order is refused, not added', () => {
  P.MODE = 'despatch';
  P.DSP = { task: { chit_id: 'c-1' }, carton: 1,
            lines: [{ line_id: 'L1', item_id: 'i9', name: 'Brake pad', unit: 'set', ordered: 12, picked: 0, reason: '', carton: 1 }] };
  let said = '';
  P.alert = (m) => { said = m; };
  P.dspScan({ item_id: 'i-other', name: 'Engine oil' }, 1);
  assert.strictEqual(P.DSP.lines.length, 1, 'it grew a line for something nobody ordered');
  assert.strictEqual(P.DSP.lines[0].picked, 0);
  assert.ok(said.indexOf('not on this order') > 0, said);
});

it('packing with no order chosen asks for one rather than guessing', () => {
  P.MODE = 'despatch';
  P.DSP = { task: null, lines: [], carton: 1 };
  let said = '';
  P.alert = (m) => { said = m; };
  P.dspScan({ item_id: 'i9', name: 'Brake pad' }, 1);
  assert.ok(said.indexOf('order') > 0, said);
});

/* ── the vertical: what a consignment must carry (2026-09-08) ────────────────────────────────────────────────── */

const PHARMA = { vertical: 'pharma', required: ['batch', 'expiry'], optional: ['mrp'],
  fields: { batch: { key: 'batch', label: 'Batch', type: 'text' }, expiry: { key: 'expiry', label: 'Expiry', type: 'date' },
            mrp: { key: 'mrp', label: 'MRP', type: 'money' } },
  why: 'Medicine is sold by batch and must not be sold past its expiry.' };

it('⭐ general trade is asked for nothing at all — no boxes, no rules', () => {
  P.S = { shop: {}, lot_fields: { vertical: null, required: [], optional: [], fields: {} } };
  assert.strictEqual(P.lotAsks().length, 0);
  assert.strictEqual(P.lotBoxes({ name: 'Rice' }, 0), '', 'a kirana grew a form');
  assert.strictEqual(P.lotTrouble({ name: 'Rice', lot: null }).missing.length, 0);
});

it('a pharmacy is asked for a batch and an expiry, and the boxes carry their names', () => {
  P.S = { shop: {}, lot_fields: PHARMA };
  assert.strictEqual(P.lotAsks().join(','), 'batch,expiry,mrp');
  const html = P.lotBoxes({ name: 'Crocin', lot: { batch: 'AC2431' } }, 0);
  assert.ok(html.indexOf('Batch') > 0 && html.indexOf('Expiry') > 0, html.slice(0, 120));
  assert.ok(html.indexOf('AC2431') > 0, 'what was already captured is shown back');
  assert.ok(html.indexOf('class="need"') > 0, 'a required field must look required');
});

it('⚠️ a missing required field is named, and asked for', () => {
  P.S = { shop: {}, lot_fields: PHARMA };
  const t = P.lotTrouble({ name: 'Crocin', lot: { batch: 'AC2431' } });
  assert.strictEqual(t.missing.join(','), 'Expiry');
  assert.strictEqual(t.refuse, undefined);
});

it('⚠️⚠️ expired stock is REFUSED at the door, not warned about', () => {
  P.S = { shop: {}, lot_fields: PHARMA };
  const t = P.lotTrouble({ name: 'Crocin', lot: { batch: 'AC2431', expiry: '2020-01-01' } });
  assert.ok(t.refuse && t.refuse.indexOf('cannot be taken in') > 0, 'it accepted expired medicine: ' + JSON.stringify(t));
});

it('a date still ahead is simply fine', () => {
  P.S = { shop: {}, lot_fields: PHARMA };
  const t = P.lotTrouble({ name: 'Crocin', lot: { batch: 'AC2431', expiry: '2099-01-01' } });
  assert.strictEqual(t.missing.length, 0);
  assert.strictEqual(t.refuse, undefined);
});

it('⭐⭐ the pack answers for itself: a GS1 scan fills the batch and the expiry', () => {
  const GS = String.fromCharCode(29);
  P.window.CBGS1 = require(require('path').join(API, 'lib', 'gs1.js'));
  const lot = P.lotFromScan('10AC2431' + GS + '17280331');
  assert.strictEqual(lot.batch, 'AC2431');
  assert.strictEqual(lot.expiry, '2028-03-31');
  assert.strictEqual(P.lotFromScan('rice'), null, 'an ordinary search must not become a batch');
});

it('a scanned consignment lands on the line it was counted into', () => {
  P.S = { shop: {}, lot_fields: PHARMA, items: [] };
  P.RCV = P.rcvBlank();
  P.rcvAdd({ item_id: 'i1', name: 'Crocin 500', unit: 'strip', price: 30 }, 10, { batch: 'AC2431', expiry: '2028-03-31' });
  assert.strictEqual(P.RCV.lines[0].counted, 10);
  assert.strictEqual(P.RCV.lines[0].lot.batch, 'AC2431');
  /* a second scan of the same product tops it up and keeps what the barcode said */
  P.rcvAdd({ item_id: 'i1', name: 'Crocin 500', unit: 'strip', price: 30 }, 5, { batch: 'AC2431', expiry: '2028-03-31' });
  assert.strictEqual(P.RCV.lines.length, 1);
  assert.strictEqual(P.RCV.lines[0].counted, 15);
});

it('the consignment travels on the chit line, where the batch belongs', () => {
  const chit = P.chitOfDoc({ kind: 'receipt', no: 'GRN/C1/26-27/0009', at: '2026-09-08T05:00:00Z', till: 'C1',
    vendor: { name: 'Apex Pharma' }, their_bill: null, against: null, costs: {}, goods: 300, extras: 0, landed_total: 300,
    lines: [{ name: 'Crocin 500', unit: 'strip', ordered: null, counted: 10, difference: 0, reason: null, rate: 30, value: 300,
              landed: 300, unit_cost: 30, item_id: 'i1', line_id: null, lot: { batch: 'AC2431', expiry: '2028-03-31' } }] });
  assert.strictEqual(chit.line_items[0].item_data.lot.batch, 'AC2431');
  assert.strictEqual(chit.line_items[0].item_data.lot.expiry, '2028-03-31');
});

/* ── a quantity in a unit, out of a spoken phrase (2026-09-08) ───────────────────────────────────────────────── */

it('⭐⭐ "thakkali 500 gm" is half a kilo of tomato, not five hundred of anything', () => {
  const t = typing('thakkali 500 gm');
  assert.strictEqual(t.qty, 500);
  assert.strictEqual(t.unit, 'gm');
  assert.strictEqual(t.text, 'thakkali', 'the quantity has to leave the words we search with');
  const c = P.qtyInUnit(500, 'gm', 'kg');
  assert.strictEqual(c.qty, 0.5);
  assert.strictEqual(c.converted, true);
});

it('the quantity may come first or last, and a half is a half', () => {
  assert.strictEqual(typing('2 kg thakkali').qty, 2);
  assert.strictEqual(typing('2 kg thakkali').text, 'thakkali');
  assert.strictEqual(typing('500g tomato').qty, 500);
  assert.strictEqual(typing('1/2 kg onion').qty, 0.5);
});

it('⚠️⚠️ A PACK SIZE IN A NAME IS NOT A QUANTITY — 500 ml of something sold by the piece is ONE packet', () => {
  const c = P.qtyInUnit(500, 'ml', 'piece');
  assert.strictEqual(c.converted, false, 'millilitres cannot be converted into packets, and guessing would put 500 on a bill');
  assert.strictEqual(P.qtyInUnit(500, 'ml', 'l').qty, 0.5, 'the same words DO convert when the shop sells by the litre');
});

it('a bare number is left alone — it belongs to the name far more often than to the order', () => {
  const t = typing('tomato 2');
  assert.strictEqual(t.qty, 1);
  assert.strictEqual(t.text, 'tomato 2');
});

it('the old shorthand still works beside it', () => {
  assert.strictEqual(typing('3*rice').qty, 3);
  assert.strictEqual(typing('0.75 x tomato').qty, 0.75);
});

/* ── a line that is not going (Athi: "if it is not going to be there, why does it stay?") ─────────────────────── */

it('⭐⭐ a line marked not going leaves the work, keeps its reason, and still reaches the paper', () => {
  P.S = { shop: {}, items: [], policy: {} };
  P.DSP = { task: { chit_id: 'c1', party: 'Chola' }, ref: '', weight: null, carton: 1,
    lines: [{ line_id: 'L1', item_id: 'i1', name: 'Brake pad set', unit: 'set', ordered: 12, picked: 12, reason: '', carton: 1 },
            { line_id: 'L2', item_id: 'i2', name: 'Clutch plate', unit: 'piece', ordered: 4, picked: 2, reason: '', carton: 1 }] };
  P.dspNotGoing(1, 'no stock');
  assert.strictEqual(P.DSP.lines[1].dropped, true);
  assert.strictEqual(P.DSP.lines[1].reason, 'no stock');
  assert.strictEqual(P.DSP.lines[1].picked, 0, '⚠️ anything already picked goes back — sending two of what is "not going" is a lie');
  /* and it is still on the record */
  const doc = P.chitOfDoc({ kind: 'despatch', no: 'DC/C1/26-27/0005', at: '2026-09-08T06:00:00Z', till: 'C1',
    against: { chit_id: 'c1', party: 'Chola' }, cartons: 1,
    lines: [{ name: 'Clutch plate', unit: 'piece', ordered: 4, picked: 0, short: 4, reason: 'no stock', not_going: true, carton: 1, line_id: 'L2' }] });
  assert.strictEqual(doc.business_json.differences[0].by, -4, 'the customer is told what is not coming');
  assert.strictEqual(doc.business_json.differences[0].reason, 'no stock');
});

it('putting it back on is one tap, and clears the reason with it', () => {
  P.dspBackOn(1);
  assert.strictEqual(P.DSP.lines[1].dropped, false);
  assert.strictEqual(P.DSP.lines[1].reason, '');
});

it('⭐ the shelf answers for itself: a product that is not in the snapshot cannot be picked today', () => {
  P.S = { shop: {}, items: [{ item_id: 'i1', name: 'Brake pad set', unit: 'set' }], policy: {} };
  assert.strictEqual(P.dspStock({ item_id: 'i1', name: 'Brake pad set' }).off, false);
  const gone = P.dspStock({ item_id: 'i9', name: 'Windscreen wiper' });
  assert.strictEqual(gone.off, true);
  assert.ok(gone.why.indexOf('shelf') > 0, gone.why);
});

it('⚠️ a count of zero only speaks when somebody keeps counts', () => {
  P.S = { shop: {}, items: [{ item_id: 'i1', name: 'Oil', unit: 'can', avail: { qty: 0 } },
                            { item_id: 'i2', name: 'Filter', unit: 'piece' }], policy: {} };
  assert.strictEqual(P.dspStock({ item_id: 'i1', name: 'Oil' }).off, true, 'a real zero is an answer');
  assert.strictEqual(P.dspStock({ item_id: 'i2', name: 'Filter' }).off, false, 'no count at all says nothing, and must not hide a line');
});

console.log(pass + ' checks');

/**
 * printer.test.js — THE SLIP, AS BYTES (2026-09-08). Athi connected a thermal printer over USB.
 *
 * A receipt is the one thing a shop hands a customer, so the layout is not cosmetic: a total that wraps, a name that is cut off, or
 * a missing cut command is a complaint at the counter. This exercises the ESC/POS the counter will actually send — the wrapping, the
 * two-column money, the cut, and the drawer pulse that must NOT fire on anything but a sale.
 *
 * Run: node tests/printer.test.js   · no printer, no Windows, no network — it reads the bytes.
 */
'use strict';
const assert = require('assert'), path = require('path');
const printer = require(path.join(__dirname, '..', 'tools', 'tally-connector', 'printer.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const text = (buf) => buf.toString('binary');
const has = (buf, bytes) => buf.indexOf(Buffer.from(bytes)) >= 0;
/**
 * ⚠️ MEASURE THE PAPER, NOT THE COMMANDS. An ESC/POS command is escape + printable parameters ("\x1bE\x01" is bold-on), so simply
 * dropping control characters leaves the letter E sitting in the middle of a line and every width check lies. Each command this file
 * emits is removed whole, with its parameters.
 */
const plain = (buf) => buf.toString('binary')
  .replace(/\x1b@/g, '')            // init
  .replace(/\x1b[Ea][\s\S]/g, '')   // bold on/off, alignment
  .replace(/\x1d![\s\S]/g, '')      // character size
  .replace(/\x1bd[\s\S]/g, '')      // feed n lines
  .replace(/\x1dV[\s\S][\s\S]/g, '')            // cut
  .replace(/\x1bp[\s\S][\s\S][\s\S]/g, '');     // drawer pulse

const SHOP = { name: 'Sri Murugan Stores', address: 'Anna Nagar, Madurai', phone: '98400 00000', gstin: '33ABCDE1234F1Z5' };
const BILL = { kind: 'tax', no: 'C1/26-27/0041', at: '2026-09-08T05:00:00Z',
  customer: { name: 'Walk-in' }, by: { name: 'Kavitha' },
  lines: [{ name: 'Ponni rice 25 kg', qty: 2, unit: 'bag', price: 1180, net: 2360, off: false, save: 0 },
          { name: 'Aachi Coriander powder 100 g pouch value pack', qty: 3, unit: 'pkt', price: 38, net: 108, off: true, save: 6 }],
  total: 2468, taxable: 2350.48, tax: 117.52, saved: 6, payments: [{ how: 'Cash', amount: 2500 }], change: 32 };

console.log('— a bill, on 80 mm paper —');

it('every line fits the paper: 42 characters at 80 mm, 32 at 58 mm', () => {
  for (const [mm, w] of [[80, 42], [58, 32]]) {
    const lines = plain(printer.slipBytes(BILL, SHOP, { mm })).split('\n');
    const tooWide = lines.filter((l) => l.length > w);
    assert.deepStrictEqual(tooWide, [], mm + ' mm: ' + tooWide.length + ' line(s) run off the paper, first: ' + tooWide[0]);
    assert.strictEqual(printer.widthOf(mm), w);
  }
});

it('a long product name WRAPS rather than being cut off — a customer reads what they bought', () => {
  const out = text(printer.slipBytes(BILL, SHOP, { mm: 80 }));
  assert.ok(out.indexOf('Aachi Coriander powder 100 g pouch value') > 0, 'the name is missing');
  assert.ok(out.indexOf('pack') > 0, 'the tail of the name was thrown away');
});

it('the money lines are two columns that meet at the edge', () => {
  const line = printer.pair('TOTAL', '2468.00', 42);
  assert.strictEqual(line.length, 42);
  assert.ok(line.startsWith('TOTAL') && line.endsWith('2468.00'));
});

it('the total is bold, and the shop name is double size', () => {
  const b = printer.slipBytes(BILL, SHOP, { mm: 80 });
  assert.ok(has(b, [0x1b, 0x45, 1]), 'nothing is bold on this slip');
  assert.ok(has(b, [0x1d, 0x21, 0x11]), 'the shop name is not double size');
  assert.ok(has(b, [0x1d, 0x21, 0x00]), 'it never goes back to normal size');
});

it('⭐ the paper is fed clear of the head and then CUT — without this a slip has to be torn', () => {
  const b = printer.slipBytes(BILL, SHOP, { mm: 80 });
  assert.ok(has(b, [0x1d, 0x56, 66, 0]), 'no cut command');
  assert.ok(has(b, [0x1b, 0x64]), 'it cuts without feeding first, which cuts through the last line');
});

it('the offer, the tax split and the change are all on the paper', () => {
  const out = text(printer.slipBytes(BILL, SHOP, { mm: 80 }));
  for (const want of ['You saved', 'Taxable', 'GST', 'TOTAL', 'Cash', 'Change', 'offer -6.00'])
    assert.ok(out.indexOf(want) > 0, 'the slip does not say "' + want + '"');
});

it('⚠️ the drawer opens for a SALE and for nothing else', () => {
  const kick = [0x1b, 0x70, 0];
  assert.ok(has(printer.slipBytes(BILL, SHOP, { mm: 80, drawer: true }), kick), 'a cash sale did not open the drawer');
  assert.ok(!has(printer.slipBytes(BILL, SHOP, { mm: 80 }), kick), 'it opened the drawer nobody asked for');
  const grn = { kind: 'receipt', no: 'GRN/C1/26-27/0007', at: '2026-09-08T05:00:00Z', vendor: { name: 'Anand Traders' },
    their_bill: { no: '4471', total: 46000 }, goods: 46320, extras: 2000, landed_total: 48320,
    lines: [{ name: 'Ponni rice 25 kg', counted: 38, unit: 'bag', rate: 1000, value: 38000, difference: -2, reason: 'damaged' }] };
  assert.ok(!has(printer.slipBytes(grn, SHOP, { mm: 80, drawer: true }), kick), 'a goods receipt must never open the cash drawer');
});

console.log('— the other two documents —');

it('a goods receipt prints what was counted, the difference and the landed cost', () => {
  const out = text(printer.slipBytes({ kind: 'receipt', no: 'GRN/C1/26-27/0007', at: '2026-09-08T05:00:00Z',
    vendor: { name: 'Anand Traders' }, their_bill: { no: '4471', total: 46000 },
    goods: 46320, extras: 2000, landed_total: 48320,
    lines: [{ name: 'Ponni rice 25 kg', counted: 38, unit: 'bag', rate: 1000, value: 38000, difference: -2, reason: 'damaged' }] }, SHOP, { mm: 80 }));
  assert.ok(out.indexOf('GOODS RECEIVED') > 0);
  assert.ok(out.indexOf('short 2 · damaged') > 0, 'the difference and its reason are not on the paper');
  assert.ok(out.indexOf('LANDED') > 0 && out.indexOf('48320.00') > 0);
  assert.ok(out.indexOf('Their bill says') > 0 && out.indexOf('46000.00') > 0, 'their figure is shown beside ours, never instead of it');
});

it('a packing slip carries quantities and shortfalls, and no prices', () => {
  const out = text(printer.slipBytes({ kind: 'despatch', no: 'DC/C1/26-27/0004', at: '2026-09-08T06:00:00Z',
    against: { party: 'Chola Auto Care' }, ref: 'TN01 AB 1234', cartons: 2, weight: 14.2,
    lines: [{ name: 'Brake pad set', picked: 12, unit: 'set', short: 0 },
            { name: 'Clutch plate', picked: 2, unit: 'piece', short: 2, reason: 'no stock' }] }, SHOP, { mm: 80 }));
  assert.ok(out.indexOf('PACKING SLIP') > 0);
  assert.ok(out.indexOf('Chola Auto Care') > 0 && out.indexOf('TN01 AB 1234') > 0);
  assert.ok(out.indexOf('short 2 · no stock') > 0, 'the customer is not told what is short');
  assert.ok(out.indexOf('TOTAL') < 0, 'a packing slip is not a bill');
});

it('a test page proves the width without needing a shop', () => {
  const out = text(printer.testPage(null, { mm: 58 }));
  assert.ok(out.indexOf('If you can read this line') > 0);
  assert.ok(out.indexOf('32 characters wide') > 0);
});

it('a shop with no address or GSTIN still prints a clean slip', () => {
  const out = text(printer.slipBytes(BILL, { name: 'Corner Shop' }, { mm: 80 }));
  assert.ok(out.indexOf('Corner Shop') > 0);
  assert.ok(out.indexOf('undefined') < 0 && out.indexOf('null') < 0, 'a missing field leaked onto the paper');
});

console.log(pass + ' checks');

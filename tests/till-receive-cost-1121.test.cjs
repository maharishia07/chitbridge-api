/* Walk C 21 Nov (C-F-09, C-F-10): the Receive door. The cost box never starts at the selling price; a cost is required; a receipt that disagrees with their bill asks first;
   an Australian shop does not see "challan" or the state split. Lifts the page's own functions (follow till-day-1121). Break check: put i.price back in rcvAdd and case 1 fails. */
// CARD      09-counter/receive
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8').replace(/\r\n/g, '\n');
function grabAt(at, label) { assert.ok(at >= 0, label + ' is gone from till.html'); let i = h.indexOf('{', at), d = 0; for (; i < h.length; i++) { if (h[i] === '{') d++; else if (h[i] === '}' && --d === 0) break; } return h.slice(at, i + 1); }
const grab = (n) => { const at = h.indexOf('function ' + n + '('); return (h.slice(at - 6, at) === 'async ' ? 'async ' : '') + grabAt(at, n); };
const lift = (names, ctx) => { vm.createContext(ctx); vm.runInContext(names.map(grab).join('\n'), ctx); return ctx; };
let n = 0; const ok = async (what, fn) => { await fn(); n++; console.log('  ok  ' + what); };
const base = { cbQuiet() {}, r2: (v) => Math.round(v * 100) / 100, Math, Number, String, Object, Array, JSON };

(async () => {
  await ok('C-F-09: a never-bought item (sells at 13) starts with an EMPTY cost, not 13', () => {
    const RCV = { lines: [] };
    const c = lift(['rcvAdd', 'rcvLastCost'], Object.assign({}, base, { RCV, RCV_BAL: {}, lineFor: () => null, rcvLineFor: () => null, rcvDefaultRate: () => 10, paintReceive() {} }));
    c.rcvAdd({ item_id: 'i1', name: 'Flat White', price: 13 }, 10, null);
    assert.strictEqual(RCV.lines[0].rate, null);
  });
  await ok('C-F-09: an item the shop has bought before starts at what the stock book holds', () => {
    const RCV = { lines: [] };
    const c = lift(['rcvAdd', 'rcvLastCost'], Object.assign({}, base, { RCV, RCV_BAL: { i1: { qty: 4, avg_cost: 2.5 } }, lineFor: () => null, rcvLineFor: () => null, rcvDefaultRate: () => 10, paintReceive() {} }));
    c.rcvAdd({ item_id: 'i1', name: 'Flat White', price: 13 }, 10, null);
    assert.strictEqual(RCV.lines[0].rate, 2.5);
  });
  const confirmCtx = (lineRate, check, sureAnswer) => {
    const out = { said: [], asked: [], doc: 0 };
    const RCV = { hidden: false, lines: [{ name: 'Flat White', counted: 10, rate: lineRate }], bill_total: 25, bill_no: 'X' };
    const c = lift(['rcvConfirm', 'rcvLotWords', 'rcvBillRefused'], Object.assign({}, base, { RCV, tillStopped: async () => false, rcvDiff: () => 0, rcvAbsorbed: () => false, lotTrouble: () => ({}),
      say: (m) => { out.said.push(m); }, rcvTax: () => ({ taxable: 130, tax: 13 }), rcvBillCheck: () => check,
      sure: async (m) => { out.asked.push(m); return sureAnswer; }, rcvLanded: () => { out.doc++; throw new Error('stop'); } }));
    return { c, out };
  };
  await ok('C-F-09: no cost typed → the receipt is not kept, and it says what to type', async () => {
    const { c, out } = confirmCtx(null, { code: 'agrees' }, true); await c.rcvConfirm().catch(() => {});
    assert.strictEqual(out.doc, 0); assert.ok(/What did Flat White cost/.test(out.said[0]));
  });
  await ok('C-F-09: their bill A$118 apart → it asks first, and "no" keeps nothing', async () => {
    const { c, out } = confirmCtx(13, { code: 'apart', sentence: 'A$118.00 apart' }, false); await c.rcvConfirm();
    assert.ok(/A\$118\.00 apart/.test(out.asked[0])); assert.strictEqual(out.doc, 0);
  });
  await ok('C-F-09: their bill agrees → no question; "yes" to the question goes on to keep it', async () => {
    let r = confirmCtx(13, { code: 'agrees' }, false); await r.c.rcvConfirm().catch(() => {}); assert.strictEqual(r.out.asked.length, 0); assert.strictEqual(r.out.doc, 1);
    r = confirmCtx(13, { code: 'apart', sentence: 'x' }, true); await r.c.rcvConfirm().catch(() => {}); assert.strictEqual(r.out.doc, 1);
  });
  await ok('C-F-10: "challan" only where the pack splits by state', () => {
    for (const [splits, want] of [[false, 'Their bill no'], [true, 'Their bill / challan no']]) {
      const box = { placeholder: '' };
      const c = lift(['rcvWords'], Object.assign({}, base, { schemeWord: () => 'GST', packSplitsByState: () => splits, document: { getElementById: (id) => (id === 'rcv_billno' ? box : null) } }));
      c.rcvWords(); assert.strictEqual(box.placeholder, want);
    }
  });
  await ok('C-F-10: the "supplier\'s state is not known" line is written only for a state-splitting pack', () => {
    assert.ok(/packSplitsByState\(\) \? ' · <b style="color:var\(--warn\)">not split/.test(h));
  });
  await ok('C-F-11: offline reads "bills are kept here" for a person-signed counter; "no key yet" only with no credential', () => {
    const f = (cred) => lift(['netPillOffline'], Object.assign({}, base, { HOST: { mode: 'cloud' }, CloudHost: { cred: () => cred } })).netPillOffline();
    assert.strictEqual(f('person'), 'offline — bills are kept here'); assert.strictEqual(f('key'), 'offline — bills are kept here'); assert.strictEqual(f(null), 'no key yet');
  });
  console.log(n + ' checks');
})().catch((e) => { console.error(e); process.exit(1); });

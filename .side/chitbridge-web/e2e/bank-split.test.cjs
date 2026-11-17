'use strict';
// @type: unit
/**
 * bank-split.test.cjs - BB-04 (a card settlement net of the acquirer's fee) and BB-10 (one payment across two bills) through the REAL engines, the real preview controller and the real post adapter.
 *
 * OWNS      the proof that a settlement of 2,640.00 against 2,700.00 of card sales waits for the person's word on the tax on its 60.00 fee (never defaulted: RQ1), then is ready with a tick; that
 *           the contra body the adapter sends carries the fee, and the fee tax, as the engine worked them (nothing worked out in the page); and that one payment of 880.00 across bills JB-1 600.00
 *           and JB-2 280.00 reaches POST /payments as ONE body with both allocations (the existing door, no second path).
 * ENGINES   CB_ENGINES_DIR, else public/engine (the adopted copies); skipped, loudly, until the engines tag that carries BB-04/BB-10 is adopted.
 * CALLED BY ci.yml (the unit checks): node e2e/bank-split.test.cjs
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
const path = require('path'), assert = require('assert');
const pub = (rel) => path.join(__dirname, '..', 'public', rel);
const E = process.env.CB_ENGINES_DIR || pub('engine');
if (!require('fs').readFileSync(path.join(E, 'bank-entry.js'), 'utf8').includes('billsOf')) { console.log('SKIP bank-split: the engines in ' + E + ' do not carry BB-04/BB-10 yet (runs once the engines tag with bank-split is adopted)'); process.exit(0); }
const P = require(pub('app/bank-preview.js')), POST = require(pub('app/cap-bank-post.js'));
const engine = { recon: require(path.join(E, 'bank-recon.js')), project: require(path.join(E, 'bank-project.js')), entry: require(path.join(E, 'bank-entry.js')) };
let ran = 0;
const ok = (name) => console.log('ok  ' + name) || ran++;
const csv = (rows) => ['Date,Description,Debit,Credit,Balance'].concat(rows).join('\n');
const make = (suggestOpts) => P.create({ engine, currency: 'AUD', statementCurrency: () => 'AUD', account: 'Demo', ledger: () => ({ lines: [], opening_minor: 500000 }), post: async () => ({ ok: true }), lockedMonth: () => null, parseOpts: { country: 'AU', currency: 'AUD' }, suggestOpts: Object.assign({ country: 'AU', learned: [] }, suggestOpts) });

/* BB-04 */
const sales = [{ amount_minor: 270000, currency: 'AUD', ref: 'cards-12-oct' }];
const ctl = make({ card_sales: sales });
assert.strictEqual(ctl.load(csv(['12/10/2026,EFTPOS SETTLEMENT,,2640.00,7640.00']), 's.csv').ok, true);
let item = ctl.view().items[0];
assert.deepStrictEqual([item.split.gross_minor, item.split.fee_minor], [270000, 6000]);
assert.strictEqual(item.needs, 'fee_tax');
assert.strictEqual(item.ready, false);
ok('BB-04: the split is offered and the line waits on the tax-on-the-fee question (needs fee_tax), not ready');
assert.strictEqual(ctl.feeTax(item.key, 'none').ok, true);
assert.strictEqual(ctl.tick(item.key).ok, true);
item = ctl.view().items[0];
assert.strictEqual(item.ready, true);
assert.deepStrictEqual(item.entry.lines.map((l) => [l.account, l.dr_minor, l.cr_minor]).sort(), [['bank', 264000, 0], ['bank_charges', 6000, 0], ['card', 0, 270000]]);
const body = POST.bodyOf(item, null, null);
assert.strictEqual(body.kind, 'contra');
assert.deepStrictEqual([body.from, body.to, body.amount, body.fee, body.fee_tax_minor], ['card', 'bank', 2640, 60, undefined]);
ok('BB-04A: "no tax" then a tick: ready, Dr Bank 264000 · Dr Fees 6000 · Cr Card 270000; the contra body carries the 60.00 fee and no tax');
assert.strictEqual(ctl.feeTax(item.key, 'tax').ok, true);
ctl.answer('gst_basis', 'accrual');
item = ctl.view().items[0];
assert.strictEqual(item.tax.tax_minor, 545);
const taxed = POST.bodyOf(item, null, null);
assert.deepStrictEqual([taxed.fee, taxed.fee_tax_minor], [54.55, 545]);
ok('BB-04B: "tax on the fee": GST 545, the body carries the fee net 54.55 and fee_tax_minor 545 (the engine\'s own split)');

/* BB-10 */
const bill = (ref, minor) => ({ ref, bill_no: ref, party: 'p-jones', side: 'supplier', open_minor: minor, currency: 'AUD' });
const pay = make({ parties: [{ id: 'p-jones', name: 'Jones Plumbing Supplies', kind: 'supplier' }], open_items: [bill('JB-1', 60000), bill('JB-2', 28000)] });
assert.strictEqual(pay.load(csv(['16/10/2026,JONES PLUMBING INV JB-1 JB-2,880.00,,4120.00']), 'p.csv').ok, true);
const one = pay.view().items[0];
assert.deepStrictEqual(one.against.map((a) => a.amount_minor), [60000, 28000]);
const pb = POST.paymentBodyOf(Object.assign({}, one, { line: { debit_minor: 88000, credit_minor: 0 } }), 'p-jones', null);
assert.deepStrictEqual(pb.allocations, [{ against_ref: 'JB-1', amount_minor: 60000 }, { against_ref: 'JB-2', amount_minor: 28000 }]);
assert.strictEqual(pb.amount_minor, 88000);
assert.strictEqual(pb.allocate, undefined);
ok('BB-10: one payment, two allocations 60000 + 28000 on ONE POST /payments body (the existing door)');

/* access both ways: the owner and an adviser whose grant posts post both kinds through the same doors; an adviser without the grant and the read-only auditor are refused up front */
(async () => {
  const settle = Object.assign({}, item, { ref: 'bank:s1' }), split = Object.assign({}, one, { ref: 'bank:p1', line: { debit_minor: 88000, credit_minor: 0 }, party: { status: 'existing', id: 'p-jones' } });
  for (const [who, allowed] of [[{ role: 'owner' }, true], [{ role: 'adviser', posts: true }, true], [{ role: 'adviser', posts: false }, false], [{ role: 'auditor' }, false]]) {
    const calls = [], post = POST.adapter({ api: async (key, o) => (calls.push([key, o.body]), { entry_no: 'E1', posted: { entry_no: 'E1' } }), who, modeOf: null });
    const a = await post(settle), b = await post(split);
    assert.strictEqual(!!(a.ok && b.ok), allowed, JSON.stringify(who));
    assert.strictEqual(calls.length, allowed ? 2 : 0, 'a refused seat reaches no door: ' + JSON.stringify(who));
    if (allowed) assert.deepStrictEqual(calls.map((c) => c[0]), ['booksEventPost', 'booksPayRecord']);
  }
  ok('access both ways: owner and posting adviser post the split and the allocations; a non-posting adviser and the read-only auditor are refused with no call to either door');
  console.log(ran + ' ok');
})().catch((e) => { console.error(e); process.exit(1); });

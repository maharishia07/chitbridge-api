/**
 * tests/acc192-credit-note.test.cjs — ACC-192 slice 1b: a priced DECREASE on an issued invoice is a credit note over the CHANGED LINES ONLY (lib/credit-note), never total_new − total_old.
 *
 *   P  IN · AU · AE (the real engines through send-money.invoiceOfLines): price down · quantity down · a line removed · an inclusive line — hand-computed figures
 *   H  the half-up rule per line: the note's tax is NOT the difference of the two totals' taxes (one case per pack where the two differ)
 *   B  the books: the original entry is untouched, the note adds its own entry (seller: return · buyer: purchase_return), the trial balance balances
 *
 * Run: node tests/acc192-credit-note.test.cjs   (CB_ENGINES_DIR = an engines worktree)
 */
'use strict';
const assert = require('assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const H = require('./support/books-harness.cjs');

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n          ') : e));
  }
};

/* the two parties of a pack, as send-money reads them (one identities query) */
const PACKS = {
  IN: { rate: 18, seller: { country: 'IN', gstn: '27AAPFU0939F1ZV' }, buyer: { country: 'IN', gstn: '27AABCU9603R1ZX' } },
  AU: { rate: 10, seller: { country: 'AU', gstn: null }, buyer: { country: 'AU', gstn: null } },
  AE: { rate: 5, seller: { country: 'AE', gstn: null }, buyer: { country: 'AE', gstn: null } }
};
let PACK = PACKS.IN;
let INCLUSIVE = false;
const db = require('../db');
db.query = async () => ({
  rows: [
    { identity_id: 's1', gstn: PACK.seller.gstn, display_name: 'Seller', policy_flags: { price_includes_tax: INCLUSIVE ? 'yes' : 'no' }, country: PACK.seller.country },
    { identity_id: 'b1', gstn: PACK.buyer.gstn, display_name: 'Buyer', policy_flags: {}, country: PACK.buyer.country }
  ]
});
require('../lib/country-setup').registrationOfShop = async () => 'regular'; /* ACC-273: these AU / AE sellers carry no number but are registered shops (the owner said so); a seller nobody asked charges no tax (tests/acc-273-send-reads-registration) */
const sendMoney = require('../lib/send-money');
const creditNote = require('../lib/price-note');
const chits = require('../routes/chits');

const line = (name, quantity, price, rate) => ({ particulars: name, quantity, unit: 'pc', price, total: Math.round(quantity * price * 100) / 100, list_price: price, gst_rate: rate });
const copyOf = (lines) => ({ lines, live: lines.map((l) => ({ live: l, original: l })) });
/** the note as the seller prices it: the changed lines, through the ONE calculation, then the header's money */
async function noteOf(lines, edits, cur) {
  const delta = creditNote.deltaLines(copyOf(lines), edits);
  const invoice = await sendMoney.invoiceOfLines({ lines: delta, sellerId: 's1', buyerId: 'b1', business_json: { billed_at: '2026-11-08T00:00:00Z' }, currency_code: cur || 'XXX' });
  return { delta, invoice, money: chits.moneyOfInvoice(invoice, cur || 'XXX') };
}
const edit = (line_index, replacement) => ({ line_index, line: replacement });

(async () => {
  for (const [country, pack] of Object.entries(PACKS)) {
    const rate = pack.rate;
    const taxOn = (net) => Math.round(net * rate) / 100;
    PACK = pack;
    INCLUSIVE = false;
    const base = [line('Pump seal', 10, 100, rate), line('Gasket', 5, 20, rate)];
    console.log('\n== ' + country + ' ==\n');
    await t(country + ' price down: 10 × (100 → 90) is a note of 100 + tax, over that line only', async () => {
      const n = await noteOf(base, [edit(0, Object.assign({}, base[0], { price: 90 }))]);
      assert.deepStrictEqual(n.delta.map((l) => [l.quantity, l.price]), [[10, 10]]);
      assert.strictEqual(n.money.taxable, 100);
      assert.strictEqual(n.money.total, 100 + taxOn(100));
    });
    await t(country + ' quantity down: 10 → 7 is 3 × 100 + tax', async () => {
      const n = await noteOf(base, [edit(0, Object.assign({}, base[0], { quantity: 7 }))]);
      assert.deepStrictEqual(n.delta.map((l) => [l.quantity, l.price]), [[3, 100]]);
      assert.strictEqual(n.money.total, 300 + taxOn(300));
    });
    await t(country + ' a line removed: the whole second line (5 × 20) is the note', async () => {
      const n = await noteOf(base, [edit(1, null)]);
      assert.strictEqual(n.money.total, 100 + taxOn(100));
    });
    await t(country + ' price and quantity both down: two delta lines that sum EXACTLY to old − new (8 × 95 from 10 × 100 = 240)', async () => {
      const n = await noteOf(base, [edit(0, Object.assign({}, base[0], { quantity: 8, price: 95 }))]);
      assert.strictEqual(n.money.taxable, 240);
    });
    await t(country + ' an INCLUSIVE line: the seller’s price holds the tax, so the note’s delta is tax-inclusive too (total = the drop)', async () => {
      INCLUSIVE = true;
      const gross = Math.round(100 * (100 + rate)) / 100;
      const lines = [line('Pump seal', 1, gross, rate)];
      const half = Math.round((gross / 2) * 100) / 100;
      const n = await noteOf(lines, [edit(0, Object.assign({}, lines[0], { price: half }))]);
      assert.strictEqual(n.money.total, Math.round((gross - half) * 100) / 100, 'the note is exactly what the buyer was charged less');
      INCLUSIVE = false;
    });
  }

  console.log('\n== H · half-up per line, not total − total ==\n');
  const HALF_UP = { IN: [0.12, 0.06, 2, 0], AU: [0.11, 0.05, 1, 0], AE: [0.11, 0.02, 0, 1] }; /* [old price, new price, the NOTE's tax in minor units, what total-minus-total would say] */
  for (const [country, [oldPrice, newPrice, noteTax, naive]] of Object.entries(HALF_UP)) {
    await t(country + ': ' + oldPrice + ' → ' + newPrice + ' — the note’s tax is ' + noteTax + ' (its own line, half-up); total − total would have said ' + naive, async () => {
      PACK = PACKS[country];
      const lines = [line('Small part', 1, oldPrice, PACK.rate)];
      const n = await noteOf(lines, [edit(0, Object.assign({}, lines[0], { price: newPrice }))]);
      const before = await sendMoney.invoiceOfLines({ lines, sellerId: 's1', buyerId: 'b1', business_json: {}, currency_code: 'XXX' });
      const after = await sendMoney.invoiceOfLines({ lines: [Object.assign({}, lines[0], { price: newPrice, total: newPrice })], sellerId: 's1', buyerId: 'b1', business_json: {}, currency_code: 'XXX' });
      const taxMinor = (inv) => Math.round((inv.ValDtls.TotInvVal - inv.ValDtls.AssVal) * 100);
      assert.strictEqual(Math.round((n.money.total - n.money.taxable) * 100), noteTax, 'the note’s tax');
      assert.strictEqual(taxMinor(before) - taxMinor(after), naive, 'total − total says something else');
      assert.notStrictEqual(noteTax, naive);
    });
  }

  console.log('\n== N · the number is unique per issuer ==\n');
  await t('N the number, the replay check and the send run inside ONE session advisory lock on a dedicated connection, released after (also when the send throws)', async () => {
    const log = [];
    const real = Object.getOwnPropertyDescriptor(db, 'pool');
    const fake = { connect: async () => ({ query: async (q, a) => log.push(q.split('(')[0] + (a ? ':' + a[0] : '')), release: () => log.push('release') }) };
    Object.defineProperty(db, 'pool', { get: () => fake, configurable: true });
    try {
      await creditNote.underSeriesLock('credit_note', 'ent-1', async () => log.push('work'));
      await assert.rejects(creditNote.underSeriesLock('credit_note', 'ent-1', async () => { throw new Error('send refused'); }), /send refused/);
    } finally {
      Object.defineProperty(db, 'pool', real);
    }
    assert.deepStrictEqual(log, ['SELECT pg_advisory_lock:note-series|credit_note|ent-1', 'work', 'SELECT pg_advisory_unlock:note-series|credit_note|ent-1', 'release', 'SELECT pg_advisory_lock:note-series|credit_note|ent-1', 'SELECT pg_advisory_unlock:note-series|credit_note|ent-1', 'release']);
  });

  console.log('\n== B · the books ==\n');
  const books = H.load();
  const K = require('../lib/books-hooks');
  if (!books.src.dir) {
    console.log('   SKIP the books checks: ' + books.src.why);
  } else {
    await t('the original entry is untouched, the note adds its own return entry, the trial balance balances; the buyer’s verdict is a purchase_return from the same invoice', async () => {
      PACK = PACKS.IN;
      const SHOP = '11111111-1111-4111-8111-111111111111';
      const CUST = '22222222-2222-4222-8222-222222222222';
      const { B, T, db: bdb } = books;
      T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi Stores', customer: true, credit_days: 15 });
      await books.store.saveSetting(bdb, SHOP, { enabled: false });
      await B.enable(bdb, SHOP, { by: SHOP, today: '2026-11-08' });
      const lines = [line('Pump seal', 10, 100, 18)];
      const original = await sendMoney.invoiceOfLines({ lines, sellerId: 's1', buyerId: 'b1', business_json: { billed_at: '2026-11-08T00:00:00Z' }, currency_code: 'INR' });
      const sale = await B.postEntry(bdb, SHOP, { type: 'sale_bill', date: '2026-11-08', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-000000000001', source_ref: 'chit:orig', by_rate: K.byRateOf(original).rows, paid: {}, round_off: 0 });
      assert.ok(sale.ok, JSON.stringify(sale));
      const frozen = JSON.stringify([T.entries.map((e) => e), T.lines.filter((l) => l.entry_id === sale.entry_id)]);
      const note = await noteOf(lines, [edit(0, Object.assign({}, lines[0], { price: 90 }))], 'INR');
      const chit = { chit_id: 'c0000000-0000-4000-8000-0000000000d1', created_at: '2026-11-08T05:00:00Z', purpose: 'credit_note', business_json: { invoice: note.invoice, against: { chit_id: 'c0000000-0000-4000-8000-000000000001', invoice_no: 'INV-7', issuer: 'CBSEL00001' }, printed_as: 'CN/2026/0001', customer: { entity_id: CUST } } };
      const verdict = K.classify({ chit, entry: { sells: true, buyer: { entity_id: CUST }, invoice: note.invoice }, setting: { enabled: true, country: 'IN', functional_currency: 'INR' } });
      assert.deepStrictEqual([verdict.kind, verdict.event.type, verdict.event.party], ['post', 'return', CUST]);
      const posted = await B.postEntry(bdb, SHOP, verdict.event);
      assert.ok(posted.ok && posted.entry_id !== sale.entry_id, JSON.stringify(posted));
      assert.strictEqual(JSON.stringify([T.entries.slice(0, 1).map((e) => e), T.lines.filter((l) => l.entry_id === sale.entry_id)]), JSON.stringify([JSON.parse(frozen)[0].slice(0, 1), JSON.parse(frozen)[1]]), 'the original entry and its lines are as they were');
      const tb = await B.trialBalance(bdb, SHOP, '2026-11-30');
      assert.ok(tb.balanced, JSON.stringify([tb.total_dr_minor, tb.total_cr_minor]));
      const buyer = K.classify({ chit, entry: { sells: false, seller: { entity_id: 's1' }, invoice: note.invoice }, setting: { enabled: true, country: 'IN', functional_currency: 'INR' } });
      assert.deepStrictEqual([buyer.kind, buyer.event.type, buyer.event.party], ['post', 'purchase_return', 's1']);
      assert.deepStrictEqual(buyer.event.by_rate, verdict.event.by_rate, 'both sides post from the same carried invoice');
    });
  }
  console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();

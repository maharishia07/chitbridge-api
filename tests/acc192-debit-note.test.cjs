/**
 * tests/acc192-debit-note.test.cjs — ACC-192 slice 2: a priced RAISE on an issued invoice is a DEBIT NOTE over the CHANGED LINES ONLY (lib/price-note), never total_new − total_old.
 * @type regression
 *
 *   P  hand figures (critic plan §8.3), through the REAL engines (send-money.invoiceOfLines): IN 1000 → 1100 @18% = 118 (9 + 9; inter-state IGST 18) · qty 10 → 12 @100 = 236 ·
 *      inclusive 1180 → 1298 = 100 + 18 · the half-up rounder per line (100.02 → 100.04 inter-state: the note's tax is 0.00, total − total says 0.01 — named, never netted) ·
 *      a line issued at 12% stays at 12% · AU 110 (incl. 1210 → 100 + 10) · AE further tax invoice 100 + 5 = 105
 *   S  the series: DN/<FY label>/<n> from docnumber.periodLabel (IN 26-27; AU, AE no label) — one builder, over every year; the lock is per (purpose, issuer)
 *   B  the books: the seller's debit_note event (Dr party / Cr sales / Cr tax), the original entry untouched, the trial balance balances, the party item is kind debit_note, the buyer posts a purchase_bill from the same JSON
 *   R  the return: tax-lines files the note on side output_dn → GSTR-1 table 9B ntty 'D' (cdnr), table 13 "Debit Note", never table 4
 *
 * Run: node tests/acc192-debit-note.test.cjs   (CB_ENGINES_DIR = an engines worktree at v1.82.0)
 */
'use strict';
const assert = require('assert');

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

const PACKS = {
  IN: { rate: 18, seller: { country: 'IN', gstn: '27AAPFU0939F1ZV' }, buyer: { country: 'IN', gstn: '27AABCU9603R1ZX' } },
  INTER: { rate: 18, seller: { country: 'IN', gstn: '27AAPFU0939F1ZV' }, buyer: { country: 'IN', gstn: '29AABCU9603R1ZX' } },
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
require('../lib/country-setup').registrationOfShop = async () => 'regular';
const sendMoney = require('../lib/send-money');
const priceNote = require('../lib/price-note');
const chits = require('../routes/chits');
const taxLines = require('../lib/tax-lines');

const line = (name, quantity, price, rate) => ({ particulars: name, quantity, unit: 'pc', price, total: Math.round(quantity * price * 100) / 100, list_price: price, gst_rate: rate });
const copyOf = (lines) => ({ lines, live: lines.map((l) => ({ live: l, original: l })) });
const edit = (line_index, replacement) => ({ line_index, line: replacement });
/** the note as the seller prices it: the changed lines, through the ONE calculation, then the header's money (at the original invoice's date, as chit-proposal.priceMoney asks) */
async function noteOf(lines, edits, at, cur) {
  const delta = priceNote.deltaOf(copyOf(lines), edits);
  const invoice = await sendMoney.invoiceOfLines({ lines: delta.lines, sellerId: 's1', buyerId: 'b1', business_json: { billed_at: at || '2025-06-01T00:00:00Z' }, currency_code: cur || 'XXX' });
  return { direction: delta.direction, delta: delta.lines, invoice, money: chits.moneyOfInvoice(invoice, cur || 'XXX') };
}
const minor = (x) => Math.round(x * 100);
const heads = (n) => [n.invoice.ValDtls.CgstVal || 0, n.invoice.ValDtls.SgstVal || 0, n.invoice.ValDtls.IgstVal || 0];

(async () => {
  console.log('\n== P · the hand figures ==\n');
  await t('IN intra: 1 × 1000 @18% issued (1180) → price 1100: the debit note is taxable 100.00, CGST 9.00 + SGST 9.00, total 118.00', async () => {
    PACK = PACKS.IN;
    const n = await noteOf([line('Pump', 1, 1000, 18)], [edit(0, line('Pump', 1, 1100, 18))]);
    assert.strictEqual(n.direction, 'debit');
    assert.deepStrictEqual(n.delta.map((l) => [l.quantity, l.price]), [[1, 100]]);
    assert.deepStrictEqual([n.money.taxable, n.money.total, ...heads(n)], [100, 118, 9, 9, 0]);
  });
  await t('IN inter-state: the same raise is IGST 18.00, total 118.00', async () => {
    PACK = PACKS.INTER;
    const n = await noteOf([line('Pump', 1, 1000, 18)], [edit(0, line('Pump', 1, 1100, 18))]);
    assert.deepStrictEqual([n.money.taxable, n.money.total, ...heads(n)], [100, 118, 0, 0, 18]);
  });
  await t('IN quantity: 10 × 100 @18% issued, quantity → 12: 2 × 100 = 200.00 + CGST 18 + SGST 18 = 236.00', async () => {
    PACK = PACKS.IN;
    const n = await noteOf([line('Pump', 10, 100, 18)], [edit(0, line('Pump', 12, 100, 18))]);
    assert.deepStrictEqual(n.delta.map((l) => [l.quantity, l.price]), [[2, 100]]);
    assert.deepStrictEqual([n.money.taxable, n.money.total, ...heads(n)], [200, 236, 18, 18, 0]);
  });
  await t('IN inclusive: 1180.00 incl. → 1298.00 incl.: the delta 118.00 holds taxable 100.00 + 18.00 inside (9 + 9), at the ISSUED rate', async () => {
    PACK = PACKS.IN;
    INCLUSIVE = true;
    try {
      const n = await noteOf([line('Pump', 1, 1180, 18)], [edit(0, line('Pump', 1, 1298, 18))]);
      assert.deepStrictEqual([n.money.taxable, n.money.total, ...heads(n)], [100, 118, 9, 9, 0]);
    } finally {
      INCLUSIVE = false;
    }
  });
  await t('IN half-up per line, inter-state: 100.02 → 100.04 — the note is 0.02 taxable + 0.00 tax (0.02 × 18% = 0.0036); total − total would say 18.01 − 18.00 = 0.01: named, never netted', async () => {
    PACK = PACKS.INTER;
    const lines = [line('Small part', 1, 100.02, 18)];
    const n = await noteOf(lines, [edit(0, Object.assign({}, lines[0], { price: 100.04 }))]);
    const taxOf = async (price) => (await sendMoney.invoiceOfLines({ lines: [line('Small part', 1, price, 18)], sellerId: 's1', buyerId: 'b1', business_json: {}, currency_code: 'XXX' })).ValDtls.IgstVal;
    assert.deepStrictEqual([n.money.taxable, minor(heads(n)[2])], [0.02, 0]);
    assert.strictEqual(minor((await taxOf(100.04)) - (await taxOf(100.02))), 1, 'total − total says 0.01');
  });
  await t('a line issued at 12% stays at 12%: the raise 1000 → 1100 is taxed 12.00 on the 100 (CGST 6 + SGST 6 = 112.00), the rate the invoice was issued under', async () => {
    PACK = PACKS.IN;
    const n = await noteOf([line('Pump', 1, 1000, 12)], [edit(0, line('Pump', 1, 1100, 12))]);
    assert.deepStrictEqual([n.money.total, ...heads(n)], [112, 6, 6, 0]);
  });
  await t('more pieces AND a higher price sum EXACTLY to new − old: 10 × 100 → 12 × 110 is 320.00 taxable (2 × 110 + 10 × 10), not 2 × 100 + 10 × 10', async () => {
    PACK = PACKS.IN;
    const n = await noteOf([line('Pump', 10, 100, 18)], [edit(0, line('Pump', 12, 110, 18))]);
    assert.strictEqual(n.money.taxable, 12 * 110 - 10 * 100);
  });
  await t('AU: 1000 + 10% issued (1100) → 1100: the increasing adjustment is 100.00 + GST 10.00 = 110.00; inclusive 1100 → 1210 is 100.00 + 10.00 (1/11)', async () => {
    PACK = PACKS.AU;
    const n = await noteOf([line('Pump', 1, 1000, 10)], [edit(0, line('Pump', 1, 1100, 10))]);
    assert.deepStrictEqual([n.money.taxable, n.money.total], [100, 110]);
    INCLUSIVE = true;
    try {
      const inc = await noteOf([line('Pump', 1, 1100, 10)], [edit(0, line('Pump', 1, 1210, 10))]);
      assert.deepStrictEqual([inc.money.taxable, inc.money.total], [100, 110]);
    } finally {
      INCLUSIVE = false;
    }
  });
  await t('AE: 1000 + 5% issued (1050) → 1100: the further tax invoice is 100.00 + VAT 5.00 = 105.00; inclusive 1050 → 1155 is 100.00 + 5.00', async () => {
    PACK = PACKS.AE;
    const n = await noteOf([line('Pump', 1, 1000, 5)], [edit(0, line('Pump', 1, 1100, 5))]);
    assert.deepStrictEqual([n.money.taxable, n.money.total], [100, 105]);
    INCLUSIVE = true;
    try {
      const inc = await noteOf([line('Pump', 1, 1050, 5)], [edit(0, line('Pump', 1, 1155, 5))]);
      assert.deepStrictEqual([inc.money.taxable, inc.money.total], [100, 105]);
    } finally {
      INCLUSIVE = false;
    }
  });
  await t('the document is read from the SELLER’s pack: IN, AU debit_note · AE invoice · no country or no ruling is refused, never defaulted', async () => {
    assert.deepStrictEqual(['IN', 'AU', 'AE'].map((c) => priceNote.documentFor(c)), ['debit_note', 'debit_note', 'invoice']);
    for (const c of [null, undefined, '', 'US', 'XX']) assert.throws(() => priceNote.documentFor(c), (e) => e.code === 'INVOICE_NOTE_NO_RULE', String(c));
    assert.strictEqual(priceNote.purposeOf('credit', null), 'credit_note', 'a lowering needs no raise ruling');
  });
  await t('mixed and nothing-changed deltas are refused in words; a line named that the invoice does not have is a new sale', async () => {
    const lines = [line('A', 1, 100, 18), line('B', 1, 100, 18)];
    assert.throws(() => priceNote.deltaOf(copyOf(lines), [edit(0, line('A', 1, 110, 18)), edit(1, line('B', 1, 90, 18))]), (e) => e.code === 'INVOICE_MIXED_ROUND');
    assert.throws(() => priceNote.deltaOf(copyOf(lines), [edit(0, line('A', 1, 100, 18))]), (e) => e.code === 'INVOICE_INCREASE_REFUSED');
    assert.throws(() => priceNote.refuseAddedLines({ lines }, [{ line_index: 2, price: 5, quantity: 1 }]), (e) => e.code === 'INVOICE_LINE_ADDED');
    assert.doesNotThrow(() => priceNote.refuseAddedLines({ lines }, [{ line_index: 1, price: 5 }]));
  });
  await t('the original invoice’s date is the `at` the note is priced at: DocDtls.Dt, else billed_at, else none', async () => {
    assert.strictEqual(priceNote.issuedAtOf({ invoice: { DocDtls: { Dt: '2025-06-01' } }, billed_at: '2026-01-01' }), '2025-06-01');
    assert.strictEqual(priceNote.issuedAtOf({ billed_at: '2026-01-01' }), '2026-01-01');
    assert.strictEqual(priceNote.issuedAtOf({}), null);
    PACK = PACKS.IN;
    const n = await noteOf([line('Pump', 1, 1000, 18)], [edit(0, line('Pump', 1, 1100, 18))], '2025-06-01T00:00:00Z');
    assert.strictEqual(n.invoice.DocDtls.Dt, '2025-06-01T00:00:00Z');
  });

  console.log('\n== S · the series ==\n');
  await t('numbers: IN DN/26-27/0001 (the FY label, docnumber.periodLabel) · AU, AE DN/0001 · AE further invoice AI/0001; one prefix per document; the sequence is one past the highest over ALL years', async () => {
    const asked = [];
    const real = Object.getOwnPropertyDescriptor(db, 'withEntity');
    const withEntity = async (entity, fn) => fn({ query: async (sql, args) => { asked.push([sql, args]); return { rows: [{ next: 7 }] }; } });
    Object.defineProperty(db, 'withEntity', { value: withEntity, configurable: true, writable: true });
    delete require.cache[require.resolve('../lib/price-note')];
    const fresh = require('../lib/price-note');
    try {
      assert.ok(/^DN\/\d{2}-\d{2}\/0007$/.test(await fresh.nextNumber('s1', 'debit_note', 'IN')));
      assert.strictEqual(await fresh.nextNumber('s1', 'debit_note', 'AU'), 'DN/0007');
      assert.strictEqual(await fresh.nextNumber('s1', 'invoice', 'AE'), 'AI/0007');
      assert.ok(/^CN\/\d{2}-\d{2}\/0007$/.test(await fresh.nextNumber('s1', 'credit_note', 'IN')));
      assert.ok(asked.every(([sql]) => !/extract|year/i.test(sql) && /LIKE \$3/.test(sql)), 'the max is over every year, under the prefix only');
      assert.deepStrictEqual(asked.map(([, args]) => args[2]), ['DN/%', 'DN/%', 'AI/%', 'CN/%']);
      assert.ok(fresh.nextNumber && 'DN/26-27/0001'.length <= 16, 'inside the GSTR-1 16-character limit');
    } finally {
      if (real) Object.defineProperty(db, 'withEntity', real);
    }
  });

  console.log('\n== R · the return ==\n');
  await t('GSTR-1: the debit note is filed on side output_dn in table 9B (cdnr ntty D), counted in table 13 as a Debit Note, never as an invoice in table 4; 3.1(a) takes it up', async () => {
    const ME = { Gstin: '27AAPFU0939F1ZV', State: '27', RegType: 'regular', Country: 'IN' };
    const FAR = { Gstin: '29AABCU9603R1ZX', State: '29', RegType: 'regular', Country: 'IN', Pos: '29' };
    const invoice = taxLines.invoiceFor({ lines: [{ name: 'Pump', quantity: 1, price: 100, gst_rate: 18, hsn: '8413', unit: 'pcs' }], seller: ME, buyer: FAR, chit_id: 'dn-1', at: '2026-11-08' }).invoice;
    const entry = { chit_id: 'dn-1', doc_no: 'DN/26-27/0001', direction: 'sent', sells: true, purpose: 'debit_note', invoice, seller: ME, buyer: FAR, at: '2026-11-08T05:00:00Z' };
    const sale = Object.assign({}, entry, { chit_id: 'inv-1', doc_no: 'INV-1', purpose: 'invoice' });
    const led = taxLines.ledger([entry, sale], ME);
    assert.deepStrictEqual(led.rows.map((r) => r.side), ['output_dn', 'output']);
    assert.deepStrictEqual([led.output.taxable, led.output.igst, led.output.total], [200, 36, 236], 'both add to output tax');
    const g = taxLines.gstr1(led, ME, '112026');
    assert.deepStrictEqual(g.cdnr.map((c) => c.nt.map((n) => [n.ntty, n.nt_num, n.val])), [[['D', 'DN/26-27/0001', 118]]]);
    assert.deepStrictEqual(g.b2b.map((b) => b.inv.map((i) => i.inum)), [['INV-1']], 'table 4 holds the invoice only');
    assert.deepStrictEqual(g.doc_issue.doc_det.map((d) => d.doc_typ).sort(), ['Debit Note', 'Invoices for outward supply']);
    assert.strictEqual(taxLines.isDebitNote({ purpose: 'debit_note' }) && taxLines.isDebitNote({ invoice: { DocDtls: { Typ: 'DBN' } } }) && !taxLines.isDebitNote({ purpose: 'invoice' }), true);
    const boxes = taxLines.outwardBoxes(led);
    assert.ok(boxes && typeof boxes === 'object');
  });

  console.log('\n== B · the books ==\n');
  const books = H.load();
  const K = require('../lib/books-hooks');
  if (!books.src.dir) {
    console.log('   SKIP the books checks: ' + books.src.why);
  } else {
    await t('seller: Dr debtors 118 / Cr sales 100 / Cr CGST 9 / Cr SGST 9 as its own entry (source_ref chit:<id>); the original entry is untouched; the trial balance balances; the party item is kind debit_note; the buyer posts a purchase_bill from the same JSON', async () => {
      PACK = PACKS.IN;
      const SHOP = '11111111-1111-4111-8111-111111111111';
      const CUST = '22222222-2222-4222-8222-222222222222';
      const { B, T, db: bdb } = books;
      T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi Stores', customer: true, credit_days: 15 });
      await books.store.saveSetting(bdb, SHOP, { enabled: false });
      await B.enable(bdb, SHOP, { by: SHOP, today: '2026-11-08' });
      const lines = [line('Pump', 1, 1000, 18)];
      const original = await sendMoney.invoiceOfLines({ lines, sellerId: 's1', buyerId: 'b1', business_json: { billed_at: '2026-11-08T00:00:00Z' }, currency_code: 'INR' });
      const sale = await B.postEntry(bdb, SHOP, { type: 'sale_bill', date: '2026-11-08', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-000000000001', source_ref: 'chit:orig', by_rate: K.byRateOf(original).rows, paid: {}, round_off: 0 });
      assert.ok(sale.ok, JSON.stringify(sale));
      const frozen = JSON.stringify(T.lines.filter((l) => l.entry_id === sale.entry_id));
      const note = await noteOf(lines, [edit(0, line('Pump', 1, 1100, 18))], '2026-11-08T00:00:00Z', 'INR');
      const chit = { chit_id: 'c0000000-0000-4000-8000-0000000000d2', created_at: '2026-11-08T05:00:00Z', purpose: 'debit_note', business_json: { invoice: note.invoice, against: { chit_id: 'c0000000-0000-4000-8000-000000000001', invoice_no: 'INV-7', issuer: 'CBSEL00001' }, printed_as: 'DN/26-27/0001', customer: { entity_id: CUST } } };
      const setting = { enabled: true, country: 'IN', functional_currency: 'INR' };
      const verdict = K.classify({ chit, entry: { sells: true, buyer: { entity_id: CUST }, invoice: note.invoice }, setting });
      assert.deepStrictEqual([verdict.kind, verdict.event.type, verdict.event.party, verdict.event.source_ref], ['post', 'debit_note', CUST, 'chit:' + chit.chit_id]);
      const posted = await B.postEntry(bdb, SHOP, verdict.event);
      assert.ok(posted.ok && posted.entry_id !== sale.entry_id, JSON.stringify(posted));
      const mine = T.lines.filter((l) => l.entry_id === posted.entry_id);
      const sum = (pick) => mine.filter(pick).reduce((s, l) => s + (l.dr_minor || 0) - (l.cr_minor || 0), 0);
      assert.strictEqual(sum((l) => l.party_id === CUST), 11800, 'Dr the customer 118.00');
      assert.strictEqual(mine.reduce((s, l) => s + (l.dr_minor || 0), 0), 11800);
      assert.strictEqual(mine.reduce((s, l) => s + (l.cr_minor || 0), 0), 11800, 'Cr sales 100 + CGST 9 + SGST 9');
      assert.strictEqual(JSON.stringify(T.lines.filter((l) => l.entry_id === sale.entry_id)), frozen, 'the original entry and its lines are as they were');
      const tb = await B.trialBalance(bdb, SHOP, '2026-11-30');
      assert.ok(tb.balanced, JSON.stringify([tb.total_dr_minor, tb.total_cr_minor]));
      const items = T.items.filter((x) => x.entry_id === posted.entry_id);
      assert.deepStrictEqual(items.map((x) => [x.kind, x.side, x.amount_minor]), [['debit_note', 'receivable', 11800]], 'the party item is named a debit note');
      const buyer = K.classify({ chit, entry: { sells: false, seller: { entity_id: 's1' }, invoice: note.invoice }, setting });
      assert.deepStrictEqual([buyer.kind, buyer.event.type, buyer.event.party, buyer.event.against_ref], ['post', 'purchase_bill', 's1', chit.chit_id]);
      assert.deepStrictEqual(buyer.event.by_rate, verdict.event.by_rate, 'both sides post from the same carried invoice');
    });
    await t('a debit note with no buyer or no supplier on the rail queues in words; a credit note is still a return', async () => {
      const chit = { chit_id: 'c0000000-0000-4000-8000-0000000000d3', created_at: '2026-11-08T05:00:00Z', purpose: 'debit_note', business_json: { printed_as: 'DN/1' } };
      PACK = PACKS.IN;
      const note = await noteOf([line('Pump', 1, 1000, 18)], [edit(0, line('Pump', 1, 1100, 18))]);
      const setting = { enabled: true, country: 'IN', functional_currency: 'INR' };
      assert.strictEqual(K.classify({ chit, entry: { sells: true, invoice: note.invoice }, setting }).kind, 'queue');
      assert.strictEqual(K.classify({ chit, entry: { sells: false, invoice: note.invoice }, setting }).kind, 'queue');
    });
  }
  console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();

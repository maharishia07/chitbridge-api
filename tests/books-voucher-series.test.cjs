/**
 * books-voucher-series.test.cjs — VOUCHER SERIES BY TYPE (engines v1.16.0; DECISIONS "Voucher numbering follows the standard").
 * lib/books.js writeLines against the in-memory store: an event takes the series of its voucher type (SV PV RV PY CV CN DN JV), a person's own
 * entry (owner door: manual entry, reversal, typed write-off) takes MJ; each series is gap-free on its own counter; ONE counter per entry; counters
 * taken in alphabetical order; a stored entry's type is derived from its series until b279 (journal_entry.voucher_type) is run.
 * Run: node tests/books-voucher-series.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';

(async () => {
  console.log('\n══ VOUCHER SERIES BY TYPE — the writer ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); console.log('\n  ✓ 0 passed · 0 checks (skipped)'); return; }
  const { B, T, db } = X;
  T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi Stores', customer: true, credit_days: 15 }, { owner: SHOP, party_id: SUPP, name: 'Kumar Traders', supplier: true, credit_days: 30 });
  await B.enable(db, SHOP, { by: SHOP, today: '2026-09-29' });
  const rate = [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }];
  const base = { date: '2026-09-10', currency: 'INR' };
  let n = 0;
  const post = async (ev) => B.postEntry(db, SHOP, Object.assign({ source_ref: 'vs:' + (++n) }, base, ev));
  const counters = () => Array.from(T.counters.entries()).reduce((t, kv) => t + (kv[1] - 1), 0);

  const sale = await post({ type: 'sale_bill', party: CUST, by_rate: rate, paid: {}, round_off: 0 });
  const buy = await post({ type: 'purchase_bill', party: SUPP, by_rate: rate, paid: {}, round_off: 0 });
  const rcv = await post({ type: 'payment_received', party: CUST, amount: 500, mode: 'cash', against_ref: 'x' });
  const pay = await post({ type: 'payment_made', party: SUPP, amount: 300, mode: 'cash', against_ref: 'y' });
  const crn = await post({ type: 'return', party: CUST, by_rate: rate });
  const dbn = await post({ type: 'purchase_return', party: SUPP, by_rate: rate });
  eq('sale SV · purchase PV · receipt RV · payment PY · credit note CN · debit note DN', [sale, buy, rcv, pay, crn, dbn].map((r) => r.entry_no),
    ['SV/2026-27/000001', 'PV/2026-27/000001', 'RV/2026-27/000001', 'PY/2026-27/000001', 'CN/2026-27/000001', 'DN/2026-27/000001']);
  const sale2 = await post({ type: 'sale_bill', party: CUST, by_rate: rate, paid: {}, round_off: 0 });
  eq('each series counts on its own, gap-free (second sale = SV 000002)', sale2.entry_no, 'SV/2026-27/000002');

  const before = counters();
  const man = await post({ type: 'manual', owner: true, narration: 'Owner brought in cash', lines: [{ account: '1400', dr: 100, cr: 0 }, { account: '3000', dr: 0, cr: 100 }] });
  eq('a manual entry (owner door) takes the single series MJ', man.entry_no, 'MJ/2026-27/000001');
  eq('...and ONE counter moved for the one entry', counters() - before, 1);
  const wo = await post({ type: 'write_off', owner: true, party: CUST, amount: 50, reason: 'bad debt' });
  eq('a write-off typed by the owner is MJ too (next number)', wo.entry_no, 'MJ/2026-27/000002');
  const rev = await B.reverseEntry(db, SHOP, sale.entry_id, { by: SHOP, reason: 'wrong party' });
  eq('the owner\'s reversal is MJ', rev.entry_no, 'MJ/2026-27/000003');
  const sys = await post({ type: 'contra', from: 'cash', to: 'bank', amount: 20 });
  eq('a contra (cash to bank, system-made) is a Contra voucher, CV', sys.entry_no, 'CV/2026-27/000001');

  const row = (r) => T.entries.find((e) => e.entry_id === r.entry_id);
  eq('the series is stored on the entry', [row(sale).series, row(man).series, row(sys).series], ['SV', 'MJ', 'CV']);
  eq('voucher type of a stored entry: from the series (SV → Sales, PY → Payment)...', [B.voucherTypeOfEntry(row(sale)), B.voucherTypeOfEntry(row(pay))], ['Sales', 'Payment']);
  eq('...an MJ entry from its event (manual → Journal); an old JV/ entry stays Journal', [B.voucherTypeOfEntry(row(man)), B.voucherTypeOfEntry({ entry_no: 'JV/2026-26/000009', event_type: 'sale_bill' })], ['Journal', 'Journal']);
  eq('voucher_type column, once b279 runs, wins', B.voucherTypeOfEntry({ series: 'MJ', voucher_type: 'Payment', event_type: 'manual' }), 'Payment');

  console.log('\n══ THE DEADLOCK GUARD ══\n');
  const asked = [];
  const spy = { nextNo: async (h, e, s, fy) => { asked.push(s); return 1; } };
  const realS = require(path.join(H.API, 'lib', 'books-store.js'));
  const orig = realS.nextNo; realS.nextNo = spy.nextNo;
  try { await B.nextNosInOrder(null, SHOP, ['SV', 'PV', 'MJ', 'PV'], '2026-27'); } finally { realS.nextNo = orig; }
  eq('several counters in one transaction are taken in alphabetical order (duplicates once)', asked, ['MJ', 'PV', 'SV']);
  /* no path writes two entries in one transaction today: every writeLines caller is writeJournal / writeReversal (one entry each), and the cheque step writes
     at most one (cleared posts; bounced reverses) — so a single counter per entry is the whole truth, asserted above (counters() - before === 1). */
  const src = fs.readFileSync(path.join(H.API, 'lib', 'books.js'), 'utf8');
  eq('writeLines is called from exactly two writers (writeJournal, writeReversal) — one entry each', (src.match(/await writeLines\(/g) || []).length, 2);
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

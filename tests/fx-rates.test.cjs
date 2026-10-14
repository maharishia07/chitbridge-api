/**
 * fx-rates.test.cjs — FOREIGN-CURRENCY TRADE END TO END, WITHOUT A DATABASE (FX1, 2026-10-14).
 *
 * lib/fx-rates.js + lib/books.js postEntry against the in-memory store (tests/support/books-memory.cjs) and the books engines (≥ v1.45.0 —
 * fx_settlement · fx_revalue · fxRevaluation). Proves: a rate is added, refused in words, imported from a CSV (good rows in, bad rows named) ·
 * a USD sale with no rate for its day is refused with the sentence Waiting shows, and posts once the rate is added, every foreign line naming the
 * rate's source and day · a USD receipt at a different rate posts the realised gain to 4260, settles the party in BOTH currencies, the trial
 * balance balances · the revaluation at a month end (closing rate) and its reversal on the next month's first day, idempotent, a missing rate
 * named · an AU shop importing in USD pays at a higher rate → the loss · before b391 / b392 every door answers BOOKS_NOT_MIGRATED in words.
 * Run: node tests/fx-rates.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
async function throws(name, fn, re, code) {
  try { await fn(); ok(name, false, 'did not throw'); } catch (e) { ok(name, (!re || re.test(String(e && e.message))) && (!code || e.code === code), 'threw: ' + (e && e.code) + ' ' + (e && e.message)); }
}

const SHOP = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';
const SHOP_AU = '44444444-4444-4444-8444-444444444444';
const VENDOR = '55555555-5555-4555-8555-555555555555';

(async () => {
  console.log('\n══ FX1 — rates, a foreign bill, its settlement, the revaluation ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return done(); }
  const { B, T, db } = X;
  const FX = require(path.join(H.API, 'lib', 'fx-rates'));
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-20T06:00:00Z');   /* one "today" for the whole walk: after every date below */
  if (typeof X.E.posting().fxRevaluation !== 'function') { console.log('   SKIP: the engines are older than v1.45.0 (no fxRevaluation)'); return done(); }
  T.parties.push({ owner: SHOP, party_id: BUYER, name: 'Acme Inc (US)', customer: true, credit_days: 30 }, { owner: SHOP_AU, party_id: VENDOR, name: 'Chip Co (US)', supplier: true, credit_days: 30 });
  await B.enable(db, SHOP, { by: SHOP, today: '2026-10-01', country: 'IN' });
  const s = await B.settingOf(db, SHOP);

  /* ── the rates ── */
  T.fxReady = false;
  await throws('before b391: adding a rate says which migration, in words', () => FX.add(db, SHOP, s, { date: '2026-10-14', currency: 'USD', rate: '83.25' }, SHOP), /b391/, 'BOOKS_NOT_MIGRATED');
  eq('…and the list is empty, not an error', await FX.list(db, SHOP, {}), []);
  T.fxReady = true;
  await throws('a rate of 0 is refused in words', () => FX.add(db, SHOP, s, { date: '2026-10-14', currency: 'USD', rate: '0' }, SHOP), /more than 0/);
  await throws('a rate to another currency than the books\' is refused', () => FX.add(db, SHOP, s, { date: '2026-10-14', currency: 'USD', to: 'AUD', rate: '1.5' }, SHOP), /to INR/);
  await throws('30 February is not a day', () => FX.add(db, SHOP, s, { date: '2026-02-30', currency: 'USD', rate: '83' }, SHOP), /date/);
  const imp = await FX.importCsv(db, SHOP, s, 'date,currency,rate,source\n2026-10-31,USD,84.00,official\n2026-10-31,EUR,abc\n2026-11-02,USD,"84.10"\n', 'cbic-oct.csv', SHOP);
  eq('a CSV import: the good rows in, the bad row named with its line', { added: imp.added, refused: imp.refused }, { added: 2, refused: [{ line: 3, why: 'The rate is a number more than 0 (83.25).' }] });
  eq('…an imported row keeps "official" when it says so, else "import", and the file as its reference', imp.rates.map((r) => [r.date, r.source, r.source_ref]), [['2026-10-31', 'official', 'cbic-oct.csv'], ['2026-11-02', 'import', 'cbic-oct.csv']]);

  /* ── a USD export sale: refused without its day's rate, then posted ── */
  const sale = { type: 'sale_bill', date: '2026-10-14', currency: 'USD', party: BUYER, by_rate: [{ rate: 0, taxable: 1000 }], source_ref: 'chit:ex1', ref: 'EX-1', source_chit_id: 'c0000000-0000-4000-8000-0000000000e1' };
  await throws('⭐ a USD bill with no rate for its day is refused with the sentence Waiting shows', () => B.postEntry(db, SHOP, sale), /^No USD rate for 14 Oct — add it/, 'FX_RATE_MISSING');
  ok('…and nothing was written', T.entries.length === 0);
  const added = await FX.add(db, SHOP, s, { date: '2026-10-14', currency: 'USD', rate: '83.25' }, SHOP);
  eq('a rate typed by the owner', [added.date, added.from, added.to, added.rate, added.source], ['2026-10-14', 'USD', 'INR', '83.25', 'manual']);
  const p1 = await B.postEntry(db, SHOP, sale);
  ok('⭐ …then the bill posts', p1.ok && p1.entry_no, JSON.stringify(p1));
  const l1 = T.lines.filter((l) => l.entry_id === p1.entry_id), deb = l1.find((l) => l.role === 'debtors');
  eq('…the party is ₹83,250 in the books and USD 1,000 on the line, at 83.25', [deb.dr_minor, deb.currency, deb.txn_currency, deb.amount_txn_minor, deb.fx_rate], [8325000, 'INR', 'USD', 100000, 83.25]);
  eq('…every foreign line names the rate it used (source + day) — the auditor sees it on the entry', Array.from(new Set(l1.map((l) => l.fx_rate_source + ' ' + l.fx_rate_date))), ['manual 2026-10-14']);

  /* ── the receipt at a different rate: the realised gain ── */
  await FX.add(db, SHOP, s, { date: '2026-11-02', currency: 'USD', rate: '84.10' }, SHOP);   /* a correction: a newer row for the same day wins */
  const pay = await B.recordPayment(db, SHOP, { party_id: BUYER, direction: 'in', amount_minor: 100000, currency: 'USD', mode: 'bank', received_at: '2026-11-02', by: SHOP });
  const l2 = T.lines.filter((l) => l.entry_id === pay.posted.entry_id), on = (code, side) => l2.filter((l) => l.code === code).reduce((t, l) => t + l[side + '_minor'], 0);
  eq('⭐ USD 1,000 received at 84.10: Dr bank ₹84,100 · Cr the party ₹83,250 · Cr exchange gain (4260) ₹850', [on('1210', 'dr') || l2.find((l) => l.role === 'bank').dr_minor, l2.find((l) => l.role === 'debtors').cr_minor, on('4260', 'cr')], [8410000, 8325000, 85000]);
  const pl = l2.find((l) => l.role === 'debtors');
  eq('…the party line keeps USD 1,000 at the BOOKED rate, named "book"', [pl.txn_currency, pl.amount_txn_minor, pl.fx_rate, pl.fx_rate_source], ['USD', 100000, 83.25, 'book']);
  eq('…the party is settled in BOTH currencies (no open USD balance left)', await X.store.foreignBalances(db, SHOP, { functional: 'INR', party: BUYER }), []);
  const tb = await B.trialBalance(db, SHOP, '2026-11-30');
  ok('⭐ …and the trial balance balances', tb && tb.balanced === true && tb.total_dr_minor > 0, JSON.stringify(tb && { d: tb.total_dr_minor, c: tb.total_cr_minor }));

  /* ── the revaluation at a month end ── */
  await B.postEntry(db, SHOP, Object.assign({}, sale, { date: '2026-10-20', source_ref: 'chit:ex2', ref: 'EX-2', source_chit_id: 'c0000000-0000-4000-8000-0000000000e2', fx_rate: 83.5 }));
  const fy = '2026-27';
  const v = await FX.revaluation(db, SHOP, s, fy, 7);
  /* at 31 Oct BOTH bills are open (EX-1 was received on 2 Nov): USD 2,000 carried ₹83,250 + ₹83,500 */
  eq('⭐ October: the open USD 2,000 (carried ₹1,66,750) at the 31 Oct closing rate 84.00 → +₹1,250, named with its rate source', v.rows.map((r) => [r.party, r.balance_txn_minor, r.carrying_minor, r.rate, r.rate_source, r.diff_minor]), [['Acme Inc (US)', 200000, 16675000, 84, 'official', 125000]]);
  eq('…dated the month end, reversed the next day', [v.date, v.reverses_on, v.gain_minor], ['2026-10-31', '2026-11-01', 125000]);
  const rv = await FX.revalue(db, SHOP, s, fy, 7, SHOP);
  ok('⭐ revalue posts the revaluation and its reversal', rv.ok && rv.entry_no && rv.reversal_no, JSON.stringify(rv));
  const e1 = T.entries.find((x) => x.source_ref === 'fxrev:' + fy + ':7'), e2 = T.entries.find((x) => x.source_ref === 'fxrev:' + fy + ':7:r');
  eq('…on 31 Oct and 1 Nov', [String(e1.posting_date).slice(0, 10), String(e2.posting_date).slice(0, 10)], ['2026-10-31', '2026-11-01']);
  const g = (e, side) => T.lines.filter((l) => l.entry_id === e.entry_id && l.code === '4260').reduce((t, l) => t + l[side + '_minor'], 0);
  eq('…unrealised gain Cr 4260 ₹1,250, the reversal Dr 4260 ₹1,250', [g(e1, 'cr'), g(e2, 'dr')], [125000, 125000]);
  ok('…the revaluation line names the closing rate (official, 31 Oct)', T.lines.some((l) => l.entry_id === e1.entry_id && l.role === 'debtors' && l.fx_rate_source === 'official' && l.fx_rate_date === '2026-10-31'));
  eq('…pressed again: the same entry, nothing new', [(await FX.revalue(db, SHOP, s, fy, 7, SHOP)).duplicate, T.entries.filter((x) => /^fxrev:/.test(x.source_ref || '')).length], [true, 2]);
  await throws('⭐ November has no USD closing rate on or before 30 Nov in the month → named, nothing revalued', async () => {
    T.fxRates = T.fxRates.filter((r) => r.rate_date < '2026-11-01');
    return FX.revalue(db, SHOP, s, fy, 8, SHOP);
  }, /^No USD closing rate for 30 Nov/);

  /* ── before b392: a foreign payment says so ── */
  T.fxLines = false;
  await throws('before b392: a USD payment answers BOOKS_NOT_MIGRATED in words', () => B.recordPayment(db, SHOP, { party_id: BUYER, direction: 'in', amount_minor: 100, currency: 'USD', mode: 'bank', received_at: '2026-10-20', by: SHOP, }), /b392/, 'BOOKS_NOT_MIGRATED');
  eq('…and the revaluation preview says it is not ready', (await FX.revaluation(db, SHOP, s, fy, 7)).ready, false);
  T.fxLines = true;

  /* ── an AU shop imports in USD ── */
  await B.enable(db, SHOP_AU, { by: SHOP_AU, today: '2026-10-01', country: 'AU' });
  const sa = await B.settingOf(db, SHOP_AU);
  await FX.add(db, SHOP_AU, sa, { date: '2026-10-14', currency: 'USD', rate: '1.50' }, SHOP_AU);
  await FX.add(db, SHOP_AU, sa, { date: '2026-11-03', currency: 'USD', rate: '1.52' }, SHOP_AU);
  const bill = await B.postEntry(db, SHOP_AU, { type: 'purchase_bill', date: '2026-10-14', currency: 'USD', party: VENDOR, by_rate: [{ rate: 0, taxable: 1000 }], source_ref: 'chit:im1', ref: 'IM-1' });
  ok('an AU shop\'s USD import bill posts in AUD at 1.50', bill.ok && T.lines.some((l) => l.entry_id === bill.entry_id && l.role === 'creditors' && l.cr_minor === 150000 && l.txn_currency === 'USD'), JSON.stringify(bill));
  const paid = await B.recordPayment(db, SHOP_AU, { party_id: VENDOR, direction: 'out', amount_minor: 100000, currency: 'USD', mode: 'bank', received_at: '2026-11-03', by: SHOP_AU });
  const l3 = T.lines.filter((l) => l.entry_id === paid.posted.entry_id);
  eq('⭐ paid at 1.52: Dr the supplier A$1,500 · Cr bank A$1,520 · Dr exchange loss (4260) A$20', [l3.find((l) => l.role === 'creditors').dr_minor, l3.find((l) => l.role === 'bank').cr_minor, l3.find((l) => l.code === '4260').dr_minor], [150000, 152000, 2000]);
  await throws('a USD payment with no open USD bill is refused in words', () => B.recordPayment(db, SHOP_AU, { party_id: VENDOR, direction: 'out', amount_minor: 100, currency: 'USD', mode: 'bank', received_at: '2026-11-03', by: SHOP_AU }), /no open USD bill/);

  done();
})().catch((e) => { console.error(e); process.exit(1); });

function done() { console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks'); process.exitCode = fail ? 1 : 0; }

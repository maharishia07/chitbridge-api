'use strict';
/**
 * tests/biz-bank.realstack.cjs — BUSINESS SCENARIOS MNY-BANK-* on REAL Postgres (api as cb_app, RLS on) and the bank-recon engine the device runs. Each case asserts the HAND-COMPUTED figure, then the inverse refusal.
 * Source of the scenarios and hand figures: toolset/sitfull/biz-money-expected.json (branch test/scenarios-money-1118). Hand figures were written before any run, in minor units (AU cents), never read from the code.
 * Doors: POST /api/books/events (expense · other_income · contra · drawings · tax_payment) · POST /api/books/entries (+ /:id/reverse) · GET /api/books/trial-balance · the engine files bank-recon.js (parse · match · brs · suggest · lineKey).
 * A case that stays red because of a real defect carries `gap:` (recorded, not hidden). Run on a SIT box only: sh toolset/sit-realstack.sh <box> <list>   (the harness refuses anything else).
 * COVERS the posting figures and the engine's reading; LEAVES OUT the screen (accept-all ticks, banners) which is an e2e walk.
 * CARD 16-finance/bank-reconciliation-and-bank-rail
 */
const path = require('path');
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const { shopDayAt } = require('./lib/shop-day.cjs');
const RUN = 'bz' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const AU = (registered) => ({ country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: registered ? { registered: true, number: '51824753556', scheme: 'regular' } : { registered: false } });
const DAY = shopDayAt(-1);
const ENG = path.join(path.resolve(process.env.CB_ENGINES_DIR || path.join(__dirname, '..', '..', 'chitbridge-engines')), 'src');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let n = 0;
const ref = (tag) => RUN + (tag || '') + '-' + (++n);

/** the trial balance as { code: dr - cr } in minor units, zero rows dropped */
async function tb(shop) {
  const r = ok(await j('/api/books/trial-balance?asOf=' + DAY + '', { token: shop.token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const net = (Number(row.dr_minor) || 0) - (Number(row.cr_minor) || 0); if (net) out[row.code] = net; });
  return out;
}
/** after minus before, zero rows dropped */
const delta = (a, b) => { const o = {}; new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { const d = (b[k] || 0) - (a[k] || 0); if (d) o[k] = d; }); return o; };
const post = (shop, body) => j('/api/books/events', { method: 'POST', token: shop.token, body: Object.assign({ date: DAY, client_ref: ref() }, body) });
const refused = (r, codes, why) => expect(r.status >= 400 && r.status < 500 && (!codes || codes.includes(r.status)), why + ': expected a refusal, got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
const says = (r, re, why) => expect(re.test(JSON.stringify(r.b)), why + ': the refusal does not say ' + re + ' -> ' + JSON.stringify(r.b).slice(0, 240));

(async () => {
  console.log('\n== MNY-BANK scenarios · run ' + RUN + ' ==');
  ok(await j('/health'), 'health');
  const S = await freshShop(RUN, 'Bluegum', AU(true));
  ok(await j('/api/books/enable', { method: 'POST', token: S.token }), 'books on');
  const D = await freshShop(RUN + 'd', 'Daisy', AU(false));
  ok(await j('/api/books/enable', { method: 'POST', token: D.token }), 'books on (Daisy)');
  let BR = null; try { BR = require(path.join(ENG, 'bank-recon')); } catch (e) { console.log('  (engine bank-recon not loadable: ' + e.message + ')'); }
  const eng = (id, title, fn) => kase(id, title, async () => { expect(BR, 'the bank-recon engine file was not found at ' + ENG); return fn(); });

  await kase('MNY-BANK-03', 'bank account fee 15.00, no GST: Dr 6090 1500 / Cr 1500 bank 1500, no 2210; and the engine proposes no tax on it', async () => {
    const a = await tb(S);
    const r = await post(S, { kind: 'expense', class: 'bank_charges', amount_minor: 1500, narration: 'ACCOUNT SERVICE FEE', paid_from: 'bank' });
    expect(r.status === 200 && r.b.ok, 'post ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const d = delta(a, await tb(S));
    expect(same(d, { 1500: -1500, 6090: 1500 }), 'books moved ' + JSON.stringify(d) + ', hand {1500:-1500, 6090:1500}, no 2210');
    if (BR) {
      const s = BR.suggest({ date: DAY, narration: 'ACCOUNT SERVICE FEE', debit_minor: 1500, credit_minor: 0 }, { country: 'AU', gst_basis: 'accrual' });
      const tax = s.tax && Number(s.tax.tax_minor) || 0;
      const ev = s.event || {};
      expect(tax === 0 && !ev.input_tax && /bank_charges/.test(JSON.stringify(ev)), 'the engine proposed a GST claim or another class on a bank fee: ' + JSON.stringify(s).slice(0, 300));
    }
  });

  await kase('MNY-BANK-04', 'terminal rental 33.00 incl GST (30.00 + 3.00): Dr 6010 3000, Dr 2210 300, Cr bank 3300; Daisy (not registered) is refused a GST claim and books the whole 33.00', async () => {
    const a = await tb(S);
    const r = await post(S, { kind: 'expense', class: 'rent', amount_minor: 3000, input_tax_minor: 300, narration: 'EFTPOS TERMINAL RENTAL', paid_from: 'bank' });
    expect(r.status === 200 && r.b.ok, 'post ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const d = delta(a, await tb(S));
    expect(same(d, { 1500: -3300, 2210: 300, 6010: 3000 }), 'books moved ' + JSON.stringify(d) + ', hand {1500:-3300, 2210:300, 6010:3000}');
    const da = await tb(D);
    const bad = await post(D, { kind: 'expense', class: 'rent', amount_minor: 3000, input_tax_minor: 300, narration: 'EFTPOS TERMINAL RENTAL', paid_from: 'bank' });
    refused(bad, null, 'Daisy GST claim'); says(bad, /not registered/i, 'Daisy GST claim');
    expect(same(await tb(D), da), 'Daisy: a refused claim wrote to the books');
    ok(await post(D, { kind: 'expense', class: 'rent', amount_minor: 3300, narration: 'EFTPOS TERMINAL RENTAL', paid_from: 'bank' }), 'Daisy whole 33.00');
    const dd = delta(da, await tb(D));
    expect(same(dd, { 1500: -3300, 6010: 3300 }), 'Daisy books moved ' + JSON.stringify(dd) + ', hand {1500:-3300, 6010:3300} and no 2210');
  });

  await kase('MNY-BANK-05', 'legal fee 110.00 above the tax-invoice threshold: held -> 100.00 + 10.00 GST; not held with GST claimed -> refused, nothing posted', async () => {
    const a = await tb(S);
    const nope = await post(S, { kind: 'expense', class: 'professional', amount_minor: 10000, input_tax_minor: 1000, tax_invoice: 'none', paid_from: 'bank', narration: 'SMITH LEGAL FEE' });
    refused(nope, [422], 'not held'); says(nope, /tax invoice/i, 'not held');
    expect(same(await tb(S), a), 'a refused claim wrote to the books');
    const held = await post(S, { kind: 'expense', class: 'professional', amount_minor: 10000, input_tax_minor: 1000, tax_invoice: 'held', paid_from: 'bank', narration: 'SMITH LEGAL FEE' });
    expect(held.status === 200, 'held ' + held.status + ' ' + JSON.stringify(held.b).slice(0, 200));
    const d = delta(a, await tb(S));
    expect(same(d, { 1500: -11000, 2210: 1000, 6120: 10000 }), 'books moved ' + JSON.stringify(d) + ', hand {1500:-11000, 2210:1000, 6120:10000}');
    const whole = await post(S, { kind: 'expense', class: 'professional', amount_minor: 11000, paid_from: 'bank', narration: 'SMITH LEGAL FEE no invoice' });
    expect(whole.status === 200, 'not held, whole 110.00 as expense: ' + whole.status);
  });

  await kase('MNY-BANK-08', 'a bare WITHDRAWAL names no account: the engine says needs you; after the owner ticks drawings: Dr 3100 500.00 / Cr bank, expenses unchanged', async () => {
    if (BR) {
      const s = BR.suggest({ date: DAY, narration: 'WITHDRAWAL ONLINE 1234567 TFR J SMITH', debit_minor: 50000, credit_minor: 0 }, { country: 'AU', parties: [] });
      expect(!s.event && s.confidence === 'none', 'the engine proposed an account for a bare withdrawal: ' + JSON.stringify(s).slice(0, 300));
    }
    const a = await tb(S);
    const r = await post(S, { kind: 'drawings', amount_minor: 50000, paid_from: 'bank', narration: 'WITHDRAWAL ONLINE 1234567 TFR J SMITH' });
    expect(r.status === 200, 'drawings ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const d = delta(a, await tb(S));
    expect(same(d, { 1500: -50000, 3100: 50000 }), 'books moved ' + JSON.stringify(d) + ', hand {1500:-50000, 3100:50000} (no 5xxx/6xxx row)');
  });

  await kase('MNY-BANK-12', 'transfer between own accounts (bank to cash) is neither income nor expense: 5,000.00 moves, P&L rows 0; the same account to itself is refused', async () => {
    const a = await tb(S);
    const r = await post(S, { kind: 'contra', from: 'bank', to: 'cash', amount_minor: 500000, narration: 'TRANSFER' });
    expect(r.status === 200, 'contra ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
    const d = delta(a, await tb(S));
    expect(same(d, { 1400: 500000, 1500: -500000 }), 'books moved ' + JSON.stringify(d) + ', hand {1400:500000, 1500:-500000}; no 4xxx/5xxx/6xxx');
    const bad = await post(S, { kind: 'contra', from: 'bank', to: 'bank', amount_minor: 500000, narration: 'TRANSFER to itself' });
    refused(bad, null, 'bank to bank');
  });

  await kase('MNY-BANK-22', 'ATO BAS payment 3,310.00 is not an expense: GST payable 2200 Cr 3,310.00 becomes 0.00, P&L unchanged', async () => {
    ok(await j('/api/books/entries', { method: 'POST', token: S.token, body: { date: DAY, client_ref: ref('gst'), narration: 'GST payable carried', lines: [{ account: '1500', dr_minor: 331000 }, { account: '2200', cr_minor: 331000 }] } }), 'prime GST payable');
    const a = await tb(S);
    const r = await post(S, { kind: 'tax_payment', amount_minor: 331000, paid_from: 'bank', narration: 'ATO BAS PAYMENT' });
    expect(r.status === 200, 'tax_payment ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
    const d = delta(a, await tb(S));
    expect(same(d, { 1500: -331000, 2200: 331000 }), 'books moved ' + JSON.stringify(d) + ', hand {1500:-331000, 2200:+331000 (Dr)} and no 6xxx');
    expect(((await tb(S))[2200] || 0) === (a[2200] || 0) + 331000, 'GST payable did not fall by 3,310.00');
  });

  await kase('MNY-BANK-24', 'a cash deposit of 800.00 does not create sales again: Dr bank 800.00 / Cr cash in till 800.00, sales 4000 unchanged', async () => {
    ok(await j('/api/books/entries', { method: 'POST', token: S.token, body: { date: DAY, client_ref: ref('till'), narration: 'Till takings', lines: [{ account: '1400', dr_minor: 80000 }, { account: '4000', cr_minor: 80000 }] } }), 'prime till takings');
    const a = await tb(S);
    const r = await post(S, { kind: 'contra', from: 'cash', to: 'bank', amount_minor: 80000, narration: 'BRANCH DEPOSIT CASH' });
    expect(r.status === 200, 'contra ' + r.status);
    const d = delta(a, await tb(S));
    expect(same(d, { 1400: -80000, 1500: 80000 }), 'books moved ' + JSON.stringify(d) + ', hand {1400:-80000, 1500:+80000}; 4000 unchanged');
  });

  await kase('MNY-BANK-27', 'accept then take it back: the reversal nets the pair to 0 on every account; a second reverse is 409 ALREADY_REVERSED, nothing posted', async () => {
    const a = await tb(S);
    const r = await post(S, { kind: 'expense', class: 'rent', amount_minor: 3000, input_tax_minor: 300, paid_from: 'bank', narration: 'EFTPOS TERMINAL RENTAL SM-BANK-04' });
    expect(r.status === 200 && r.b.entry_id, 'post ' + JSON.stringify(r.b).slice(0, 200));
    const rev = await j('/api/books/entries/' + r.b.entry_id + '/reverse', { method: 'POST', token: S.token, body: { reason: 'wrong line' } });
    expect(rev.status === 200 && rev.b.ok, 'reverse ' + rev.status + ' ' + JSON.stringify(rev.b).slice(0, 200));
    expect(same(delta(a, await tb(S)), {}), 'the pair did not net to 0: ' + JSON.stringify(delta(a, await tb(S))));
    const again = await j('/api/books/entries/' + r.b.entry_id + '/reverse', { method: 'POST', token: S.token, body: { reason: 'again' } });
    expect(again.status === 409 && again.b.code === 'ALREADY_REVERSED', 'second reverse expected 409 ALREADY_REVERSED, got ' + again.status + ' ' + JSON.stringify(again.b).slice(0, 200));
    expect(same(delta(a, await tb(S)), {}), 'the second reverse moved the books');
  });

  await kase('MNY-BANK-28', 'two staff accept the same line in the same second: ONE entry of 33.00; the second answer is duplicate:true; a different account on the second does not stack', async () => {
    const a = await tb(S), key = ref('race');
    const body = (cls) => ({ kind: 'expense', class: cls, amount_minor: 3300, paid_from: 'bank', narration: 'LINE -33.00', client_ref: key });
    const [x, y] = await Promise.all([post(S, body('rent')), post(S, body('telephone'))]);
    expect(x.status === 200 && y.status === 200, 'both answered 200 ' + x.status + ' ' + y.status + ' ' + JSON.stringify([x.b, y.b]).slice(0, 300));
    expect([x.b.duplicate, y.b.duplicate].filter(Boolean).length === 1, 'exactly one of the two is the duplicate: ' + JSON.stringify([x.b.duplicate, y.b.duplicate]));
    const d = delta(a, await tb(S));
    expect(d[1500] === -3300 && Object.keys(d).length === 2, 'two entries stacked or none: ' + JSON.stringify(d) + ', hand one entry {1500:-3300, one expense:3300}');
    const third = await post(S, body('rent'));
    expect(third.b.duplicate === true, 'a later press is not the duplicate: ' + JSON.stringify(third.b).slice(0, 200));
  });

  await kase('MNY-BANK-29', 'card settlement net of fee: deposit 1,079.10 + fee 19.00 + GST 1.90 = 1,100.00 cleared; Dr bank 107910, Dr 6090 1900, Dr 2210 190, Cr 1520 110000', async () => {
    const a = await tb(S);
    const r = await post(S, { kind: 'contra', from: 'card', to: 'bank', amount_minor: 107910, fee: 19, fee_tax_minor: 190, tax_invoice: 'held', narration: 'SQUARE SETTLEMENT' });
    expect(r.status === 200, 'contra with fee ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
    const d = delta(a, await tb(S));
    expect(same(d, { 1500: 107910, 1520: -110000, 2210: 190, 6090: 1900 }), 'books moved ' + JSON.stringify(d) + ', hand {1500:107910, 1520:-110000, 2210:190, 6090:1900}; sales not touched');
  });

  /* ── the engine's own reading of a statement (the device runs it) ── */
  const csv = (rows) => 'Date,Description,Debit,Credit,Balance\n' + rows.join('\n') + '\n';
  await eng('MNY-BANK-02', 'two identical lines on one day are both real (2 x 20.00 = 40.00) and have two keys; loading the same file twice does not make 4 lines', async () => {
    const text = csv(['2026-10-03,CASH DEP 0412,,20.00,', '2026-10-03,CASH DEP 0412,,20.00,']);
    const p = BR.parse(text, { country: 'AU' });
    expect(p.ok && p.lines.length === 2, 'parse ' + JSON.stringify(p).slice(0, 300));
    expect(p.lines.reduce((t, l) => t + l.credit_minor, 0) === 4000, 'credits sum ' + p.lines.map((l) => l.credit_minor));
    const k = BR.explain(p.lines, [], [], { country: 'AU' }).rows.map((r) => r.key);
    expect(k.length === 2 && k[0] !== k[1] && /#1$/.test(k[1]), 'the two lines need two keys, got ' + JSON.stringify(k));
    const again = BR.explain(BR.parse(text, { country: 'AU' }).lines, [], [], { country: 'AU' }).rows.map((r) => r.key);
    expect(same(again, k), 'a second load of the same file made other keys (would double): ' + JSON.stringify(again));
  });
  await eng('MNY-BANK-01', 'a 550.00 deposit already in the books matches its ledger line (no new line); the same file re-read gives the same key', async () => {
    const stmt = BR.parse(csv(['2026-10-12,TFR FROM J SMITH,,550.00,']), { country: 'AU' }).lines;
    const led = [{ id: 'L1', date: '2026-10-12', dr_minor: 55000, cr_minor: 0, narration: 'Receipt J Smith INV-0042', entry_no: 'R1' }];
    const m = BR.match(stmt, led, { window_days: 3 });
    expect(m.matched.length === 1 && m.unmatched_stmt.length === 0, 'matched ' + m.matched.length + ' unmatched ' + m.unmatched_stmt.length);
    const m2 = BR.match(BR.parse(csv(['2026-10-12,TFR FROM J SMITH,,550.00,']), { country: 'AU' }).lines, [], {});
    expect(m2.unmatched_stmt.length === 1 && BR.lineKey(stmt[0]) === BR.lineKey(m2.unmatched_stmt[0].line || m2.unmatched_stmt[0]), 'with no books line it stays unmatched with the same key');
  });
  await eng('MNY-BANK-14', 'statement opening 5,100.00 against ledger opening 5,000.00 is 100.00 apart; 5,000.00 is not', async () => {
    const op = (v) => BR.parse(csv(['Opening balance,,,,' + v, '2026-10-02,SALE,,100.00,' + (Number(v) + 100).toFixed(2)]), { country: 'AU' }).opening_minor;
    expect(op('5100.00') === 510000 && op('5100.00') - 500000 === 10000, 'opening read ' + op('5100.00') + ' hand 510000 (100.00 over the ledger)');
    expect(op('5000.00') === 500000, 'opening read ' + op('5000.00') + ' hand 500000 (no difference)');
  });
  await eng('MNY-BANK-15', 'reconciliation with an unpresented cheque: 8,000.00 + 300.00 = 8,300.00, difference 0, tied; unlisted -> difference 300.00', async () => {
    const base = { asOf: '2026-10-31', bookBalance_minor: 800000, bankBalance_minor: 830000, unmatched_stmt: [], country: 'AU' };
    const listed = BR.brs(Object.assign({ unmatched_ledger: [{ id: 'c1', date: '2026-10-30', dr_minor: 0, cr_minor: 30000, narration: 'CHEQUE 000123', cheque_no: '000123' }] }, base));
    expect(listed.ok && listed.difference_minor === 0 && listed.tied === true && listed.totals.issued_not_presented_minor === 30000, 'listed ' + JSON.stringify(listed).slice(0, 300));
    const bare = BR.brs(Object.assign({ unmatched_ledger: [] }, base));
    expect(bare.difference_minor === 30000 && bare.tied === false, 'unlisted difference ' + bare.difference_minor + ', hand 30000');
  });
  await eng('MNY-BANK-16', 'lines add to the closing balance: 5,000.00 + 3,200.00 - 1,450.50 = 6,749.50 reads clean; a file missing a line breaks the running balance by name', async () => {
    const full = BR.parse(csv(['Opening balance,,,,5000.00', '2026-10-02,SALE DEP,,3200.00,8200.00', '2026-10-05,SUPPLIER,1000.00,,7200.00', '2026-10-09,SUPPLIER 2,450.50,,6749.50', 'Closing balance,,,,6749.50']), { country: 'AU' });
    expect(full.ok && full.lines.length === 3 && full.opening_minor === 500000 && full.closing_minor === 674950 && full.warnings.length === 0, 'full ' + JSON.stringify(full).slice(0, 400));
    expect(full.opening_minor + full.lines.reduce((t, l) => t + l.credit_minor - l.debit_minor, 0) === full.closing_minor, 'the lines do not add to the closing balance');
    const gap = BR.parse(csv(['Opening balance,,,,5000.00', '2026-10-02,SALE DEP,,3200.00,8200.00', '2026-10-09,SUPPLIER 2,450.50,,6749.50', 'Closing balance,,,,6749.50']), { country: 'AU' });
    expect(gap.warnings.length >= 1 && /line|balance/i.test(gap.warnings.join(' ')), 'a missing 1,000.00 line was not flagged: ' + JSON.stringify(gap.warnings));
  });
  await eng('MNY-BANK-18', 'an amount "1,234.50" reads 123450 cents; "1.234,50" in an AU file is not read as 1,234.50', async () => {
    const one = BR.parse(csv(['2026-10-02,SALE,,"1,234.50",']), { country: 'AU' });
    expect(one.ok && one.lines[0].credit_minor === 123450, 'read ' + JSON.stringify(one.lines && one.lines[0]) + ', hand 123450');
    const eu = BR.parse(csv(['2026-10-02,SALE,,"1.234,50",']), { country: 'AU' });
    const got = eu.ok && eu.lines[0] ? eu.lines[0].credit_minor : null;
    expect(got !== 123450 || (eu.warnings && eu.warnings.length), 'European "1.234,50" was silently read as 1,234.50 (123450) with no warning: ' + JSON.stringify(eu).slice(0, 300));
  });
  await eng('MNY-BANK-25', 'overlapping statements add only the new lines: 3 + (3 - 1 already loaded) = 5 keys, counted once; loading file 2 twice is still 5', async () => {
    const f1 = BR.parse(csv(['2026-10-01,A,,10.00,', '2026-10-02,B,,20.00,', '2026-10-03,C,,30.00,']), { country: 'AU' }).lines;
    const f2 = BR.parse(csv(['2026-10-03,C,,30.00,', '2026-10-04,D,,40.00,', '2026-10-05,E,,50.00,']), { country: 'AU' }).lines;
    const keysOf = (ls) => BR.explain(ls, [], [], { country: 'AU' }).rows.map((r) => r.key);
    const seen = new Set(keysOf(f1)); keysOf(f2).forEach((k) => seen.add(k));
    expect(seen.size === 5, 'distinct lines ' + seen.size + ', hand 5');
    keysOf(f2).forEach((k) => seen.add(k));
    expect(seen.size === 5, 'a second load of file 2 grew it to ' + seen.size);
  });
  finish('biz-bank');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });

'use strict';
/**
 * tests/money2-carry-opening.realstack.cjs — Fable's two money findings of 17 Nov on REAL Postgres (the api running as cb_app, year_carry from b873 present).
 *  F1  a year with no entries between two years with entries must not freeze a kept carry.
 *      FY 2023-24 holds cash 1,000.00 Dr; FY 2024-25 holds nothing; FY 2025-26 holds cash 800.00 Dr. The trial balance as at today (FY 2026-27) reads cash 1,800.00.
 *      A late correction in 2023-24 adds 7.77 → the next read must say 1,807.77 (kept carry served stale = 1,800.00, the defect).
 *  F2  opening bill INV-1 of 1,000.00 with a receipt of 400.00 allocated to it: the owner replaces the openings (adds a bank line) → refused in words naming INV-1,
 *      INV-1 still owes 600.00, one live opening entry, the receipt still allocated.
 * Run: API_BASE=http://127.0.0.1:3100 TRUTH_DB=postgres://postgres:cblocal@127.0.0.1:55432/cb_local node tests/money2-carry-opening.realstack.cjs   (local / a named SIT box only: the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'm2' + (Date.now() % 1e10).toString(36);
const sentence = (r) => String(r.b.detail || r.b.message || r.b.error || '');

(async () => {
  console.log('\n== money2 · F1 gap-year carry · F2 opening replace with an allocated receipt · ' + RUN + ' ==\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Money2', { tax: { registered: false } });
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const chart = ok(await j('/api/books/accounts', { token: shop.token }), 'accounts').b.accounts;
    const code = (role) => String(chart.find((a) => a.role === role).code);
    const cash = code('cash'), sales = code('sales'), debtors = code('debtors'), capital = code('capital'), bank = code('bank');
    const journal = (date, minor, ref) => j('/api/books/entries', { method: 'POST', token: shop.token, body: { narration: 'M2 ' + ref, date, ref: RUN + ref, lines: [{ code: cash, dr_minor: minor }, { code: sales, cr_minor: minor }] } });
    const cashNow = async () => {
      const t = ok(await j('/api/books/trial-balance', { token: shop.token }), 'trial balance').b;
      const row = t.rows.find((r) => String(r.code) === cash);
      return row ? Number(row.dr_minor) - Number(row.cr_minor) : 0;
    };

    await kase('F1', 'FY24 1,000.00 · FY25 none · FY26 800.00 → cash 1,800.00; +7.77 late in FY24 → cash 1,807.77', async () => {
      const a = await journal('2023-08-01', 100000, 'a'), b = await journal('2025-08-01', 80000, 'b');
      expect(a.status === 200 && b.status === 200, 'postings: ' + a.status + '/' + b.status + ' ' + JSON.stringify([a.b, b.b]).slice(0, 300));
      const before = await cashNow();
      expect(before === 180000, 'cash before the correction ' + before + ', expected 180000');
      const kept = Number((await pg.query('SELECT count(*)::int AS n FROM year_carry WHERE entity_id = $1', [shop.entity])).rows[0].n);
      expect(kept > 0, 'the kept carry was never written (year_carry has ' + kept + ' rows): the cached path was not exercised');
      const c = await journal('2023-09-01', 777, 'c');
      expect(c.status === 200, 'late correction: ' + c.status + ' ' + JSON.stringify(c.b).slice(0, 300));
      const after = await cashNow();
      expect(after === 180777, 'cash after the correction ' + after + ', expected 180777 (180000 = the stale kept carry)');
      return 'before ' + before + ' after ' + after + ' kept rows ' + kept;
    });

    await kase('F2', 'INV-1 1,000.00, receipt 400.00 allocated, owner replaces the openings → refused naming INV-1; 600.00 still owed', async () => {
      const w = ok(await j('/api/crm/walk-ins/add', { method: 'POST', token: shop.token, body: { name: 'M2 buyer ' + RUN, phone: '6' + String(1e7 + (Date.now() % 9e6)).slice(-8) } }), 'party').b;
      const party = w.party_id || (w.party && w.party.party_id) || w.id;
      const rows = (extra) => [
        { code: debtors, party_id: party, dr_minor: 100000, bill_ref: 'INV-1', due_date: '2026-05-30' },
        { code: debtors, dr_minor: 100000, control: true },
        { code: capital, cr_minor: 100000 + (extra || 0) }
      ].concat(extra ? [{ code: bank, dr_minor: extra }] : []);
      const op = await j('/api/books/opening', { method: 'POST', token: shop.token, body: { date: '2026-04-01', rows: rows(), client_ref: RUN + 'op', require_balanced: true } });
      expect(op.status === 200, 'opening: ' + op.status + ' ' + JSON.stringify(op.b).slice(0, 400));
      const pay = await j('/api/books/payments', { method: 'POST', token: shop.token, body: { party_id: party, direction: 'in', amount_minor: 40000, currency: 'INR', mode: 'cash', allocations: [{ against_ref: 'INV-1', amount_minor: 40000 }], acknowledge: ['nothing_owed'], client_ref: RUN + 'pay' } });
      expect(pay.status === 200, 'receipt: ' + pay.status + ' ' + JSON.stringify(pay.b).slice(0, 400));
      const owed = async () => Number((await pg.query("SELECT COALESCE(SUM(amount_minor),0)::bigint AS n FROM party_item WHERE entity_id = $1 AND against_ref = 'INV-1'", [shop.entity])).rows[0].n);
      const live = async () => Number((await pg.query('SELECT count(*)::int AS n FROM journal_entry e WHERE e.entity_id = $1 AND e.is_opening AND e.reverses_entry_id IS NULL AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.reverses_entry_id = e.entry_id)', [shop.entity])).rows[0].n);
      const countItems = async () => Number((await pg.query('SELECT count(*)::int AS n FROM party_item WHERE entity_id = $1', [shop.entity])).rows[0].n);
      expect((await owed()) === 60000, 'INV-1 owes ' + (await owed()) + ' after the receipt, expected 60000');
      const items0 = await countItems();
      const rep = await j('/api/books/opening/replace', { method: 'POST', token: shop.token, body: { date: '2026-04-01', rows: rows(5000), client_ref: RUN + 'rep', reason: 'bank added' } });
      expect(rep.status >= 400 && /INV-1/.test(sentence(rep)), 'expected a refusal naming INV-1, got ' + rep.status + ' ' + JSON.stringify(rep.b).slice(0, 300));
      const items1 = await countItems();
      expect((await owed()) === 60000 && (await live()) === 1 && items1 === items0, 'after the refusal: owes ' + (await owed()) + ', live openings ' + (await live()) + ', items ' + items0 + ' to ' + items1);
      return sentence(rep).slice(0, 200);
    });
  } finally { await pg.end(); }
  finish('money2-carry-opening');
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/**
 * tests/gst-lodged-read.realstack.cjs — GET /api/books/gst/lodged on REAL Postgres (the SQL no offline twin runs: taxClosesOf over journal_entry.tax_close, the lodged periods of returnStatesFor).
 * FLOW  fresh AU shop (GST registered; the BAS is the return the books close), books on, ledger started 2025-07-02 (ARM below) → GST collected 100.00 and GST paid 40.00 on 2025-08-10 →
 *       POST /gst/close 2025-Q1 → GET /gst/lodged answers no period (year not declared) → the other eleven months locked, POST /year/2025-26/close {returns_lodged:true} →
 *       GET /gst/lodged answers 2025-Q1 with net_minor 6000 (HAND: 10,000 collected - 4,000 paid = 6,000 owed before payments, AUD minor units), source 'close', closed_at a time.
 * Run: API_BASE=http://127.0.0.1:<port> TRUTH_DB=<owner url> node tests/gst-lodged-read.realstack.cjs   ⚠️ LOCAL OR A NAMED SIT BOX ONLY (the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'lg' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const said = (reply) => JSON.stringify([reply.status, reply.b]);
(async () => {
  console.log('\n══ GET /gst/lodged on real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Lodged Read', { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556' } });
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    await pg.query("UPDATE books_setting SET enabled_at = '2025-07-02T05:00:00Z' WHERE entity_id = $1", [shop.entity]); /* ARM: the throwaway shop is switched on today; its ledger starts in FY 2025-26 so a closed past year can be declared lodged */
    const code = {};
    (await pg.query("SELECT role, code FROM ledger_account WHERE entity_id = $1 AND role IN ('cash','gst_collected','gst_paid')", [shop.entity])).rows.forEach((row) => (code[row.role] = row.code));
    const journal = (lines, ref) => j('/api/books/events', { method: 'POST', token: shop.token, body: { event: { kind: 'journal', narration: 'GST ' + ref, date: '2025-08-10', lines, client_ref: RUN + ref } } });
    ok(await journal([{ code: code.cash, dr_minor: 10000 }, { code: code.gst_collected, cr_minor: 10000 }], 'out'), 'GST collected');
    ok(await journal([{ code: code.gst_paid, dr_minor: 4000 }, { code: code.cash, cr_minor: 4000 }], 'in'), 'GST paid');
    ok(await j('/api/books/gst/close', { method: 'POST', token: shop.token, body: { fy: '2025-26', period: '2025-Q1' } }), 'gst close');
    await kase('LG-1', 'before the year is declared lodged: no period', async () => {
      const r = await j('/api/books/gst/lodged', { token: shop.token });
      expect(r.status === 200 && Array.isArray(r.b.periods) && r.b.periods.length === 0 && r.b.currency === 'AUD', said(r));
      return said(r);
    });
    await kase('LG-2', 'year declared lodged: 2025-Q1 reads net 6,000 from the stored close; closed_at is a close time, no lodged_at', async () => {
      for (let m = 4; m <= 12; m++) ok(await j('/api/books/periods/2025-26/' + m + '/lock', { method: 'POST', token: shop.token, body: { reason: 'month done' } }), 'lock ' + m); /* July is 1; Jul-Sep are locked by the quarter close */
      const y = await j('/api/books/year/2025-26/close', { method: 'POST', token: shop.token, body: { returns_lodged: true } });
      expect(y.status === 200, 'year close ' + said(y));
      const r = await j('/api/books/gst/lodged', { token: shop.token });
      const p = (r.b.periods || []).find((x) => /Q1/.test(String(x.period)));
      expect(r.status === 200 && r.b.periods.length === 1 && p && p.net_minor === 6000 && p.source === 'close' && !isNaN(Date.parse(p.closed_at)) && !/lodged_at/.test(JSON.stringify(r.b)), said(r));
      return said(r);
    });
  } finally { await pg.end(); }
  finish('GET /gst/lodged');
})().catch((e) => { console.error(e); process.exit(2); });

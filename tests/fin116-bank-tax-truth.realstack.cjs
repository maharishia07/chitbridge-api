'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/fin116-bank-tax-truth.realstack.cjs — FIN-116 on REAL Postgres, the api running as cb_app: a bank line's own tax on POST /api/books/events (kind expense) posts through the ONE posting engine,
 * and B5-03 (a credit from A$82.50 needs the person's word that the tax invoice is held) is the SERVER's rule too.
 *
 * owns: the proof the in-memory stand-in cannot give — the entry as Postgres stored it (journal_entry · journal_line, RLS on), each line's currency, Dr = Cr, and no entry for a refusal.
 * FLOW  fresh AU shop (GST regular, ABN, AUD), books on → POST /api/books/events → the lines read back with SELECT (nothing is written here).
 *   FT-1  fee 22.00 incl. 10% GST: amount 20.00 + input_tax_minor 200 → Dr 6090 bank charges 2000 · Dr 2210 GST paid 200 · Cr 1500 Bank 2200, all AUD, Dr = Cr (the bank's figure to the cent)
 *   FT-2  a repeat of the same client_ref answers duplicate:true and stores ONE entry
 *   FT-3  88.00 (80.00 + 8.00 GST, over A$82.50) with no word on the tax invoice: 422, no entry; with tax_invoice 'none': 422, no entry; with 'held': 200, 8000 · 800 · 8800
 *   FT-4  the edge is the pack's: gross 82.51 needs the word (422, no entry), gross 82.50 does not (200): "more than A$82.50" (business.gov.au, Athi 20 Nov)
 *   FT-5  money is a value type: a body that names a currency is refused (400/422) and nothing is stored; every stored line is the shop's own currency
 * CARD 16-finance/books
 * Run: API_BASE=http://127.0.0.1:<port> TRUTH_DB=<url> node tests/fin116-bank-tax-truth.realstack.cjs   ⚠️ LOCAL OR A NAMED SIT BOX ONLY (the harness refuses anything else). CI: the T2 loop.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;

const RUN = 'f116' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const DAY = shopDayAt(-1);
let pg = null, shop = null;

/** a bank charge as the Bank sheet sends it: the flat body, `amount_minor` the NET */
const fee = (ref, extra) => Object.assign({ kind: 'expense', class: 'bank_charges', date: DAY, amount_minor: 2000, narration: 'Monthly account fee', paid_from: 'bank', client_ref: RUN + ref }, extra);
const post = (body) => j('/api/books/events', { method: 'POST', token: shop.token, body });
/** the stored entry for a client_ref: its lines as [code, dr, cr, currency], line order (SELECT only) */
async function stored(ref) {
  const rows = (await pg.query(
    `SELECT a.code, l.dr_minor::bigint AS dr, l.cr_minor::bigint AS cr, l.currency FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id AND l.entity_id = e.entity_id
       JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id WHERE e.entity_id = $1 AND e.source_ref = $2 ORDER BY l.line_no`, [shop.entity, 'ev:expense:' + RUN + ref])).rows;
  return rows.map((r) => [r.code, Number(r.dr), Number(r.cr), r.currency]);
}
const sum = (lines, at) => lines.reduce((t, l) => t + l[at], 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log('\n══ FIN-116 · a bank line tax on real Postgres · ' + RUN + ' ══\n');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    shop = await freshShop(RUN, 'Bank tax', AU);
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');

    await kase('FT-1', 'a 22.00 AU fee (20.00 net + 200 tax) posts Dr 6090 20.00 · Dr 2210 2.00 · Cr 1500 22.00 in AUD, balanced', async () => {
      const r = await post(fee('a', { input_tax_minor: 200 }));
      expect(r.status === 200 && r.b.ok && !r.b.duplicate, 'post ' + JSON.stringify([r.status, r.b]));
      const lines = await stored('a');
      expect(same(lines, [['6090', 2000, 0, 'AUD'], ['2210', 200, 0, 'AUD'], ['1500', 0, 2200, 'AUD']]), 'lines ' + JSON.stringify(lines));
      expect(sum(lines, 1) === sum(lines, 2), 'Dr ' + sum(lines, 1) + ' vs Cr ' + sum(lines, 2));
      return JSON.stringify(lines);
    });

    await kase('FT-2', 'a repeat of the client_ref answers duplicate:true and stores one entry', async () => {
      const again = await post(fee('a', { input_tax_minor: 200 }));
      const n = Number((await pg.query('SELECT COUNT(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND source_ref = $2', [shop.entity, 'ev:expense:' + RUN + 'a'])).rows[0].n);
      expect(again.status === 200 && again.b.duplicate === true && n === 1, JSON.stringify([again.status, again.b]) + ' entries ' + n);
      return 'entries ' + n;
    });

    await kase('FT-3', '88.00 (over A$82.50): no word on the tax invoice 422, "none" 422, "held" posts 80.00 · 8.00 · 88.00', async () => {
      const big = (ref, extra) => fee(ref, Object.assign({ amount_minor: 8000, input_tax_minor: 800 }, extra));
      const bare = await post(big('b1')), none = await post(big('b2', { tax_invoice: 'none' }));
      expect(bare.status === 422 && none.status === 422, 'bare ' + bare.status + ' none ' + none.status + ' ' + JSON.stringify(bare.b));
      expect((await stored('b1')).length === 0 && (await stored('b2')).length === 0, 'a refusal stored an entry');
      const held = await post(big('b3', { tax_invoice: 'held' }));
      expect(held.status === 200 && held.b.ok, 'held ' + JSON.stringify([held.status, held.b]));
      const lines = await stored('b3');
      expect(same(lines.map((l) => l.slice(0, 3)), [['6090', 8000, 0], ['2210', 800, 0], ['1500', 0, 8800]]), 'lines ' + JSON.stringify(lines));
      return JSON.stringify(lines);
    });

    await kase('FT-4', 'the line is the pack line: gross 82.51 needs the word (422, nothing stored), gross 82.50 does not (200)', async () => {
      const at = (gross, ref) => post(fee(ref, { amount_minor: gross - 750, input_tax_minor: 750 }));
      const over = await at(8251, 'c1'), under = await at(8250, 'c2');
      expect(over.status === 422 && (await stored('c1')).length === 0, 'over ' + JSON.stringify([over.status, over.b]));
      expect(under.status === 200 && (await stored('c2')).length === 3, 'under ' + JSON.stringify([under.status, under.b]));
      return over.status + ' / ' + under.status;
    });

    await kase('FT-5', 'money is a value type: a body that names a currency is refused and nothing is stored; every stored line is AUD', async () => {
      const r = await post(fee('d', { input_tax_minor: 200, currency: 'USD' }));
      expect([400, 422].indexOf(r.status) >= 0 && (await stored('d')).length === 0, 'currency body ' + JSON.stringify([r.status, r.b]));
      const other = Number((await pg.query("SELECT COUNT(*)::int AS n FROM journal_line WHERE entity_id = $1 AND currency <> 'AUD'", [shop.entity])).rows[0].n);
      expect(other === 0, other + ' lines in another currency');
      return 'refused ' + r.status;
    });
  } finally {
    await pg.end();
  }
  finish('FIN-116 bank-line tax');
})().catch((e) => { console.error(e); process.exit(2); });

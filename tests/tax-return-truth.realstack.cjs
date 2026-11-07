'use strict';
/**
 * tests/tax-return-truth.realstack.cjs — RETURN TRUTH on the LOCAL stack (T2, real Postgres + RLS): ACC-270 — the SQL of tax-copy.copiesFor runs on a real database.
 *
 * Why: the unit test tests/acc-270-reversed-named.test.cjs models the SQL in memory (no database on a laptop), so only this file proves the as-at read, the
 * reversed-after-its-month arm and the no-entry arm PARSE, TYPE their parameters ($4 / $5) and answer under RLS.
 *   TR-01 GET /api/tax/ledger for the current month and the month before answers 200 with `reversed` and `not_in_books` arrays (every arm of the query ran)
 *   TR-02 a counter bill sent now is never silent: it is counted in `rows`, or named in `not_in_books` (a day-grain walk-in bill reads as not_in_books until the day closes)
 * Not here (said): the reversed-after-filed case itself needs a locked month and a back-dated reversal; the in-memory test holds that figure by figure.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/tax-return-truth.realstack.cjs   (one realstack file at a time; API_BASE / TRUTH_DB as the harness says)
 * CARD 15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, pause, kase, expect, bill, freshShop, finish } = H;
const RUN = 'tr' + (Date.now() % 1e10).toString(36);
const monthOf = (back) => {
  const day = new Date();
  day.setUTCDate(1);
  day.setUTCMonth(day.getUTCMonth() - back);
  return day.toISOString().slice(0, 7);
};

(async () => {
  console.log('\n── return truth (ACC-270) on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const shop = await freshShop(RUN + 'a', 'Return truth');
  ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
  const rice = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name: 'Rice ' + RUN, unit: 'kg', price: 60 } } }), 'product').b.item;
  const RICE = { id: rice.item_id, name: 'Rice ' + RUN, unit: 'kg', price: 60 };

  await kase('TR-01', 'the ledger of this month and of the month before answers with the two ACC-270 lists (every arm of the query ran on real SQL)', async () => {
    for (const back of [0, 1]) {
      const reply = ok(await j('/api/tax/ledger?month=' + monthOf(back), { token: shop.token }), 'ledger ' + monthOf(back));
      expect(Array.isArray(reply.b.reversed) && Array.isArray(reply.b.not_in_books), 'lists missing: ' + JSON.stringify(Object.keys(reply.b)));
    }
    return 'both months 200';
  });

  await kase('TR-02', 'a counter bill sent now is never silent: counted in rows, or named in not_in_books', async () => {
    const sent = ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: bill(RUN + '-B1', [[RICE, 1]]) }), 'counter bill').b;
    const chit = String(sent.chit_id || (sent.chit && sent.chit.chit_id));
    let seen = null;
    for (let tries = 0; tries < 20 && !seen; tries++) {
      const led = ok(await j('/api/tax/ledger?month=' + monthOf(0), { token: shop.token }), 'ledger').b;
      if ((led.rows || []).some((row) => String(row.chit_id) === chit)) seen = 'counted';
      else if ((led.not_in_books || []).some((item) => String(item.chit_id) === chit)) seen = 'named';
      else await pause(500);
    }
    expect(seen, 'the bill is in neither rows nor not_in_books: silent');
    return seen;
  });
  finish('tax-return-truth', process.env.TAX_RETURN_TRUTH_JSON);
})().catch((e) => { console.error('FAIL (threw): ' + (e && e.stack || e)); process.exit(1); });

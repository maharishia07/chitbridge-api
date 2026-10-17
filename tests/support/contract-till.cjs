/**
 * tests/support/contract-till.cjs — the read Reports › Trend makes (RPT2): GET /api/till/summary?compare=1, through the REAL routes/till.js over
 * one stubbed shop (tests/support/till-trend-stub.cjs). Used by tests/web-api-contract.test.cjs. Two answers on one path: `GET /api/till/summary`
 * (the plain summary the counter pages read: { period, rows, counters }) and `GET /api/till/summary #compare` (Reports › Trend). An Australian shop (July year) with 24 months of summaries, a
 * week tab with none (every slot null - never 0), and the refusal the page branches on (`code` NO_COUNTRY).
 */
'use strict';
const T = require('./till-trend-stub.cjs');

async function captureTill() {
  const got = {};
  const keep = (r, plain) => { let k = 'GET /api/till/summary' + (plain ? '' : ' #compare'); if (got[k] && got[k].status !== r.status) k += '-' + r.status; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.json); return r; };
  const srv = T.start();
  try {
    T.S.shop = { country: 'AU', currency_code: 'AUD', books: null, gov: null };
    for (let k = 1; k <= 24; k++) T.S.rows.month.push(T.sumRow('month', T.monthsBack(k), k <= 12 ? 1100 : 1000, T.daysOf(T.monthsBack(k))));
    keep(await srv.get('compare=1&period=month'));
    keep(await srv.get('compare=1&period=quarter&n=8'));
    keep(await srv.get('compare=1&period=week'));
    keep(await srv.get('period=month&limit=3'), true);
    T.S.shop = { country: null, currency_code: null, books: null, gov: null };
    keep(await srv.get('compare=1&period=month'));
  } finally { srv.stop(); }
  return got;
}
module.exports = { captureTill };

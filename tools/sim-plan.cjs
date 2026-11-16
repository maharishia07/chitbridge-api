/**
 * tools/sim-plan.cjs — THE ONE PLAN OF A SIMULATED SHOP'S DAYS (round Y1b).
 *
 * tools/simulate-years.cjs (Y1, in memory) and tools/sim-load.cjs (Y1b, a real database) must agree on what the shop did:
 * how many bills a day, at which rate, paid how; which days a purchase came, which days money went out. Both read THIS
 * plan, so "bills count = the simulator's" is a fact of one function, never two scripts that happen to match.
 *
 * Deterministic per seed: the same seed gives the same days, in the same order, every run. Amounts are in RUPEES
 * (the posting engine's event shape — books.js turns them into minor units with the one rounder).
 *
 *   planDays({ start: '2026-04-01', years: 3, seed: 7 }) → { start, last, days: [{ day, sales: [{ rate, taxable, how }],
 *                                                            purchase: { taxable, paid_bank } | null, expense: { class, amount } | null, rent: boolean }] }
 
 * CALLED BY tools/sim-load.cjs, tools/simulate-years.cjs   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
'use strict';

/** a small seeded generator (mulberry32) — the one simulate-years.cjs has used since Y1 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dayAdd = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);

const RATES = [5, 12, 18];
const MODES = ['cash', 'cash', 'upi', 'upi', 'credit'];
const EXPENSES = ['fuel', 'rent', 'fuel'];

function planDays(opt) {
  const o = opt || {};
  const START = o.start || '2026-04-01',
    YEARS = Number(o.years || 3),
    SEED = Number(o.seed == null ? 7 : o.seed);
  const LAST = dayAdd(
    +START.slice(0, 4) + YEARS + START.slice(4),
    -1
  ); /* the day before the start's anniversary: an April year ends 31 March, a July year (AU) 30 June */
  const rnd = rng(SEED),
    pick = (a) => a[Math.floor(rnd() * a.length)],
    between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  /* a sale: the rate first, then the taxable amount — the draw order Y1 proved with (do not reorder: the seed's days would change) */
  const sale = (rate) => {
    const taxable = between(2, 60) * 100,
      half = (taxable * rate) / 100 / 2;
    return { rate, taxable, half, total: taxable + half * 2 };
  };
  const days = [];
  let day = START;
  while (day <= LAST) {
    const row = { day, sales: [], purchase: null, expense: null, rent: day.slice(8) === '05' };
    const nSales = between(2, 4);
    for (let index = 0; index < nSales; index++) {
      const s = sale(pick(RATES));
      row.sales.push({ rate: s.rate, taxable: s.taxable, how: pick(MODES) });
    }
    if (rnd() < 0.34) {
      const p = sale(18);
      row.purchase = { taxable: p.taxable, paid_bank: rnd() < 0.5 };
    }
    if (rnd() < 0.5) row.expense = { class: pick(EXPENSES), amount: between(1, 20) * 50 };
    days.push(row);
    day = dayAdd(day, 1);
  }
  return { start: START, last: LAST, years: YEARS, seed: SEED, days };
}

/** the counts a loader must reproduce: bills, purchases, expenses (rent included), days */
function countOf(plan) {
  const c = { days: plan.days.length, bills: 0, credit_bills: 0, purchases: 0, expenses: 0 };
  for (const d of plan.days) {
    c.bills += d.sales.length;
    c.credit_bills += d.sales.filter((item) => item.how === 'credit').length;
    if (d.purchase) c.purchases++;
    if (d.expense) c.expenses++;
    if (d.rent) c.expenses++;
  }
  return c;
}

/**
 * MIS showcase step 1: the same plan shape for a back-dated HISTORY of whole months from a data file (tools/seed/mis-history.json), `months` of it from its `start`.
 * No random draw: every day has ONE walk-in takings figure (the month's daily_ex_gst), so a month's total is hand-computable (days x daily x 1.1 + the inclusive sale).
 *   historyDays(table, months) → { start, last, months, days: [{ day, walkin: taxable, inclusive: { total, taxable } | null, reversed: { taxable } | null, rent: amount | null }] }
 */
const cents = (n) => Math.round(n * 100);
function historyDays(table, months) {
  const keys = Object.keys(table.daily_ex_gst);
  const n = Number(months || keys.length);
  if (!(n >= 1 && n <= keys.length)) throw new Error('months is 1..' + keys.length + ' (the data file holds ' + keys.length + ')');
  if (keys[0] !== table.start.slice(0, 7)) throw new Error('the data file must begin in its start month');
  const rate = table.gst_rate,
    days = [];
  for (const key of keys.slice(0, n)) {
    const length = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5), 0)).getUTCDate();
    for (let d = 1; d <= length; d++) {
      const row = { day: key + '-' + String(d).padStart(2, '0'), walkin: table.daily_ex_gst[key], inclusive: null, reversed: null, rent: null };
      if (d === table.inclusive_sale.day) {
        const total = table.inclusive_sale.price_incl_gst;
        row.inclusive = { total, taxable: Math.round((total * 100) / (1 + rate / 100)) / 100 }; /* the price the customer saw includes GST; the books split it */
      }
      if (d === table.reversed_sale.day) row.reversed = { taxable: table.reversed_sale.taxable };
      if (d === table.rent.day) row.rent = table.rent.amount;
      days.push(row);
    }
  }
  return { start: table.start, last: days[days.length - 1].day, months: n, days };
}
/** what the books must hold per month, in whole cents (integer sums; no float drift): { 'YYYY-MM': { sold, net, gst, rent, entries } } — SOLD is tax-inclusive, the reversed sale is in none of it */
function historyExpect(plan, rate) {
  const out = {};
  for (const d of plan.days) {
    const m = out[d.day.slice(0, 7)] || (out[d.day.slice(0, 7)] = { sold: 0, net: 0, gst: 0, rent: 0, entries: 0 });
    const gst = Math.round((cents(d.walkin) * rate) / 100);
    m.net += cents(d.walkin);
    m.gst += gst;
    m.sold += cents(d.walkin) + gst;
    m.entries += 1;
    if (d.inclusive) {
      m.net += cents(d.inclusive.taxable);
      m.gst += cents(d.inclusive.total) - cents(d.inclusive.taxable);
      m.sold += cents(d.inclusive.total);
      m.entries += 1;
    }
    if (d.reversed) m.entries += 2; /* the sale and its reversal: posted, then cancelled out */
    if (d.rent) {
      m.rent += cents(d.rent);
      m.entries += 1;
    }
  }
  return out;
}

module.exports = { rng, planDays, countOf, dayAdd, RATES, historyDays, historyExpect };

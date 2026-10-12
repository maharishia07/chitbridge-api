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
 */
'use strict';

/** a small seeded generator (mulberry32) — the one simulate-years.cjs has used since Y1 */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const dayAdd = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);

const RATES = [5, 12, 18];
const MODES = ['cash', 'cash', 'upi', 'upi', 'credit'];
const EXPENSES = ['fuel', 'rent', 'fuel'];

function planDays(opt) {
  const o = opt || {};
  const START = o.start || '2026-04-01', YEARS = Number(o.years || 3), SEED = Number(o.seed == null ? 7 : o.seed);
  const LAST = (+START.slice(0, 4) + YEARS) + '-03-31';
  const rnd = rng(SEED), pick = (a) => a[Math.floor(rnd() * a.length)], between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  /* a sale: the rate first, then the taxable amount — the draw order Y1 proved with (do not reorder: the seed's days would change) */
  const sale = (rate) => { const taxable = between(2, 60) * 100, half = taxable * rate / 100 / 2; return { rate, taxable, half, total: taxable + half * 2 }; };
  const days = [];
  let day = START;
  while (day <= LAST) {
    const row = { day, sales: [], purchase: null, expense: null, rent: day.slice(8) === '05' };
    const nSales = between(2, 4);
    for (let i = 0; i < nSales; i++) { const s = sale(pick(RATES)); row.sales.push({ rate: s.rate, taxable: s.taxable, how: pick(MODES) }); }
    if (rnd() < 0.34) { const p = sale(18); row.purchase = { taxable: p.taxable, paid_bank: rnd() < 0.5 }; }
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
    c.bills += d.sales.length; c.credit_bills += d.sales.filter((s) => s.how === 'credit').length;
    if (d.purchase) c.purchases++;
    if (d.expense) c.expenses++;
    if (d.rent) c.expenses++;
  }
  return c;
}

module.exports = { rng, planDays, countOf, dayAdd, RATES };

/*
 * OWNS      the one plan of a simulated shop days: bills per day, rates, payment mix, purchase and payout days
 * CALLED BY tools/simulate-years.cjs, tools/sim-load.cjs, tests/sim-load.test.cjs
 * FLOW      a pure function from the seed to the plan; both simulators read the same plan
 * CARD      28-platform-and-operations/load-simulation
 */
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
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
/** a day (YYYY-MM-DD) moved by a number of days, in UTC */
const dayAdd = (dayText, count) => new Date(Date.parse(dayText + 'T00:00:00Z') + count * 86400000).toISOString().slice(0, 10);

const RATES = [5, 12, 18];
const MODES = ['cash', 'cash', 'upi', 'upi', 'credit'];
const EXPENSES = ['fuel', 'rent', 'fuel'];

/** the plan of a simulated shop: one row per day from `start` for `years` years, drawn from the seed (the draw order is the plan: do not reorder) */
function planDays(opt) {
  const options = opt || {};
  const START = options.start || '2026-04-01',
    YEARS = Number(options.years || 3),
    SEED = Number(options.seed == null ? 7 : options.seed);
  const LAST = dayAdd(
    +START.slice(0, 4) + YEARS + START.slice(4),
    -1
  ); /* the day before the start's anniversary: an April year ends 31 March, a July year (AU) 30 June */
  const rnd = rng(SEED),
    pick = (list) => list[Math.floor(rnd() * list.length)],
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
    const salesToday = between(2, 4);
    for (let index = 0; index < salesToday; index++) {
      const drawn = sale(pick(RATES));
      row.sales.push({ rate: drawn.rate, taxable: drawn.taxable, how: pick(MODES) });
    }
    if (rnd() < 0.34) {
      const bought = sale(18);
      row.purchase = { taxable: bought.taxable, paid_bank: rnd() < 0.5 };
    }
    if (rnd() < 0.5) row.expense = { class: pick(EXPENSES), amount: between(1, 20) * 50 };
    days.push(row);
    day = dayAdd(day, 1);
  }
  return { start: START, last: LAST, years: YEARS, seed: SEED, days };
}

/** the counts a loader must reproduce: bills, purchases, expenses (rent included), days */
function countOf(plan) {
  const counts = { days: plan.days.length, bills: 0, credit_bills: 0, purchases: 0, expenses: 0 };
  for (const row of plan.days) {
    counts.bills += row.sales.length;
    counts.credit_bills += row.sales.filter((item) => item.how === 'credit').length;
    if (row.purchase) counts.purchases++;
    if (row.expense) counts.expenses++;
    if (row.rent) counts.expenses++;
  }
  return counts;
}

/**
 * MIS showcase: the same plan shape for a back-dated HISTORY of whole months from a data file (tools/seed/mis-history.json, 26 months · mis-history-84.json, 84), `months` of it from its `start`.
 * No random draw: every day has ONE walk-in takings figure (the month's daily_ex_gst x the shop profile's scale, whole dollars), so a month's total is hand-computable
 * (days x daily x 1.1 + the inclusive sale). A PROFILE (tools/seed/mis-profiles.json) varies the shop: size, trade mix (cost of goods, suppliers), a slide, how fast it pays.
 *   historyDays(table, months, profile) → { start, last, months, profile, days: [{ day, walkin: taxable, inclusive, reversed, rent, buys: [{ s, taxable }], pays: [{ s, cents }], receipt: cents | null }], owing: { ap: [cents per supplier], ar: cents } }
 * PURCHASES: each month supplier s bills on day 6 + 7s (cost_pct of the month's walk-in takings, split evenly, whole dollars); on day 27 the shop pays pay_ratio of the
 * bills 30+ days old (oldest first); the customer pays cust_ratio of what it owes on day 25, except in the last two months (left open). What is left is `owing`.
 */
const cents = (amount) => Math.round(amount * 100);
const DEFAULT_PROFILE = { scale: 1, slide_pct: 0, cost_pct: 55, suppliers: ['Harbour Wholesale', 'Southern Supplies'], pay_ratio: 1, cust_ratio: 1 };
const sumOf = (list) => list.reduce((left, right) => left + right, 0);

/** one month's daily walk-in takings: the table's figure x the profile's scale; a struggling shop slides slide_pct a year over its last two years */
function dailyTakings(table, prof, key, index, count) {
  return Math.max(1, Math.round(table.daily_ex_gst[key] * prof.scale * (1 - (prof.slide_pct / 100) * (Math.max(0, index - (count - 24)) / 12))));
}

/** the tax-inclusive sale: the price the customer saw includes GST; the books split it into taxable + GST */
function inclusiveSaleOf(table, rate) {
  const total = table.inclusive_sale.price_incl_gst;
  return { total, taxable: Math.round((total * 100) / (1 + rate / 100)) / 100 };
}

/** supplier `supplier`'s bill on its day: the row's buy, and the bill's gross (cents) joins that supplier's open bills */
function supplierBuy(state, spec) {
  const { prof, rate, row, supplier, daily, length } = spec;
  const taxable = Math.max(1, Math.round((daily * length * prof.cost_pct) / 100 / prof.suppliers.length));
  row.buys.push({ s: supplier, taxable });
  state.bills[supplier].push({ day: row.day, left: cents(taxable) + Math.round((cents(taxable) * rate) / 100) });
}

/** day 27: the shop pays pay_ratio of the supplier's bills 30+ days old, oldest first */
function supplierPayment(state, prof, row, supplier) {
  const eligible = state.bills[supplier].filter((bill) => bill.left > 0 && dayAdd(bill.day, 30) <= row.day);
  let remaining = Math.round(sumOf(eligible.map((bill) => bill.left)) * prof.pay_ratio);
  if (!(remaining > 0)) return;
  row.pays.push({ s: supplier, cents: remaining });
  for (const bill of eligible) {
    const take = Math.min(bill.left, remaining);
    bill.left -= take;
    remaining -= take;
  }
}

/** day 25: the credit customer pays cust_ratio of what it owes, oldest sale first */
function customerReceipt(state, prof, row) {
  let remaining = Math.round(sumOf(state.owed) * prof.cust_ratio);
  if (!(remaining > 0)) return;
  row.receipt = remaining;
  for (let slot = 0; slot < state.owed.length && remaining > 0; slot++) {
    const take = Math.min(state.owed[slot], remaining);
    state.owed[slot] -= take;
    remaining -= take;
  }
}

/** one day of the history: the fixed sales and rent of the data file, then each supplier's bill (day 6 + 7s) and payment (day 27), then the customer's receipt (day 25, not in the last two months) */
function historyRow(table, prof, state, spec) {
  const { key, dayNo, daily, length, index, count } = spec;
  const rate = table.gst_rate;
  const row = { day: key + '-' + String(dayNo).padStart(2, '0'), walkin: daily, inclusive: null, reversed: null, rent: null, buys: [], pays: [], receipt: null };
  if (dayNo === table.inclusive_sale.day) {
    row.inclusive = inclusiveSaleOf(table, rate);
    state.owed.push(cents(row.inclusive.total));
  }
  if (dayNo === table.reversed_sale.day) row.reversed = { taxable: table.reversed_sale.taxable };
  if (dayNo === table.rent.day) row.rent = table.rent.amount;
  prof.suppliers.forEach((name, supplier) => {
    if (dayNo === 6 + 7 * supplier) supplierBuy(state, { prof, rate, row, supplier, daily, length });
    if (dayNo === 27) supplierPayment(state, prof, row, supplier);
  });
  if (dayNo === 25 && index <= count - 3) customerReceipt(state, prof, row);
  return row;
}

function historyDays(table, months, profile) {
  const keys = Object.keys(table.daily_ex_gst);
  const count = Number(months || keys.length);
  if (!(count >= 1 && count <= keys.length)) throw new Error('months is 1..' + keys.length + ' (the data file holds ' + keys.length + ')');
  if (keys[0] !== table.start.slice(0, 7)) throw new Error('the data file must begin in its start month');
  const prof = Object.assign({}, DEFAULT_PROFILE, profile || {}),
    days = [],
    state = { bills: prof.suppliers.map(() => []) /* per supplier [{ day, left }]: the bill's gross in cents, what is still owed */, owed: [] }; /* owed: the customer's open sales, cents */
  keys.slice(0, count).forEach((key, index) => {
    const length = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5), 0)).getUTCDate();
    const daily = dailyTakings(table, prof, key, index, count);
    for (let dayNo = 1; dayNo <= length; dayNo++) days.push(historyRow(table, prof, state, { key, dayNo, daily, length, index, count }));
  });
  return { start: table.start, last: days[days.length - 1].day, months: count, profile: prof, days, owing: { ap: state.bills.map((list) => sumOf(list.map((bill) => bill.left))), ar: sumOf(state.owed) } };
}

/** one day's entries in the month's sums: net, GST and SOLD (tax-inclusive) of the walk-in and the inclusive sale, rent, purchases, and the entry count */
function addDayExpect(month, row, rate) {
  const gst = Math.round((cents(row.walkin) * rate) / 100);
  month.net += cents(row.walkin);
  month.gst += gst;
  month.sold += cents(row.walkin) + gst;
  month.entries += 1;
  if (row.inclusive) {
    month.net += cents(row.inclusive.taxable);
    month.gst += cents(row.inclusive.total) - cents(row.inclusive.taxable);
    month.sold += cents(row.inclusive.total);
    month.entries += 1;
  }
  if (row.reversed) month.entries += 2; /* the sale and its reversal: posted, then cancelled out */
  if (row.rent) {
    month.rent += cents(row.rent);
    month.entries += 1;
  }
  for (const buy of row.buys) {
    month.buys += cents(buy.taxable);
    month.buys_gst += Math.round((cents(buy.taxable) * rate) / 100);
    month.entries += 1;
  }
  month.entries += row.pays.length + (row.receipt ? 1 : 0);
}

/** what the books must hold per month, in whole cents (integer sums; no float drift): { 'YYYY-MM': { sold, net, gst, rent, buys, buys_gst, entries } } — SOLD is tax-inclusive, the reversed sale is in none of it */
function historyExpect(plan, rate) {
  const out = {};
  for (const row of plan.days) {
    const month = out[row.day.slice(0, 7)] || (out[row.day.slice(0, 7)] = { sold: 0, net: 0, gst: 0, rent: 0, buys: 0, buys_gst: 0, entries: 0 });
    addDayExpect(month, row, rate);
  }
  return out;
}

module.exports = { rng, planDays, countOf, dayAdd, RATES, historyDays, historyExpect, DEFAULT_PROFILE };

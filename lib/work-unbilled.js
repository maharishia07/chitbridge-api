/**
 * work-unbilled.js — the unbilled-orders sum of the worklist (a part of work-rows.js, split out to keep its size row)
 * OWNER     cb-orders (the worklist) with cb-finance (what Finance shows beside what is owed)
 * RISK      money (a figure shown beside what is owed; a wrong sum misleads)
 * OWNS      the value an order is picked at (pickValue) · the ONE "not billed" test (unbilledItems) · the sum per currency (sumUnbilled) · the cost-blind partial rule (blindSum)
 * CALLED BY lib/work-rows.js (unbilledOf · unbilledByParty · the row total_minor)
 * FLOW      open orders in ──▶ marks read once (open-orders MARKS_SQL) ──▶ unbilledItems ──▶ sumUnbilled ──▶ (a blind reader: blindSum)
 * CARD      02-tasks-orders-and-workflow/everyones-work
 */
'use strict';
const { readBatch } = require('../db');
const money = require('./money');
const openOrders = require('./open-orders');

const pickValue = (r) => [r.value, r.alt_value].find((item) => item != null && Number(item) > 0);

/**
 * RAIL-146b/146e · a blind reader's unbilled figure for some orders: the sum stands only when EVERY order in it is the reader's sale (`sides` is workSides over the same orders);
 * else the money is null and cost_hidden:true (never a plausible wrong sum). The Home figure and each party on the Parties list ask this same rule.
 */
function blindSum(left, sides, minorOf) {
  const sums = sumUnbilled(left, minorOf);
  if (left.every((x) => sides.get(String(x.r.chit_id)) === 'sell')) return sums;
  return { n: sums.n, minor: null, currency: sums.currency, cost_hidden: true };
}

/** the open orders in that no bill names yet — the ONE "not billed" test (open-orders' MARKS_SQL), one batched read */
async function unbilledItems(ctx, items) {
  const open = items.filter((x) => x.tab === 'orders_in');
  if (!open.length) return [];
  const [marks] = await readBatch(ctx.entity, ctx.actor, [{ text: openOrders.MARKS_SQL, params: [ctx.entity, open.map((x) => String(x.r.chit_id))] }]);
  const billed = openOrders.marksFrom(marks.rows).billed;
  return open.filter((x) => !billed.has(String(x.r.chit_id)));
}

/**
 * { n, minor, currency, by_currency, no_currency, unpriced } of some unbilled orders (CRM-D7): the ONE sum, over lib/money summarise (integer minor units in, integers out).
 * by_currency [{ currency, minor, n }] is one bucket per currency, biggest first (DISPLAY order only, never a comparison of unlike units); money is never added across two.
 * minor/currency keep the old single-figure shape: the bucket's own when there is exactly one; minor null, currency null when two or more. An order with NO currency is counted in n
 * and in no_currency, its money left OUT (never given the reader's currency; this CHANGES the old answer, which called [INR, none] two currencies). An order with a currency but no
 * value is counted in unpriced and adds nothing (never a wrong 0): a party with orders but no priced one answers minor null (count alone).
 */
function sumUnbilled(left, minorOf) {
  const sum = money.summarise(left.map((x) => ({ currency: x.r.currency || null, value: minorOf(pickValue(x.r), x.r.currency || null) })));
  const by_currency = sum.by_currency.map((bucket) => ({ currency: bucket.currency, minor: bucket.total, n: bucket.chits }));
  const single = by_currency.length === 1 ? by_currency[0] : null;
  const minor = single ? single.minor : by_currency.length || left.length ? null : 0;
  return { n: left.length, minor, currency: single ? single.currency : null, by_currency, no_currency: sum.excluded.non_monetary, unpriced: sum.excluded.awaiting_agreement };
}

module.exports = { pickValue, sumUnbilled, blindSum, unbilledItems };

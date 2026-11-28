'use strict';
/**
 * lib/usage-read.js — the ONE read of a shop's usage_ledger for GET /api/entities/usage (drift 15, 28 Nov 2026).
 * OWNER     finance (cb-finance) · money gate cb-security
 * RISK      money · access
 * OWNS      readUsage(c, shop, days, hideMoney) · answerOf(out, days, hideMoney): the shop's rows, never the asking person's; a seat the books refuse gets counts and no cost
 * CALLED BY routes/entities.js GET /usage
 * FLOW      shop id (auth.entityOf) ──▶ three reads bound to the SHOP ──▶ answerOf: owner bytes as before · refused seat: every cost null + cost_hidden:true, rows ordered by events, meta dropped
 * CARD      16-finance/plan-and-usage
 * ⭐ ONE READ PATH: an owner, a manager, a cashier and a view-only seat read the same ledger (it was the person's own id for an actor: 605 for the owner, 0 for the cashier). Roles restrict cost, never the count.
 */
/** the three reads, all bound to `shop` (an actor's own identity id never reaches usage_ledger) */
async function readUsage(c, shop, days, hideMoney) {
  const window = `entity_id = $1 AND created_at > now() - ($2 || ' days')::interval`;
  const daily = await c.query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS events, COALESCE(sum(cost_usd), 0)::numeric(12,4) AS cost
       FROM usage_ledger WHERE ${window} GROUP BY 1 ORDER BY 1 DESC`,
    [shop, String(days)]
  );
  const byMeter = await c.query(
    `SELECT meter, count(*)::int AS events, COALESCE(sum(quantity), 0)::bigint AS quantity, COALESCE(sum(cost_usd), 0)::numeric(12,4) AS cost
       FROM usage_ledger WHERE ${window} GROUP BY 1 ORDER BY ${hideMoney ? 'events DESC, meter' : 'cost DESC, events DESC'}`,
    [shop, String(days)]
  );
  const recent = await c.query('SELECT meter, detail, quantity, cost_usd, meta, created_at FROM usage_ledger WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 100', [shop]);
  return { daily: daily.rows, by_meter: byMeter.rows, recent: recent.rows };
}
/** the response body: the owner's bytes unchanged; for a seat the books refuse, no cost figure survives anywhere (null + cost_hidden:true) */
function answerOf(out, days, hideMoney) {
  const total = out.by_meter.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const body = {
    ok: true,
    window_days: days,
    counts: { billed: out.by_meter.reduce((sum, item) => sum + Number(item.events || 0), 0) },
    total_cost_usd: Math.round(total * 10000) / 10000,
    rate_card: require('./rates').CARD.id,
    daily: out.daily,
    by_meter: out.by_meter,
    recent: out.recent
  };
  if (!hideMoney) return body;
  return Object.assign(body, {
    total_cost_usd: null,
    cost_hidden: true,
    rate_card: null,
    daily: out.daily.map((row) => Object.assign({}, row, { cost: null })),
    by_meter: out.by_meter.map((row) => Object.assign({}, row, { cost: null })),
    recent: out.recent.map((row) => Object.assign({}, row, { cost_usd: null, meta: null }))
  });
}
module.exports = { readUsage, answerOf };

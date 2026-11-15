'use strict';
// OWNS      the firm's practice rule: the starting thresholds (ONE object) and the status of a client from its own books' figures · the action count of a row · the band's counts.
// CALLED BY lib/books-practice.js (the one read GET /api/books-grants/practice) · tests/practice-health.test.cjs
// FLOW      figures read from the client's books (lib/books-practice) → statusOf(figures, RULE) → { status, reasons[] } · actionOf(row) · bandOf(rows)
// CARD      04-network/ACC-176-AUDITOR-GRANT
/**
 * ⭐ THE THRESHOLDS LIVE HERE, IN ONE PLACE, and travel in the answer (`rule`) so the screen states the rule it applied. They are OUR STARTING RULE: no accounting-practice standard sets them
 *   (Xero HQ client insights shows the figures and no verdict: https://www.xero.com/au/xero-hq/client-insights). A firm-editable copy is a GOV setting (cb-settings, needs a migration): follow-up, not here.
 * ⭐ NOTHING OF THE BOOKS IS RECOMPUTED HERE: figures arrive as the books' own stored sums; this file only compares them with the rule and says why.
 */
const RULE = {
  source: 'our starting rule, the firm can change it',
  help: { cash_days_below: 30, sales_down_pct: 20, loss_months_running: 2 },
  watch: { sales_down_pct: 10, receivables_over60_share_pct: 25, loss_this_quarter: true }
};
const WORDS = { good: 'Doing well', watch: 'Watch', help: 'Needs help', none: 'Not enough books yet' };
const ORDER = { help: 0, watch: 1, good: 2, none: 3 };

/** statusOf(f, rule) → { status: good|watch|help|none, reasons: [short words] }; an unknown figure (null) never triggers a rule and never reads as fine: with nothing known the status is `none` */
function statusOf(f, rule) {
  const r = rule || RULE;
  const help = [], watch = [];
  const known = [f.sales_trend_pct, f.cash_days, f.loss_months_running, f.profit_quarter_minor, f.receivables_over60_share_pct].some((x) => x !== null && x !== undefined);
  if (!known) return { status: 'none', reasons: ['no figures yet'] };
  if (f.cash_days != null && f.cash_days < r.help.cash_days_below) help.push('cash ' + Math.max(0, Math.floor(f.cash_days)) + ' days');
  if (f.sales_trend_pct != null && f.sales_trend_pct <= -r.help.sales_down_pct) help.push('sales ' + Math.round(f.sales_trend_pct) + '%');
  else if (f.sales_trend_pct != null && f.sales_trend_pct <= -r.watch.sales_down_pct) watch.push('sales ' + Math.round(f.sales_trend_pct) + '%');
  if (f.loss_months_running != null && f.loss_months_running >= r.help.loss_months_running) help.push('loss ' + f.loss_months_running + ' months');
  else if (r.watch.loss_this_quarter && f.profit_quarter_minor != null && f.profit_quarter_minor < 0) watch.push('loss this quarter');
  if (f.receivables_over60_share_pct != null && f.receivables_over60_share_pct >= r.watch.receivables_over60_share_pct) watch.push('late debtors ' + Math.round(f.receivables_over60_share_pct) + '%');
  if (help.length) return { status: 'help', reasons: help.concat(watch) };
  if (watch.length) return { status: 'watch', reasons: watch };
  return { status: 'good', reasons: [] };
}
/** the work a client still needs from the firm: open queries waiting on us, unlocked months with entries, a return due within 30 days, entries not yet checked, access ending within 30 days (one count, the sort key) */
function actionOf(row) {
  return (row.queries.on_us || 0) + (row.months_unlocked || 0) + (row.bas.due_in_days != null && row.bas.due_in_days <= 30 ? 1 : 0) + ((row.checked.of || 0) > (row.checked.n || 0) ? 1 : 0) + (row.bank.state === 'unexplained' ? 1 : 0) + (row.grant.ends_in_days != null && row.grant.ends_in_days <= 30 ? 1 : 0);
}
/** a share of a whole as a percentage with one decimal; null when there is no whole to take a share of */
const shareOf = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);
/** the default order: Needs help first, then most action, then name */
const byUrgency = (a, b) => ORDER[a.health.status] - ORDER[b.health.status] || b.action_count - a.action_count || String(a.name).localeCompare(String(b.name));
/** the practice band: one count per thing, each the size of the filter it opens in the list below */
function bandOf(rows) {
  const n = (test) => rows.filter(test).length;
  const sum = (pick) => {
    let count = 0;
    for (const r of rows) count += pick(r) || 0;
    return count;
  };
  return {
    clients: rows.length,
    queries: { clients: n((r) => r.queries.open > 0), on_client: sum((r) => r.queries.on_client), on_us: sum((r) => r.queries.on_us) },
    bas_due_30: n((r) => r.bas.due_in_days != null && r.bas.due_in_days <= 30),
    months_unlocked: n((r) => r.months_unlocked > 0),
    checked: { n: sum((r) => r.checked.n), of: sum((r) => r.checked.of), clients_behind: n((r) => (r.checked.of || 0) > (r.checked.n || 0)) },
    grants_ending_30: n((r) => r.grant.ends_in_days != null && r.grant.ends_in_days <= 30),
    health: { good: n((r) => r.health.status === 'good'), watch: n((r) => r.health.status === 'watch'), help: n((r) => r.health.status === 'help'), none: n((r) => r.health.status === 'none') },
    bank: { unexplained: n((r) => r.bank.state === 'unexplained'), no_statement: n((r) => r.bank.state === 'none'), reconciled: n((r) => r.bank.state === 'reconciled') }
  };
}
module.exports = { RULE, WORDS, statusOf, actionOf, byUrgency, bandOf, shareOf };

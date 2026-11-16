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
  help: { cash_days_below: 30, sales_down_pct: 20, loss_months_running: 2, receivables_over60_share_pct: 50 },
  watch: { sales_down_pct: 10, receivables_over60_share_pct: 25, loss_this_quarter: true }
};
/** the sales trend compares the last closed month with the 2 or 3 months before it (`sales_trend_months` says which); under this many prior months there is no trend and the row says so */
const TREND_MIN_MONTHS = 2;
const WORDS = { good: 'Doing well', watch: 'Watch', help: 'Needs help', none: 'Not enough books yet' };
const ORDER = { help: 0, watch: 1, good: 2, none: 3 };

/** statusOf(f, rule) → { status: good|watch|help|none, reasons: [short words], codes: [cash_low|sales_down|loss|late_debtors] } (the page branches on `codes`, never on a sentence); an unknown figure (null) never triggers a rule and never reads as fine: with nothing known the status is `none` */
function statusOf(f, rule) {
  const r = rule || RULE;
  const help = [], watch = [], codes = [];
  const known = [f.sales_trend_pct, f.cash_days, f.loss_months_running, f.profit_quarter_minor, f.receivables_over60_share_pct].some((x) => x !== null && x !== undefined);
  if (!known) return { status: 'none', reasons: ['no figures yet'], codes: [] };
  if (f.cash_days != null && f.cash_days < r.help.cash_days_below) { help.push('cash ' + Math.max(0, Math.floor(f.cash_days)) + ' days'); codes.push('cash_low'); }
  const down = 'sales down ' + Math.abs(Math.round(f.sales_trend_pct)) + '% on the ' + (f.sales_trend_months || 3) + ' months before';
  if (f.sales_trend_pct != null && f.sales_trend_pct <= -r.help.sales_down_pct) { help.push(down); codes.push('sales_down'); }
  else if (f.sales_trend_pct != null && f.sales_trend_pct <= -r.watch.sales_down_pct) { watch.push(down); codes.push('sales_down'); }
  if (f.loss_months_running != null && f.loss_months_running >= r.help.loss_months_running) { help.push('loss ' + f.loss_months_running + ' months'); codes.push('loss'); }
  else if (r.watch.loss_this_quarter && f.profit_quarter_minor != null && f.profit_quarter_minor < 0) { watch.push('loss this quarter'); codes.push('loss'); }
  const late = 'late debtors ' + Math.round(f.receivables_over60_share_pct) + '%';
  if (f.receivables_over60_share_pct != null && f.receivables_over60_share_pct >= r.help.receivables_over60_share_pct) { help.push(late); codes.push('late_debtors'); }
  else if (f.receivables_over60_share_pct != null && f.receivables_over60_share_pct >= r.watch.receivables_over60_share_pct) { watch.push(late); codes.push('late_debtors'); }
  /* unknown is shown, never hidden: no trend because of too little history says so and moves no class */
  const unknown = f.sales_trend_pct == null && f.sales_trend_months != null && f.sales_trend_months < TREND_MIN_MONTHS ? ['sales trend: under ' + TREND_MIN_MONTHS + ' months of history'] : [];
  if (help.length) return { status: 'help', reasons: help.concat(watch, unknown), codes };
  if (watch.length) return { status: 'watch', reasons: watch.concat(unknown), codes };
  return { status: 'good', reasons: unknown, codes };
}
/** the work a client still needs from the firm: open queries waiting on us, unlocked months with entries, a return due within 30 days, entries not yet checked, access ending within 30 days (one count, the sort key) */
function actionOf(row) {
  return (row.queries.on_us || 0) + (row.months_unlocked || 0) + (row.bas.due_in_days != null && row.bas.due_in_days <= 30 ? 1 : 0) + ((row.checked.of || 0) > (row.checked.n || 0) ? 1 : 0) + (row.bank.state === 'unexplained' ? 1 : 0) + (row.grant.ends_in_days != null && row.grant.ends_in_days <= 30 ? 1 : 0);
}
/** a share of a whole as a percentage with one decimal; null when there is no whole to take a share of */
const shareOf = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);
/** the default order: Needs help first, then most action, then name */
const byUrgency = (a, b) => ORDER[a.health.status] - ORDER[b.health.status] || b.action_count - a.action_count || String(a.name).localeCompare(String(b.name));
/** REP-73: the last financial year that has ended before `today`, from the client's month rows (fiscal_year + period + end_date + status) and its bank state.
 *  Complete = books.monthsNotLocked is 0 over the FY (soft or hard lock) AND the bank is reconciled with reconciled_to on or after the FY end. A client with fewer than 12 month rows in that FY is first_year: not Complete, no blocker.
 *  null when no FY has ended (or no rows): the stage then has no input and is not drawn. `lodged` and `reason` arrive with past-years (howClosed); until then absent. */
function yearEndOf(monthRows, bank, today, cover) {
  const byYear = new Map();
  for (const m of monthRows || []) {
    if (Number(m.period) < 1 || m.fiscal_year == null) continue;
    const key = String(m.fiscal_year); /* the label as stored: '2025-26' in a split-year pack, 2026 in another; ordered by its end date, never as a number */
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(m);
  }
  const ended = [...byYear.entries()].map(([fy, list]) => ({ fy, list, end: list.map((m) => String(m.end_date).slice(0, 10)).sort().pop() })).filter((y) => y.end < today).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  if (!ended) return null;
  const of = ended.list.length;
  const open = require('./books').monthsNotLocked(ended.list, today);
  const locked = of - open;
  const bankToEnd = !!bank && bank.state === 'reconciled' && !!bank.reconciled_to && String(bank.reconciled_to).slice(0, 10) >= ended.end;
  const first = of < 12;
  /* Checked: every entry of the FY has a valid clear mark (review-mark's own coverage over the FY range); null = the reader gave nothing (input absent), `capped` = the 5000-row cap was hit so 100% can never be shown (said, not hidden) */
  const checked = cover && cover.of != null ? cover.of > 0 && cover.checked === cover.of && !cover.capped : null;
  const lodged = require('./books-year-past').howClosed(ended.list) === 'declared_lodged';
  const complete = !first && open === 0 && bankToEnd;
  const blocker = first ? null : open > 0 ? 'months' : !bankToEnd ? 'bank' : checked === false ? 'checked' : null;
  return { fy: ended.list[0].fiscal_year, start: String(ended.list.map((m) => String(m.end_date).slice(0, 10)).sort()[0]).slice(0, 8) + '01', end: ended.end, of, locked, bank_to_end: bankToEnd, first_year: first, complete, checked, entries: cover && cover.of != null ? { checked: cover.checked, of: cover.of, capped: !!cover.capped } : null, lodged, blocker };
}
/** the furthest year-end stage a client has reached; howClosed (lodged) is read FIRST and is not a subset of the others (a closed year can carry open queries) */
const STAGES = ['books_in', 'complete', 'checked', 'ready', 'lodged'];
function stageOf(row) {
  if (!row.books_on) return null;
  const y = row.year_end;
  if (y && y.lodged) return 'lodged';
  if (y && y.complete && y.checked) return row.queries && row.queries.open === 0 ? 'ready' : 'checked';
  if (y && y.complete) return 'complete';
  return 'books_in';
}
/** the seat from the roles the login may use (req.practice_roles): auditor if the list holds it, else accountant */
const seatOf = (roles) => ((roles || []).includes('auditor') ? 'auditor' : 'accountant');
const ADVICE = [['cash_low', 'cash_days'], ['sales_down', 'sales_trend_pct'], ['loss', 'loss_months_running'], ['late_debtors', 'receivables_over60_share_pct']];
/** the accountant seat's order: the client waiting longest on us (oldest open query) first, then the default urgency; a client with no age last */
const byOldest = (a, b) => (b.queries.oldest_days == null ? -1 : b.queries.oldest_days) - (a.queries.oldest_days == null ? -1 : a.queries.oldest_days) || byUrgency(a, b);
/** the practice band (W2, Athi 16 Nov: each client counts at its CURRENT stage only, so the stage tiles sum to the clients and a tile equals the filter row.stage === key): one count per thing, each the size of the filter it opens in the list below; `opts.seat` orders the bands (the server decides, the page paints) */
function bandOf(rows, opts) {
  const seat = (opts && opts.seat) || 'auditor';
  const n = (test) => rows.filter(test).length;
  const sum = (pick) => {
    let count = 0;
    for (const r of rows) count += pick(r) || 0;
    return count;
  };
  const withYear = rows.some((r) => r.year_end);
  const pipeline = [{ key: 'books_in', n: n((r) => r.stage === 'books_in') }];
  if (withYear) pipeline.push({ key: 'complete', n: n((r) => r.stage === 'complete') });
  /* a stage is drawn when its INPUT is present for any client (a real 0 is drawn); Lodged counts every client whose year close carries the owner's declaration, and is not a subset of Ready */
  if (rows.some((r) => r.year_end && r.year_end.checked != null)) pipeline.push({ key: 'checked', n: n((r) => r.stage === 'checked') }, { key: 'ready', n: n((r) => r.stage === 'ready') });
  if (withYear) pipeline.push({ key: 'lodged', n: n((r) => r.stage === 'lodged') });
  const costed = rows.filter((r) => r.grant && r.grant.can_see_costs);
  const advice = ADVICE.filter(([, input]) => costed.some((r) => r.health && r.health[input] != null)).map(([key]) => ({ key, n: costed.filter((r) => (r.health.codes || []).includes(key)).length }));
  const bands = [
    { key: 'pipeline', tiles: pipeline.concat([{ key: 'bas_due_30', n: n((r) => r.bas.due_in_days != null && r.bas.due_in_days <= 30) }]) },
    { key: 'on_us', tiles: [
      { key: 'queries_on_us', n: n((r) => r.queries.on_us > 0) },
      ...(rows.some((r) => r.queries.oldest_days != null) ? [{ key: 'queries_over_14', n: n((r) => r.queries.waiting_over_14 === true) }] : []),
      { key: 'bank_unexplained', n: n((r) => r.bank.state === 'unexplained') },
      { key: 'to_check', n: n((r) => (r.to_check || 0) > 0) },
      { key: 'months_unlocked', n: n((r) => r.months_unlocked > 0) },
      { key: 'bas_due_30', n: n((r) => r.bas.due_in_days != null && r.bas.due_in_days <= 30) }
    ] }
  ];
  if (advice.length) bands.push({ key: 'advisory', tiles: advice, costs_not_shared: rows.length - costed.length });
  const order = seat === 'auditor' ? ['pipeline', 'on_us', 'advisory'] : ['on_us', 'advisory', 'pipeline'];
  const ordered = order.map((key) => bands.find((b) => b.key === key)).filter(Boolean).map((b, k) => Object.assign({ first: k === 0 }, b));
  return {
    seat, bands: ordered, pipeline,
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
module.exports = { RULE, WORDS, statusOf, actionOf, byUrgency, byOldest, bandOf, shareOf, yearEndOf, stageOf, seatOf, STAGES };

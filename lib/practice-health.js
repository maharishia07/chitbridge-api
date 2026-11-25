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
  watch: { sales_down_pct: 10, receivables_over60_share_pct: 25, loss_this_quarter: true },
  yoy_stale_days: 31 /* REP-66b: books whose last sale is older than this are not compared year on year as a fall (the firm can change it) */
};
/** the sales trend compares the last closed month with the 2 or 3 months before it (`sales_trend_months` says which); under this many prior months there is no trend and the row says so */
const TREND_MIN_MONTHS = 2;
const WORDS = { good: 'Doing well', watch: 'Watch', help: 'Needs help', none: 'Not enough books yet' };
const ORDER = { help: 0, watch: 1, good: 2, none: 3 };

/** the cash rule: fewer days of cash than the help line is Needs help */
function cashRule(figures, thresholds, found) {
  if (figures.cash_days == null || figures.cash_days >= thresholds.help.cash_days_below) return;
  found.help.push('cash ' + Math.max(0, Math.floor(figures.cash_days)) + ' days');
  found.codes.push('cash_low');
}
/** the sales rule: the trend down by the help share is Needs help, by the watch share is Watch */
function salesRule(figures, thresholds, found) {
  if (figures.sales_trend_pct == null) return;
  const down = 'sales down ' + Math.abs(Math.round(figures.sales_trend_pct)) + '% on the ' + (figures.sales_trend_months || 3) + ' months before';
  if (figures.sales_trend_pct <= -thresholds.help.sales_down_pct) found.help.push(down);
  else if (figures.sales_trend_pct <= -thresholds.watch.sales_down_pct) found.watch.push(down);
  else return;
  found.codes.push('sales_down');
}
/** the loss rule: losing for the help number of months running is Needs help, a loss this quarter is Watch */
function lossRule(figures, thresholds, found) {
  if (figures.loss_months_running != null && figures.loss_months_running >= thresholds.help.loss_months_running) found.help.push('loss ' + figures.loss_months_running + ' months');
  else if (thresholds.watch.loss_this_quarter && figures.profit_quarter_minor != null && figures.profit_quarter_minor < 0) found.watch.push('loss this quarter');
  else return;
  found.codes.push('loss');
}
/** the late-debtors rule: the share of receivables over 60 days late, at the help line is Needs help, at the watch line is Watch */
function debtorsRule(figures, thresholds, found) {
  const share = figures.receivables_over60_share_pct;
  if (share == null) return;
  const late = 'late debtors ' + Math.round(share) + '%';
  if (share >= thresholds.help.receivables_over60_share_pct) found.help.push(late);
  else if (share >= thresholds.watch.receivables_over60_share_pct) found.watch.push(late);
  else return;
  found.codes.push('late_debtors');
}
/** statusOf(f, rule) → { status: good|watch|help|none, reasons: [short words], codes: [cash_low|sales_down|loss|late_debtors] } (the page branches on `codes`, never on a sentence); an unknown figure (null) never triggers a rule and never reads as fine: with nothing known the status is `none` */
function statusOf(figures, rule) {
  const thresholds = rule || RULE;
  const found = { help: [], watch: [], codes: [] };
  const known = [figures.sales_trend_pct, figures.cash_days, figures.loss_months_running, figures.profit_quarter_minor, figures.receivables_over60_share_pct].some((value) => value !== null && value !== undefined);
  if (!known) return { status: 'none', reasons: ['no figures yet'], codes: [] };
  cashRule(figures, thresholds, found);
  salesRule(figures, thresholds, found);
  lossRule(figures, thresholds, found);
  debtorsRule(figures, thresholds, found);
  /* unknown is shown, never hidden: no trend because of too little history says so and moves no class */
  const unknown = figures.sales_trend_pct == null && figures.sales_trend_months != null && figures.sales_trend_months < TREND_MIN_MONTHS ? ['sales trend: under ' + TREND_MIN_MONTHS + ' months of history'] : [];
  if (found.help.length) return { status: 'help', reasons: found.help.concat(found.watch, unknown), codes: found.codes };
  if (found.watch.length) return { status: 'watch', reasons: found.watch.concat(unknown), codes: found.codes };
  return { status: 'good', reasons: unknown, codes: found.codes };
}
/** a day count that is known and 30 or fewer */
const dueWithin30 = (days) => days != null && days <= 30;
/** the work a client still needs from the firm: open queries waiting on us, unlocked months with entries, a return due within 30 days, entries not yet checked, access ending within 30 days (one count, the sort key) */
function actionOf(row) {
  const flags = [dueWithin30(row.bas.due_in_days), (row.checked.of || 0) > (row.checked.n || 0), row.bank.state === 'unexplained', dueWithin30(row.grant.ends_in_days)];
  return (row.queries.on_us || 0) + (row.months_unlocked || 0) + flags.filter(Boolean).length;
}
/** a share of a whole as a percentage with one decimal; null when there is no whole to take a share of */
const shareOf = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);
/** the change of a figure against the same period a year back, as a percentage with one decimal; null when last year held nothing to compare with */
const changeOf = (now, before) => (Number(before) > 0 ? Math.round((1000 * (Number(now) - Number(before))) / Number(before)) / 10 : null);
/** REP-66b: the state CODE of a year on year (never prose): ok | stale (last sale more than RULE.yoy_stale_days before today) | short_last_year (the first sale of last year's range came later than the same days) | no_last_year (nothing then). staleDays and startGapDays are day counts the caller measured. */
function yoyStateOf(f, rule) {
  const r = rule || RULE;
  if (!(Number(f.before) > 0)) return 'no_last_year';
  if (f.startGapDays != null && f.startGapDays > r.yoy_stale_days) return 'short_last_year';
  if (f.staleDays != null && f.staleDays > r.yoy_stale_days) return 'stale';
  return 'ok';
}
/** the default order: Needs help first, then most action, then name */
const byUrgency = (a, b) => ORDER[a.health.status] - ORDER[b.health.status] || b.action_count - a.action_count || String(a.name).localeCompare(String(b.name)) || String(a.entity_id).localeCompare(String(b.entity_id));
/** the month rows grouped by financial year (the label as stored: '2025-26' in a split-year pack, 2026 in another); a row with no period or no year is not a month */
function monthsByYear(monthRows) {
  const byYear = new Map();
  for (const month of monthRows || []) {
    if (Number(month.period) < 1 || month.fiscal_year == null) continue;
    const key = String(month.fiscal_year);
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(month);
  }
  return byYear;
}
/** the last year that has ended before today, ordered by its end date (never as a number): { list (its months), end } or undefined */
function lastEndedYear(byYear, today) {
  const endOf = (month) => String(month.end_date).slice(0, 10);
  const years = [...byYear.values()].map((list) => ({ list, end: list.map(endOf).sort().pop() })).filter((year) => year.end < today);
  return years.sort((first, second) => (first.end < second.end ? 1 : -1))[0];
}
/** is the bank reconciled up to or past the year's end day */
const bankReachesEnd = (bank, endDay) => !!bank && bank.state === 'reconciled' && !!bank.reconciled_to && String(bank.reconciled_to).slice(0, 10) >= endDay;
  /* Checked: every entry of the FY has a valid clear mark (review-mark's own coverage over the FY range); null = the reader gave nothing (input absent), `capped` = the 5000-row cap was hit so 100% can never be shown (said, not hidden) */
const checkedOf = (cover) => (cover && cover.of != null ? cover.of > 0 && cover.checked === cover.of && !cover.capped : null);
/** the entries coverage as the year-end row carries it, null when the reader gave nothing */
const entriesOf = (cover) => (cover && cover.of != null ? { checked: cover.checked, of: cover.of, capped: !!cover.capped } : null);
/** what holds the year back: months open, then the bank, then the checks; a first year has no blocker */
function blockerOf(state) {
  if (state.first) return null;
  if (state.open > 0) return 'months';
  if (!state.bankToEnd) return 'bank';
  return state.checked === false ? 'checked' : null;
}
/** REP-73: the last financial year that has ended before `today`, from the client's month rows (fiscal_year + period + end_date + status) and its bank state.
 *  Complete = books.monthsNotLocked is 0 over the FY (soft or hard lock) AND the bank is reconciled with reconciled_to on or after the FY end. A client with fewer than 12 month rows in that FY is first_year: not Complete, no blocker.
 *  null when no FY has ended (or no rows): the stage then has no input and is not drawn. `lodged` and `reason` arrive with past-years (howClosed); until then absent. */
function yearEndOf(monthRows, bank, today, cover) {
  const ended = lastEndedYear(monthsByYear(monthRows), today);
  if (!ended) return null;
  const of = ended.list.length; /* YE-F-09: a financial year has all its months, the same count as the Month lock page and the client's year line; a month before the books start is not owed a lock (E3, books.markBeforeBooks) so `open` below leaves it out, and it reads as locked */
  const open = require('./books').monthsNotLocked(ended.list, today);
  const locked = of - open;
  const bankToEnd = bankReachesEnd(bank, ended.end);
  const first = ended.list.length < 12;
  const checked = checkedOf(cover);
  const lodged = require('./books-year-past').howClosed(ended.list) === 'declared_lodged';
  const complete = !first && of > 0 && open === 0 && bankToEnd;
  const blocker = blockerOf({ first, open, bankToEnd, checked });
  return { fy: ended.list[0].fiscal_year, start: String(ended.list.map((month) => String(month.end_date).slice(0, 10)).sort()[0]).slice(0, 8) + '01', end: ended.end, of, locked, bank_to_end: bankToEnd, first_year: first, complete, checked, entries: entriesOf(cover), lodged, blocker };
}
/** the furthest year-end stage a client has reached; howClosed (lodged) is read FIRST and is not a subset of the others (a closed year can carry open queries) */
const STAGES = ['books_in', 'complete', 'checked', 'ready', 'lodged'];
/** the client holds no open query */
const queriesClosed = (row) => !!row.queries && row.queries.open === 0;
function stageOf(row) {
  if (!row.books_on) return null;
  const year = row.year_end || {};
  if (year.lodged) return 'lodged';
  if (year.complete && year.checked) return queriesClosed(row) ? 'ready' : 'checked';
  return year.complete ? 'complete' : 'books_in';
}
/** the seat from the roles the login may use (req.practice_roles): auditor if the list holds it, else accountant */
const seatOf = (roles) => ((roles || []).includes('auditor') ? 'auditor' : 'accountant');
const ADVICE = [['cash_low', 'cash_days'], ['sales_down', 'sales_trend_pct'], ['loss', 'loss_months_running'], ['late_debtors', 'receivables_over60_share_pct']];
/** the accountant seat's order: the client waiting longest on us (oldest open query) first, then the default urgency; a client with no age last */
const byOldest = (a, b) => (b.queries.oldest_days == null ? -1 : b.queries.oldest_days) - (a.queries.oldest_days == null ? -1 : a.queries.oldest_days) || byUrgency(a, b);
/** the year-end pipeline tiles: Books in always; Complete and Lodged when any client has a year end; Checked and Ready when any year end carries a checked answer */
function pipelineOf(rows, countOf) {
  const withYear = rows.some((r) => r.year_end);
  const pipeline = [{ key: 'books_in', n: countOf((r) => r.stage === 'books_in') }];
  if (withYear) pipeline.push({ key: 'complete', n: countOf((r) => r.stage === 'complete') });
  /* a stage is drawn when its INPUT is present for any client (a real 0 is drawn); Lodged counts every client whose year close carries the owner's declaration, and is not a subset of Ready */
  if (rows.some((r) => r.year_end && r.year_end.checked != null)) pipeline.push({ key: 'checked', n: countOf((r) => r.stage === 'checked') }, { key: 'ready', n: countOf((r) => r.stage === 'ready') });
  if (withYear) pipeline.push({ key: 'lodged', n: countOf((r) => r.stage === 'lodged') });
  return pipeline;
}
/** the advisory tiles: each advice rule the costed clients can answer, with how many of them carry its code */
function adviceTilesOf(costed) {
  return ADVICE.filter(([, input]) => costed.some((r) => r.health && r.health[input] != null)).map(([key]) => ({ key, n: costed.filter((r) => (r.health.codes || []).includes(key)).length }));
}
/** the bands in the seat's own order (the auditor reads the pipeline first), the first one marked */
function orderedBands(bands, seat) {
  const order = seat === 'auditor' ? ['pipeline', 'on_us', 'advisory'] : ['on_us', 'advisory', 'pipeline'];
  return order.map((key) => bands.find((b) => b.key === key)).filter(Boolean).map((b, k) => Object.assign({ first: k === 0 }, b));
}
/** the queries tiles of the on-us band: waiting on us always, over 14 days only when any client's oldest query has an age */
function queryTiles(rows, countOf) {
  const tiles = [{ key: 'queries_on_us', n: countOf((r) => r.queries.on_us > 0) }];
  if (rows.some((r) => r.queries.oldest_days != null)) tiles.push({ key: 'queries_over_14', n: countOf((r) => r.queries.waiting_over_14 === true) });
  return tiles;
}
/** the practice band (W2, Athi 16 Nov: each client counts at its CURRENT stage only, so the stage tiles sum to the clients and a tile equals the filter row.stage === key): one count per thing, each the size of the filter it opens in the list below; `opts.seat` orders the bands (the server decides, the page paints) */
function bandOf(rows, opts) {
  const seat = (opts && opts.seat) || 'auditor';
  const countOf = (test) => rows.filter(test).length;
  const sum = (pick) => {
    let count = 0;
    for (const r of rows) count += pick(r) || 0;
    return count;
  };
  const pipeline = pipelineOf(rows, countOf);
  const costed = rows.filter((r) => r.grant && r.grant.can_see_costs);
  const advice = adviceTilesOf(costed);
  const bands = [
    { key: 'pipeline', tiles: pipeline.concat([{ key: 'return_due_30', n: countOf((r) => r.bas.due_in_days != null && r.bas.due_in_days <= 30) }]) },
    { key: 'on_us', tiles: [
      ...queryTiles(rows, countOf),
      { key: 'bank_unexplained', n: countOf((r) => r.bank.state === 'unexplained') },
      { key: 'changed', n: countOf((r) => r.changed && r.changed.n > 0), entries: sum((r) => r.changed && r.changed.n) }, /* rank 10: clients with entries posted since THIS person checked; the tile filters the list, never a second sort */
      { key: 'to_check', n: countOf((r) => (r.to_check || 0) > 0), entries: sum((r) => r.to_check) }, /* A3P rank 6: n counts clients (the filter under the tile); entries counts the work, the sum of each client's own to_check: never a second subtraction */
      { key: 'months_unlocked', n: countOf((r) => r.months_unlocked > 0) },
      { key: 'return_due_30', n: countOf((r) => r.bas.due_in_days != null && r.bas.due_in_days <= 30) },
      { key: 'return_overdue', n: countOf((r) => !!r.bas.overdue) } /* YE-F-07: due day passed and not closed in the books (lib/return-overdue) */
    ] }
  ];
  if (advice.length) bands.push({ key: 'advisory', tiles: advice, costs_not_shared: rows.length - costed.length });
  const ordered = orderedBands(bands, seat);
  return {
    seat, bands: ordered, pipeline,
    clients: rows.length,
    queries: { clients: countOf((r) => r.queries.open > 0), on_client: sum((r) => r.queries.on_client), on_us: sum((r) => r.queries.on_us) },
    return_due_30: countOf((r) => r.bas.due_in_days != null && r.bas.due_in_days <= 30),
    return_overdue: countOf((r) => !!r.bas.overdue),
    bas_due_30: countOf((r) => r.bas.due_in_days != null && r.bas.due_in_days <= 30), /* DEPRECATED alias of return_due_30 (same value), sunset 2027-02-18; docs/API-CHANGELOG.md, API-STANDARD S13/S26 */
    months_unlocked: countOf((r) => r.months_unlocked > 0),
    checked: { n: sum((r) => r.checked.n), of: sum((r) => r.checked.of), clients_behind: countOf((r) => (r.checked.of || 0) > (r.checked.n || 0)) },
    grants_ending_30: countOf((r) => r.grant.ends_in_days != null && r.grant.ends_in_days <= 30),
    health: { good: countOf((r) => r.health.status === 'good'), watch: countOf((r) => r.health.status === 'watch'), help: countOf((r) => r.health.status === 'help'), none: countOf((r) => r.health.status === 'none') },
    bank: { unexplained: countOf((r) => r.bank.state === 'unexplained'), no_statement: countOf((r) => r.bank.state === 'none'), reconciled: countOf((r) => r.bank.state === 'reconciled') }
  };
}
module.exports = { RULE, WORDS, statusOf, actionOf, byUrgency, byOldest, bandOf, shareOf, changeOf, yoyStateOf, yearEndOf, stageOf, seatOf, STAGES };
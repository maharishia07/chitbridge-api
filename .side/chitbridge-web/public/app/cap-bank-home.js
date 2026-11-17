/* cap-bank-home.js — the BANK HOME and the way back to it (l16, W15-84; Athi 16 Nov: "you always need to land on one page when you press the bank").
 * OWNS      the page the menu's Bank always opens on (the Statements box grown: one row per account, the months across: ✓ signed off · ● not signed off · Missing) · the cards for unfinished months (Continue) ·
 *           the trail "← Bank › account › Month YYYY" over a statement's lines and its Back · the #bank/<account>/<YYYY-MM> entry the browser's Back and Forward walk.
 * W15-100 (Athi 16 Nov, hundreds of months): ONE financial year on the grid (‹ FY › stepper, All years), cards newest three + "and n more", a count per account row; the kept files are a CBList paged by the SERVER (cap-bank-statements.js).
 * CALLED BY cap-bank.js (bankView lands here; bankPaint → bankHomeEnter when lines show) and cap-bank-statements.js (bankStmtPaint draws the grid and cards; Read → bankStmtReadFile). Loaded after cap-bank-statements.js by public/accounts.html.
 * FLOW      menu Bank → bankView → BKB.view = 'home' → bankStmtMount (GET /bank/statement-files) + bankHomeSigned (GET /bank/log per account: the sign-offs) → a month pressed / Continue / Read → the kept file into the ONE reader → bankPaint → bankHomeEnter (view 'lines', pushState #bank/<code>/<month>) → Back = history.back() → popstate → bankHomeShow.
 * ⭐ ONE LANDING: the device's last statement never decides the landing page (cap-bank.js no longer restores it on open); it may still be picked when the account is changed on the plain picker.
 * ⭐ NO NEW READ AND NO MONEY: a month is ✓ only when GET /bank/log (the page's own sign-off record) lists a statement signed for that account whose period ends in it; kept and not signed is ●. When the log cannot be read the cell says "Kept", never ✓.
 * ⭐ A LINE COUNT only where it is known: the device's count of lines that need a person (bankTodoItem's record) is shown on the card of the statement it was counted for; else the card says "Not signed off yet".
 * IDS       BKS014-B46 (Back to the Bank home) · BKS014-B47 (a month: open its lines) · BKS014-B48 (Continue an unfinished month) · BKS014-B49 (earlier year) · BKS014-B50 (later year) · BKS014-B51 (All years) · BKS014-B52 (and n more / Show fewer) · BKS014-B53 (a year row of All years). A missing month keeps BKS014-B44 (cap-bank-statements.js).
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const BANK_HOME = { signed: {}, known: false, blind: false, noPush: false, shown: 3, deepDone: false };
window.BKH = BANK_HOME; /* the name accounts.html and cap-bank-statements.js read */
const bkhE = (text) => (typeof bkbE === 'function' ? bkbE(text) : String(text));
/** 'September 2026' for '2026-09', in the reader's language (a date helper, no money) */
function bkhMonthLong(month) {
  try {
    return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch (_) {
    return month;
  }
}
const bkhAccountById = (id) => ((BKST.data && BKST.data.accounts) || []).filter((item) => item.account_id === id)[0] || null;
const bkhAccountByCode = (code) => ((BKST.data && BKST.data.accounts) || []).filter((item) => String(item.code) === String(code))[0] || null;
const bkhCellOf = (account, month) => BKST.data.cells.filter((item) => item.account_id === account.account_id && item.month === month)[0];
/** the days the sign-offs are asked for: from the first day of the oldest year the stepper reaches (the shown year when the pack gives no years to keep) to the last day of this year's end */
function bkhSignedRange() {
  if (BKST.fy === null) return {};
  const years = bkhRetention(),
    start = bkhStartMonth(),
    oldest = years ? BKST.cur - (years - 1) : BKST.fy,
    end = bkhFyEnd(BKST.cur);
  return { from: oldest + '-' + bkhPad(start) + '-01', to: end + '-' + bkhPad(new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate()) };
}
/** the sign-offs of every account the box lists: the same GET /bank/log the lines view reads; one that fails leaves the whole answer unknown (cells say Kept) */
async function bankHomeSigned() {
  const accounts = (BKST.data && BKST.data.accounts) || [],
    next = {};
  let known = true,
    blind = false;
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const log = await api('booksBankLog', { query: Object.assign({ account: String(account.code), marks_limit: 0 }, bkhSignedRange()), fresh: true }); /* only the sign-offs, of the years on show: no marks, never the whole record */
        next[account.account_id] = (log && log.statements) || [];
      } catch (failure) {
        known = false;
        if (bksCostBlind(failure)) blind = true; /* said once on the Bank home (cap-bank-statements.js bkstSummary), never a silent "Kept" */
      }
    })
  );
  BANK_HOME.signed = next;
  BANK_HOME.known = known && accounts.length > 0;
  BANK_HOME.blind = blind;
}
/* ── the financial year: one year on screen (W15-100). Its first month and its name are the shop's own (the country pack through bkYearStart and bkFyName); how far back the stepper reaches is the pack's record-keeping years ── */
const bkhPad = (n) => (n < 10 ? '0' : '') + n;
const bkhStartMonth = () => (typeof bkYearStart === 'function' ? bkYearStart() : 1);
/** this month, by the SHOP's day: the api's own (GET /bank/statement-files today, the shop clock); the page's bkToday only before the first answer */
const bkhThisMonth = () => String((typeof BKST !== 'undefined' && BKST.data && BKST.data.today) || (typeof bkToday === 'function' ? bkToday() : new Date().toISOString())).slice(0, 7);
/** the year (its first calendar year) holding a month 'YYYY-MM' */
const bkhFyOf = (month) => (Number(month.slice(5, 7)) >= bkhStartMonth() ? Number(month.slice(0, 4)) : Number(month.slice(0, 4)) - 1);
/** the last month of a year: its 12 months end here */
const bkhFyEnd = (fy) => (bkhStartMonth() === 1 ? fy + '-12' : fy + 1 + '-' + bkhPad(bkhStartMonth() - 1));
const bkhFyLabel = (fy) => tx('FY') + ' ' + (typeof bkFyName === 'function' ? bkFyName(fy) : String(fy));
/** the years the pack says to keep records for; 0 when it says nothing (then the stepper follows the data, no number is made up) */
function bkhRetention() {
  const pack = typeof shopReg === 'function' ? shopReg() : null,
    years = Number(pack && pack.retentionYears);
  return years > 0 ? Math.floor(years) : 0;
}
/** can the stepper go one year later (never past this year) or earlier (back to the record-keeping years; without them, while the box holds older files) */
function bkhCanStep(step) {
  if (step > 0) return BKST.fy < BKST.cur;
  const years = bkhRetention();
  if (years) return BKST.fy > BKST.cur - (years - 1);
  return !!BKST.data && BKST.data.older > 0 && BKST.fy > BKST.cur - 40;
}
/** is there a signed-off statement (the reconciliation record) for this account and month: the SAME record the practice list's Bank column reads */
/** a sign-off covers every month from its period_from to its period_to (a year signed in one go is twelve months signed, not one); a record with no period_from covers its own end month only */
const bkhCovers = (item, month) => String(item.period_from || item.period_to || '').slice(0, 7) <= month && month <= String(item.period_to || '').slice(0, 7);
const bkhSignedIn = (account, month) => (BANK_HOME.signed[account.account_id] || []).some((item) => bkhCovers(item, month));
/** the state of a month with no statement: still to come, in progress (not due yet, never Missing) or missing */
function bkhGapState(month) {
  const now = bkhThisMonth();
  return month > now ? 'future' : month === now ? 'current' : 'missing';
}
/** 'missing' · 'signed' · 'open' (kept, lines to do) · 'unfiled' (signed off, but no file kept: the record is shown, never "Missing") · 'kept' (the sign-off record could not be read) · 'future' (a month not begun) · 'current' (the month in progress: not due yet, never "missing") */
function bankHomeState(account, month, cell) {
  const gap = !cell || cell.missing;
  if (gap && BANK_HOME.known && bkhSignedIn(account, month)) return 'unfiled'; /* l16 fable2 R2-2: the practice row says "unexplained to 31 Oct" from these sign-offs; the Bank page shows them too */
  if (gap) return bkhGapState(month); /* the month in progress is not due yet: its own state, never Missing */
  if (!BANK_HOME.known) return 'kept';
  return bkhSignedIn(account, month) ? 'signed' : 'open';
}
/** the count of each state over some accounts and an answer's months: { signed, open, kept, missing } */
function bkhTally(data, accounts) {
  const cells = {},
    out = { signed: 0, open: 0, kept: 0, missing: 0, unfiled: 0 };
  data.cells.forEach((cell) => (cells[cell.account_id + '|' + cell.month] = cell));
  accounts.forEach((account) =>
    data.months.forEach((month) => {
      const state = bankHomeState(account, month, cells[account.account_id + '|' + month]);
      if (out[state] !== undefined) out[state] += 1;
    })
  );
  return out;
}
/** "9 ✓ · 1 ● · 2 missing": what a year holds for an account (or for all of them) */
function bkhTallyWords(tally) {
  return tally.signed + ' ✓ · ' + tally.open + ' ● · ' + txf('{n} missing', { n: tally.missing }) + (tally.kept ? ' · ' + txf('{n} kept', { n: tally.kept }) : '') + (tally.unfiled ? ' · ' + txf('{n} signed, no file', { n: tally.unfiled }) : '');
}
const bankHomeMayAdd = () => typeof bkbMayAct === 'function' && bkbMayAct();
/** ‹ FY 2024-25 · FY 2025-26 · FY 2026-27 › and All years: the year on screen, one step either way */
function bankHomeFyHtml() {
  const financialYear = BKST.financialYear,
    canStep = (step) => bkhCanStep(step),
    btn = (cbsid, tid, step, text, label) => '<button ' + cbsid + ' type="button" class="bks-btn bkh-step" data-testid="' + tid + '" onclick="bankHomeFyStep(' + step + ')" aria-label="' + bkhE(label) + '"' + (canStep(step) ? '' : ' disabled') + '>' + bkhE(text) + '</button>';
  return (
    '<div class="bkh-financialYear" data-testid="bank-home-financialYear" role="group" aria-label="' + bkhE(tx('Financial year')) + '">' +
    btn('data-cbsid="BKS014-B49"', 'bank-home-financialYear-prev', -1, '‹ ' + (canStep(-1) ? bkhFyLabel(financialYear - 1) : ''), tx('Earlier year')) +
    '<b class="bkh-fynow" data-testid="bank-home-financialYear-now" aria-live="polite">' + bkhE(bkhFyLabel(financialYear)) + '</b>' +
    btn('data-cbsid="BKS014-B50"', 'bank-home-financialYear-next', 1, (canStep(1) ? bkhFyLabel(financialYear + 1) : '') + ' ›', tx('Later year')) +
    (bkhRetention() ? '<button data-cbsid="BKS014-B51" type="button" class="bks-btn bkh-step" data-testid="bank-home-financialYear-all" aria-pressed="' + !!BKST.all + '" onclick="bankHomeAllYears()">' + bkhE(tx('All years')) + '</button>' : '') +
    '</div>'
  );
}
/** a step: the year changes, the box is read for it, the focus stays on the press that was used */
async function bankHomeFyStep(step) {
  if (!bkhCanStep(step) || BKST.busy) return;
  BKST.fy += step;
  BKST.all = false;
  BKST.focus = step < 0 ? 'bank-home-fy-prev' : 'bank-home-fy-next';
  await bankStmtLoad({ fresh: true });
}
/** All years: one row per year the pack says to keep, newest first (one small read per year: the counts, no files); a row opens that year */
async function bankHomeAllYears() {
  BKST.all = !BKST.all;
  BKST.focus = 'bank-home-fy-all';
  if (BKST.all) await bankStmtAllLoad();
  else bankStmtPaint();
}
function bankHomeAllHtml() {
  const rows = BKST.allRows;
  if (!rows) return '<div class="pe-note" data-testid="bank-home-all">' + bkhE(tx('Reading what is kept')) + '</div>';
  const many = BKST.data.accounts.length > 1;
  return (
    '<div class="bkh-all" data-testid="bank-home-all">' + (many ? '<div class="pe-note">' + bkhE(tx('Months across all accounts')) + '</div>' : '') +
    rows.map((row) => '<button type="button" class="bks-btn bkh-allrow" data-cbsid="BKS014-B53" data-testid="bank-home-all-' + bkhE(row.fy) + '" onclick="bankHomePickFy(' + row.fy + ')"><b>' + bkhE(bkhFyLabel(row.fy)) + '</b> · ' + bkhE(bkhTallyWords(row.tally)) + '</button>').join('') +
    '</div>'
  );
}
function bankHomePickFy(fy) {
  BKST.fy = fy;
  BKST.all = false;
  BKST.focus = 'bank-home-fy-now';
  return bankStmtLoad({ fresh: true });
}
/** the unfinished months of the shown year, newest first: the newest three as cards, the rest said as a count that opens the whole list */
function bankHomeCardsHtml() {
  const data = BKST.data;
  if (!data || !data.accounts.length) return '';
  const open = [];
  data.accounts.forEach((account) => data.months.forEach((month) => bankHomeState(account, month, bkhCellOf(account, month)) === 'open' && open.push({ account, month })));
  if (!open.length) return '';
  open.sort((first, second) => second.month.localeCompare(first.month));
  const todo = bkbLoad('todo', null),
    many = data.accounts.length > 1;
  const card = ({ account, month }) => {
    const counted = todo && Number(todo.n) > 0 && String(todo.acct) === String(account.code) && String(todo.to || '').slice(0, 7) === month,
      words = counted ? txn('{count} line needs you', '{count} lines need you', Number(todo.n)) : tx('Not signed off yet');
    return (
      '<div class="bkh-card" data-testid="bank-home-card-' + bkhE(account.account_id) + '-' + bkhE(month) + '"><span class="bkh-dot" aria-hidden="true">●</span><span class="bkh-words">' + bkhE(bkhMonthLong(month)) + (many ? ' · ' + bkhE(bkstAccountName(account)) : '') + ' · ' + bkhE(words) + '</span>' +
      '<button data-cbsid="BKS014-B48" type="button" class="bks-btn bkh-go" data-testid="bank-home-continue" data-acct="' + bkhE(account.account_id) + '" data-month="' + bkhE(month) + '" onclick="bankHomePress(this)">' + bkhE(tx('Continue')) + '</button></div>'
    );
  };
  const all = !!BKST.cards,
    shown = all ? open : open.slice(0, BANK_HOME.shown),
    rest = open.length - BANK_HOME.shown;
  const more = rest > 0 ? '<button data-cbsid="BKS014-B52" type="button" class="bks-link bkh-more" data-testid="bank-home-more" aria-expanded="' + all + '" onclick="bankHomeCardsMore()">' + bkhE(all ? tx('Show fewer') : txf('and {n} more', { n: rest })) + '</button>' : '';
  return '<div class="bkh-cards' + (all ? ' bkh-cards-all' : '') + '" data-testid="bank-home-cards">' + shown.map(card).join('') + more + '</div>';
}
function bankHomeCardsMore() {
  BKST.cards = !BKST.cards;
  BKST.focus = 'bank-home-more';
  bankStmtPaint();
}
/** a year with no statement file kept, whose every month that has begun is signed off: ONE line instead of a grid of cells (never "Missing" for a signed month; nothing invented) */
function bkhFoldedHtml(data) {
  if (BKST.fileTotal || !BANK_HOME.known) return '';
  const tallies = data.accounts.map((account) => ({ account, tally: bkhTally(data, [account]) }));
  if (!tallies.length || tallies.some((row) => row.tally.missing || row.tally.signed || row.tally.open || row.tally.kept) || !tallies.some((row) => row.tally.unfiled)) return '';
  const many = tallies.length > 1;
  return (
    '<div class="pe-note bkh-folded" data-testid="bank-home-folded">' +
    tallies.filter((row) => row.tally.unfiled).map((row) => '<div data-testid="bank-home-folded-' + bkhE(row.account.account_id) + '">' + (many ? '<b>' + bkhE(bkstAccountName(row.account)) + '</b> · ' : '') + bkhE(txn('Signed off for {count} month, no statement file kept', 'Signed off for {count} months, no statement file kept', row.tally.unfiled)) + '</div>').join('') +
    '</div>'
  );
}
/** the head row of the grid: Account · the shown year's months · This year */
function bkhHeadRowHtml(data) {
  return '<tr><th scope="col">' + bkhE(tx('Account')) + '</th>' + data.months.map((month) => '<th scope="col">' + bkhE(bkstMonth(month)) + '</th>').join('') + '<th scope="col">' + bkhE(tx('This year')) + '</th></tr>';
}
/** one line per account: its monthly sign-offs "n of m" (named when there is more than one account) */
function bkhSignedLinesHtml(data) {
  const many = data.accounts.length > 1,
    count = data.months.length;
  return data.accounts.map((account) => { const t = bkhTally(data, [account]); return '<div data-testid="bank-home-signed-' + bkhE(account.account_id) + '">' + (many ? bkhE(bkstAccountName(account)) + ' · ' : '') + bkhE(txf('Monthly sign-offs: {n} of {m}', { n: t.signed + t.unfiled, m: count })) + '</div>'; }).join('');
}
/** a month with no statement: the month in progress, a month not yet due, a month signed off with no file kept, or a gap (the person who may add gets the button to add it) */
function bkhGapCellHtml(state, account, month, key, mayAdd) {
      if (state === 'current') return '<td data-m="' + bkhE(bkstMonth(month)) + '" class="bks-gap bkh-future" data-testid="bank-stmts-current-' + key + '" title="' + bkhE(tx('Not due yet')) + '"><span aria-hidden="true">·</span><span class="sr-only">' + bkhE(tx('Not due yet')) + '</span></td>';
      if (state === 'future') return '<td data-m="' + bkhE(bkstMonth(month)) + '" class="bks-gap bkh-future" data-testid="bank-stmts-future-' + key + '"><span aria-hidden="true">·</span></td>';
      if (state === 'unfiled') return '<td data-m="' + bkhE(bkstMonth(month)) + '" class="bks-gap"><span class="bks-sum" data-testid="bank-stmts-unfiled-' + key + '" title="' + bkhE(tx('Signed off; no statement file is kept for this month')) + '">' + bkhE(tx('Signed off')) + '</span></td>';
      if (state === 'missing')
  return mayAdd
          ? '<td data-m="' + bkhE(bkstMonth(month)) + '" class="bks-gap"><button data-cbsid="BKS014-B44" type="button" class="bks-miss" data-testid="bank-stmts-miss-' + key + '" data-acct="' + bkhE(account.code || '') + '" onclick="bankStmtPickGap(this)" title="' + bkhE(tx('Add a statement for this account')) + '">' + bkhE(tx('Not signed off')) + '</button></td>'
          : '<td data-m="' + bkhE(bkstMonth(month)) + '" class="bks-gap"><span class="bks-sum" data-testid="bank-stmts-miss-' + key + '">' + bkhE(tx('Not signed off')) + '</span></td>';
  return '';
}
/** a month with a statement kept: its press (open the lines), its mark, its count and the crossed-statements warning */
function bkhHaveCellHtml(account, month, cell, state, key) {
      const crossed = cell.overlaps === true,
  mark = state === 'open' ? '●' : state === 'signed' ? '✓' : '◦',
  word = state === 'signed' ? tx('Signed off') : state === 'open' ? tx('Not signed off yet') : tx('Kept'),
  warn = crossed ? tx('Two statements cover this month') : '';
      return (
  '<td data-m="' + bkhE(bkstMonth(month)) + '" class="bks-have bkh-' + state + '" data-testid="bank-stmts-have-' + key + '"><button data-cbsid="BKS014-B47" type="button" class="bkh-cell" data-testid="bank-home-month-' + key + '" data-acct="' + bkhE(account.account_id) + '" data-month="' + bkhE(month) + '" onclick="bankHomePress(this)" title="' + bkhE(word + ' · ' + bkhMonthLong(month) + (warn ? ' · ' + warn : '')) + '" aria-label="' + bkhE(bkstAccountName(account) + ', ' + bkhMonthLong(month) + ', ' + word + (warn ? ', ' + warn : '')) + '"><span aria-hidden="true">' + mark + '</span> ' + bkhE(String(cell.file_ids.length)) + (crossed ? ' <span class="bks-flag" data-testid="bank-stmts-cross-' + key + '" aria-hidden="true">⚠</span>' : '') + '</button></td>'
      );
}
/** one month of one account: a gap cell, or the press that opens its lines */
function bkhMonthCellHtml(account, month, mayAdd) {
  const cell = bkhCellOf(account, month),
  state = bankHomeState(account, month, cell),
  key = bkhE(account.account_id) + '-' + bkhE(month);
  if (['current', 'future', 'unfiled', 'missing'].indexOf(state) >= 0) return bkhGapCellHtml(state, account, month, key, mayAdd);
  return bkhHaveCellHtml(account, month, cell, state, key);
}
/** one row of the grid: the account and its months across, the year's tally at the end */
function bkhAccountRowHtml(data, account, mayAdd) {
  const cells = data.months.map((month) => bkhMonthCellHtml(account, month, mayAdd)).join('');
  return '<tr><th scope="row" title="' + bkhE(bkstAccountName(account)) + '">' + bkhE(bkstAccountName(account)) + '</th>' + cells + '<td class="bkh-tally" data-testid="bank-home-tally-' + bkhE(account.account_id) + '">' + bkhE(bkhTallyWords(bkhTally(data, [account]))) + '</td></tr>';
}
/** the grid: one row per account, the shown year's months across, the year's count at the end; a month with a statement opens its lines */
function bankHomeGridHtml() {
  const data = BKST.data;
  if (!data || !data.accounts.length) return '';
  const mayAdd = bankHomeMayAdd();
  const folded = bkhFoldedHtml(data);
  if (folded) return folded;
  const rows = data.accounts.map((account) => bkhAccountRowHtml(data, account, mayAdd)).join('');
  return (
    '<div class="pe-note bkh-signed" data-testid="bank-home-signed">' + bkhSignedLinesHtml(data) + '</div>' +
    '<div class="bks-wrap bkh-gridwrap"><table class="bks-grid" data-testid="bank-stmts-grid"><thead>' + bkhHeadRowHtml(data) + '</thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="pe-note bkh-key" data-testid="bank-home-key">✓ ' + bkhE(tx('signed off')) + ' · ● ' + bkhE(tx('not signed off yet')) + ' · ' + bkhE(tx('no statement kept')) + '</div>'
  );
}
/** a month pressed, or Continue: that statement's lines */
function bankHomePress(button) {
  return bankHomeOpen(bkhAccountById(button.getAttribute('data-acct')), button.getAttribute('data-month'));
}
/** open the lines of the newest file kept for this account and month (the cell names it); a month with none says so on the home */
function bankHomeOpen(account, month) {
  const cell = account && BKST.data ? bkhCellOf(account, month) : null;
  if (!cell || cell.missing || !cell.newest_id) return peBad('bks_out', tx('That statement is no longer here.'));
  return bankStmtReadFile(cell.newest_id, { code: account.code, name: cell.newest_name, to: cell.newest_to });
}

/* ── the lines view: the trail and the Back ── */
/** the one line over a statement's lines: ← Bank › account › Month YYYY */
function bankHomeTrailHtml() {
  const account = bkhAccountByCode(BKB.acct),
    ledger = (BKB.accts || []).filter((item) => String(item.code) === String(BKB.acct))[0] || {},
    name = account ? bkstAccountName(account) : ledger.name || '',
    month = String(BKB.to || '').slice(0, 7);
  return (
    '<nav class="bkh-trail" data-testid="bank-home-trail" aria-label="' + bkhE(tx('Where you are')) + '"><button data-cbsid="BKS014-B46" type="button" class="bks-btn bkh-back" id="bkh_back" data-testid="bank-home-back" onclick="bankHomeBack()">← ' + bkhE(tx('Bank')) + '</button>' +
    '<span class="bkh-crumbs" aria-current="page"><span aria-hidden="true">›</span> ' + bkhE(name) + (month ? ' <span aria-hidden="true">›</span> ' + bkhE(bkhMonthLong(month)) : '') + '</span></nav>'
  );
}
/** the lines are on screen (cap-bank.js bankPaint): the view is 'lines' and the browser has an entry to go Back to */
function bankHomeEnter() {
  if (BKB.view === 'lines') return;
  BKB.view = 'lines';
  if (BANK_HOME.noPush) {
    BANK_HOME.noPush = false; /* the browser's Forward brought us here: the entry is in the history already */
    return;
  }
  const month = String(BKB.to || '').slice(0, 7);
  try {
    history.pushState({ bk: 1 }, '', '#bank/' + encodeURIComponent(BKB.acct) + (month ? '/' + month : ''));
  } catch (failure) {
    bkQuiet('bank-home-history', failure);
  }
}
/** Back: one step in the browser's history when the lines were entered from the home (the popstate paints the home), else straight to the home */
function bankHomeBack() {
  if (history.state && history.state.bk) history.back();
  else bankHomeShow();
}
/** the home over everything: the lines are cleared from the screen, the box is read again (a sign-off just made shows) */
function bankHomeShow() {
  BKB.view = 'home';
  try {
    if (/^#bank\//.test(location.hash)) history.replaceState(null, '', '#bank');
  } catch (failure) {
    bkQuiet('bank-home-history', failure);
  }
  const res = bkbEl('bk_res'),
    out = bkbEl('bk_out');
  if (res) res.innerHTML = '';
  if (out) out.innerHTML = '';
  bankLayout(false, false);
  bankHomeClass();
  if (BKST.mode === 'server') bankStmtLoad().then(bankHomeFocus).catch((failure) => bkQuiet('bank-home-load', failure));
  else bankStmtPaint();
}
/** the pane wears bk-home while the box is the page (the plain picker folds; it stays when the box is not ready) */
function bankHomeClass() {
  const pane = document.querySelector('.pe-bank');
  if (pane) pane.classList.toggle('bk-home', BKB.view === 'home' && BKST.mode === 'server');
}
/** the keyboard lands on the first press of the home */
function bankHomeFocus() {
  const node = document.querySelector('.bkh-cell,.bkh-go,.bks-tog');
  if (node) node.focus({ preventScroll: true });
}
/** is this account and month the statement whose lines are on screen */
function bkhShowing(code, month) {
  return BKB.view === 'lines' && String(BKB.acct) === code && String(BKB.to || '').slice(0, 7) === month;
}
/** the browser's Back and Forward: #bank is the home, #bank/<code>/<YYYY-MM> is that statement's lines */
function bankHomeRoute() {
  if (!/^#bank(\/|$)/.test(location.hash) || !bkbEl('bk_stmts')) return;
  const route = /^#bank\/([^/]+)\/(\d{4}-\d{2})$/.exec(location.hash);
  if (!route) return BKB.view === 'lines' ? bankHomeShow() : undefined;
  const code = decodeURIComponent(route[1]);
  if (bkhShowing(code, route[2])) return;
  const account = bkhAccountByCode(code),
    cell = account ? bkhCellOf(account, route[2]) : null;
  if (cell && !cell.missing) {
    BKB.view = 'home'; /* the entry is already in the history: bankHomeEnter pushes none */
    BANK_HOME.noPush = true;
    return bankHomeOpen(account, route[2]);
  }
  bankHomeShow();
}
/** once, when the first list has come in: a reload or a bookmark on #bank/<account>/<month> opens that account's month (the same route the browser's Back and Forward walk) */
function bankHomeDeepOnce() {
  if (BANK_HOME.deepDone) return;
  BANK_HOME.deepDone = true;
  if (BKST.mode === 'server') bankHomeRoute();
}
window.addEventListener('popstate', bankHomeRoute);

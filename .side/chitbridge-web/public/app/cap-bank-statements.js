/* cap-bank-statements.js — the STATEMENTS BOX of the Bank view (l16, W15-51; api: POST/GET /api/books/bank/statement-files, b872).
 * W15-100: one financial year at a time (12 months), the kept files a CBList the SERVER pages and searches (limit 25, newest first); nothing loads the whole box.
 * OWNS      bankStmtMount (the box on the Bank page) · the account × month grid with its gaps ("Oct missing") · Add statement (account + file, the period from the reader) · Read (a kept file into the ONE reader) · Download.
 * CALLED BY cap-bank.js (bankView draws #bk_stmts and calls bankStmtMount(banks)); the grid, the cards and the Back are cap-bank-home.js; loaded after cap-bank-store.js by public/accounts.html. The owner and the acting adviser see the same box (the server decides who may add).
 * FLOW      bankStmtMount → GET /bank/statement-files (the page's own bank list names the accounts) → grid + files · Add → the reader's own period and currency → POST (the sha256 of the UTF-8 text, bkbHash: the ONE hash) · Read → GET …/file?use=read → bankTake(text, name, false)
 * ⭐ NO SECOND PARSER AND NO MONEY: the period is what CBBankRecon.parse already returned (bankStmtPeriod); Read hands the text to bankTake, which parses, hashes, projects and posts as it always did. A file with no period is refused, never guessed.
 * ⭐ EVERY FILE IS FILED AGAINST AN ACCOUNT AND A PERIOD (Athi, 15 Nov): the account is required; "Oct missing" is a cell of the grid, with a shortcut that picks that account.
 * ⭐ THE WORDS: "Kept on our server for the record period; visible to the accountant or auditor you give access." is the box's own line (cb-compliance owns the final text). The plain picker above keeps its own, still-true device-only sentence.
 * IDS       BKS014-B45 (Just read a file, do not keep it) · BKS014-B41 (Show/Hide the box) · BKS014-I12 (the account label) · BKS014-I13 (the statement file) · BKS014-B42 (Read) · BKS014-B43 (Download) · BKS014-B44 (a missing month: add for it); the account select and Add button are the page's library builders (peSel BKS016-S01, peBtn BKS016-B02).
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksStmtList: { m: 'GET', p: '/api/books/bank/statement-files' },
    booksStmtAdd: { m: 'POST', p: '/api/books/bank/statement-files' }
  });
}
const BKST = { banks: [], data: null, open: null, mode: 'idle', pickAcct: '', busy: false, fy: null, cur: null, auto: false, all: false, allRows: null, cards: false, q: '', cursors: [null], ix: 0, fileTotal: 0, last: '', filesOpen: false, filesApi: null, focus: '' };
const BKST_MONTHS = 12; /* one financial year at a time (W15-100) */
const BKST_PAGE = 25;
const bkstE = (text) => (typeof bkbE === 'function' ? bkbE(text) : String(text));
const bkstEl = (id) => document.getElementById(id);
/** 'Oct' for '2026-10', in the reader's own language (a date helper, no money) */
function bkstMonth(month) {
  try {
    return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  } catch (_) {
    return month.slice(5);
  }
}
/** the bank ledgers the page lists (bkbBanks: the ONE list), each { code, name } */
const bkstBanks = () => BKST.banks.map((item) => ({ code: String(item.code), name: item.name }));
/** the account of a row of the answer, as the page names it: its name and the owner's label (..1234) */
const bkstAccountName = (account) => (account.name || tx('Bank account')) + (account.label ? ' ' + account.label : '');
const bkstAccountOf = (id) => ((BKST.data && BKST.data.accounts) || []).filter((item) => item.account_id === id)[0] || {};

/* ── the box ── */
/** draw the box into #bk_stmts and read the list; `banks` is bkbBanks(accts) (the Bank page's own list) */
function bankStmtMount(banks) {
  BKST.banks = banks || [];
  BKST.pickAcct = BKST.pickAcct || (BKST.banks[0] ? String(BKST.banks[0].code) : '');
  const host = bkstEl('bk_stmts');
  if (!host) return;
  host.innerHTML = '<div class="bks-bar"><b>' + bkstE(tx('Statements')) + '</b><span class="bks-sum" data-testid="bank-stmts-sum">' + bkstE(tx('Reading what is kept')) + '</span></div>';
  bankStmtLoad().catch((failure) => typeof bkQuiet === 'function' && bkQuiet('bank-stmts', failure));
}
/** ONE read of one financial year: its 12 months of cells and ONE page of kept files, newest first (the server pages and searches; the page never holds the whole box) */
async function bkstFetch(fy, extra) {
  const query = Object.assign({ accounts: bkstBanks().map((item) => item.code).join(','), months: BKST_MONTHS, to: bkhFyEnd(fy), limit: BKST_PAGE }, fy === BKST.fy ? { asOf: bkstPeriodEnd() } : {}, extra || {});
  const answer = await api('booksStmtList', { query, fresh: true });
  if (!answer || !Array.isArray(answer.cells) || !Array.isArray(answer.accounts) || !Array.isArray(answer.files)) throw new Error('the statements answer is not the statements box answer');
  return answer;
}
/** bank17 D2: the period in the address (&fy=2025-26, or &from=&to=) as { fy: the year's first calendar year, to: the day it ends or null }; null when none is named. The same words Books writes (CBPeriodPick.toAddress). */
function bkstAddressPeriod() {
  const query = new URLSearchParams(window.location.search || ''),
    from = query.get('from'),
    to = query.get('to'),
    year = Number(String(query.get('fy') || '').slice(0, 4)),
    day = /^\d{4}-\d{2}-\d{2}$/;
  if (from && to && day.test(from) && day.test(to) && from <= to) return { fy: bkhFyOf(to.slice(0, 7)), to };
  return year >= 1990 && year <= 2200 ? { fy: year, to: null } : null;
}
/** the last day of the shown period: the address's own day while its year is on show, else the end of the year on show */
function bkstPeriodEnd() {
  if (BKST.addr && BKST.addr.to && BKST.addr.fy === BKST.fy) return BKST.addr.to;
  const end = bkhFyEnd(BKST.fy);
  return end + '-' + bkhPad(new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate());
}
/** the bank balance at the period end, READ from the sign-off the api chose (GET /bank/statement-files asOf → signed_as_at: the ONE rule, the newest period end on or before the day; no choosing, no sum here).
 *  The words: the statement figure and "nothing unexplained" / "unexplained A$Y" (the absolute remainder after the timing items; it is NOT statement minus books, so no Books or Difference figure is shown). '' when no account was signed by then. */
function bkstBalanceHtml() {
  const signed = (BKST.data && BKST.data.signed_as_at && BKST.data.signed_as_at.accounts) || [],
    accounts = (BKST.data && BKST.data.accounts) || [],
    lines = accounts
      .map((account) => {
        const row = signed.filter((item) => item.account_id === account.account_id)[0];
        if (!row) return '';
        const cur = row.currency || BKST.data.currency,
          day = typeof shopDay === 'function' ? shopDay(String(row.period_to).slice(0, 10)) : String(row.period_to).slice(0, 10),
          rest = row.unexplained_minor ? txf('unexplained {a}', { a: bkMoney(row.unexplained_minor, cur) }) : tx('nothing unexplained');
        return '<div data-testid="bank-stmts-bal-' + bkstE(account.account_id) + '">' + (accounts.length > 1 ? '<b>' + bkstE(account.name || account.code) + '</b> · ' : '') + bkstE(txf('Signed off to {d}', { d: day }) + ' · ' + tx('Statement') + ' ' + bkMoney(row.statement_minor, cur) + ' · ' + rest) + '</div>';
      })
      .filter(Boolean);
  return lines.length ? '<div class="pe-note" data-testid="bank-stmts-balance">' + lines.join('') + '</div>' : '';
}
/** the first load: the year the address names, else this year (bank17 D2: the page opens on the year the address names, never a step back to find files) */
function bkstStartYear() {
  BKST.cur = bkhFyOf(bkhThisMonth());
  BKST.addr = bkstAddressPeriod();
  BKST.fy = BKST.addr ? BKST.addr.fy : BKST.cur;
  BKST.auto = !BKST.addr;
}
/** read the shown year; on the first load with no address, step back from this year until a year holds files */
async function bkstReadYear() {
  BKST.q = '';
  BKST.cursors = [null];
  BKST.ix = 0;
  if (window.CBList) CBList.reset('bank-stmts-files');
  let answer = await bkstFetch(BKST.fy);
  while (BKST.auto && answer.total === 0 && answer.older > 0 && BKST.cur - BKST.fy < (bkhRetention() || 40)) {
    BKST.fy -= 1;
    answer = await bkstFetch(BKST.fy);
  }
  BKST.auto = false;
  BKST.data = answer;
  BKST.fileTotal = answer.total;
  BKST.last = answer.files[0] ? String(answer.files[0].period_to || '').slice(0, 7) : '';
  BKST.mode = 'server';
}
/** how the box stands when its read failed: 'device' (the server's record is not set up yet), 'blind' (cost-blind sign-in) or 'error' */
function bkstFailureMode(failure) {
  if (failure && failure.status === 503) return 'device';
  return bksCostBlind(failure) ? 'blind' : 'error';
}
/** after a load: the sign-offs are read, then the All-years list or the home is painted, and a deep address opens its statement once */
async function bkstAfterLoad() {
  if (BKST.data && typeof bankHomeSigned === 'function') await bankHomeSigned().catch((failure) => bkQuiet('bank-stmts-signed', failure));
  if (BKST.data && BKST.all) await bankStmtAllLoad();
  else bankStmtPaint();
  if (typeof bankHomeDeepOnce === 'function') bankHomeDeepOnce(); /* a reload on #bank/<account>/<month> reopens that statement once the list is in */
}
/** read the box for the shown year (the first time: the year holding the newest statement, found by stepping back from this year); the files start again at page 1 with no search */
async function bankStmtLoad() {
  if (!bkstEl('bk_stmts')) return;
  try {
    if (BKST.fy === null) bkstStartYear();
    await bkstReadYear();
  } catch (failure) {
    BKST.data = null;
    BKST.mode = bkstFailureMode(failure);
  }
  await bkstAfterLoad();
}
/** All years: the counts of each year the pack says to keep (a one-file read per year: cells only), newest first */
async function bankStmtAllLoad() {
  BKST.allRows = null;
  bankStmtPaint();
  const years = bkhRetention();
  try {
    const list = [];
    for (let at = 0; at < years; at++) list.push(BKST.cur - at);
    const answers = await Promise.all(list.map((fy) => (fy === BKST.fy && BKST.data ? Promise.resolve(BKST.data) : bkstFetch(fy, { limit: 1 }))));
    BKST.allRows = list.map((fy, at) => ({ fy, tally: bkhTally(answers[at], answers[at].accounts) }));
  } catch (failure) {
    bkQuiet('bank-stmts-all', failure);
    BKST.allRows = [];
    BKST.all = false;
  }
  bankStmtPaint();
}
/** the files list asked for another search or page: only the files are read again (the cells stay) */
async function bkstFilesGo() {
  try {
    const answer = await bkstFetch(BKST.fy, Object.assign({}, BKST.q ? { q: BKST.q } : {}, BKST.cursors[BKST.ix] ? { after: BKST.cursors[BKST.ix] } : {}));
    BKST.data = Object.assign({}, BKST.data, { files: answer.files, total: answer.total, next: answer.next });
  } catch (_) {
    BKST.data = Object.assign({}, BKST.data, { files: [], total: 0, next: null });
  }
  const pager = bkstEl('bks_pager');
  if (pager) pager.innerHTML = bkstFilesFoot();
  if (BKST.filesApi) BKST.filesApi.refresh();
}
function bkstFilesQuery(text) {
  BKST.q = String(text || '').trim();
  BKST.cursors = [null];
  BKST.ix = 0;
  return bkstFilesGo();
}
/** Previous / Next of the files: a step through the server's cursors */
function bankStmtPage(step) {
  const at = BKST.ix + step;
  if (at < 0 || (step > 0 && !(BKST.data && BKST.data.next))) return;
  if (step > 0) BKST.cursors[at] = BKST.data.next;
  BKST.ix = at;
  return bkstFilesGo();
}
/** " · Signed off to 31 Oct 2026 · A$354.32 unexplained": the practice list's own Bank words, CARRIED by the api (GET /bank/statement-files unexplained: the newest sign-off of each account, one line per currency, never added across); '' when none was signed. No sum here. */
function bkstSignedLine() {
  const carried = BKST.data && BKST.data.unexplained;
  if (!carried || !carried.count) return '';
  const day = typeof shopDay === 'function' ? shopDay(carried.to) : String(carried.to || ''),
    several = (carried.by_currency || []).length > 1, /* two currencies: each figure names its own, so $ cannot be read as the other */
    lines = (carried.by_currency || []).map((line) => bkMoney(line.unexplained_minor, line.currency) + (several ? ' ' + line.currency : ''));
  return ' · ' + txf('Signed off to {d}', { d: day }) + (lines.length ? ' · ' + txf('{a} unexplained', { a: lines.join(' · ') }) : '');
}
const bkstMissing = (data) => (data ? bkhTally(data, data.accounts).missing : 0);
/** the one line of a box with no file in the shown year: the older statements kept, or that nothing (or no file) is kept, then the sign-off */
function bkstEmptyWords(data) {
  const said = data && data.older ? txf('{n} older statements kept', { n: data.older }) : bkstSignedLine() ? tx('No statement file kept') : tx('Nothing kept yet');
  return said + bkstSignedLine();
}
/** one line: what the box holds, said as the gap the person should fix */
function bkstSummary() {
  if (BKST.mode === 'device') return tx('Starts after an update. Your statement is still read on this device.');
  if (BKST.mode === 'blind' || (typeof BKH !== 'undefined' && BKH.blind)) return bksCostBlindSay();
  if (BKST.mode === 'error') return tx('Could not read the statements kept.');
  const data = BKST.data;
  if (!data || !BKST.fileTotal) return bkstEmptyWords(data);
  const gaps = bkstMissing(data),
    kept = BKST.last ? bkstMonth(BKST.last) + ' ✓ · ' : '';
  return kept + (gaps ? txf('{n} missing', { n: gaps }) : tx('Every month is kept')) + bkstSignedLine();
}
/** the box's one line: its name, what it holds (the gap to fix) and, on the home only, the press that opens Add statement (BKS014-B41) */
function bkstBarInner(open, ready) {
  return (
    '<b>' + bkstE(tx('Statements')) + '</b><span class="bks-sum" data-testid="bank-stmts-sum">' + bkstE(bkstSummary()) + '</span>' +
    (ready && bankHomeMayAdd() ? '<button data-cbsid="BKS014-B41" type="button" class="bks-tog" data-testid="bank-stmts-toggle" title="' + bkstE(bkstSummary()) + '" onclick="bankStmtToggle()" aria-expanded="' + open + '">' + bkstE(open ? tx('Hide') : tx('Add statement') + ' ▾') + '</button>' : '')
  );
}
/** the body of a ready box: the cards and the grid (or All years), the Add form when open, the kept files, the quiet "just read a file" and the note on where statements are kept */
function bkstBodyHtml(open) {
  return '<div class="bkh-body">' + (BKST.all ? bankHomeAllHtml() : bankHomeCardsHtml() + bankHomeGridHtml()) + (bankHomeMayAdd() ? (open ? bkstAddHtml() : '') : '') + '<div id="bks_out" class="pe-slot" data-testid="bank-stmts-out"></div>' + (BKST.all ? '' : bkstFilesHtml()) + (bankHomeMayAdd() ? bkstJustReadHtml() : '') + '<div class="pe-note" data-testid="bank-stmts-kept">' + bkstE(tx('Kept on our server for the record period; visible to the accountant or auditor you give access.')) + '</div></div>';
}
/** the home's page: the bar, the year steps, the balance line and (when the box is ready) the cards, the grid, the kept files and the quiet "just read a file" */
function bkstHomeHtml(open, ready) {
  const year = ready && BKST.data ? bankHomeFyHtml() : '';
  return (
    '<div class="bks-bar">' + bkstBarInner(open, ready) + '</div>' + year + (ready && BKST.data && BKH.known ? bkstBalanceHtml() : '') +
    (ready ? bkstBodyHtml(open) : '')
  );
}
/** on a phone the newest month that has begun shows first, not the months to come */
function bkstScrollGrids(host) {
  host.querySelectorAll('.bks-wrap').forEach((node) => {
    const days = Array.from(node.querySelectorAll('tbody tr:first-child td:not(.bkh-future):not(.bkh-tally)')),
      last = days[days.length - 1]; /* on a phone the newest month that has begun shows first, not the months to come */
    node.scrollLeft = last ? Math.max(0, last.offsetLeft + last.offsetWidth - node.clientWidth + 40) : node.scrollWidth;
  });
}
/** the press the last action asked to keep the keyboard on */
function bkstRefocus(host) {
  if (BKST.focus) {
    const node = host.querySelector('[data-testid="' + BKST.focus + '"]');
    BKST.focus = '';
    if (node && !node.disabled) node.focus({ preventScroll: true });
  }
}
/** the home: the cards of unfinished months, the grid, the kept files, then Add statement; over a statement's lines only the trail and its Back (bank-home) */
function bankStmtPaint() {
  const host = bkstEl('bk_stmts');
  if (!host) return;
  const ready = BKST.mode === 'server';
  bkstOneDoor(ready);
  if (BKB.view === 'lines') {
    host.style.display = '';
    host.innerHTML = bankHomeTrailHtml();
    return;
  }
  bankHomeClass();
  const hasFiles = !!(BKST.data && (BKST.fileTotal || BKST.data.older)),
    open = BKST.open === null ? !hasFiles : BKST.open; /* open on a bare page; folded once there is a grid to read */
  host.style.display = '';
  host.innerHTML = bkstHomeHtml(open, ready);
  bkstScrollGrids(host);
  if (ready && !BKST.all) bkstFilesMount();
  bkstRefocus(host);
}
/** W15-62: while the box is the door, the plain picker's file field and its sentence step aside (one "Add statement" door); the file input stays for "Just read a file", the quiet choice inside the box. Box not ready (503, error): the picker is the only door and stays. */
function bkstOneDoor(ready) {
  const field = bkstEl('bk_file') && bkstEl('bk_file').closest('label'),
    note = document.querySelector('[data-testid="bank-private"]');
  if (field) field.style.display = ready ? 'none' : '';
  if (note) note.style.display = ready ? 'none' : '';
}
/** the quiet secondary: read a file for this visit, keep nothing on our server (the device keeps the latest, as the picker always did) */
function bkstJustReadHtml() {
  return (
    '<div class="bks-just" data-testid="bank-stmts-justread"><button data-cbsid="BKS014-B45" type="button" class="bks-link" id="bks_just" data-testid="bank-stmts-justread-go" onclick="bankStmtJustRead()">' + bkstE(tx("Just read a file, don't keep it")) + '</button> ' +
    '<span class="bks-sum">' + bkstE(tx('Read on this device only. Not sent to our server; this device keeps the latest one.')) + '</span></div>'
  );
}
/** opens the plain picker's file input (bankPick reads it: the ONE reader) */
function bankStmtJustRead() {
  const input = bkstEl('bk_file');
  if (input) input.click();
}
function bankStmtToggle() {
  const open = BKST.open === null ? !(BKST.data && (BKST.fileTotal || BKST.data.older)) : BKST.open;
  BKST.open = !open;
  bankStmtPaint();
  const press = document.querySelector('[data-testid="bank-stmts-toggle"]');
  if (press) press.focus({ preventScroll: true }); /* the paint drew a new button: the keyboard stays on Add statement (Enter closed the box, focus must not fall to the page) */
}

/* ── the files: a CBList the SERVER pages (25 a page, newest first, searched by account, month or file name), then Read and Download ── */
function bkstFilesHtml() {
  if (!BKST.fileTotal && !BKST.q) return '';
  return (
    '<details class="bkh-files" data-testid="bank-stmts-filesbox"' + (BKST.filesOpen ? ' open' : '') + ' ontoggle="bkstFilesToggle(this)"><summary>' + bkstE(txf('Kept files · {n}', { n: BKST.fileTotal })) + ' · ' + bkstE(bkhFyLabel(BKST.fy)) + '</summary><div id="bks_pager" class="bkh-pager" data-testid="bank-stmts-pager">' + bkstFilesFoot() + '</div><div id="bks_fileslist" class="bkh-fileslist" data-testid="bank-stmts-files"></div></details>'
  );
}
function bkstFilesToggle(node) {
  BKST.filesOpen = !!node.open;
  if (node.open && BKST.filesApi) BKST.filesApi.refresh();
}
const bkstFileBy = (file) => (file.by_name ? file.by_name + (file.by_firm ? ', ' + file.by_firm : '') : '—');
/** Previous · "1–25 of 41" · Next: above the rows, so it is on screen however long the page is (the list's own foot would sit below the fold) */
function bkstFilesFoot() {
  const data = BKST.data;
  if (!data || !data.total) return '';
  const from = BKST.ix * BKST_PAGE + 1;
  return (
    '<span class="bkh-pageof" data-testid="bank-stmts-pageof">' + bkstE(txf('{a}–{b} of {n}', { a: from, b: from + data.files.length - 1, n: data.total })) + '</span> ' +
    CBList.pager({ prev: { label: tx('Previous'), tid: 'bank-stmts-prev', act: 'bankStmtPage(-1)', off: BKST.ix === 0 }, next: { label: tx('Next'), tid: 'bank-stmts-next', act: 'bankStmtPage(1)', off: !data.next } })
  );
}
const bkstPhone = () => !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
/** a phone's row of the files list: two lines, "Account 10 · Oct 2026" with Read and Download as small icon presses, then the file name (muted, cut short) and who added it */
function bkstFileCard(file) {
  const month = String(file.period_to || '').slice(0, 7),
    id = bkstE(file.id),
    press = (code, tid, run, glyph, word) => '<button data-cbsid="' + code + '" type="button" class="bks-btn bkf-ic" data-testid="' + tid + '" data-file="' + id + '" onclick="event.stopPropagation();' + run + '(this)" title="' + bkstE(word) + '" aria-label="' + bkstE(word + ' · ' + file.name) + '"><span aria-hidden="true">' + glyph + '</span></button>';
  return (
    '<span class="bkf-l1"><b>' + bkstE(bkstAccountName(bkstAccountOf(file.account_id))) + ' · ' + bkstE(bkstMonth(month) + ' ' + month.slice(0, 4)) + '</b><span class="bks-acts">' +
    press('BKS014-B42', 'bank-stmts-read', 'bankStmtRead', '▸', tx('Read')) + press('BKS014-B43', 'bank-stmts-download', 'bankStmtDownload', '↓', tx('Download')) + '</span></span>' +
    '<span class="bkf-l2" title="' + bkstE(file.name) + '">' + bkstE(file.name) + (file.overlaps ? ' · ⚠' : '') + ' · ' + bkstE(bkstFileBy(file)) + '</span>'
  );
}
/** the options of the kept-files list (one CBList mount): its columns (a card on a phone), the Read and Download presses, paging and search through the box's own reads */
function bkstFilesOptions() {
  const phone = bkstPhone();
  return {
    key: 'bank-stmts-files',
    t: tx,
    rows: () => (BKST.data ? BKST.data.files : []),
    id: (file) => file.id,
    rowTid: (file) => 'bank-stmts-file-' + file.id,
    defaultCols: phone ? ['card'] : ['account', 'period', 'name', 'by', 'acts'],
    columns: (phone ? [{ key: 'card', label: tx('File'), prio: 1, keep: true, w: 300, html: true, cell: bkstFileCard }] : []).concat([
      { key: 'account', label: tx('Account'), prio: 1, keep: true, w: 170, cell: (file) => bkstAccountName(bkstAccountOf(file.account_id)) },
      { key: 'period', label: tx('Period'), prio: 2, w: 210, html: true, cell: (file) => bkstE(bkDate(file.period_from)) + ' – ' + bkstE(bkDate(file.period_to)) + (file.overlaps ? ' <span class="bks-flag" title="' + bkstE(tx('Two statements cover this month')) + '">⚠ ' + bkstE(tx('overlap')) + '</span>' : '') },
      { key: 'name', label: tx('File'), prio: 3, w: 200, cell: (file) => file.name },
      { key: 'by', label: tx('Added by'), prio: 4, w: 130, cell: bkstFileBy },
      {
        key: 'acts',
        label: '',
        prio: 1,
        keep: true,
        w: 170,
        html: true,
        cell: (file) =>
          '<span class="bks-acts"><button data-cbsid="BKS014-B42" type="button" class="bks-btn" data-testid="bank-stmts-read" data-file="' + bkstE(file.id) + '" onclick="event.stopPropagation();bankStmtRead(this)">' + bkstE(tx('Read')) + '</button>' +
          '<button data-cbsid="BKS014-B43" type="button" class="bks-btn" data-testid="bank-stmts-download" data-file="' + bkstE(file.id) + '" onclick="event.stopPropagation();bankStmtDownload(this)">' + bkstE(tx('Download')) + '</button></span>'
      }
    ]),
    search: (file) => [bkstAccountName(bkstAccountOf(file.account_id)), file.name, file.period_from, file.period_to].join(' '),
    searchHint: tx('Account, month or file name'),
    empty: { title: tx('No kept file matches') },
    tools: { count: false } /* the pager above says "1–25 of 41" once; no second "25 shown of 41" */,
    remote: { total: () => (BKST.data ? BKST.data.total : 0), onQuery: (query) => bkstFilesQuery(query.q) }
  };
}
/** the list is drawn after the box is painted (the host is in the page again after every paint) */
function bkstFilesMount() {
  const host = bkstEl('bks_fileslist');
  BKST.filesApi = null;
  if (host && window.CBList) BKST.filesApi = CBList.mount(host, bkstFilesOptions());
}
/** the kept file's bytes through the seat's own headers (the adviser's X-Books-For rides in CBBooksActing), never cached */
function bkstFetchFile(id, use) {
  return fetch(CFG.API_BASE + '/api/books/bank/statement-files/' + encodeURIComponent(id) + '/file?use=' + use, {
    cache: 'no-store',
    headers: CBBooksActing.authHeaders()
  });
}
const bkstWhyNot = async (res) => (res.status === 403 && (await bkstBlind(res)) ? bksCostBlindSay() : res.status === 403 ? tx('This access has ended.') : res.status === 404 ? tx('That statement is no longer here.') : tx('The statement could not be opened. Nothing was lost; try again in a minute.'));
/** a 403 whose body says COST_BLIND (the file read has no api() wrapper, so the body is read here) */
const bkstBlind = (res) => res.clone().json().then((j) => bksCostBlind({ status: res.status, data: j }), () => false);
/** Read: the kept text goes to the page's ONE reader (bankTake), for the account it was kept against; nothing is parsed or hashed here */
async function bankStmtRead(button) {
  return bankStmtReadFile(button.getAttribute('data-file'));
}
/** which statement a Read means: the file named by id, the account's code, the file's name and its end date — a month of the grid names its newest file (hint), a row of the list is the file itself */
function bkstReadTarget(id, hint) {
  const file = ((BKST.data && BKST.data.files) || []).filter((item) => item.id === id)[0];
  return {
    file,
    code: hint ? hint.code : file ? bkstAccountOf(file.account_id).code : null,
    name: hint ? hint.name : file && file.name,
    to: hint ? hint.to : file && file.period_to
  };
}
/** the kept text goes to the page's ONE reader for the account it was kept against; a refusal stays on the home, said where the person is looking */
async function bkstOpenInReader(target, text) {
  const code = target.code,
    name = target.name,
    to = target.to;
  const select = bkbEl('bk_acct');
  if (select) select.value = String(code);
  bankAcctPick(String(code), true); /* the account the file was kept against; the screen is cleared, the device copy is not loaded over it */
  const out = bkbEl('bk_out');
  if (out) out.innerHTML = '';
  BKB.to = String(to || '').slice(0, 10); /* the trail's month is the file's, before the reader answers */
  await bankTake(text, name || 'statement.csv', false);
  if (BKB.view !== 'lines' && out && out.innerHTML) peBad('bks_out', out.textContent || tx('That statement could not be read.')); /* a refusal stays on the home, said where the person is looking */
}
/** Read one kept statement by its id (the grid names a month's newest file with a hint): the file is fetched, then read by the one reader */
async function bankStmtReadFile(id, hint) {
  const target = bkstReadTarget(id, hint);
  if (!target.code || !(target.file || hint)) return peBad('bks_out', tx('That statement is no longer here.'));
  let res;
  try {
    res = await bkstFetchFile(id, 'read');
  } catch (failure) {
    bkQuiet('bank-stmts-read', failure);
    return peBad('bks_out', tx('The statement could not be opened. Nothing was lost; try again in a minute.'));
  }
  if (!res.ok) return peBad('bks_out', await bkstWhyNot(res));
  return bkstOpenInReader(target, await res.text());
}
/** Download: the file as kept, to the device */
async function bankStmtDownload(button) {
  const id = button.getAttribute('data-file'),
    file = ((BKST.data && BKST.data.files) || []).filter((item) => item.id === id)[0];
  let res;
  try {
    res = await bkstFetchFile(id, 'download');
  } catch (_) {
    return peBad('bks_out', tx('The statement could not be opened. Nothing was lost; try again in a minute.'));
  }
  if (!res.ok) return peBad('bks_out', await bkstWhyNot(res));
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = (file && file.name) || 'statement';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

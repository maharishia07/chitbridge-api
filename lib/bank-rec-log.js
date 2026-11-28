// @stage tested
// CALLED BY routes/books.js
// @stage-note [BOOKS · FIN-70] The bank reconciliation record on the server: the engine's step actions and the signed statement figures, insert-only (b864).
'use strict';
// CARD  16-finance/bank-reconciliation-and-bank-rail
/**
 * lib/bank-rec-log.js — FIN-70: the bank reconciliation leaves a record the auditor can read (docs/16-finance/FIN-70-CRITIC.md, verdict CHANGE).
 *
 * ⭐ ONE INSERT-ONLY TABLE (b864 bank_rec_log), TWO KINDS OF ROW.
 *   mark       the action CBBankRecon.step already takes on one statement line — accept · undo · note · attach — stored as it came. The page replays the rows oldest
 *              first through the SAME step (newest wins per line key); the server replays nothing and computes nothing: no second reconciliation.
 *   statement  the BRS the page already shows, carried: opening · closing per bank · closing per books · difference · the currency · the file's HASH. A re-sign is a new row.
 * ⭐ THE SERVER STAMPS WHO AND WHEN (made_by from the session, made_at from its own clock). A body that names `by` or `at` is refused, not ignored.
 * ⭐ NEVER STORED: a statement line, a narration, the file name or the file. A note is the owner's own text (max 500) and now lives on the server — the page says so.
 * ⭐ EVERY AMOUNT CARRIES ITS CURRENCY (CUR-1): a statement whose currency is not the account's (the books') is refused, CURRENCY_MISMATCH 409; minor units, whole numbers.
 * ⭐ THE CROSS-CHECK IS A MISMATCH, NOT A RECOMPUTE: a posted entry from a bank line, whichever door posted it (see postedBankRefs: /entries, /events, /payments; ref manual:bank:<file hash>:<line> once normalised) that no live
 *   accept mark names is returned as a named exception on the read. Two carried sets compared: posted refs vs the entries the accept marks name (the engine's ledger id is
 *   "<entry_no>#<line>"; the part before the # is compared with the entry's number or id).
 * ⚠️ NOT MIGRATED → BOOKS_NOT_MIGRATED (503) in words: before b864 every door says the shared record arrives after the next update; the page keeps its marks on the device.
 */
const { waiting } = require('./not-migrated');

const ACTS = ['accept', 'undo', 'note', 'attach'];
const MARK_KEYS = ['act', 'key', 'how', 'chits', 'ledger', 'text', 'ref'];
const MAX_MARKS = 200;
const MAX_IDS = 50;
const MAX_LOG = 5000;
/* both forms of a bank line's source_ref: manual:bank:<file hash>:<line> (old) and manual:bank:<fingerprint, 24 hex>-<place> (the engine's bank-project.refsOf, via POST /events) */
const POSTED_REF = /^manual:bank:(?:([^:]+):(\d+)|([0-9a-f]{24})-(\d{1,4}))$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const WAITS = {
  record: waiting('The shared bank reconciliation record', false, 'Your marks and notes stay on this device only; nothing was sent to the server and nothing was lost.')
};
const ready = () => require('./schema').hasTable('bank_rec_log');

/** a refusal in words (422); `code` names the kind when it is not the general one */
function refuse(reason, code, status) {
  const refusal = new Error(reason);
  refusal.code = code || 'BOOKS_REFUSED';
  refusal.refused = true;
  if (status) refusal.status = status;
  return refusal;
}
async function mustBeReady() {
  if (!(await ready())) throw Object.assign(new Error(WAITS.record), { code: 'BOOKS_NOT_MIGRATED' });
}

/** the ledger an account key names: its code, its role or its id (the one reader GET /ledger/:account uses); null for none or a group */
function accountIn(chart, key) {
  const given = String(key == null ? '' : key);
  const found = chart.find((item) => String(item.code) === given) || chart.find((item) => item.role === given) || chart.find((item) => String(item.account_id) === given);
  return found && !found.is_group ? found : null;
}
const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
function ids(list, what) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || !item || item.length > 80) || list.length > MAX_IDS)
    throw refuse(what + ' must be a list of at most ' + MAX_IDS + ' ids.');
  return list;
}
const fileHash = (value) => {
  const hash = text(value, 129);
  if (hash.length > 128) throw refuse('The file hash is too long.');
  return hash || null;
};

/** the note or attached-file reference a mark carries (the other acts carry neither) */
function wordsOf(given) {
  if (given.act === 'note') {
    const note = text(given.text, 501);
    if (!note || note.length > 500) throw refuse('A note is 1 to 500 characters.');
    return { note, attach_ref: null };
  }
  if (given.act === 'attach') {
    const attachRef = text(given.ref, 201);
    if (!attachRef || attachRef.length > 200) throw refuse('An attached file needs its reference (1 to 200 characters), not its name.');
    return { note: null, attach_ref: attachRef };
  }
  return { note: null, attach_ref: null };
}
/** a mark that is an object of known keys with a known act, or the sentence it is refused with */
function checkedMark(given) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw refuse('A mark is an object: { act, key, … }.');
  const unknown = Object.keys(given).filter((name) => !MARK_KEYS.includes(name));
  if (unknown.length) throw refuse('A mark does not take ' + unknown.join(', ') + ' (who and when are set by the server).', 'UNKNOWN_FIELD');
  if (!ACTS.includes(given.act)) throw refuse('A mark is one of: ' + ACTS.join(', ') + '.');
  return given;
}
/** the line key and the "how" of a mark, each within its length */
function lineOf(given) {
  const key = text(given.key, 201);
  if (!key || key.length > 200) throw refuse('Which statement line? A key of 1 to 200 characters.');
  const method = text(given.how, 41) || null;
  if (method && method.length > 40) throw refuse('How is at most 40 characters.');
  return { key, how: method };
}
/** one mark as the engine's step takes it → the row's columns, or the sentence it is refused with */
function markOf(given) {
  const mark = checkedMark(given);
  return Object.assign({ act: mark.act, entry_ids: ids(mark.ledger, 'ledger'), chit_ids: ids(mark.chits, 'chits') }, lineOf(mark), wordsOf(mark));
}

const COLS_BASE = 'id, seq, account_id, kind, line_key, act, how, entry_ids, chit_ids, note, attach_ref, file_hash, period_from::text AS period_from, period_to::text AS period_to, '
  + 'opening_minor, closing_bank_minor, closing_books_minor, difference_minor, currency, tied, made_by, made_at';
/** W15-71: the reader says WHO matched and signed. The name is read by the ONE names reader (books-store namesOf: the shop's own people, bound to the shop), once for the rows, never as a subselect on identities */
async function named(db, e, rows) {
  const unnamed = rows.filter((row) => row.made_by && !row.by_name);
  if (!unnamed.length) return rows;
  const names = await require('./books-store').namesOf(db, e, unnamed.map((row) => row.made_by));
  unnamed.forEach((row) => { row.made_by_name = names.get(String(row.made_by)) || null; });
  return rows;
}
/** b871 (l16 adviser-bank): who acted for the books, kept at the write: the person's name and the firm's, for a row an ADVISER's person made */
const ACTING_COLS = ', grant_id, by_name, by_firm';
const actingReady = () => require('./schema').hasColumn('bank_rec_log', 'by_firm');
const journalActingReady = () => require('./schema').hasColumn('journal_entry', 'by_firm');
const colsOf = async () => COLS_BASE + ((await actingReady()) ? ACTING_COLS : '');
/** the stamp of an adviser's write: { grant_id, name, firm }, or null for the owner's own. Without b871 an adviser's write is refused in words, never stored unnamed. */
async function actingStamp(acting) {
  if (!acting) return { grant_id: null, name: null, firm: null, on: await actingReady() };
  if (!(await actingReady())) throw Object.assign(new Error(WAITS.record), { code: 'BOOKS_NOT_MIGRATED' });
  return { grant_id: acting.grant_id, name: text(acting.name, 200) || null, firm: text(acting.firm, 200) || null, on: true };
}
/** a stored row → what the caller reads: `by` and `at` are the server's; minor amounts are whole numbers (bigint arrives as text) */
function shown(row) {
  const out = Object.assign({}, row, { by: row.made_by || null, at: row.made_at });
  delete out.made_by;
  delete out.made_at;
  out.by_name = out.by_name || out.made_by_name || null; /* an adviser's person is named at the write; the owner's own marks by the identity row */
  delete out.made_by_name;
  if ('grant_id' in out) { out.by_name = out.by_name || null; out.by_firm = out.by_firm || null; out.for_client = !!out.grant_id; delete out.grant_id; } /* by_name · by_firm: who acted, and for whom, when an adviser made the row */
  for (const name of ['opening_minor', 'closing_bank_minor', 'closing_books_minor', 'difference_minor']) if (out[name] != null) out[name] = Number(out[name]);
  return out;
}

/** append marks → the rows, oldest first. One INSERT, however many marks; the server stamps who (the session) and when (now()). */
async function appendMarks(db, e, account, body, by, acting) {
  await mustBeReady();
  const stamp = await actingStamp(acting),
    COLS = await colsOf();
  const given = body.marks;
  if (!Array.isArray(given) || !given.length || given.length > MAX_MARKS) throw refuse('Send 1 to ' + MAX_MARKS + ' marks.');
  const hash = fileHash(body.file_hash),
    marks = given.map(markOf),
    args = [],
    values = marks.map((mark) => {
      const first = args.length;
      args.push(e, account.account_id, 'mark', mark.key, mark.act, mark.how, mark.entry_ids, mark.chit_ids, mark.note, mark.attach_ref, hash, by || null);
      if (stamp.on) args.push(stamp.grant_id, stamp.name, stamp.firm);
      return '(' + Array.from({ length: stamp.on ? 15 : 12 }, (_, offset) => '$' + (first + offset + 1)).join(',') + ')';
    });
  const result = await db.query(
    `INSERT INTO bank_rec_log (entity_id, account_id, kind, line_key, act, how, entry_ids, chit_ids, note, attach_ref, file_hash, made_by${stamp.on ? ', grant_id, by_name, by_firm' : ''}) VALUES ${values.join(',')} RETURNING ${COLS}`,
    args
  );
  return (await named(db, e, result.rows)).map(shown);
}

const whole = (value, name) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw refuse(name + ' is a whole number of minor units (cents, paise).');
  return value;
};
const dateField = (value, name) => {
  if (!DATE.test(String(value || '')) || Number.isNaN(Date.parse(value))) throw refuse(name + ' is a date, YYYY-MM-DD.', 'DATE_INVALID', 400);
  return value;
};
/**
 * WALK U U-F-01/02: the books' own figure for a bank account on a day (the trial balance's debit less credit: the ONE calculation the TB bank line already reads), in the shop's currency.
 * A statement may only be signed against THAT figure; the page carries it, the server checks it, so a bad or partial statement can never read "tied" against a books balance it never saw.
 */
const minorWords = (minor, currency) => require('./bill-privacy').money(minor, currency); /* the ONE words-for-an-amount reader (books-cashflow, books-dues, books-hooks) */
async function booksBalanceAt(db, e, account, day, currency) {
  const B = require('./books'),
    MoneyOps = require('./books-money-ops');
  const row = (await B.trialBalance(db, e, day, await B.ledgerCtx(db, e))).rows.find((item) => String(item.code) === String(account.code));
  return row ? MoneyOps.diffMinor(row.debit_minor, row.credit_minor, currency) : 0;
}

/**
 * BA-F-07: "tied" is the server's own sum, never the page's word: the bank's closing = the books' closing + the listed timing items (net, signed as the BRS adds them) + the difference left over;
 * the remainder is carried signed or as an amount, so its SIZE must be what is left. A statement cannot end on a day that has not come (a day of slack for the shop's zone).
 */
function tiedFigures(body, figures, to, currency) {
  const E = require('./books-engines');
  if (to > E.addDays(E.ymd(new Date()), 1)) throw refuse('A statement cannot end on ' + to + ': that day has not come.', 'DATE_INVALID', 400);
  const timing = body.exceptions_minor == null ? 0 : whole(body.exceptions_minor, 'exceptions_minor'),
    left = figures[1] - figures[2] - timing;
  if (Math.abs(left) !== Math.abs(figures[3]))
    throw refuse('These figures do not add up: the bank shows ' + minorWords(figures[1], currency) + ', the books ' + minorWords(figures[2], currency) + ' and the listed items ' + minorWords(timing, currency) + ', which leaves ' + minorWords(left, currency) + ' unexplained, not ' + minorWords(figures[3], currency) + '. Work the statement again, then sign off.', 'BANK_FIGURES_DONT_ADD', 409);
}

/**
 * ONE-FIGURE sign-off rule (28 Nov 2026, walk A06; critic CHANGE): a month is signed off only when EVERY statement line is matched, recorded or explained. Equal and opposite unmatched lines cancel in the closing figures
 * (the compensating pair the totals cannot see), so the page carries the count of lines still needing a decision (unmatched_lines) and the server refuses above 0. Outstanding items are the BOOKS' side only.
 * ⚠️ A request without the field (an older web) is still accepted: the lines live on the device, the server cannot count them (HOLE named in the PR: storing "not checked" needs a column, an Athi-run migration).
 */
function unmatchedLinesRefused(body) {
  if (body.unmatched_lines == null) return;
  const count = whole(body.unmatched_lines, 'unmatched_lines');
  if (count < 0) throw refuse('unmatched_lines is a count of lines, not below zero.');
  if (count > 0)
    throw refuse((count === 1 ? '1 statement line is' : count + ' statement lines are') + ' neither matched to your books nor explained, so this month cannot be signed off. Match, add or explain ' + (count === 1 ? 'it' : 'each') + ' under Needs you on the Bank page, then sign off.', 'BANK_LINES_UNMATCHED', 409);
}

/** BA-F-07: a mark or a sign-off belongs to a BANK ledger (role bank, or a sibling under the bank group, the web's bkbBanks): never the till cash or a sales account. Refused in words. */
function bankOnly(chart, account) {
  const main = chart.find((item) => item.role === 'bank');
  if (account.is_group || !(account.role === 'bank' || (main && main.parent_id != null && String(account.parent_id) === String(main.parent_id))))
    throw refuse(account.name + ' (' + account.code + ') is not a bank account, so a bank reconciliation cannot be kept on it. Pick one of the bank accounts.', 'NOT_A_BANK_ACCOUNT', 409);
  return account;
}

/** append a signed statement: the figures as the page's BRS carried them, in the account's own currency. tied is the server's own sum (the figures must add; tied = nothing unexplained). */
/**
 * AM-F-04: a statement's identity is its account + period + the hash of its lines (the file hash). The same statement signed again with the same carried books and bank figures
 * is nothing new to sign: refused 409 STATEMENT_ALREADY_SIGNED, in words, nothing stored. A re-sign is still a new row when the books moved since (a different books figure is a different sign-off).
 */
async function mustBeNew(db, e, account, from, to, hash, figures) {
  const seen = await db.query(
    `SELECT seq FROM bank_rec_log WHERE entity_id = $1 AND account_id = $2 AND kind = 'statement' AND file_hash = $3 AND period_from = $4::date AND period_to = $5::date AND closing_bank_minor = $6 AND closing_books_minor = $7 ORDER BY seq DESC LIMIT 1`,
    [e, account.account_id, hash, from, to, figures[1], figures[2]]
  );
  if (seen.rows && seen.rows.length) throw refuse('This statement (' + from + ' to ' + to + ') was already signed off against the same books figure. Nothing was saved. If the books have changed since, open the Bank page again and sign off the new figures.', 'STATEMENT_ALREADY_SIGNED', 409);
}
/**
 * AM-F-05: a sign-off whose period ends in a month the books have locked (soft or hard) is refused by the entries' own lock rule: the period engine's postingDate, strict, over the
 * months the shop stores (books.periodsOf) - PERIOD_LOCKED or YEAR_CLOSED in the engine's own words. Only the LOCK is asked: not the entries' future or before-the-ledger date gates.
 */
async function mustBeOpen(db, e, to) {
  const B = require('./books'),
    E = require('./books-engines'),
    ctx = await B.ledgerCtx(db, e),
    fy = E.packs().fiscalYearOf(to, ctx.pack);
  const verdict = E.period().postingDate({ type: 'posting', date: to }, B.periodsOf([await B.ensureYear(db, e, fy, ctx.pack, true)]), { strict: true, pack: ctx.pack });
  if (!verdict.ok) throw refuse(verdict.why, verdict.code, 409);
}

/** append a signed statement: the figures as the page's BRS carried them, in the account's own currency. Never recomputed; tied is "the carried difference is nil". */
async function appendStatement(db, e, account, currency, body, by, acting) {
  await mustBeReady();
  const stamp = await actingStamp(acting),
    COLS = await colsOf();
  const given = text(body.currency, 4).toUpperCase();
  if (given !== currency) throw Object.assign(refuse('This statement is in ' + (given || 'no currency') + ' but the account is kept in ' + currency + '.', 'CURRENCY_MISMATCH', 409), { field: 'currency' });
  const from = dateField(body.period_from, 'period_from'),
    to = dateField(body.period_to, 'period_to');
  if (to < from) throw refuse('The period ends before it starts.');
  const figures = ['opening_minor', 'closing_bank_minor', 'closing_books_minor', 'difference_minor'].map((name) => whole(body[name], name)),
    hash = fileHash(body.file_hash);
  if (!hash) throw refuse('The statement file hash is needed (the file itself stays on the device).');
  tiedFigures(body, figures, to, currency);
  unmatchedLinesRefused(body);
  await mustBeOpen(db, e, to);
  const books = await booksBalanceAt(db, e, account, to, currency);
  if (books !== figures[2]) throw refuse('The books show ' + minorWords(books, currency) + ' in this account on ' + to + ', not ' + minorWords(figures[2], currency) + '. Open the Bank page again so the figures are read from the books, then sign off.', 'BOOKS_FIGURE_DIFFERS', 409);
  await mustBeNew(db, e, account, from, to, hash, figures);
  const result = await db.query(
    `INSERT INTO bank_rec_log (entity_id, account_id, kind, file_hash, period_from, period_to, opening_minor, closing_bank_minor, closing_books_minor, difference_minor, currency, tied, made_by${stamp.on ? ', grant_id, by_name, by_firm' : ''})
     VALUES ($1, $2, 'statement', $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12${stamp.on ? ', $13, $14, $15' : ''}) RETURNING ${COLS}`,
    [e, account.account_id, hash, from, to, figures[0], figures[1], figures[2], figures[3], currency, figures[3] === 0, by || null].concat(stamp.on ? [stamp.grant_id, stamp.name, stamp.firm] : [])
  );
  return shown((await named(db, e, [result.rows[0]]))[0]);
}

/**
 * posted bank refs with no live accept mark → named exceptions. `posted` = [{ entry_id, entry_no, source_ref, posting_date, total_minor, currency }];
 * `marks` = the log, oldest first. A line's accept is live until a later undo of the same line key; newest wins.
 */
function exceptionsOf(posted, marks) {
  const last = new Map();
  for (const mark of marks) if (mark.act === 'accept' || mark.act === 'undo') last.set(mark.line_key, mark);
  const named = new Set();
  for (const mark of last.values()) if (mark.act === 'accept') (mark.entry_ids || []).forEach((id) => named.add(String(id).split('#')[0]));
  return posted
    .filter((entry) => !entry.reversed /* BA-F-01: the books reversed this line, the reversal nets it: not an exception */ && !named.has(String(entry.entry_no)) && !named.has(String(entry.entry_id)))
    .map((entry) => {
      const ref = POSTED_REF.exec(entry.source_ref) || [];
      return {
        code: 'POSTED_NOT_ACCEPTED',
        entry_id: entry.entry_id,
        entry_no: entry.entry_no,
        posting_date: String(entry.posting_date).slice(0, 10),
        amount_minor: Number(entry.total_minor),
        currency: entry.currency,
        file_hash: ref[1] || null,
        line_no: ref[2] ? Number(ref[2]) : null,
        fingerprint: ref[3] || null,
        place: ref[4] ? Number(ref[4]) : null,
        why: 'Entry ' + entry.entry_no + ' was posted from a bank line, but no accept mark names it.'
      };
    });
}

/**
 * the bank-line entries posted from a statement line, WHICHEVER DOOR posted them, that touch this account, in the range. A bank line carries ONE ref (the web's client_ref bank:<fp>-<n>);
 * each door keeps it somewhere else, and bankRefOf reads all three:
 *   POST /entries   source_ref manual:bank:<fp>-<n>
 *   POST /events    source_ref ev:<kind>:bank:<fp>-<n>   (a typed expense, income, … — lib/books-manual sourceRef)
 *   POST /payments  books_payment.client_ref bank:<fp>-<n>; the entry's source_ref is pay:<payment_id> (receipts and payments, matched or on account)
 * Every row comes back with `source_ref` = manual:<the bank ref>, the one form the cross-check and the feed read.
 */
const EVENT_REF = /^ev:[a-z_]+:(bank:.+)$/;
const bankRefOf = (row) => {
  const given = String(row.source_ref || '');
  const found = row.pay_ref && String(row.pay_ref).startsWith('bank:') ? row.pay_ref : EVENT_REF.exec(given) ? EVENT_REF.exec(given)[1] : given.startsWith('manual:bank:') ? given.slice('manual:'.length) : null;
  return found ? 'manual:' + found : null;
};
/** the bank references the books already hold for an account in a period (so a statement line posted once is not offered again) */
async function postedBankRefs(db, e, account, from, to) {
  const acting = (await journalActingReady()) ? ', en.by_name AS by_name, en.by_firm AS by_firm' : ''; /* b871: an adviser's person and firm, kept on the entry */
  const result = await db.query(
    `SELECT DISTINCT ON (en.entry_id) en.entry_id, en.entry_no, en.source_ref, pay.client_ref AS pay_ref, en.posting_date::text AS posting_date, en.doc_date::text AS doc_date, en.total_minor, en.currency, en.created_at::text AS made_at, i.display_name AS made_by, EXISTS (SELECT 1 FROM journal_entry rv WHERE rv.entity_id = en.entity_id AND rv.reverses_entry_id = en.entry_id) AS reversed${acting}
       FROM journal_entry en JOIN journal_line li ON li.entry_id = en.entry_id AND li.entity_id = en.entity_id
       LEFT JOIN books_payment pay ON pay.entity_id = en.entity_id AND en.source_ref = 'pay:' || pay.payment_id::text AND pay.client_ref LIKE 'bank:%'
       LEFT JOIN identities i ON i.identity_id = en.created_by
      WHERE en.entity_id = $1 AND li.account_id = $2 AND (en.source_ref LIKE 'manual:bank:%' OR en.source_ref LIKE 'ev:%:bank:%' OR pay.payment_id IS NOT NULL)
        AND (($3::date IS NULL OR en.posting_date >= $3::date) AND ($4::date IS NULL OR en.posting_date <= $4::date)
            OR ($3::date IS NULL OR en.doc_date >= $3::date) AND ($4::date IS NULL OR en.doc_date <= $4::date)) /* l16 banklock: a line moved to the next open month stays found by its own statement date */
      ORDER BY en.entry_id LIMIT 500`,
    [e, account.account_id, from, to]
  );
  return result.rows.map((row) => Object.assign({}, row, { source_ref: bankRefOf(row) })).filter((row) => row.source_ref && POSTED_REF.test(row.source_ref));
}

/**
 * the bank lines already posted (POST /events), one per entry, as a statement page reads them to say WHY a line is already in the books:
 * [{ ref ('bank:<fingerprint>-<n>' or 'bank:<hash>:<n>': the stored source_ref without its 'manual:'), entry_no, posting_date, made_at (the server's stamp), made_by (the writer's name) }]. Carried, not computed.
 */
function postedOf(posted) {
  return posted.map((entry) => ({ ref: String(entry.source_ref).replace(/^manual:/, ''), entry_no: entry.entry_no, posting_date: String(entry.posting_date).slice(0, 10), doc_date: entry.doc_date ? String(entry.doc_date).slice(0, 10) : null, made_at: entry.made_at || null, made_by: entry.made_by || null, by_name: entry.by_name || null, by_firm: entry.by_firm || null }));
}

/**
 * the log of one account, and what the cross-check found: { marks (oldest first), statements (newest first), posted, exceptions (null = not counted: the marks read were not the whole log) }.
 * The period (from · to, either may be absent) narrows the statements that overlap it and the posted refs. A mark carries no date of its own (its line key is the page's), so the marks are not dated: they are the NEWEST `limit`
 * (default 5000, 0 = none: the Bank home needs only the sign-offs), returned oldest first so a replay is unchanged; `marks_next` (the seq of the oldest returned) is the cursor of the next older page (`before`), null when none is left.
 * ⚠️ It was ORDER BY seq LIMIT 5000 (the OLDEST 5,000): after the 5,000th mark the newest reconciliation never came back (l16 growth5y).
 */
const MARKS_BAD = { limit: ['Marks limit is a whole number from 0 to ' + MAX_LOG + '.', 'MARKS_LIMIT_INVALID'], before: ['The marks cursor is the marks_next the last answer gave.', 'MARKS_CURSOR_INVALID'] };
/** a query word that was not sent, or sent empty */
const isBlank = (value) => value == null || value === '';
/** the marks page a query asks for: { limit (0 to 5000, default 5000), before (a seq or null) }, or the sentence */
function marksPageOf(query) {
  const given = query || {};
  const limit = isBlank(given.marks_limit) ? MAX_LOG : Number(given.marks_limit);
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_LOG) throw refuse(MARKS_BAD.limit[0], MARKS_BAD.limit[1], 400);
  const before = isBlank(given.marks_before) ? null : Number(given.marks_before);
  if (before !== null && (!Number.isInteger(before) || before < 1)) throw refuse(MARKS_BAD.before[0], MARKS_BAD.before[1], 400);
  return { limit, before };
}
/** one account's bank reconciliation log: the marks page asked for, the signed statements, the bank lines the books hold, and the exceptions between them (null when the page is not the whole log) */
async function read(db, e, account, from, to, page) {
  await mustBeReady();
  const COLS = await colsOf();
  const { limit, before } = page || { limit: MAX_LOG, before: null };
  const [marks, statements, posted] = await Promise.all([
    limit === 0 ? { rows: [] } : db.query(`SELECT ${COLS} FROM bank_rec_log WHERE entity_id = $1 AND account_id = $2 AND kind = 'mark' AND ($3::bigint IS NULL OR seq < $3::bigint) ORDER BY seq DESC LIMIT ${limit + 1}`, [e, account.account_id, before]),
    db.query(
      `SELECT ${COLS} FROM bank_rec_log WHERE entity_id = $1 AND account_id = $2 AND kind = 'statement'
          AND ($3::date IS NULL OR period_to >= $3::date) AND ($4::date IS NULL OR period_from <= $4::date) ORDER BY seq DESC LIMIT 200`,
      [e, account.account_id, from, to]
    ),
    postedBankRefs(db, e, account, from, to)
  ]);
  const newest = marks.rows.slice(0, limit), /* the NEWEST marks are the ones kept; the answer is oldest first, as a replay reads it */
    log = (await named(db, e, newest)).slice().reverse().map(shown);
  const next = marks.rows.length > limit ? Number(newest[newest.length - 1].seq) : null;
  /* exceptions are worked out from the marks that came back: with no marks read (limit 0), a truncated page (marks_next) or an older page (before) an accept may sit outside them, so the answer is UNKNOWN (null), never "every posted line is not accepted" */
  const complete = limit > 0 && next === null && before == null;
  return { marks: log, marks_next: next, statements: (await named(db, e, statements.rows)).map(shown), posted: postedOf(posted), exceptions: complete ? exceptionsOf(posted, log) : null };
}

/**
 * the statement the books are SIGNED OFF TO, of ANY bank account (a Home card's one read): LATEST_SQL's unbroken run, the same reader as the Bank page (RW1-rep: it read the newest by seq, past a hole), of the accounts the one signed to the latest day.
 * The row, or null when none was ever signed or the table is not migrated. Never recomputed; two trips (the run, then its row).
 */
async function latest(db, e) {
  if (!(await ready())) return null;
  const run = (await db.query(LATEST_SQL('$1'), [e])).rows.sort((a, b) => String(b.period_to).localeCompare(String(a.period_to)) || Number(b.seq) - Number(a.seq))[0];
  if (!run) return null;
  const COLS = await colsOf();
  const rows = await db.query(`SELECT ${COLS} FROM bank_rec_log WHERE entity_id = $1 AND kind = 'statement' AND seq = $2`, [e, run.seq]);
  return rows.rows[0] ? shown((await named(db, e, [rows.rows[0]]))[0]) : null;
}

/**
 * the newest mark made AFTER the last signed statement (or any mark, when none was ever signed): work on a loaded statement that is not signed off yet, as carried
 * (its day is the server's made_at; the file stays on the device, so no statement difference exists here to show). null when nothing is waiting. One trip.
 */
async function unsigned(db, e) {
  if (!(await ready())) return null;
  const COLS = await colsOf();
  const rows = await db.query(
    `SELECT ${COLS} FROM bank_rec_log WHERE entity_id = $1 AND kind = 'mark'
       AND seq > COALESCE((SELECT MAX(seq) FROM bank_rec_log WHERE entity_id = $1 AND kind = 'statement'), 0) ORDER BY seq DESC LIMIT 1`,
    [e]
  );
  return rows.rows[0] ? shown((await named(db, e, [rows.rows[0]]))[0]) : null;
}

/**
 * ⭐ THE ONE RULE OF "UNEXPLAINED" (l16 fable3; the practice list and the Bank home both read it): the NEWEST signed statement of each bank account (LATEST_SQL), its difference as carried, in the
 * currency it was signed in (CUR-1). Amounts of two currencies are NEVER added: `by_currency` has one line per currency; `unexplained_minor` is the one figure only when a single currency is in play (else null).
 * `to` = the earliest period end of the accounts (the books are reconciled to there). Pure: rows in, answer out.
 */
/**
 * ONE RULE OF "THE NEWEST SIGN-OFF" (bankfix): the one signed to the LATEST PERIOD END, a later re-sign of the same end winning (period_to DESC, seq DESC), never the last one MADE (seq alone):
 * re-signing May after June must not move "reconciled to" back to May (the bank17 critic, finding 2). With an `asOfParam` it is "on or before that day", the Bank page's period end.
 * ⭐ SIGNED OFF TO = THE END OF THE UNBROKEN RUN (FW-36, 25 Nov; Xero/MYOB reconciled-to is a statement-by-statement chain, never a later date over a hole): the periods signed for an account
 * must join up (each starts within a day of the end of those before it); the first month nobody signed ends the run and anything signed after the hole is not signed off to (September unsigned, October signed = to 31 Aug).
 * Carries the figures as signed (closing_bank_minor, closing_books_minor), the difference (the UNEXPLAINED remainder after the timing items, signed; NOT statement minus books) and made_at.
 */
const LATEST_SQL = (entityParam, asOfParam) =>
  `SELECT DISTINCT ON (c.account_id) c.account_id, c.seq, c.period_to::text AS period_to, c.difference_minor, c.closing_bank_minor, c.closing_books_minor, c.made_at::text AS made_at, c.currency FROM (`
  + `SELECT s.*, MIN(s.gap_at) OVER (PARTITION BY s.account_id) AS first_gap FROM (`
  + `SELECT b.account_id, b.seq, b.period_from, b.period_to, b.difference_minor, b.closing_bank_minor, b.closing_books_minor, b.made_at, b.currency, `
  /* a sign-off whose period starts MORE than a day after everything signed before it leaves a hole (an unsigned month): it is where the unbroken run ends */
  /* RW1-11/12 (26 Nov): the run starts where the books' bank activity starts, not at the first sign-off: before any sign-off the day BEFORE the account's first journal line (the opening balance carried in is not activity) stands in for "everything signed before it" (Xero/MYOB: the chain begins at the conversion balance, every statement after it is reconciled). No activity = no start = the old rule. */
  + `CASE WHEN period_from > COALESCE(MAX(period_to) OVER (PARTITION BY account_id ORDER BY period_to, seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), `
  + `(SELECT MIN(en.posting_date) FROM journal_entry en JOIN journal_line li ON li.entry_id = en.entry_id AND li.entity_id = en.entity_id WHERE en.entity_id = b.entity_id AND li.account_id = b.account_id AND COALESCE(en.source_ref, '') NOT LIKE 'opening:%') - 1) + 1 THEN period_to END AS gap_at `
  + `FROM bank_rec_log b WHERE b.entity_id = ${entityParam} AND kind = 'statement'${asOfParam ? ` AND period_to <= ${asOfParam}::date` : ''}) s) c `
  + `WHERE c.first_gap IS NULL OR c.period_to < c.first_gap ORDER BY c.account_id, c.period_to DESC, c.seq DESC`;
/**
 * W4-02 (walk 4): the newest sign-off of each account WHATEVER the run (period_to DESC, seq DESC, the same order as LATEST_SQL): what the Bank page shows as "Oct: A$354.32 unexplained" beside "Months are signed off, none in an unbroken run".
 * The practice list reads it only when LATEST_SQL's run rule gives nothing, so a client with a lone signed month is never "No statement". The difference is as carried, never recomputed.
 */
const NEWEST_ANY_SQL = (entityParam) => `SELECT DISTINCT ON (b.account_id) b.account_id, b.period_to::text AS period_to, b.difference_minor, b.currency FROM bank_rec_log b WHERE b.entity_id = ${entityParam} AND b.kind = 'statement' ORDER BY b.account_id, b.period_to DESC, b.seq DESC`;
/**
 * RW2-03 ONE PHRASE for "months are signed off but not one of them is in an unbroken run from the first bank entry" (Oct signed alone, Sept not): the trial balance's bank line
 * (state 'no_run'), the Home Bank card and the web read the same words, never "No bank sign-off yet" beside the Bank page's "1 of 12".
 */
const NO_RUN_WORDS = 'Months are signed off, none in an unbroken run from the first bank entry';
/** the accounts with ANY signed statement, run or not: [{ account_id }] (RW2-03: the run rule hides a lone month from LATEST_SQL, it does not un-sign it). One trip. */
async function signedAccounts(db, e) {
  if (!(await ready())) return [];
  return (await db.query("SELECT DISTINCT account_id FROM bank_rec_log WHERE entity_id = $1 AND kind = 'statement'", [e])).rows;
}
/** a day as YYYY-MM-DD: the SQL casts it to text; a driver Date (a pg date is local midnight) is read by its calendar parts, never String(date) ("Sat Oct 31", R4-1) */
const dayOf = (v) => (v instanceof Date ? (Number.isNaN(v.getTime()) ? null : [v.getFullYear(), String(v.getMonth() + 1).padStart(2, '0'), String(v.getDate()).padStart(2, '0')].join('-')) : String(v || '').slice(0, 10) || null);
/** the unexplained amounts summed per currency (never across): [{ currency, unexplained_minor, to (the earliest period end) }] */
function sumByCurrency(list) {
  const by = new Map();
  for (const row of list) {
    const line = by.get(row.currency) || { currency: row.currency, unexplained_minor: 0, to: null };
    line.unexplained_minor += row.unexplained_minor;
    if (row.to && (!line.to || row.to < line.to)) line.to = row.to;
    by.set(row.currency, line);
  }
  return [...by.values()];
}
/** the unexplained difference of the latest signed statements (rows of LATEST_SQL): per account, per currency, and the single-currency headline when there is one currency only */
function unexplainedOf(rows) {
  const list = (rows || []).filter(Boolean).map((row) => ({ account_id: row.account_id || null, to: dayOf(row.period_to), currency: row.currency || null, unexplained_minor: Math.abs(Number(row.difference_minor || 0)) }));
  const sums = sumByCurrency(list);
  const lines = sums.filter((line) => line.unexplained_minor > 0);
  const single = sums.length === 1 ? sums[0] : null;
  const dates = list.map((row) => row.to).filter(Boolean).sort();
  return {
    accounts: list.map((row) => ({ account_id: row.account_id, currency: row.currency, unexplained_minor: row.unexplained_minor, to: row.to })),
    by_currency: lines,
    currency: single ? single.currency : null,
    unexplained_minor: single ? single.unexplained_minor : null,
    to: dates[0] || null,
    count: list.length
  };
}
/**
 * the Bank home's read: the same rule over the whole shop (never only the years on show); the not-migrated table reads as nothing signed.
 * W4-12: when the run rule gives nothing but a month IS signed, no_run is true and words is the ONE sentence (NO_RUN_WORDS) the trial balance and the practice list say; one more read, only in that case.
 */
async function unexplained(db, e) {
  if (!(await ready())) return Object.assign(unexplainedOf([]), { no_run: false, words: null });
  const run = unexplainedOf((await db.query(LATEST_SQL('$1'), [e])).rows);
  const noRun = run.count === 0 && (await db.query(NEWEST_ANY_SQL('$1'), [e])).rows.length > 0;
  return Object.assign(run, { no_run: noRun, words: noRun ? NO_RUN_WORDS : null });
}

/** BD-F-03: how far the STORED statement and books figures of a sign-off are apart (absolute minor units; a sign-off saved before BA-F-07 can say tied over a gap, its timing items never stored): the screens name it in words. null without a currency. */
const apartMinor = (row) => (row.currency ? Math.abs(require('./books-money-ops').diffMinor(Number(row.closing_bank_minor || 0), Number(row.closing_books_minor || 0), row.currency)) : null);
/**
 * the sign-off of each account on or before a day, AS CARRIED, for the Bank page's line (rows of LATEST_SQL(entity, asOf) in, answer out; no sum, no recompute):
 * statement_minor = the bank's closing figure signed, books_signed_minor = the books' figure the browser sent, unexplained_minor = |difference_minor| (the remainder after the timing items,
 * so a clean sign-off with an unpresented cheque has statement != books and unexplained 0), tied = unexplained 0. An account never signed by that day has no row.
 */
function asAtOf(rows, asOf) {
  return {
    asOf: asOf || null,
    accounts: (rows || []).filter(Boolean).map((row) => ({
      account_id: row.account_id || null,
      currency: row.currency || null,
      period_to: dayOf(row.period_to),
      statement_minor: Number(row.closing_bank_minor || 0),
      books_signed_minor: Number(row.closing_books_minor || 0),
      unexplained_minor: Math.abs(Number(row.difference_minor || 0)),
      apart_minor: apartMinor(row),
      tied: Number(row.difference_minor || 0) === 0,
      made_at: row.made_at ? String(row.made_at) : null
    }))
  };
}
/** the Bank page's read: the same rule as the Home, on or before a day; the not-migrated table reads as nothing signed */
async function signedAsAt(db, e, asOf, chart) {
  if (!(await ready())) return asAtOf([], asOf);
  const out = asAtOf((await db.query(LATEST_SQL('$1', '$2'), [e, asOf])).rows, asOf);
  return chart ? movedSinceSigned(db, e, out, chart) : out;
}
/**
 * WALK U U-F-03: a sign-off is true for the books AS THEY WERE. Each account's line is read again against the books NOW at its period end (booksBalanceAt, the TB's figure): books_now_minor, and
 * moved_minor = how far that is from the books figure signed. A reversal after sign-off moves it, so the line is no longer tied (tied false, stale true) and the page says the books changed, never "nothing unexplained".
 */
async function movedSinceSigned(db, e, out, chart) {
  for (const line of out.accounts) {
    const account = (chart || []).find((item) => String(item.account_id) === String(line.account_id));
    if (!account || !line.period_to) continue;
    const now = await booksBalanceAt(db, e, account, line.period_to, line.currency);
    const MoneyOps = require('./books-money-ops');
    Object.assign(line, { books_now_minor: now, moved_minor: Math.abs(MoneyOps.diffMinor(now, line.books_signed_minor, line.currency)) });
    line.stale = line.moved_minor > 0;
    if (line.stale) line.tied = false;
  }
  return out;
}

/**
 * ⭐ RANK 9 (17 Nov) THE BANK LINE OF THE TRIAL BALANCE, one entry per bank account: the sign-off the ONE rule picks on or before the day (`atRows` = LATEST_SQL(entity, asOf)),
 * `anyRows` = LATEST_SQL(entity) (does ANY sign-off exist), `tbRows` = the trial balance rows ({ code, debit_minor, credit_minor }), `chart` = the shop's accounts, `cur` = the shop's currency.
 * State: reconciled (period end = the day, remainder 0) · unexplained (period end = the day, remainder not 0) · earlier (signed before the day: the date and the statement as signed, NO
 * difference across dates) · none_by_date (signed, but only after the day) · never (no sign-off at all). unexplained_minor is absolute (difference_minor is the remainder after the timing
 * items, NOT statement minus books). books_now_minor = the trial balance's debit less credit on that account (an overdraft is negative); moved_minor = |now - the figure signed|, only when
 * the period end is the day and the line is in the shop's currency (two currencies are never compared or added). Pure: rows in, answer out.
 */
function tbBankOf(atRows, anyRows, asOf, tbRows, chart, currency, everRows) {
  const ever = new Map((everRows || []).filter(Boolean).map((row) => [String(row.account_id), row]));
  const at = new Map((atRows || []).filter(Boolean).map((row) => [String(row.account_id), row]));
  const any = new Map((anyRows || []).filter(Boolean).map((row) => [String(row.account_id), row]));
  const byCode = new Map((tbRows || []).map((row) => [String(row.code), row]));
  const accounts = (chart || []).filter((item) => !item.is_group && (item.role === 'bank' || at.has(String(item.account_id)) || any.has(String(item.account_id))));
  return accounts.map((account) => tbBankLine(account, { row: at.get(String(account.account_id)) || null, signedEver: any.has(String(account.account_id)), signedNoRun: ever.has(String(account.account_id)), trialRow: byCode.get(String(account.code)), asOf, currency }));
}
/** a bank account's line before anything is known of it: never signed, every figure null */
function emptyBankLine(account, currency) {
  return { account_id: account.account_id, code: account.code, name: account.name, currency, state: 'never', period_to: null, statement_minor: null, books_signed_minor: null, unexplained_minor: null, books_now_minor: null, moved_minor: null, signed_at: null };
}
/** what the sign-off says of the statement: its period end, the bank's closing figure and when it was signed */
const statementFigures = (row) => ({ period_to: dayOf(row.period_to), statement_minor: Number(row.closing_bank_minor || 0), signed_at: row.made_at ? String(row.made_at) : null });
/** the figures of a sign-off on the day itself: the books figure signed and the unexplained remainder (absolute) */
const signedFigures = (row) => ({ books_signed_minor: Number(row.closing_books_minor || 0), unexplained_minor: Math.abs(Number(row.difference_minor || 0)), apart_minor: apartMinor(row) });
/** the state of an account with no sign-off on the day: signed on an earlier day · signed but in no unbroken run · never */
const unsignedState = (found) => (found.signedEver ? 'none_by_date' : found.signedNoRun ? 'no_run' : 'never');
/** one bank account's line on the trial balance: its state and, on the day itself, how far the books have moved since the figure signed */
function tbBankLine(account, found) {
  const { row, trialRow, asOf, currency } = found;
  const line = emptyBankLine(account, row ? row.currency || currency : currency);
  if (!row) return Object.assign(line, { state: unsignedState(found) });
  Object.assign(line, statementFigures(row));
  if (line.period_to !== asOf) return Object.assign(line, { state: 'earlier' });
  Object.assign(line, { state: Number(row.difference_minor || 0) === 0 ? 'reconciled' : 'unexplained' }, signedFigures(row));
  return trialRow && line.currency === currency ? Object.assign(line, movedSince(trialRow, line, currency)) : line;
}
/** how far the books have moved since the figure signed: the trial balance's debit less credit now, and the distance from the signed books figure (one currency only) */
function movedSince(trialRow, line, currency) {
  const MoneyOps = require('./books-money-ops');
  const now = MoneyOps.diffMinor(trialRow.debit_minor, trialRow.credit_minor, currency);
  return { books_now_minor: now, moved_minor: Math.abs(MoneyOps.diffMinor(now, line.books_signed_minor, currency)) };
}
/** the trial balance's read: two SELECTs inside the caller's entity transaction; null (no block) when b864 is not run, so the page says nothing and nothing breaks */
async function onTrialBalance(db, e, asOf, tbRows, chart, currency) {
  if (!(await ready())) return null;
  const at = (await db.query(LATEST_SQL('$1', '$2'), [e, asOf])).rows;
  const any = (await db.query(LATEST_SQL('$1'), [e])).rows;
  return tbBankOf(at, any, asOf, tbRows, chart, currency, await signedAccounts(db, e));
}

module.exports = { NEWEST_ANY_SQL, tbBankOf, onTrialBalance, unexplained, unexplainedOf, asAtOf, signedAsAt, LATEST_SQL, NO_RUN_WORDS, signedAccounts, latest, unsigned, WAITS, ready, accountIn, bankOnly, markOf, appendMarks, appendStatement, exceptionsOf, read, refuse, marksPageOf };

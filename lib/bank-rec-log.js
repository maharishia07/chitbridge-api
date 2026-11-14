// @stage built
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
 * ⭐ THE CROSS-CHECK IS A MISMATCH, NOT A RECOMPUTE: a posted entry whose source_ref is manual:bank:<file hash>:<line> (the bank-to-books door, POST /events) that no live
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
const POSTED_REF = /^manual:bank:([^:]+):(\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const WAITS = {
  record: waiting('The shared bank reconciliation record', false, 'Your marks and notes stay on this device only; nothing was sent to the server and nothing was lost.')
};
const ready = () => require('./schema').hasTable('bank_rec_log');

/** a refusal in words (422); `code` names the kind when it is not the general one */
function refuse(why, code, status) {
  const refusal = new Error(why);
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

/** one mark as the engine's step takes it → the row's columns, or the sentence it is refused with */
function markOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw refuse('A mark is an object: { act, key, … }.');
  const unknown = Object.keys(raw).filter((name) => !MARK_KEYS.includes(name));
  if (unknown.length) throw refuse('A mark does not take ' + unknown.join(', ') + ' (who and when are set by the server).', 'UNKNOWN_FIELD');
  if (!ACTS.includes(raw.act)) throw refuse('A mark is one of: ' + ACTS.join(', ') + '.');
  const key = text(raw.key, 201);
  if (!key || key.length > 200) throw refuse('Which statement line? A key of 1 to 200 characters.');
  const mark = { act: raw.act, key, how: text(raw.how, 41) || null, entry_ids: ids(raw.ledger, 'ledger'), chit_ids: ids(raw.chits, 'chits'), note: null, attach_ref: null };
  if (mark.how && mark.how.length > 40) throw refuse('How is at most 40 characters.');
  if (raw.act === 'note') {
    mark.note = text(raw.text, 501);
    if (!mark.note || mark.note.length > 500) throw refuse('A note is 1 to 500 characters.');
  }
  if (raw.act === 'attach') {
    mark.attach_ref = text(raw.ref, 201);
    if (!mark.attach_ref || mark.attach_ref.length > 200) throw refuse('An attached file needs its reference (1 to 200 characters), not its name.');
  }
  return mark;
}

const COLS = 'id, seq, account_id, kind, line_key, act, how, entry_ids, chit_ids, note, attach_ref, file_hash, period_from::text AS period_from, period_to::text AS period_to, '
  + 'opening_minor, closing_bank_minor, closing_books_minor, difference_minor, currency, tied, made_by, made_at';
/** a stored row → what the caller reads: `by` and `at` are the server's; minor amounts are whole numbers (bigint arrives as text) */
function shown(row) {
  const out = Object.assign({}, row, { by: row.made_by || null, at: row.made_at });
  delete out.made_by;
  delete out.made_at;
  for (const name of ['opening_minor', 'closing_bank_minor', 'closing_books_minor', 'difference_minor']) if (out[name] != null) out[name] = Number(out[name]);
  return out;
}

/** append marks → the rows, oldest first. One INSERT, however many marks; the server stamps who (the session) and when (now()). */
async function appendMarks(db, e, account, body, by) {
  await mustBeReady();
  const raw = body.marks;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_MARKS) throw refuse('Send 1 to ' + MAX_MARKS + ' marks.');
  const hash = fileHash(body.file_hash),
    marks = raw.map(markOf),
    args = [],
    values = marks.map((mark) => {
      const first = args.length;
      args.push(e, account.account_id, 'mark', mark.key, mark.act, mark.how, mark.entry_ids, mark.chit_ids, mark.note, mark.attach_ref, hash, by || null);
      return '(' + Array.from({ length: 12 }, (_, offset) => '$' + (first + offset + 1)).join(',') + ')';
    });
  const result = await db.query(
    `INSERT INTO bank_rec_log (entity_id, account_id, kind, line_key, act, how, entry_ids, chit_ids, note, attach_ref, file_hash, made_by) VALUES ${values.join(',')} RETURNING ${COLS}`,
    args
  );
  return result.rows.map(shown);
}

const whole = (value, name) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw refuse(name + ' is a whole number of minor units (cents, paise).');
  return value;
};
const day = (value, name) => {
  if (!DATE.test(String(value || '')) || Number.isNaN(Date.parse(value))) throw refuse(name + ' is a date, YYYY-MM-DD.', 'DATE_INVALID', 400);
  return value;
};
/** append a signed statement: the figures as the page's BRS carried them, in the account's own currency. Never recomputed; tied is "the carried difference is nil". */
async function appendStatement(db, e, account, currency, body, by) {
  await mustBeReady();
  const given = text(body.currency, 4).toUpperCase();
  if (given !== currency) throw Object.assign(refuse('This statement is in ' + (given || 'no currency') + ' but the account is kept in ' + currency + '.', 'CURRENCY_MISMATCH', 409), { field: 'currency' });
  const from = day(body.period_from, 'period_from'),
    to = day(body.period_to, 'period_to');
  if (to < from) throw refuse('The period ends before it starts.');
  const figures = ['opening_minor', 'closing_bank_minor', 'closing_books_minor', 'difference_minor'].map((name) => whole(body[name], name)),
    hash = fileHash(body.file_hash);
  if (!hash) throw refuse('The statement file hash is needed (the file itself stays on the device).');
  const result = await db.query(
    `INSERT INTO bank_rec_log (entity_id, account_id, kind, file_hash, period_from, period_to, opening_minor, closing_bank_minor, closing_books_minor, difference_minor, currency, tied, made_by)
     VALUES ($1, $2, 'statement', $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12) RETURNING ${COLS}`,
    [e, account.account_id, hash, from, to, figures[0], figures[1], figures[2], figures[3], currency, figures[3] === 0, by || null]
  );
  return shown(result.rows[0]);
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
    .filter((entry) => !named.has(String(entry.entry_no)) && !named.has(String(entry.entry_id)))
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
        why: 'Entry ' + entry.entry_no + ' was posted from a bank line, but no accept mark names it.'
      };
    });
}

/** the bank-line entries posted through the bank-to-books door (POST /events, client_ref bank:<hash>:<line> → source_ref manual:bank:…) that touch this account, in the range */
async function postedBankRefs(db, e, account, from, to) {
  const result = await db.query(
    `SELECT DISTINCT ON (en.entry_id) en.entry_id, en.entry_no, en.source_ref, en.posting_date::text AS posting_date, en.total_minor, en.currency
       FROM journal_entry en JOIN journal_line li ON li.entry_id = en.entry_id AND li.entity_id = en.entity_id
      WHERE en.entity_id = $1 AND li.account_id = $2 AND en.source_ref LIKE 'manual:bank:%'
        AND ($3::date IS NULL OR en.posting_date >= $3::date) AND ($4::date IS NULL OR en.posting_date <= $4::date)
      ORDER BY en.entry_id LIMIT 500`,
    [e, account.account_id, from, to]
  );
  return result.rows.filter((row) => POSTED_REF.test(row.source_ref));
}

/**
 * the log of one account, and what the cross-check found: { marks (oldest first), statements (newest first), exceptions }.
 * The period (from · to, either may be absent) narrows the statements that overlap it and the posted refs; the marks are whole (a replay needs every one).
 */
async function read(db, e, account, from, to) {
  await mustBeReady();
  const [marks, statements, posted] = await Promise.all([
    db.query(`SELECT ${COLS} FROM bank_rec_log WHERE entity_id = $1 AND account_id = $2 AND kind = 'mark' ORDER BY seq LIMIT ${MAX_LOG}`, [e, account.account_id]),
    db.query(
      `SELECT ${COLS} FROM bank_rec_log WHERE entity_id = $1 AND account_id = $2 AND kind = 'statement'
          AND ($3::date IS NULL OR period_to >= $3::date) AND ($4::date IS NULL OR period_from <= $4::date) ORDER BY seq DESC LIMIT 200`,
      [e, account.account_id, from, to]
    ),
    postedBankRefs(db, e, account, from, to)
  ]);
  const log = marks.rows.map(shown);
  return { marks: log, statements: statements.rows.map(shown), exceptions: exceptionsOf(posted, log) };
}

module.exports = { WAITS, ready, accountIn, markOf, appendMarks, appendStatement, exceptionsOf, read, refuse };

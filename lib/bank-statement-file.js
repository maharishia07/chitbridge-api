'use strict';
// @stage built
// OWNS      the STATEMENTS BOX of the Bank page (l16, W15-51): a bank statement file kept against a bank account of the shop and a statement period · the account × month list with its gaps · the file's bytes back · who added, read, downloaded it.
// CALLED BY routes/books.js (POST /bank/statement-files · GET /bank/statement-files · GET /bank/statement-files/:id/file) · tests/l16-statement-box.test.cjs
// FLOW      validate(body, currency) → the file, hashed here too → add(): duplicate? overlap? → the bytes through lib/storage (ONE adapter) → one row + its 'added' event → list(): cells per account and month → open(): the bytes + a 'read' or 'downloaded' event
// CARD      16-finance/bank-reconciliation-and-bank-rail
/**
 * lib/bank-statement-file.js — ⭐ EVERY FILE IS FILED AGAINST SOMETHING (Athi, 15 Nov 2026): a chart ledger account of the shop (the one GET /accounts returns, as the Bank page's bkbBanks lists it) AND a period (from · to, read from the file by
 * the reader's own parse; this file never parses a statement). A file that names no account or no period is refused in words. There is no loose inbox.
 * ⭐ ONE HASH: sha256 of the UTF-8 TEXT the reader sees (web bkbHash). The page sends it; this file recomputes it on the same definition and refuses a mismatch (HASH_MISMATCH). The bytes kept ARE that text, so a Read gives the reader exactly what it hashed.
 * ⭐ DUPLICATE = same account + same hash (ALREADY_IN_BOX, nothing stored). OVERLAP = same account and the date ranges cross: stored, `overlaps: true`, and the answer says so (a month key would hide a 20 Oct to 20 Nov file).
 * ⭐ CURRENCY (CUR-1): a file in a currency other than the account's (the books') is refused, CURRENCY_MISMATCH 409; nothing is converted.
 * ⭐ ONE BYTE STORE: lib/storage (a cb_attachment row with no chit and no message, opaque id); served by lib/attachment-send sendBlob (nosniff, download, `private, no-store`: a revoked grant stops at the next request).
 * ⭐ INSERT-ONLY (b872): no hide, no delete in the record period. The SERVER stamps who and when; a body naming `by`, `at`, `source` or `kind` is refused, not ignored.
 * ⭐ AN AUDITOR'S READ runs BEGIN READ ONLY (middleware/books-grant), so it writes no event row: the grant's own look (books_access_log) is the auditor's record. The owner's and the adviser's reads and downloads write theirs.
 * ⚠️ NOT MIGRATED → BOOKS_NOT_MIGRATED (503) in words: before b872 the box says it arrives after the next update; the Bank page keeps its device-only picker.
 */
const crypto = require('crypto');
const { waiting } = require('./not-migrated');
const reqctx = require('./reqctx');
const storage = require('./storage');

const WAITS = { box: waiting('The statements box', false, 'Your statement is still read on this device; nothing was kept on the server and nothing was lost.') };
const KIND_MIME = { csv: 'text/csv', json: 'application/json', txt: 'text/plain' };
const BODY_KEYS = ['account', 'label', 'period_from', 'period_to', 'currency', 'sha256', 'name', 'text'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 24;
const MAX_FILES = 2000;

/** a refusal in words with its own status and code (the route answers it as it is; never a 500) */
function refuse(reason, code, status) {
  return Object.assign(new Error(reason), { code: code || 'STATEMENT_REFUSED', status: status || 422, statementBox: true });
}
const ready = async () => {
  const schema = require('./schema');
  return (await schema.hasTable('bank_statement_file')) && (await schema.hasTable('bank_statement_file_event'));
};
async function mustBeReady() {
  if (!(await ready())) throw Object.assign(new Error(WAITS.box), { code: 'BOOKS_NOT_MIGRATED', status: 503, statementBox: true });
}
const realDate = (value, name) => {
  const given = String(value == null ? '' : value);
  if (!DATE.test(given) || Number.isNaN(Date.parse(given)) || new Date(given + 'T00:00:00Z').toISOString().slice(0, 10) !== given) throw refuse(name === 'period_from' ? 'Which day does the statement start? The file must say, as YYYY-MM-DD.' : 'Which day does the statement end? The file must say, as YYYY-MM-DD.', 'PERIOD_NEEDED', 400);
  return given;
};

/** the sha256 of a text as UTF-8 bytes: the ONE definition (web bkbHash), hex */
const hashOf = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * validate(body, currency) → { name, mime, buffer, sha256, from, to, currency, label }, or the refusal in words.
 * `currency` = the account's (the books'). Nothing here reads a statement line: the period and the currency are what the page's reader found.
 */
function validate(body, currency) {
  const given = body || {};
  const unknown = Object.keys(given).filter((key) => !BODY_KEYS.includes(key));
  if (unknown.length) throw refuse('A statement does not take ' + unknown.join(', ') + ' (who and when are set by the server).', 'UNKNOWN_FIELD', 400);
  const name = String(given.name == null ? '' : given.name).trim();
  if (!name || name.length > 200) throw refuse('Which file is this? Its name is 1 to 200 characters.', 'FILE_NAME_NEEDED', 400);
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1];
  if (!ext || !KIND_MIME[ext.toLowerCase()]) throw refuse('Only CSV, JSON or TXT statements can be kept here.', 'FILE_TYPE_NOT_KEPT', 415);
  if (typeof given.text !== 'string' || !given.text) throw refuse('The file is empty.', 'FILE_EMPTY', 400);
  if (given.text.indexOf('\u0000') !== -1) throw refuse('That file is not a text statement, so it cannot be kept here.', 'FILE_TYPE_NOT_KEPT', 415);
  const buffer = Buffer.from(given.text, 'utf8');
  if (buffer.length > storage.MAX_ATTACHMENT_BYTES) throw refuse('That file is over 6 MB, which is more than a statement should be.', 'FILE_TOO_LARGE', 413);
  const claimed = String(given.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(claimed)) throw refuse('The file fingerprint is missing or not a sha256.', 'HASH_MISMATCH', 422);
  const sha256 = hashOf(given.text);
  if (claimed !== sha256) throw refuse('The file arrived changed: its fingerprint does not match. Pick the file again.', 'HASH_MISMATCH', 422);
  const from = realDate(given.period_from, 'period_from'),
    to = realDate(given.period_to, 'period_to');
  if (to < from) throw refuse('The statement ends before it starts.', 'PERIOD_NEEDED', 400);
  const said = String(given.currency == null ? '' : given.currency).trim().toUpperCase();
  if (!said) throw refuse('Which currency is this statement in? Nothing is assumed.', 'CURRENCY_NEEDED', 400);
  if (said !== currency) throw Object.assign(refuse('This statement is in ' + said + ' but the account is kept in ' + currency + '.', 'CURRENCY_MISMATCH', 409), { field: 'currency' });
  const label = String(given.label == null ? '' : given.label).trim();
  if (label.length > 40) throw refuse('The account label is at most 40 characters, such as ..1234.', 'LABEL_TOO_LONG', 400);
  return { name, mime: KIND_MIME[ext.toLowerCase()], buffer, sha256, from, to, currency: said, label: label || null };
}

const COLS = `id, account_id, label, period_from::text AS period_from, period_to::text AS period_to, currency, name, size, mime, kind, source, overlap_flag AS overlaps, by_user, by_name, by_firm, grant_id, created_at`;
/** a stored row → what the caller reads (no hash, no storage id); `by` is the person, `for_client` says an adviser's person made it */
function shown(row) {
  return {
    id: row.id, account_id: row.account_id, label: row.label || null, period_from: row.period_from, period_to: row.period_to, currency: row.currency, name: row.name, size: Number(row.size), mime: row.mime,
    kind: row.kind, source: row.source, overlaps: row.overlaps === true, by_name: row.by_name || null, by_firm: row.by_firm || null, for_client: !!row.grant_id, added_at: row.created_at,
    read_at: row.read_at || null, reads: row.reads == null ? 0 : Number(row.reads)
  };
}
/** the stamp of the writer: { user, name, firm, grant_id } from the session and the live grant, never from the body */
const stampOf = (by) => ({ user: (by && by.user) || null, name: (by && by.name ? String(by.name).slice(0, 200) : null), firm: (by && by.firm ? String(by.firm).slice(0, 200) : null), grant_id: (by && by.grant_id) || null });
async function recordEvent(db, e, fileId, event, by) {
  const stamp = stampOf(by);
  await db.query(`INSERT INTO bank_statement_file_event (entity_id, file_id, event, by_user, by_name, by_firm, grant_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [e, fileId, event, stamp.user, stamp.name, stamp.firm, stamp.grant_id]);
}

/**
 * is this file already in the box, and does it cross another file of the account? → { duplicate: row|null, overlapping: [row], label (the account's last label) }. Reads only; the unique index is the final word on a race.
 */
async function checkAgainstBox(db, e, accountId, sha256, from, to) {
  const found = await db.query(
    `SELECT ${COLS}, (sha256 = $3) AS same FROM bank_statement_file WHERE entity_id = $1 AND account_id = $2 AND (sha256 = $3 OR (period_from <= $5::date AND period_to >= $4::date)) ORDER BY created_at DESC LIMIT 20`,
    [e, accountId, sha256, from, to]
  );
  const label = await db.query(`SELECT label FROM bank_statement_file WHERE entity_id = $1 AND account_id = $2 AND label IS NOT NULL ORDER BY seq DESC LIMIT 1`, [e, accountId]);
  return { duplicate: found.rows.find((row) => row.same) || null, overlapping: found.rows.filter((row) => !row.same), label: label.rows[0] ? label.rows[0].label : null };
}

/** a date as the owner reads it in a sentence: 1 Oct 2026 */
const WORDS_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (iso) => Number(iso.slice(8, 10)) + ' ' + WORDS_MONTH[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);

/**
 * add(withEntity, e, account, currency, body, by) → { file, overlaps: [{ id, name, period_from, period_to }], words }
 * `account` = the chart account the body names (the route resolved it, a group is no account); `currency` = the books' currency. Insert-only; the row and its 'added' event commit together. The bytes are put FIRST
 * (an object whose row never landed is deleted again here, never left as a file nobody lists).
 */
async function add(withEntity, e, account, currency, body, by) {
  await mustBeReady();
  const given = validate(body, currency);
  const first = await withEntity(e, (db) => checkAgainstBox(db, e, account.account_id, given.sha256, given.from, given.to));
  if (first.duplicate) throw Object.assign(refuse('Already in the box: this file is kept for ' + dayWords(first.duplicate.period_from) + ' to ' + dayWords(first.duplicate.period_to) + '.', 'ALREADY_IN_BOX', 409), { existing_id: first.duplicate.id });
  const stamp = stampOf(by);
  const attachmentId = await storage.putForParticipants({ name: given.name, mime: given.mime, size: given.buffer.length, buffer: given.buffer, uploaded_by: stamp.user, participants: [e], forEntity: e });
  if (!attachmentId) throw refuse('The file could not be kept. Nothing was added; try again.', 'FILE_NOT_KEPT', 503);
  try {
    const row = await withEntity(e, async (db) => {
      const label = given.label || first.label;
      const crossed = first.overlapping.length > 0;
      const inserted = await db.query(
        `INSERT INTO bank_statement_file (entity_id, account_id, label, period_from, period_to, currency, sha256, attachment_id, name, size, mime, source, overlap_flag, by_user, by_name, by_firm, grant_id)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING ${COLS}`,
        [e, account.account_id, label, given.from, given.to, given.currency, given.sha256, attachmentId, given.name, given.buffer.length, given.mime, stamp.grant_id ? 'adviser' : 'owner', crossed, stamp.user, stamp.name, stamp.firm, stamp.grant_id]
      );
      await recordEvent(db, e, inserted.rows[0].id, 'added', by);
      return inserted.rows[0];
    });
    const overlaps = first.overlapping.map((item) => ({ id: item.id, name: item.name, period_from: item.period_from, period_to: item.period_to }));
    return { file: shown(row), overlaps, words: overlaps.length ? 'Kept. It overlaps ' + overlaps.length + ' other statement' + (overlaps.length === 1 ? '' : 's') + ' of this account (' + overlaps.map((item) => dayWords(item.period_from) + ' to ' + dayWords(item.period_to)).join(', ') + '). Both are shown.' : 'Kept.' };
  } catch (err) {
    await withEntity(e, (db) => db.query(`DELETE FROM cb_attachment WHERE id = $1 AND entity_id = $2`, [attachmentId, e])).catch(() => {}); /* the row never landed: its bytes go too */
    if (err && err.code === '23505') throw Object.assign(refuse('Already in the box: this file is already kept for this account.', 'ALREADY_IN_BOX', 409), { statementBox: true }); /* two presses at once: the unique index decided */
    throw err;
  }
}

/** the first and last day of 'YYYY-MM' */
function monthBounds(month) {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return { first: month + '-01', last: month + '-' + String(last).padStart(2, '0') };
}
/** the `count` months ending at `endMonth` ('YYYY-MM'), oldest first */
function monthsUpTo(endMonth, count) {
  const out = [];
  let year = Number(endMonth.slice(0, 4)),
    month = Number(endMonth.slice(5, 7));
  for (let n = 0; n < count; n++) {
    out.unshift(year + '-' + String(month).padStart(2, '0'));
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return out;
}
/** the window the list covers: `count` (1 to 24, default 6) months ending at `to` ('YYYY-MM', default the shop's current month) */
function windowOf(query, todayIso) {
  const count = query.months == null || query.months === '' ? 6 : Number(query.months);
  if (!Number.isInteger(count) || count < 1 || count > MAX_MONTHS) throw refuse('Months is a whole number from 1 to ' + MAX_MONTHS + '.', 'MONTHS_INVALID', 400);
  const end = query.to == null || query.to === '' ? String(todayIso).slice(0, 7) : String(query.to);
  if (!MONTH.test(end)) throw refuse('The last month is YYYY-MM.', 'MONTH_INVALID', 400);
  return monthsUpTo(end, count);
}

/**
 * cells(accounts, files, months) → [{ account_id, month, missing, file_ids }]: ONE definition of "a month has a statement": a file whose period touches the month (the days, not the label). Pure: the test and the list use this.
 */
function cells(accounts, files, months) {
  const out = [];
  for (const account of accounts) {
    const mine = files.filter((file) => file.account_id === account.account_id);
    for (const month of months) {
      const { first, last } = monthBounds(month);
      const here = mine.filter((file) => file.period_from <= last && file.period_to >= first);
      const newest = here.slice().sort((a, b) => String(b.period_to).localeCompare(String(a.period_to)) || String(b.period_from).localeCompare(String(a.period_from)))[0];
      out.push({ account_id: account.account_id, month, missing: here.length === 0, file_ids: here.map((file) => file.id), overlaps: here.some((file) => file.overlaps === true), newest_id: newest ? newest.id : null });
    }
  }
  return out;
}

/**
 * list(db, e, { accounts (the chart accounts the page lists as banks, resolved by the route), chart (every chart account, to name an account that has files but is not listed), months }) → { months, accounts: [{ account_id, code, name, label, cells }], files, older }
 * The accounts are the page's own bank list (bkbBanks), never a second definition; an account that holds files but is no longer on the list is still shown. TWO reads however many accounts.
 */
async function list(db, e, { accounts, chart, months }) {
  await mustBeReady();
  const first = monthBounds(months[0]).first;
  const [fileRows, events] = await Promise.all([
    db.query(`SELECT ${COLS} FROM bank_statement_file WHERE entity_id = $1 ORDER BY period_from, seq LIMIT ${MAX_FILES}`, [e]),
    db.query(`SELECT file_id, count(*) FILTER (WHERE event = 'read') AS reads, max(at) FILTER (WHERE event = 'read') AS read_at FROM bank_statement_file_event WHERE entity_id = $1 GROUP BY file_id`, [e])
  ]);
  const seen = new Map(events.rows.map((row) => [row.file_id, row]));
  const all = fileRows.rows.map((row) => shown(Object.assign({}, row, seen.get(row.id) || {})));
  const last = monthBounds(months[months.length - 1]).last;
  const inWindow = all.filter((file) => file.period_from <= last && file.period_to >= first);
  const listed = accounts.slice();
  for (const file of all) if (!listed.some((item) => item.account_id === file.account_id)) listed.push((chart || []).find((item) => item.account_id === file.account_id) || { account_id: file.account_id, code: null, name: null });
  const labelOf = (accountId) => (all.filter((file) => file.account_id === accountId && file.label).pop() || {}).label || null;
  return {
    months,
    accounts: listed.map((item) => ({ account_id: item.account_id, code: item.code == null ? null : String(item.code), name: item.name || null, label: labelOf(item.account_id) })),
    cells: cells(listed, inWindow, months),
    files: inWindow,
    older: all.length - inWindow.length
  };
}

/**
 * open(withEntity, e, id, use, by, handle) → { file: { name, mime, data }, row }: the bytes of one kept statement, through the storage adapter, or null when it is not this shop's. `use` = 'read' (the Bank page loads it into the reader) or 'download'.
 * The event is written in the same request unless the request is read only (an auditor: the grant's own look is the record).
 */
async function open(withEntity, e, id, use, by) {
  await mustBeReady();
  const row = await withEntity(e, async (db) => (await db.query(`SELECT ${COLS}, attachment_id FROM bank_statement_file WHERE id = $1 AND entity_id = $2`, [id, e])).rows[0] || null);
  if (!row) return null;
  const file = await storage.getBlob(row.attachment_id, e);
  if (!file || file.data == null) throw refuse('The kept file could not be opened. Nothing was lost; try again in a minute.', 'FILE_NOT_OPENED', 503);
  if (!reqctx.isReadOnly()) await withEntity(e, (db) => recordEvent(db, e, row.id, use === 'read' ? 'read' : 'downloaded', by));
  return { file: { name: row.name, mime: row.mime, data: file.data }, row: shown(row) };
}

module.exports = { COLS, shown, MAX_FILES, validate, hashOf, add, list, open, cells, monthsUpTo, monthBounds, windowOf, checkAgainstBox, ready, WAITS, refuse, MAX_MONTHS };

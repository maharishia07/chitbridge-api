'use strict';
// @stage tested
// OWNS      the PAGED read of the statements box (l16, W15-100): one year's months for the page's accounts, and ONE page of the kept files, newest first, narrowed by a search; never the whole box.
// CALLED BY routes/books.js (GET /bank/statement-files when `limit` is given) · tests/l16-statement-page.test.cjs
// FLOW      list(db, e, { accounts, chart, months, limit, after, q }) → the accounts that hold files (one grouped read) → the window's files (id, account, period, overlap: the cells) → the page (keyset on period_to, seq) + its count → the page's read events → the answer
// CARD      16-finance/bank-reconciliation-and-bank-rail
/**
 * ⭐ NEVER LOAD ALL (Athi, 16 Nov): the old list reads every row of the box; this one reads the window the caller asks for (at most 24 months), a page of at most 100 files, and counts. The per-month cells come
 * from the window's rows only; `total` is the files matching the search in the window; `older` is the files outside the window (the stepper uses it). No sha, no storage id leaves here (lib/bank-statement-file shown()).
 * ⭐ KEYSET, NEWEST FIRST: ORDER BY period_to DESC, seq DESC; `after` is the opaque cursor the last answer's `next` gave. A bad cursor or limit is a sentence (400), never a 500.
 * ⭐ THE SEARCH: a file name, an account's name, label or code, a month written 2026-10 or as a name (Oct, October). Wildcards typed by the person are plain characters.
 */
const StatementFile = require('./bank-statement-file');

const MAX_LIMIT = 100;
const MAX_Q = 60;
const NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** the page size: a whole number 1 to 100 */
function limitOf(value) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw StatementFile.refuse('Limit is a whole number from 1 to ' + MAX_LIMIT + '.', 'LIMIT_INVALID', 400);
  return n;
}
const cursorOf = (row) => Buffer.from(String(row.period_to) + ':' + String(row.seq), 'utf8').toString('base64url');
/** the cursor back to { to, seq }, or the sentence */
function unCursor(text) {
  const hit = /^(\d{4}-\d{2}-\d{2}):(\d{1,15})$/.exec(Buffer.from(String(text), 'base64url').toString('utf8'));
  if (!hit || Number.isNaN(Date.parse(hit[1]))) throw StatementFile.refuse('That page marker is not one this list gave. Start again from the newest.', 'CURSOR_INVALID', 400);
  return { to: hit[1], seq: hit[2] };
}
const likeOf = (text) => '%' + String(text).replace(/[\\%_]/g, (char) => '\\' + char) + '%';

/** the clause a typed month matches (2026-10, or a month's name of three letters or more), or '' when the text is neither */
function monthClause(text, push) {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    const { first, last } = StatementFile.monthBounds(text);
    return `(period_from <= ${push(last)}::date AND period_to >= ${push(first)}::date)`;
  }
  const at = text.length >= 3 ? NAMES.findIndex((name) => name.startsWith(text)) : -1;
  return at >= 0 ? `(EXTRACT(MONTH FROM period_from) = ${push(at + 1)} OR EXTRACT(MONTH FROM period_to) = ${push(at + 1)})` : '';
}
/** the where-clause (and its values) of a search over the window; `listed` = the accounts, to match their name, label and code */
function searchSql(searchText, listed, push) {
  const text = String(searchText || '').trim().toLowerCase();
  if (!text) return '';
  if (text.length > MAX_Q) throw StatementFile.refuse('The search is at most ' + MAX_Q + ' characters.', 'SEARCH_TOO_LONG', 400);
  const parts = [`name ILIKE ${push(likeOf(text))}`];
  const ids = listed.filter((item) => [item.name, item.label, item.code].some((field) => field && String(field).toLowerCase().includes(text))).map((item) => item.account_id);
  if (ids.length) parts.push(`account_id = ANY(${push(ids)}::uuid[])`);
  const when = monthClause(text, push);
  if (when) parts.push(when);
  return ' AND (' + parts.join(' OR ') + ')';
}

/**
 * list(db, e, { accounts, chart, months, limit, after, q }) → { months, accounts, cells, files (one page, newest first), total, next (cursor or null), older }
 */
async function list(db, e, { accounts, chart, months, limit, after, q: searchText }) {
  if (!(await StatementFile.ready())) throw Object.assign(new Error(StatementFile.WAITS.box), { code: 'BOOKS_NOT_MIGRATED', status: 503, statementBox: true, said: StatementFile.WAITS.box });
  const size = limitOf(limit),
    key = after == null || after === '' ? null : unCursor(after),
    first = StatementFile.monthBounds(months[0]).first,
    last = StatementFile.monthBounds(months[months.length - 1]).last;
  const held = (await db.query(`SELECT account_id, (array_agg(label ORDER BY seq DESC) FILTER (WHERE label IS NOT NULL))[1] AS label FROM bank_statement_file WHERE entity_id = $1 GROUP BY account_id`, [e])).rows;
  const listed = accounts.slice();
  for (const row of held) if (!listed.some((item) => item.account_id === row.account_id)) listed.push((chart || []).find((item) => item.account_id === row.account_id) || { account_id: row.account_id, code: null, name: null });
  const labelOf = (accountId) => (held.find((row) => row.account_id === accountId) || {}).label || null;
  const named = listed.map((item) => ({ account_id: item.account_id, code: item.code == null ? null : String(item.code), name: item.name || null, label: labelOf(item.account_id) }));
  const inWindow = (await db.query(`SELECT id, account_id, name, period_from::text AS period_from, period_to::text AS period_to, overlap_flag AS overlaps FROM bank_statement_file WHERE entity_id = $1 AND period_from <= $3::date AND period_to >= $2::date LIMIT ${StatementFile.MAX_FILES}`, [e, first, last])).rows;
  const values = [e, first, last],
    push = (value) => (values.push(value), '$' + values.length);
  const where = ' WHERE entity_id = $1 AND period_from <= $3::date AND period_to >= $2::date' + searchSql(searchText, named, push);
  const count = Number((await db.query('SELECT count(*) AS n FROM bank_statement_file' + where, values)).rows[0].n);
  const older = Number((await db.query('SELECT count(*) AS n FROM bank_statement_file WHERE entity_id = $1 AND NOT (period_from <= $3::date AND period_to >= $2::date)', [e, first, last])).rows[0].n);
  const keyed = key ? ` AND (period_to, seq) < (${push(key.to)}::date, ${push(key.seq)}::bigint)` : '';
  const rows = (await db.query(`SELECT ${StatementFile.COLS}, seq FROM bank_statement_file${where}${keyed} ORDER BY period_to DESC, seq DESC LIMIT ${size + 1}`, values)).rows;
  const page = rows.slice(0, size);
  const events = page.length ? (await db.query(`SELECT file_id, count(*) FILTER (WHERE event = 'read') AS reads, max(at) FILTER (WHERE event = 'read') AS read_at FROM bank_statement_file_event WHERE entity_id = $1 AND file_id = ANY($2::uuid[]) GROUP BY file_id`, [e, page.map((row) => row.id)])).rows : [];
  const seen = new Map(events.map((row) => [row.file_id, row]));
  return {
    months,
    accounts: named,
    cells: StatementFile.cells(listed, inWindow, months),
    files: page.map((row) => StatementFile.shown(Object.assign({}, row, seen.get(row.id) || {}))),
    total: count,
    next: rows.length > size ? cursorOf(page[page.length - 1]) : null,
    older
  };
}

module.exports = { list, limitOf, unCursor, cursorOf, MAX_LIMIT, MAX_Q };

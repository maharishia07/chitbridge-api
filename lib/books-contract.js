/*
 * OWNS      the contract of routes/books.js: each route's OpenAPI operation (S9), the ledger's refusal mapper (refusalOf) and the sentences its gates answer in.
 * CALLED BY routes/books.js (schemaValidate on each route, router.openapi, problem(req, res, refusalOf(e))) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-books.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           thrown refusal → refusalOf(e) → { status, code, detail, legacy } → problem() → the old body's keys beside the Problem fields
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * Kept apart from the route file so its handlers keep their places (and their history) while the contract grows here. This file shapes NO answer: the figures are the engines'.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names and kinds, nothing required, nothing narrowed. Every handler answers a missing or odd value in its own words
 *    (a 400 "Which customer?"), and those words are frozen (docs/contracts/api-legacy.json). Required fields stay the handlers'; an unknown key is refused
 *    (S33, below the routes; Athi 1 Nov, Job E "for accounts alone").
 * ⚠️ A query or body value the handler reads leniently (a bad date falls back to today, a page falls back to the first) is declared as plain text: a schema that refused it would turn a
 *    fallback into a refusal no caller has ever had.
 */
'use strict';
const { waiting } = require('./not-migrated');
const { internalSpec } = require('./problem');
const { contractOf, object, array, text, maybeText } = require('./contract-kit');
const { SEATS } = require('./role-matrix'); /* the role matrix: what each seat is answered (register column 14) */
const bounds = require('./bounds'); /* the one set of input bounds: a list's page size is bounds.limit() (column 16, resource_cap) */
const { SAFE_SENTENCE } = require('./respond');

/* ── the sentences the gates and the shared refusals answer in (frozen: they are the words the Ledger screen shows) ── */
const SAID = {
  signIn: 'Sign in to use the ledger.',
  ownerOnly: 'Only the owner may do this.',
  openingOwner: 'Only the owner can change opening balances now.',
  notFound: 'Not found',
  saved: 'That is already recorded.',
  notReady: 'Not available yet.',
  notMigrated: waiting('Ledger entries', true, 'This entry was NOT recorded in the books. Keep the paper record and enter it again after the update.'),
  termsNotMigrated: 'Terms arrive after the next update.',
  notAuditor: require('./books-readers').READ_MONEY_WORDS, /* the one read-money sentence */
  compareSignIn: 'Sign in to compare the books.',
  failed: 'Failed'
};

/* ── refusalOf: the ledger's one mapping from a thrown refusal to the answer ── */
const coded = (status, code, e, extra) => ({ status, code, detail: e.message, legacy: Object.assign({ code, error: e.message, message: e.message }, extra) });
const plain = (status, code, e, legacy) => ({ status, code, detail: e.message, legacy: legacy || { error: e.message, message: e.message } });
const COUNTRY_GATE = ['NO_COUNTRY_PACK', 'NO_COUNTRY', 'COUNTRY_SETUP_PENDING', 'NO_MONEY'];

const LOCKS = ['PERIOD_LOCKED', 'YEAR_CLOSED', 'SUSPENSE_NOT_NIL'];
/** a refusal that carries a code says it; one that carries none is the books' general "refused in words" */
const refusedAs = (e) => (e.code && e.code !== 'BOOKS_REFUSED' ? coded(422, e.code, e) : plain(422, 'BOOKS_REFUSED', e));
/** a terms field the owner can fix (lib/finance-terms): 400 or 404 in a sentence */
const saidAs = (e) => ({ status: e.status, code: e.status === 404 ? 'NOT_FOUND' : 'BOOKS_BAD_REQUEST', detail: e.say, legacy: { error: e.say, message: e.say } });
const alreadyRecorded = () => ({ status: 409, code: 'ALREADY_RECORDED', detail: SAID.saved, legacy: { error: SAID.saved, message: SAID.saved } });
/** the books are insert-only (b273): a write the database refuses for that reason is the server's state (b295 not run), 503 in words, and the reason stays in the log */
function insertOnly(e) {
  console.error('books route refused by the database:', e.code || '', String(e.message || e).slice(0, 300)); /* silence is the bug: the Railway log keeps the reason */
  return { status: 503, code: 'BOOKS_NOT_MIGRATED', detail: SAID.notMigrated, legacy: { code: 'BOOKS_NOT_MIGRATED', error: SAID.notReady, message: SAID.notMigrated } };
}
/** the query or body key whose value was the date that failed (a reader that is handed only the value, books routes dateQ, cannot name it) */
const DATE_KEY = /date|^(from|to|asof|as_at|period_from|period_to|put_to_use)$/i; /* the keys a date travels in; a narration that happens to hold the same words is not the date */
const fieldGiven = (req, given) => {
  const keys = (source) => Object.keys(source || {}).filter((key) => String(source[key]) === given);
  const found = [].concat(keys(req && req.query), keys(req && req.body));
  return found.find((key) => DATE_KEY.test(key)) || found[0] || 'date';
};

/** the ledger's refusals, first match wins; the order is the order the route file always asked in (a "not migrated" refusal is read before the general 422) */
const RULES = [
  [(e) => LOCKS.includes(e.code), (e) => coded(409, e.code, e)],
  [(e) => e.code === 'ENTRY_HAS_REPAYMENTS', (e) => ({ status: 409, code: e.code, detail: e.message })], /* a loan reversed while an instalment of it is live (the guard inside the write, lib/books.refuseLoanWithInstalments): the route guard's own 409 */
  [(e) => e.code === 'EVENT_REF_REUSED', (e) => coded(409, e.code, e, { entry_no: e.entry_no })], /* R12a: a client_ref already used for a different entry */
  [(e) => e.code === 'CURRENCY_MISMATCH', (e) => coded(409, e.code, e, { field: e.field })],
  [(e) => e.code === 'BOOKS_NOT_FOUND', (e) => plain(404, 'NOT_FOUND', e, { error: SAID.notFound, message: e.message })],
  [(e) => e.code === 'FX_RATE_MISSING' || e.code === 'RETURN_FROM_RAIL' || COUNTRY_GATE.includes(e.code), (e) => coded(422, e.code, e)],
  [(e) => e.code === 'BOOKS_ENGINE' || e.code === 'BOOKS_NOT_MIGRATED', (e) => coded(503, e.code, e)],
  [(e) => e.code === 'DATE_INVALID', (e, req) => Object.assign(plain(400, 'DATE_INVALID', e), { field: e.field || fieldGiven(req, e.given) })], /* ACC-274: a given date that is not a day, naming the field */
  [(e) => e.code === 'BOOKS_BAD_REQUEST', (e) => plain(400, 'BOOKS_BAD_REQUEST', e)],
  [(e) => e.refused && /^STOCK_/.test(String(e.code || '')), (e) => coded(422, e.code, e, { items: e.items || [] })],
  [(e) => e.refused || e.code === 'BOOKS_REFUSED', refusedAs],
  [(e) => e.status === 409 || e.status === 422, (e) => plain(e.status, e.status === 409 ? 'BOOKS_CONFLICT' : 'BOOKS_REFUSED', e)],
  [(e) => e.say && (e.status === 400 || e.status === 404), saidAs],
  [(e) => e.code === '23505', alreadyRecorded],
  [(e) => e.code === '42501' || /insert-only/.test(String(e.message || '')), insertOnly]
];

/** a refusal the database makes on purpose, or the books' own typed refusal → { status, code, detail, legacy } for problem(); anything else is a 500 that says nothing of its cause (S8) */
function refusalOf(e, req) {
  const rule = e && RULES.find(([applies]) => applies(e));
  return rule ? rule[1](e, req) : internal(e, req);
}
/** silence is the bug: the real error is logged with the request id (internalSpec), the caller gets the one generic sentence */
function internal(e, req) {
  return internalSpec(req, e, { error: SAID.failed, message: SAFE_SENTENCE });
}

/* ── the contract: each route's OpenAPI operation, built from one row of ROUTES ── */
const GATE_STATUS = { moneyReader: 403, ownerOrAccountant: 403, payOut: 403, owner: 403, noKey: 403, editor: 403, on: 404 };
const REFUSALS = [
  { status: 400, code: 'BOOKS_BAD_REQUEST', when: 'a question the owner can answer: a missing field, a date that is not a date' },
  { status: 404, code: 'NOT_FOUND', when: 'no such ledger, payment, entry, pack or snapshot in this shop' },
  { status: 409, code: 'PERIOD_LOCKED | YEAR_CLOSED | SUSPENSE_NOT_NIL | BOOKS_CONFLICT | ALREADY_RECORDED', when: 'the books refuse the write as it stands' },
  { status: 422, code: 'BOOKS_REFUSED | NO_COUNTRY_PACK | NO_COUNTRY | COUNTRY_SETUP_PENDING | FX_RATE_MISSING | STOCK_*', when: 'a refusal in words, with its code' },
  { status: 503, code: 'BOOKS_NOT_MIGRATED | BOOKS_ENGINE', when: 'a database update or an engine is still to arrive' }
];
const PAGE = ['limit', 'after', 'page'];
const MONEY = 'minor units (integers) with the currency beside them';
const DATE_RANGE = ['from', 'to'];
/** what every move-in door reads (routes/books.js moveInBody + its country/company reader + lib/move-in readFile): one list for the three doors, so they never drift apart */
/** the body of the ＋ Entry door (POST /events · /preview): `event` (a kind, or { kind, …fields }) and, beside it, every field some entry kind reads (lib/books-manual.js BUILD + books-period amountOf/dateOf/refOf/contraEvent + the typed bill's tax lines), and what the sheet adds (client_ref, attachment, paid_by, cheque_no, cheque_date) */
const EVENT_BODY = [
  'event', 'kind', 'client_ref', 'attachment',
  'class', 'expense_class', 'income_class', 'amount', 'amount_minor', 'date', 'narration', 'how', 'what', 'paid_from', 'paid_by', 'into', 'from', 'to', 'cheque_no', 'cheque_date',
  'ledger', 'code', 'supplier', 'party', 'party_id', 'bill', 'blocked_credit', 'claim_credit', 'against_ref', 'reason', 'lines', 'voucher_type',
  'if_locked', 'supplier_gstin', 'my_gstin', 'place_of_supply', 'supplier_name', 'price_includes_tax', 'doc_no', 'tax_rate', 'input_tax_minor', 'output_tax_minor', 'tax_invoice', 'fee', 'fee_tax_minor', 'fee_currency'
];
const MOVE_IN = ['kind', 'source', 'csv', 'xlsx', 'sheet', 'header_row', 'side', 'as_at', 'source_country', 'source_company', 'decisions', 'client_ref'];
const ROUTES = {
  'GET /status': { seats: SEATS.OWNER_ADVISER_READS, summary: 'Whether the ledger is switched on, and whether it may be', gates: ['owner'], out: object(['migrated', 'enabled', 'walkin_grain', 'engines', 'country']) },
  'POST /enable': { seats: SEATS.OWNER_ONLY, summary: 'Switch the ledger on, with an optional start date that posts earlier bills (owner)', gates: ['owner'], body: ['walkin_grain', 'start_date'] },
  'POST /backfill': { seats: SEATS.OWNER_ONLY, summary: 'Post the bills from a start date into the books, once each (owner)', gates: ['owner', 'on'], body: ['start_date'], out: object(['start_day', 'posted', 'waiting', 'before_start', 'words']) },
  'GET /backfill': { seats: SEATS.OWNER_ONLY, summary: 'The books start day and how many bills before it are in the opening balances', gates: ['owner', 'on'], out: object(['enabled', 'start_day', 'before_start', 'words']) },
  'POST /setting': { seats: SEATS.OWNER_ONLY, summary: 'Change the walk-in grain or switch the ledger off (owner)', gates: ['owner', 'on'], body: ['enabled', 'walkin_grain'], out: object(['ok', 'enabled', 'walkin_grain']) },
  'GET /terms': { seats: SEATS.ANY_BOTH_READ, summary: "The shop's credit terms and, with party_id, that party's own", gates: ['noKey', 'on'], query: ['party_id', 'side'], out: object(['terms_migrated', 'may_set', 'why_not', 'default', 'party', 'events']) },
  'POST /terms': { seats: SEATS.OWNER_ONLY, summary: "Set the shop's default terms or one party's (owner)", gates: ['owner', 'on'], inline: [503], body: ['party_id', 'side', 'credit_days', 'credit_limit_minor', 'interest', 'early', 'pdc_remind'], out: object(['ok', 'terms']) },
  'GET /health': { seats: SEATS.ANY_BOTH_READ, summary: "The ledger's probe and to-do list: the waiting posts, the year, the country", gates: ['on'], out: object(['enabled', 'currency', 'country', 'walkin_grain', 'engines', 'year', 'waiting', 'total', 'page', 'limit', 'todo']) },
  'POST /check': { seats: SEATS.OWNER_ONLY, summary: 'Run the nightly books check now (owner)', gates: ['owner', 'on'] },
  'POST /money-check/resolve': { seats: SEATS.EDITOR_NO_GRANT, summary: 'Close the to-do item of a sale let through although the money did not add up (owner or editor)', gates: ['noKey', 'editor', 'on'], inline: [400, 404], body: { chit_id: text, how: text, note: text }, required: ['chit_id', 'how'], rules: { additionalProperties: false }, out: object(['resolved', 'how', 'duplicate'], { resolved: { type: 'boolean' }, how: text, duplicate: { type: 'boolean' } }, true) },
  'POST /outbox/retry': { seats: SEATS.OWNER_ONLY, summary: 'Try the waiting posts again (owner)', gates: ['owner', 'on'] },
  'GET /accounts': { seats: SEATS.ANY_BOTH_READ, summary: "The shop's chart of accounts", gates: ['on'], out: object(['accounts'], { accounts: array(object(['account_id', 'code', 'name', 'is_group'])) }) },
  'POST /accounts': { seats: SEATS.OWNER_ONLY, summary: 'Add a ledger to the chart under a group (owner)', gates: ['owner', 'on'], body: ['name', 'parent_code', 'parent_id', 'code', 'account_code', 'source_code'], out: object(['ok', 'account']) },
  'GET /daybook': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'The day book: every entry of a date range, newest page first', gates: ['moneyReader', 'on'], query: DATE_RANGE.concat(['entries', 'order', 'since'], PAGE), out: object(['currency', 'from', 'to', 'entries', 'count'], { entries: array(), country: maybeText }) },
  'GET /evidence/:id': { seats: SEATS.OWNER_MANAGER_ADVISER_READS, summary: 'One document file behind an entry of the books (the owner, or a firm under a live read-only grant); not cached', gates: ['moneyReader', 'on'], inline: [404], media: 'application/octet-stream', noKeys: true },
  'GET /ledger/:account': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'One ledger over a range (the account is its code, its role or its id)', gates: ['moneyReader', 'on'], query: DATE_RANGE.concat(['party'], PAGE), queryBounds: { limit: bounds.limit() }, out: object(['currency']) },
  'GET /party/:id/statement': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: "One party's statement over a range", gates: ['moneyReader', 'on'], query: DATE_RANGE, out: object(['currency', 'party_id', 'from', 'to']) },
  'GET /dues': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'Who owes the shop and whom the shop owes, as at a day (' + MONEY + ')', gates: ['moneyReader', 'on'], inline: [400, 403], query: ['asOf', 'side', 'finance', 'control'], out: object(['currency', 'asOf', 'parties', 'total_minor', 'needs'], { parties: array(), aged_totals: {}, tb_control: {} }) },
  'GET /party/:id/bills': { seats: SEATS.OWNER_MANAGER_ONLY, summary: "One party's bills, open first, newest first, a page at a time, each with its age, mark and evidence flag (" + MONEY + ')', gates: ['moneyReader', 'on'], query: ['side', 'state', 'tab', 'why', 'band', 'sort', 'dir', 'asOf', 'page', 'limit'], queryBounds: { limit: bounds.limit() }, out: object(['currency', 'party_id', 'side', 'asOf', 'bills', 'total', 'page', 'limit', 'counts'], { bills: array() }) },
  'GET /attention': { seats: SEATS.ANY_ADVISER_READS, summary: "The Day book's evidence counts over a range — no tax invoice, no file, no source, open queries — or the entries behind one", gates: ['noKey', 'on'], query: DATE_RANGE.concat(['kind', 'page', 'limit']), out: object(['from', 'to', 'total', 'no_tax_invoice', 'no_file', 'no_source', 'open_queries', 'needs']) },
  'GET /overview': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'How the business is doing: sales, profit, owed, owing and cash ahead in one read (' + MONEY + ')', gates: ['moneyReader', 'on'], inline: [400], query: ['period'], out: object(['currency', 'period', 'sales', 'bars', 'to_collect', 'to_pay', 'cost_hidden'], { period: {}, compare: {}, sales: {}, bars: array(), weekdays: array(), aged_totals: {}, to_collect: {}, to_pay: {}, income: {}, expenses: {}, profit: {}, gross: {}, profit_share_bp: {}, profit_by_month: array(), cash: {} }) },
  'GET /cashflow': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'The cash position for the next 7 or 30 days (owner)', gates: ['moneyReader', 'on'], inline: [403], query: ['days', 'asOf'] },
  'GET /trial-balance': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'The trial balance as at a day (owner, auditor)', gates: ['moneyReader', 'on'], inline: [403], query: ['asOf'], out: object(['currency', 'asOf', 'rows', 'total_dr_minor', 'total_cr_minor', 'balanced'], { rows: array(), shown_as_at: text, bank: array(), over_rule: {}, compare: {} }) },
  'GET /pl': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'Profit and loss over a range inside one financial year (owner, auditor)', gates: ['moneyReader', 'on'], inline: [403], query: DATE_RANGE, out: object(['currency', 'from', 'to', 'income', 'expense', 'profit_minor'], { income: array(), expense: array(), gross_profit: {}, over_rule: {} }) },
  'GET /bs': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'The balance sheet as at a day (owner, auditor)', gates: ['moneyReader', 'on'], inline: [403], query: ['asOf'], out: object(['currency', 'asOf'], { shown_as_at: text, over_rule: {} }) },
  'POST /payments/preview': { seats: SEATS.ANY_NO_GRANT, summary: 'What a payment would settle, nothing written', gates: ['noKey', 'on'], body: ['party_id', 'party', 'direction', 'amount_minor', 'amount', 'currency', 'mode', 'allocate', 'allocations', 'checks'] },
  'POST /payments': { seats: SEATS.EDITOR_ADVISER_DOOR, summary: 'Record a payment in or out, settling bills oldest first or as named', gates: ['noKey', 'editor', 'payOut', 'on'], body: ['party_id', 'party', 'direction', 'amount_minor', 'amount', 'currency', 'mode', 'reference', 'cheque', 'cheque_no', 'cheque_bank', 'cheque_date', 'received_at', 'date', 'client_ref', 'acknowledge', 'allocate', 'allocations', 'if_locked', 'fx_rate', 'settles'], out: object(['ok']) },
  'GET /payments/:id/advice': { seats: SEATS.ANY_NO_GRANT, summary: 'The payment advice for one payment: whether it may be sent or shared, and the words', gates: ['noKey', 'on'], out: object(['currency', 'payment_id']) },
  'GET /bank/rail': { seats: SEATS.OWNER_MANAGER_ADVISER_READS, summary: "The rail leg of the bank reconciliation: the shop's payments over a range of at most 400 days", gates: ['moneyReader', 'on'], inline: [400], query: DATE_RANGE, out: object(['currency', 'from', 'to', 'parties', 'books', 'may']) },
  'POST /bank/marks': { seats: SEATS.EDITOR_ADVISER_DOOR, summary: 'Record bank reconciliation steps (accept, undo, note, attach) on statement lines; insert-only, who and when set by the server (editor)', gates: ['noKey', 'editor', 'bankWriter', 'on'], inline: [403, 404, 503], ok: 201, body: ['account', 'file_hash', 'marks'], required: ['account', 'marks'], out: object(['marks'], { marks: array() }, true) },
  'POST /bank/statements': { seats: SEATS.EDITOR_ADVISER_DOOR, summary: 'Sign off a bank reconciliation: the statement figures as the page carried them, with their currency and the file hash; insert-only (editor)', gates: ['noKey', 'editor', 'bankWriter', 'on'], inline: [400, 403, 404, 409, 503], ok: 201, body: ['account', 'period_from', 'period_to', 'opening_minor', 'closing_bank_minor', 'closing_books_minor', 'difference_minor', 'currency', 'file_hash'], required: ['account'], out: object(['statement'], { statement: { type: 'object' } }, true) },
  'POST /bank/statement-files': { seats: SEATS.EDITOR_ADVISER_DOOR, summary: 'Keep a bank statement file against a bank account and its period (csv, json or txt, at most 6 MB); the sha256 of the UTF-8 text is recomputed; the same file twice is refused, a crossing period is kept and flagged (the owner, or an adviser under a live grant)', gates: ['noKey', 'editor', 'bankWriter', 'on'], inline: [400, 403, 404, 409, 413, 415, 422, 503], ok: 201, body: ['account', 'label', 'period_from', 'period_to', 'currency', 'sha256', 'name', 'text'], required: ['account'], out: object(['file', 'overlaps', 'words'], { file: { type: 'object' }, overlaps: array(), words: text }) },
  'GET /bank/statement-files': { seats: SEATS.OWNER_BOTH_READ, summary: 'The kept bank statements as account by month, with the months that have none (read; an auditor too)', gates: ['noKey', 'on'], inline: [400, 503], query: ['accounts', 'months', 'to', 'limit', 'after', 'q', 'asOf'], queryBounds: { limit: bounds.limit() }, out: object(['currency', 'months', 'accounts', 'cells', 'files', 'older', 'may'], { signed_as_at: { type: 'object' }, currency: text, months: array(), accounts: array(), cells: array(), files: array(), older: { type: 'integer' }, total: { type: 'integer' }, next: { type: ['string', 'null'] } }) },
  'GET /bank/statement-files/:id/file': { seats: SEATS.OWNER_MANAGER_ADVISER_READS, summary: 'One kept bank statement file (use=read loads it into the Bank page; never cached; the owner, or an adviser under a live grant; no auditor grant reaches it, MONEY-01 A6)', gates: ['noKey', 'on'], inline: [404, 503], query: ['use'], media: 'application/octet-stream', noKeys: true },
  'GET /bank/log': { seats: SEATS.OWNER_BOTH_READ, summary: 'The shared bank reconciliation record of one account: the marks, the signed statements, and the posted bank lines no accept mark names', gates: ['noKey', 'on'], inline: [400, 404, 503], query: ['account', 'from', 'to', 'marks_limit', 'marks_before'], out: object(['currency', 'account', 'marks', 'statements', 'exceptions'], { currency: text, account: { type: 'object' }, marks: array(), marks_next: { type: ['integer', 'null'] }, statements: array(), exceptions: { type: ['array', 'null'] } }, true) },
  'PATCH /payments/:id': { seats: SEATS.EDITOR_NO_GRANT, summary: 'Record that a payment advice was sent or shared (a merge-patch of the named fields)', gates: ['noKey', 'on'], inline: [400, 409, 503], body: ['advice_chit_id', 'advice_shared_at'], out: object(['ok', 'payment_id', 'advice']) },
  'POST /payments/:id/propose': { seats: SEATS.EDITOR_NO_GRANT, summary: 'Which bills a payment would settle', gates: ['noKey', 'editor', 'payOut', 'on'], out: object(['payment_id']) },
  'POST /payments/:id/confirm': { seats: SEATS.EDITOR_NO_GRANT, summary: 'Confirm the allocation of a payment to bills', gates: ['noKey', 'editor', 'payOut', 'on'], body: ['allocations'] },
  'GET /cheques': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'The cheques, post-dated ones and the reminder setting', gates: ['moneyReader', 'on'], query: ['all'], out: object(['currency', 'asOf', 'cheques', 'pdc_reminders', 'remind'], { cheques: array() }) },
  'POST /cheques/:id/status': { seats: SEATS.EDITOR_NO_GRANT, summary: 'Move a cheque to deposited, cleared or bounced', gates: ['editor', 'on'], inline: [400], body: ['status', 'date'] },
  'POST /parties/:id/dispute': { seats: SEATS.EDITOR_NO_GRANT, summary: 'Mark a bill disputed, or not', gates: ['editor', 'on'], inline: [400], body: ['against_ref', 'side', 'disputed', 'note'] },
  'GET /events': { seats: SEATS.ANY_ADVISER_READS, summary: 'The kinds of entry a person may make, with the words and the fields', gates: ['noKey', 'on'], out: object(['events', 'may']) },
  'POST /preview': { seats: SEATS.ANY_ADVISER_DOOR, summary: 'The voucher an event would make, nothing written', gates: ['noKey', 'on'], body: EVENT_BODY },
  'POST /events': { seats: SEATS.OWNER_MANAGER_ADVISER_DOOR, summary: 'Record an event as a journal entry (owner)', gates: ['noKey', 'ownerOrAccountant', 'on'], body: EVENT_BODY },
  'POST /entries': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'Post a manual journal entry (owner)', gates: ['ownerOrAccountant', 'on'], inline: [409], body: ['narration', 'date', 'lines', 'ref', 'client_ref', 'against_ref'] },
  'POST /entries/:id/reverse': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'Reverse an entry with a mirror entry (owner)', gates: ['ownerOrAccountant', 'on'], inline: [409], body: ['reason', 'client_ref'] },
  'POST /write-off': { seats: SEATS.OWNER_ONLY, summary: 'Write off what a customer owes (owner)', gates: ['owner', 'on'], inline: [400, 409], body: ['party_id', 'party', 'amount_minor', 'amount', 'reason', 'date', 'against_ref', 'client_ref'] },
  'POST /opening': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'Post the opening balances as one entry (owner)', gates: ['ownerOrAccountant', 'on'], inline: [400], body: ['rows', 'date', 'client_ref', 'require_balanced'] },
  'POST /opening/preview': { seats: SEATS.OWNER_ONLY, summary: "The opening balances as the posting engine would see them: its own Difference, the bills against their control line, what would refuse; nothing is written (owner)", gates: ['owner', 'on'], inline: [400, 404], body: ['rows', 'date', 'currency', 'replace'], required: ['rows'], out: object(['currency', 'date', 'debit_minor', 'credit_minor', 'difference_minor', 'side', 'bills', 'refusals', 'can_save'], { currency: text, date: text, debit_minor: { type: 'integer' }, credit_minor: { type: 'integer' }, difference_minor: { type: 'integer' }, side: {}, bills: array(), refusals: array(), can_save: { type: 'boolean' }, posted_rows: { type: 'integer' } }, true) },
  'POST /opening/replace': { seats: SEATS.OWNER_ONLY, summary: 'Change the saved opening balances on a day: the old entries are reversed with the reason and the new rows posted, all or nothing (owner)', gates: ['owner', 'on'], inline: [400, 404, 409, 422], body: ['rows', 'date', 'currency', 'reason', 'client_ref'], required: ['rows', 'date', 'reason', 'client_ref'], out: object(['ok', 'entry_no', 'reversed', 'changes'], { ok: { type: 'boolean' }, duplicate: { type: 'boolean' }, entry_id: text, entry_no: text, posting_date: text, reversed: array(), changes: { type: 'integer' }, changed: array() }, true) },
  'GET /opening': { seats: SEATS.OWNER_BOTH_READ, summary: 'Every live opening line of a day (the first day that has one when none is named), with the ledger, party, bill, who entered it and when', gates: ['owner', 'on'], inline: [400], query: ['date'], out: object(['date', 'dates', 'currency', 'pinned', 'entries', 'lines', 'suspense_minor'], { date: {}, dates: array(), default_date: {}, currency: text, pinned: array(), entries: array(), lines: array(), suspense_minor: { type: 'integer' } }, true) },
  'GET /opening/years': { seats: SEATS.OWNER_BOTH_READ, summary: "Each financial year's opening and carry, read from the year close; the carried-out total set beside the next year's opening (nothing stored, nothing typed)", gates: ['owner', 'on'], out: object(['currency', 'years'], { currency: text, years: array() }, true) },
  'POST /move-in/preflight': { seats: SEATS.OWNER_ONLY, summary: 'Read a file from another system and guess its columns, nothing written (owner)', gates: ['owner', 'on'], body: MOVE_IN },
  'POST /move-in/preview': { seats: SEATS.OWNER_ONLY, summary: 'What importing the file would add, merge, skip or hold (owner)', gates: ['owner', 'on'], body: MOVE_IN },
  'POST /move-in/import': { seats: SEATS.OWNER_ONLY, summary: 'Import the file, once confirmed (owner)', gates: ['owner', 'on'], inline: [400], body: MOVE_IN.concat(['confirm']) },
  'GET /move-in/imports': { seats: SEATS.OWNER_ONLY, summary: 'The imports done so far (owner)', gates: ['owner', 'on'], inline: [403], out: object(['ready', 'why', 'imports']) },
  'GET /compare': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'The parallel-run snapshots (owner, accountant or bookkeeper, auditor)', gates: ['noKey', 'moneyReader', 'on'], inline: [403], out: object(['currency', 'ready', 'why', 'may', 'snapshots']) },
  'POST /compare/preflight': { seats: SEATS.OWNER_MANAGER_ONLY, summary: "Read the other system's report and guess its columns, nothing stored", gates: ['noKey', 'moneyReader', 'on'], inline: [403], body: ['part', 'source', 'csv', 'xlsx', 'xml', 'sheet', 'header_row', 'file_name'] },
  'POST /compare/snapshots': { seats: SEATS.OWNER_MANAGER_ONLY, summary: "Store the other system's report as a snapshot, never posted", gates: ['noKey', 'moneyReader', 'on'], inline: [403, 409], body: ['snapshot_id', 'label', 'source', 'part', 'period_from', 'period_to', 'file_name', 'csv', 'xlsx', 'xml', 'sheet', 'header_row', 'decisions'] },
  'GET /compare/:id': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'One snapshot compared with the ledger', gates: ['noKey', 'moneyReader', 'on'], inline: [403], out: object(['currency', 'snapshot', 'parts']) },
  'GET /compare/:id/csv': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'The same compare as a CSV file for the auditor', gates: ['noKey', 'moneyReader', 'on'], inline: [403], media: 'text/csv', noKeys: true },
  'POST /periods/:fy/:p/:act': { seats: SEATS.OWNER_ONLY, summary: 'Lock or unlock one month (owner); the act is lock or unlock', gates: ['owner', 'on'], body: ['reason', 'hard', 'amend_tax'], out: object(['ok', 'period']) },
  'POST /year/:fy/reopen': { seats: SEATS.OWNER_ONLY, summary: 'Open the newest closed year again (owner), with a reason; logged; refused in words when it is not the newest closed year', gates: ['owner', 'on'], body: ['reason'], out: object(['ok', 'fiscal_year', 'reopened']), example: { ok: true, fiscal_year: '2026-27', reopened: 12 }, bodyExample: { reason: 'A supplier bill for June arrived after the close' } },
  'POST /periods/:fy/:p/reopen': { seats: SEATS.OWNER_ONLY, summary: 'Open the last hard-locked month again (owner), with a reason; logged', gates: ['owner', 'on'], body: ['reason'], out: object(['ok', 'fiscal_year', 'period', 'status']), example: { ok: true, fiscal_year: '2026-27', period: 3, status: 'open' }, bodyExample: { reason: 'A September bill was posted to the wrong month' } },
  'POST /year/:fy/close': { seats: SEATS.OWNER_ONLY, summary: 'Close a financial year (owner), or on a closed year record that its returns were lodged outside the books; refused in words when something is open', gates: ['owner', 'on'], inline: [422], body: ['returns_lodged'] },
  'GET /loans': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: "The shop's loans for the bank line's picker: reference, lender, opening and still owed from the posted journal, a page at a time (owner, auditor)", gates: ['moneyReader', 'on'], query: ['limit', 'page'], queryBounds: { limit: Object.assign({}, bounds.limit(), { 'x-words': { type: 'limit must be a string.' } }) } /* the released sentence of a repeated ?limit, kept byte for byte (col16 fix) */, out: object(['loans', 'total', 'page', 'limit'], { loans: array(), capped: {}, cap_note: text }) },
  'GET /gst/lodged': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'The tax close each period of a year declared lodged carried: period, net owed, the close date (not a lodgement date) (owner, auditor)', gates: ['moneyReader', 'on'], out: object(['currency', 'periods', 'note'], { periods: array() }) },
  'GET /year/:fy/status': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: 'What closing a year would say, nothing written (owner, auditor)', gates: ['moneyReader', 'on'], out: object(['fiscal_year', 'closed', 'returns_lodged', 'reclosing', 'can_close', 'can_close_if_lodged', 'refusals', 'warnings', 'months', 'next']) },
  'GET /periods': { seats: SEATS.ANY_BOTH_READ, summary: 'The months of the books and what each may do; the figures only for the owner and the auditor (every seat reads the months)', gates: ['noKey', 'on'], query: ['fy'], out: object(['periods'], { periods: array(), under_review: {}, years: array(), books_start: {}, lock_date: {}, gaps: array() }) },
  'GET /packs': { seats: SEATS.OWNER_MANAGER_ADVISER_READS, summary: 'The audit packs built so far (owner or the shop accountant)', gates: ['ownerOrAccountant', 'on'], out: object(['packs'], { packs: array() }) },
  'POST /packs': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'Build an audit pack (owner or the shop accountant)', gates: ['ownerOrAccountant', 'on'], body: ['kind', 'fiscal_year', 'period'], out: object(['ok', 'pack', 'manifest']) },
  'GET /packs/:id': { seats: SEATS.OWNER_MANAGER_ADVISER_READS, summary: 'One audit pack and its manifest (owner or the shop accountant)', gates: ['ownerOrAccountant', 'on'], out: object(['pack', 'manifest', 'has_file', 'file', 'download']) },
  'GET /packs/:id/file': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'The pack as a zip file (owner or the shop accountant)', gates: ['ownerOrAccountant', 'on'], inline: [409], media: 'application/zip', noKeys: true },
  'POST /packs/:id/ack': { seats: SEATS.OWNER_ONLY, summary: 'Say the pack was received (owner)', gates: ['owner', 'on'], inline: [409], out: object(['ok', 'acknowledged_at']) },
  'GET /recurring': { seats: SEATS.OWNER_ADVISER_READS, summary: 'The recurring entries (owner)', gates: ['owner', 'on'], out: object(['recurring'], { recurring: array() }) },
  'POST /recurring': { seats: SEATS.OWNER_ONLY, summary: 'Add a recurring entry (owner)', gates: ['owner', 'on'], body: ['name', 'event', 'frequency', 'next_on', 'end_on', 'auto', 'active'] },
  'PATCH /recurring/:id': { seats: SEATS.OWNER_ONLY, summary: 'Change a recurring entry; only the fields sent change (owner)', gates: ['owner', 'on'], body: ['name', 'event', 'frequency', 'next_on', 'end_on', 'auto', 'active'] },
  'DELETE /recurring/:id': { seats: SEATS.OWNER_ONLY, summary: 'Stop a recurring entry; what it posted stays (owner)', gates: ['owner', 'on'] },
  'POST /recurring/:id/post': { seats: SEATS.OWNER_ONLY, summary: 'Accept the due proposal: post it and move on (owner)', gates: ['owner', 'on'] },
  'POST /recurring/:id/skip': { seats: SEATS.OWNER_ONLY, summary: 'Let the due proposal pass (owner)', gates: ['owner', 'on'] },
  'GET /todo': { seats: SEATS.ANY_ADVISER_READS, summary: 'What needs doing in CB Accounts: bills to accept, months not locked, and the rest', gates: ['noKey', 'on'], out: array() },
  'GET /assets': { seats: SEATS.OWNER_ADVISER_READS, summary: 'The fixed-asset register and the net block (owner)', gates: ['owner', 'on'], query: ['asOf'], out: object(['currency', 'asOf', 'assets', 'total_wdv_minor'], { assets: array() }) },
  'POST /assets': { seats: SEATS.OWNER_ONLY, summary: 'Buy a fixed asset (the purchase entry, the tax on a bill claimed) or add one owned before the books began (an opening entry); the register row (owner)', gates: ['owner', 'on'], body: ['name', 'class', 'cost', 'date', 'put_to_use', 'how', 'party_id', 'client_ref', 'cost_minor', 'asset_class', 'party', 'bill', 'existing', 'accumulated', 'accumulated_minor'] },
  'POST /assets/:id/dispose': { seats: SEATS.OWNER_ONLY, summary: 'Dispose of a fixed asset (owner)', gates: ['owner', 'on'], body: ['date', 'proceeds', 'into', 'client_ref', 'proceeds_minor', 'party_id'] },
  'GET /depreciation/schedule': { seats: SEATS.OWNER_ADVISER_READS, summary: 'The depreciation to a day per asset and class, posting nothing (owner)', gates: ['owner', 'on'], query: ['fy', 'through'], out: object(['currency', 'fy', 'through', 'assets', 'by_class', 'total_due_minor'], { assets: array(), by_class: array() }) },
  'POST /depreciation/run': { seats: SEATS.OWNER_ONLY, summary: 'Post the depreciation to a day (a month end; the year end when left out) from the register (owner)', gates: ['owner', 'on'], body: ['fy', 'through', 'client_ref'] },
  'POST /closing-stock': { seats: SEATS.OWNER_ONLY, summary: 'Post the closing stock, by hand or valued from the stock ledger (owner)', gates: ['owner', 'on'], body: ['date', 'value_minor', 'nrv_minor', 'method', 'cost_formula', 'client_ref', 'value', 'nrv'] },
  'POST /gst/close': { seats: SEATS.OWNER_ONLY, summary: 'Close the GST month: utilise the credit and show what is payable (owner)', gates: ['owner', 'on'], body: ['fy', 'period', 'frequency', 'stagger', 'client_ref'] },
  'POST /gst/pay': { seats: SEATS.OWNER_ONLY, summary: 'Record the GST payment for a month (owner)', gates: ['owner', 'on'], inline: [409], body: ['fy', 'period', 'amounts', 'bank', 'challan_no', 'payment_ref', 'mode', 'rcm', 'frequency', 'stagger', 'date'] },
  'GET /returns': { seats: SEATS.OWNER_MANAGER_BOTH_READ, summary: "The shop's own tax return read from the books for one period (owner)", gates: ['moneyReader', 'on'], query: ['period', 'frequency', 'simpler', 'stagger', 'emirate'] },
  'POST /loans': { seats: SEATS.OWNER_ONLY, summary: 'Take a loan (owner)', gates: ['owner', 'on'], body: ['ref', 'lender', 'amount', 'into', 'rate', 'kind', 'bank', 'client_ref', 'amount_minor', 'date'] },
  'POST /loans/:ref/emi': { seats: SEATS.OWNER_ONLY, summary: 'Pay a loan instalment (owner)', gates: ['owner', 'on'], body: ['principal', 'interest', 'from', 'bank', 'date', 'client_ref', 'principal_minor', 'interest_minor'] },
  'POST /accruals': { seats: SEATS.OWNER_ONLY, summary: 'Accrue an expense or income to be reversed later (owner)', gates: ['owner', 'on'], body: ['ref', 'kind', 'class', 'amount', 'date', 'amount_minor', 'narration', 'client_ref'] },
  'POST /accruals/:ref/reverse': { seats: SEATS.OWNER_ONLY, summary: 'Reverse an accrual (owner)', gates: ['owner', 'on'], body: ['date', 'client_ref'] },
  'POST /contra': { seats: SEATS.OWNER_ONLY, summary: 'Move money between cash, bank and UPI (owner)', gates: ['owner', 'on'], body: ['from', 'to', 'amount', 'date', 'client_ref', 'narration', 'amount_minor'] },
  'GET /fx-rates': { seats: SEATS.ANY_BOTH_READ, summary: 'The exchange rates the owner has entered', gates: ['noKey', 'on'], query: ['from', 'suggest_for'], out: object(['currency', 'ready', 'why', 'may', 'rates'], { rates: array() }) },
  'POST /fx-rates': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'Add an exchange rate for a day (owner or the shop accountant); insert-only', gates: ['noKey', 'on', 'ownerOrAccountant'], ok: 201, body: ['date', 'currency', 'rate', 'source', 'source_ref', 'rate_date', 'from', 'from_ccy', 'to', 'to_ccy'], out: object(['rate']) },
  'POST /fx-rates/import': { seats: SEATS.OWNER_MANAGER_ONLY, summary: 'Import exchange rates from a CSV (owner or the shop accountant)', gates: ['noKey', 'on', 'ownerOrAccountant'], body: ['csv', 'file_name'], out: object(['added', 'refused', 'rates']) },
  'GET /fx-revalue': { seats: SEATS.OWNER_ONLY, summary: 'What revaluing the foreign balances at month end would post (owner)', gates: ['noKey', 'on', 'owner'], inline: [400], query: ['fiscal_year', 'period'], out: object(['ready', 'why', 'may', 'rows', 'missing', 'gain_minor', 'posted']) },
  'POST /fx-revalue': { seats: SEATS.OWNER_ONLY, summary: 'Post the revaluation and its reversal (owner); idempotent', gates: ['noKey', 'on', 'owner'], inline: [400], body: ['fiscal_year', 'period'] }
};

/* ── S33 strict input (OWASP API3:2023, mass assignment): every write body is an allow-list; a key no route, library or web caller reads is refused 422 UNKNOWN_FIELD,
 *    named (middleware/validate.js). Each list above holds what the handler, the library it hands the body to (books-period, finance-terms, parallel-run, move-in) and the
 *    web screens (cap-books, cap-period, cap-compare, cap-finance-*, cap-move-in, accounts-shell, rail-advice) send — declared first, then closed (API-S2: never take away
 *    what a caller sends). POST /events and POST /preview (pass 2, 7 Nov) are closed too: their body is the chosen entry kind's own fields, so EVENT_BODY is the union of every key books-manual's builders read
 *    (eventOf spreads `event` over the body, then BUILD[kind] reads b.* and hands it to books-period amountOf/dateOf/refOf/contraEvent and the tax lines) and the web sheet cap-entry sends (enBody, client_ref, attachment, paid_by, cheque_no, cheque_date). ── */
const CLOSED = { additionalProperties: false };
const WRITES = /^(POST|PUT|PATCH) /;
for (const [key, row] of Object.entries(ROUTES)) if (WRITES.test(key)) row.rules = Object.assign({}, row.rules, CLOSED);

const contract = contractOf({ mount: '/api/books', routes: ROUTES, gateStatus: GATE_STATUS, refusals: REFUSALS, refusalsWhen: 'on', extension: 'x-books-refusals' });

module.exports = Object.assign({ refusalOf, SAID, ROUTES, REFUSALS, PAGE }, contract);

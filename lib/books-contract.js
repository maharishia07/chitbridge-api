/*
 * OWNS      the contract of routes/books.js: each route's OpenAPI operation (S9), the ledger's refusal mapper (refusalOf) and the sentences its gates answer in.
 * CALLED BY routes/books.js (schemaValidate on each route, router.openapi, problem(req, res, refusalOf(e))) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-books.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           thrown refusal → refusalOf(e) → { status, code, detail, legacy } → problem() → the old body's keys beside the Problem fields
 * CARD      16-finance/books-routes
 * Kept apart from the route file so its handlers keep their places (and their history) while the contract grows here. This file shapes NO answer: the figures are the engines'.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names and kinds, nothing required, nothing narrowed. Every handler answers a missing or odd value in its own words
 *    (a 400 "Which customer?"), and those words are frozen (docs/contracts/api-legacy.json). Required fields and unknown-key refusal are API-3 (strict_input) with the owner's say.
 * ⚠️ A query or body value the handler reads leniently (a bad date falls back to today, a page falls back to the first) is declared as plain text: a schema that refused it would turn a
 *    fallback into a refusal no caller has ever had.
 */
'use strict';
const { internalSpec } = require('./problem');
const { contractOf, object, array } = require('./contract-kit');
const { SAFE_SENTENCE } = require('./respond');

/* ── the sentences the gates and the shared refusals answer in (frozen: they are the words the Ledger screen shows) ── */
const SAID = {
  signIn: 'Sign in to use the ledger.',
  ownerOnly: 'Only the owner may do this.',
  notFound: 'Not found',
  saved: 'That is already recorded.',
  notReady: 'Not available yet.',
  notMigrated: 'This cannot be saved yet — a database update (b295) is still to run.',
  termsNotMigrated: 'Terms arrive after the next update.',
  notAuditor: "Only the owner or the shop's auditor may compare the books.",
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
/** the ledger's refusals, first match wins; the order is the order the route file always asked in (a "not migrated" refusal is read before the general 422) */
const RULES = [
  [(e) => LOCKS.includes(e.code), (e) => coded(409, e.code, e)],
  [(e) => e.code === 'BOOKS_NOT_FOUND', (e) => plain(404, 'NOT_FOUND', e, { error: SAID.notFound, message: e.message })],
  [(e) => e.code === 'FX_RATE_MISSING' || e.code === 'RETURN_FROM_RAIL' || COUNTRY_GATE.includes(e.code), (e) => coded(422, e.code, e)],
  [(e) => e.code === 'BOOKS_ENGINE' || e.code === 'BOOKS_NOT_MIGRATED', (e) => coded(503, e.code, e)],
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
const GATE_STATUS = { owner: 403, noKey: 403, editor: 403, comparer: 403, on: 404 };
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
const ROUTES = {
  'GET /status': { summary: 'Whether the ledger is switched on, and whether it may be', gates: ['owner'], out: object(['migrated', 'enabled', 'walkin_grain', 'engines', 'country']) },
  'POST /enable': { summary: 'Switch the ledger on (owner)', gates: ['owner'], body: ['walkin_grain'] },
  'POST /setting': { summary: 'Change the walk-in grain or switch the ledger off (owner)', gates: ['owner', 'on'], body: ['enabled', 'walkin_grain'], out: object(['ok', 'enabled', 'walkin_grain']) },
  'GET /terms': { summary: "The shop's credit terms and, with party_id, that party's own", gates: ['noKey', 'on'], query: ['party_id', 'side'], out: object(['terms_migrated', 'may_set', 'why_not', 'default', 'party', 'events']) },
  'POST /terms': { summary: "Set the shop's default terms or one party's (owner)", gates: ['owner', 'on'], inline: [503], body: ['party_id', 'side', 'credit_days', 'credit_limit_minor', 'interest', 'early'], out: object(['ok', 'terms']) },
  'GET /health': { summary: "The ledger's probe and to-do list: the waiting posts, the year, the country", gates: ['on'], out: object(['enabled', 'currency', 'country', 'walkin_grain', 'engines', 'year', 'waiting', 'total', 'page', 'limit', 'todo']) },
  'POST /check': { summary: 'Run the nightly books check now (owner)', gates: ['owner', 'on'] },
  'POST /money-check/:chit_id/resolve': { summary: 'Close the to-do item of a sale let through although the money did not add up (owner or editor)', gates: ['noKey', 'editor', 'on'], body: ['how', 'note'] },
  'POST /outbox/retry': { summary: 'Try the waiting posts again (owner)', gates: ['owner', 'on'] },
  'GET /accounts': { summary: "The shop's chart of accounts", gates: ['on'], out: object(['accounts'], { accounts: array(object(['account_id', 'code', 'name', 'is_group'])) }) },
  'POST /accounts': { summary: 'Add a ledger to the chart under a group (owner)', gates: ['owner', 'on'], body: ['name', 'parent_code', 'parent_id', 'code', 'account_code', 'source_code'], out: object(['ok', 'account']) },
  'GET /daybook': { summary: 'The day book: every entry of a date range, newest page first', gates: ['on'], query: DATE_RANGE.concat(['entries'], PAGE), out: object(['currency', 'from', 'to', 'entries', 'count'], { entries: array() }) },
  'GET /ledger/:account': { summary: 'One ledger over a range (the account is its code, its role or its id)', gates: ['on'], query: DATE_RANGE.concat(['party'], PAGE), out: object(['currency']) },
  'GET /party/:id/statement': { summary: "One party's statement over a range", gates: ['noKey', 'on'], query: DATE_RANGE, out: object(['currency', 'party_id', 'from', 'to']) },
  'GET /dues': { summary: 'Who owes the shop and whom the shop owes, as at a day (' + MONEY + ')', gates: ['noKey', 'on'], inline: [403], query: ['asOf', 'side', 'finance'], out: object(['currency', 'asOf', 'parties', 'total_minor'], { parties: array() }) },
  'GET /cashflow': { summary: 'The cash position for the next 7 or 30 days (owner)', gates: ['noKey', 'on'], inline: [403], query: ['days', 'asOf'] },
  'GET /trial-balance': { summary: 'The trial balance as at a day', gates: ['on'], query: ['asOf'], out: object(['currency', 'asOf', 'rows', 'total_dr_minor', 'total_cr_minor', 'balanced'], { rows: array() }) },
  'GET /pl': { summary: 'Profit and loss over a range inside one financial year', gates: ['on'], query: DATE_RANGE, out: object(['currency', 'from', 'to', 'income', 'expense', 'profit_minor'], { income: array(), expense: array() }) },
  'GET /bs': { summary: 'The balance sheet as at a day', gates: ['on'], query: ['asOf'], out: object(['currency', 'asOf']) },
  'POST /payments/preview': { summary: 'What a payment would settle, nothing written', gates: ['noKey', 'on'], body: ['party_id', 'party', 'direction', 'amount_minor', 'amount', 'currency', 'mode', 'allocate', 'allocations'] },
  'POST /payments': { summary: 'Record a payment in or out, settling bills oldest first or as named', gates: ['noKey', 'editor', 'on'], body: ['party_id', 'party', 'direction', 'amount_minor', 'amount', 'currency', 'mode', 'reference', 'cheque', 'cheque_no', 'cheque_bank', 'cheque_date', 'received_at', 'date', 'client_ref', 'acknowledge', 'allocate', 'allocations'], out: object(['ok']) },
  'GET /payments/:id/advice': { summary: 'The payment advice for one payment: whether it may be sent or shared, and the words', gates: ['noKey', 'on'], out: object(['currency', 'payment_id']) },
  'GET /bank/rail': { summary: "The rail leg of the bank reconciliation: the shop's payments over a range of at most 400 days", gates: ['noKey', 'on'], inline: [400], query: DATE_RANGE, out: object(['currency', 'from', 'to', 'parties', 'may']) },
  'PATCH /payments/:id': { summary: 'Record that a payment advice was sent or shared (a merge-patch of the named fields)', gates: ['noKey', 'on'], inline: [400, 409, 503], body: ['advice_chit_id', 'advice_shared_at'], out: object(['ok', 'payment_id', 'advice']) },
  'POST /payments/:id/propose': { summary: 'Which bills a payment would settle', gates: ['noKey', 'editor', 'on'], out: object(['payment_id']) },
  'POST /payments/:id/confirm': { summary: 'Confirm the allocation of a payment to bills', gates: ['noKey', 'editor', 'on'], body: ['allocations'] },
  'GET /cheques': { summary: 'The cheques, post-dated ones and the reminder setting', gates: ['noKey', 'on'], query: ['all'], out: object(['currency', 'asOf', 'cheques', 'pdc_reminders', 'remind'], { cheques: array() }) },
  'POST /cheques/:id/status': { summary: 'Move a cheque to deposited, cleared or bounced', gates: ['editor', 'on'], inline: [400], body: ['status', 'date'] },
  'POST /parties/:id/dispute': { summary: 'Mark a bill disputed, or not', gates: ['editor', 'on'], inline: [400], body: ['against_ref', 'side', 'disputed', 'note'] },
  'GET /events': { summary: 'The kinds of entry a person may make, with the words and the fields', gates: ['noKey', 'on'], out: object(['events']) },
  'POST /preview': { summary: 'The voucher an event would make, nothing written', gates: ['noKey', 'on'], body: ['event'] },
  'POST /events': { summary: 'Record an event as a journal entry (owner)', gates: ['noKey', 'owner', 'on'], body: ['event', 'client_ref'] },
  'POST /entries': { summary: 'Post a manual journal entry (owner)', gates: ['owner', 'on'], body: ['narration', 'date', 'lines', 'ref', 'client_ref', 'against_ref'] },
  'POST /entries/:id/reverse': { summary: 'Reverse an entry with a mirror entry (owner)', gates: ['owner', 'on'], inline: [409], body: ['reason'] },
  'POST /write-off': { summary: 'Write off what a customer owes (owner)', gates: ['owner', 'on'], inline: [400], body: ['party_id', 'party', 'amount_minor', 'amount', 'reason', 'date', 'against_ref', 'client_ref'] },
  'POST /opening': { summary: 'Post the opening balances as one entry (owner)', gates: ['owner', 'on'], inline: [400], body: ['rows', 'date', 'client_ref'] },
  'POST /move-in/preflight': { summary: 'Read a file from another system and guess its columns, nothing written (owner)', gates: ['owner', 'on'], body: ['kind', 'source', 'csv', 'xlsx', 'sheet', 'header_row'] },
  'POST /move-in/preview': { summary: 'What importing the file would add, merge, skip or hold (owner)', gates: ['owner', 'on'], body: ['kind', 'source', 'source_country', 'source_company', 'csv', 'xlsx', 'decisions', 'side', 'as_at'] },
  'POST /move-in/import': { summary: 'Import the file, once confirmed (owner)', gates: ['owner', 'on'], inline: [400], body: ['kind', 'source', 'source_country', 'source_company', 'csv', 'xlsx', 'decisions', 'side', 'as_at', 'confirm', 'client_ref'] },
  'GET /move-in/imports': { summary: 'The imports done so far (owner)', gates: ['owner', 'on'], inline: [403], out: object(['ready', 'why', 'imports']) },
  'GET /compare': { summary: 'The parallel-run snapshots (owner or the shop auditor)', gates: ['noKey', 'on', 'comparer'], inline: [403], out: object(['currency', 'ready', 'why', 'may', 'snapshots']) },
  'POST /compare/preflight': { summary: "Read the other system's report and guess its columns, nothing stored", gates: ['noKey', 'on', 'comparer'], inline: [403], body: ['part', 'source', 'csv', 'xlsx', 'xml', 'sheet', 'header_row'] },
  'POST /compare/snapshots': { summary: "Store the other system's report as a snapshot, never posted", gates: ['noKey', 'on', 'comparer'], inline: [403, 409], body: ['snapshot_id', 'label', 'source', 'part', 'period_from', 'period_to', 'file_name', 'csv', 'xlsx', 'xml', 'sheet', 'header_row', 'decisions'] },
  'GET /compare/:id': { summary: 'One snapshot compared with the ledger', gates: ['noKey', 'on', 'comparer'], inline: [403], out: object(['currency', 'snapshot', 'parts']) },
  'GET /compare/:id/csv': { summary: 'The same compare as a CSV file for the auditor', gates: ['noKey', 'on', 'comparer'], inline: [403], media: 'text/csv' },
  'POST /periods/:fy/:p/:act': { summary: 'Lock or unlock one month (owner); the act is lock or unlock', gates: ['owner', 'on'], body: ['reason', 'hard'], out: object(['ok', 'period']) },
  'POST /year/:fy/close': { summary: 'Close a financial year (owner); refused in words when something is open', gates: ['owner', 'on'], inline: [422], body: [] },
  'GET /year/:fy/status': { summary: 'What closing a year would say, nothing written', gates: ['on'], out: object(['fiscal_year', 'closed', 'can_close', 'refusals', 'months', 'next']) },
  'GET /periods': { summary: 'The months of the books and what each may do', gates: ['on'], query: ['fy'], out: object(['periods'], { periods: array() }) },
  'GET /packs': { summary: 'The audit packs built so far (owner)', gates: ['owner', 'on'], out: object(['packs'], { packs: array() }) },
  'POST /packs': { summary: 'Build an audit pack (owner)', gates: ['owner', 'on'], body: ['kind', 'fiscal_year', 'period'], out: object(['ok', 'pack', 'manifest']) },
  'GET /packs/:id': { summary: 'One audit pack and its manifest (owner)', gates: ['owner', 'on'], out: object(['pack', 'manifest', 'has_file', 'file', 'download']) },
  'GET /packs/:id/file': { summary: 'The pack as a zip file (owner)', gates: ['owner', 'on'], inline: [409], media: 'application/zip' },
  'POST /packs/:id/ack': { summary: 'Say the pack was received (owner)', gates: ['owner', 'on'], inline: [409], out: object(['ok', 'acknowledged_at']) },
  'GET /recurring': { summary: 'The recurring entries (owner)', gates: ['owner', 'on'], out: object(['recurring'], { recurring: array() }) },
  'POST /recurring': { summary: 'Add a recurring entry (owner)', gates: ['owner', 'on'], body: ['name', 'event', 'frequency', 'next_on', 'end_on', 'auto'] },
  'PATCH /recurring/:id': { summary: 'Change a recurring entry; only the fields sent change (owner)', gates: ['owner', 'on'], body: ['name', 'event', 'frequency', 'next_on', 'end_on', 'auto', 'active'] },
  'DELETE /recurring/:id': { summary: 'Stop a recurring entry; what it posted stays (owner)', gates: ['owner', 'on'] },
  'POST /recurring/:id/post': { summary: 'Accept the due proposal: post it and move on (owner)', gates: ['owner', 'on'] },
  'POST /recurring/:id/skip': { summary: 'Let the due proposal pass (owner)', gates: ['owner', 'on'] },
  'GET /todo': { summary: 'What needs doing in CB Accounts: bills to accept, months not locked, and the rest', gates: ['noKey', 'on'], out: array() },
  'GET /assets': { summary: 'The fixed-asset register and the net block (owner)', gates: ['owner', 'on'], query: ['asOf'], out: object(['currency', 'asOf', 'assets', 'total_wdv_minor'], { assets: array() }) },
  'POST /assets': { summary: 'Buy a fixed asset: the purchase entry and the register row (owner)', gates: ['owner', 'on'], body: ['name', 'class', 'cost', 'date', 'put_to_use', 'how', 'party_id', 'client_ref'] },
  'POST /assets/:id/dispose': { summary: 'Dispose of a fixed asset (owner)', gates: ['owner', 'on'], body: ['date', 'proceeds', 'into', 'client_ref'] },
  'POST /depreciation/run': { summary: 'Run the year-end depreciation from the register (owner)', gates: ['owner', 'on'], body: ['fy'] },
  'POST /closing-stock': { summary: 'Post the closing stock, by hand or valued from the stock ledger (owner)', gates: ['owner', 'on'], body: ['date', 'value_minor', 'nrv_minor', 'method'] },
  'POST /gst/close': { summary: 'Close the GST month: utilise the credit and show what is payable (owner)', gates: ['owner', 'on'], body: ['fy', 'period'] },
  'POST /gst/pay': { summary: 'Record the GST payment for a month (owner)', gates: ['owner', 'on'], body: ['fy', 'period', 'amounts', 'bank', 'challan_no'] },
  'GET /returns': { summary: "The shop's own tax return read from the books for one period (owner)", gates: ['owner', 'on'], query: ['period', 'frequency', 'simpler', 'stagger', 'emirate'] },
  'POST /loans': { summary: 'Take a loan (owner)', gates: ['owner', 'on'], body: ['ref', 'lender', 'amount', 'into', 'rate', 'kind'] },
  'POST /loans/:ref/emi': { summary: 'Pay a loan instalment (owner)', gates: ['owner', 'on'], body: ['principal', 'interest', 'from', 'date', 'client_ref'] },
  'POST /accruals': { summary: 'Accrue an expense or income to be reversed later (owner)', gates: ['owner', 'on'], body: ['ref', 'kind', 'class', 'amount', 'date'] },
  'POST /accruals/:ref/reverse': { summary: 'Reverse an accrual (owner)', gates: ['owner', 'on'], body: ['date'] },
  'POST /contra': { summary: 'Move money between cash, bank and UPI (owner)', gates: ['owner', 'on'], body: ['from', 'to', 'amount', 'date', 'client_ref'] },
  'GET /fx-rates': { summary: 'The exchange rates the owner has entered', gates: ['noKey', 'on'], query: ['from'], out: object(['currency', 'ready', 'why', 'may', 'rates'], { rates: array() }) },
  'POST /fx-rates': { summary: 'Add an exchange rate for a day (owner); insert-only', gates: ['noKey', 'on', 'owner'], ok: 201, body: ['date', 'currency', 'rate', 'source', 'source_ref'], out: object(['rate']) },
  'POST /fx-rates/import': { summary: 'Import exchange rates from a CSV (owner)', gates: ['noKey', 'on', 'owner'], body: ['csv', 'file_name'], out: object(['added', 'refused', 'rates']) },
  'GET /fx-revalue': { summary: 'What revaluing the foreign balances at month end would post (owner)', gates: ['noKey', 'on', 'owner'], inline: [400], query: ['fiscal_year', 'period'], out: object(['ready', 'why', 'may', 'rows', 'missing', 'gain_minor', 'posted']) },
  'POST /fx-revalue': { summary: 'Post the revaluation and its reversal (owner); idempotent', gates: ['noKey', 'on', 'owner'], inline: [400], body: ['fiscal_year', 'period'] }
};

const contract = contractOf({ mount: '/api/books', routes: ROUTES, gateStatus: GATE_STATUS, refusals: REFUSALS, refusalsWhen: 'on', extension: 'x-books-refusals' });

module.exports = Object.assign({ refusalOf, SAID, ROUTES, REFUSALS, PAGE }, contract);

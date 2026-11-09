#!/usr/bin/env node
/**
 * api-problem-books.test.cjs — API-4 sweep, accounts and finance: every refusal of routes/books.js, routes/tax.js and routes/invoice.js.
 *
 * OWNS      the proof that each refusal of the ledger's routes (and the tax and invoice services') is a Problem body AND still carries the keys it answered before
 *           (docs/contracts/api-legacy.json, recorded from the code before the sweep), and this file's rows of docs/contracts/api-error-tests.json
 *           (the statuses each books route is tested for, which the register's error_tests column reads). Also: no answer outside the statuses the
 *           route's contract declares (lib/books-contract.js), and the ledger's refusal mapper (refusalOf) as a unit.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/books.js over a stand-in db, auth and country gate.
 * FLOW      route list (read from the router itself) x world (signed out, a key, staff, ledger off, a bad id, a failing db, an empty db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-books.test.cjs                    check
 *   node tests/api-problem-books.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-books.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-books.test.cjs --compare F        the answers now against a capture F: byte for byte (status, content type, body)
 *   node tests/api-problem-books.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.OUTPUT_ALLOWLIST = 'enforce'; /* S34: a sweep test runs the allow-list for real; production defaults to report */
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json'); /* the area tests' own evidence file (R2-4) */
const ANSWERS_FILE = path.join(HERE, 'docs', 'contracts', 'books-answers.json'); /* the period-end routes' 2xx answers, produced by tests/support/books-capture.cjs --build */
const MOUNT = '/api/books';
const FOREIGN = require('./lib/foreign-id-world.cjs');
const MOUNTS = ['/api/books', '/api/tax', '/api/invoice'];
/** the route files these mounts serve (named in full so the graph links this test to each of them) */
const ROUTE_FILES = { '/api/books': 'routes/books.js', '/api/tax': 'routes/tax.js', '/api/invoice': 'routes/invoice.js' };
const MINE = (route) => MOUNTS.some((mount) => route.includes(' ' + mount + '/'));
const argv = process.argv.slice(2);
const flagValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  if (!condition || argv.includes('--verbose')) console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/* ── stand-ins: auth, db, the country gate ─────────────────────────────────────────────────────────────────── */
const SHOP = '11111111-1111-4111-8111-111111111111';
const PARTY = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
const SECRET_SQL = 'relation "books_entry" does not exist -- SELECT secret FROM vault';
const FRESH = { realAuth: false, who: OWNER, asKey: false, ledgerOn: true, db: 'ok', sqlRows: null, rowOwner: null, sqlLog: null, registration: 'unregistered' };
const world = Object.assign({}, FRESH);
const SETTING_ROW = { entity_id: SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 4, functional_currency: 'INR', country: 'IN', pack_version: '1', timezone: 'Asia/Kolkata' };
const OTHER = '77777777-7777-4777-8777-777777777777'; /* another shop: the owner of the row in the foreign-id world */
/** another shop's row that answers ANY column (the generator's proxy row, tools/api-contract-tests.cjs rowOf): a handler that read it unscoped would answer with it, not 404 */
const foreignRow = () => new Proxy({}, { get: (target, name) => (typeof name !== 'string' || name === 'then' || name === 'toJSON' ? undefined : /entity_id$|^owner$/.test(name) ? OTHER : /_id$/.test(name) ? PARTY : /_at$|date/.test(name) ? '2026-10-01' : 1), has: () => true });

/** the rows a statement gets: the ledger's switch, then a scenario's own rows, then nothing (or the secret failure when the db is down) */
function rowsFor(sql, params) {
  if (world.sqlLog) world.sqlLog.push(String(sql));
  /* K-1: a db that answers as Postgres does to a value that is no uuid (22P02), so a route that lets one through shows as a 500 */
  if (world.db === 'uuid' && (params || []).some((value) => typeof value === 'string' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw Object.assign(new Error('invalid input syntax for type uuid: "' + params[0] + '"'), { code: '22P02' });
  if (/FROM books_setting/.test(sql)) return world.ledgerOn ? { rows: [SETTING_ROW], rowCount: 1 } : { rows: [], rowCount: 0 };
  /* S35 (Wave M · M3): the path id names ANOTHER shop's row — hidden from a statement that names the caller (SHOP: a scoped read, as RLS hides it), shown to any statement that does not (a read by the id alone surfaces it) */
  if (world.rowOwner && (params || []).includes(PARTY)) return params.includes(SHOP) ? { rows: [], rowCount: 0 } : { rows: [foreignRow()], rowCount: 1 };
  if (world.sqlRows) {
    const given = world.sqlRows(String(sql));
    if (given) return given;
  }
  if (world.db === 'fail') throw new Error(SECRET_SQL);
  /* CTRY-94: the engines no longer read India for a party with no country, so the generic world's shop says it is in India (a shop that never said is a 422 on every tax read) */
  if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: [{ identity_id: SHOP, gstn: null, display_name: null, policy_flags: {}, country: 'IN' }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    if (world.asKey) req.api_key = { jti: 'j1', scopes: ['till'] };
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const client = { query: async (sql, params) => rowsFor(sql, params) };
  const known = { query: async (sql, params) => rowsFor(sql, params), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), readBatch: async () => [{ rows: [], rowCount: 0 }] };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db);
  mock('db/index', db);
  /* ACC-272: tax/compute and invoice/build ask the shop's registration (registrationOfShop; a world says it: 'unknown' = never said) */
  mock('lib/country-setup', { COUNTRY_FIRST: 'Set the shop’s country first (Country setup) — the books are kept by its law.' /* CTRY-94: the one sentence, as lib/country-setup holds it */, registrationOfShop: async () => world.registration, registrationWord: (answer, scheme) => (answer && answer !== 'regular' ? answer : String(scheme || 'regular')), registrationAsk: () => ({ code: 'TAX_REGISTRATION_UNKNOWN', question: 'Is this business registered for GST?' }), currencyStated: (...vals) => vals.find((one) => typeof one === 'string' && one.trim()) || null, gate: async () => ({ books: true, code: null, country: 'IN' }), status: async () => ({ books: true, code: null, country: 'IN' }) });
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
}

/* ── the scenarios: every route the router holds x the worlds, then the named extras ──────────────────────── */
const PARAM_VALUES = { id: PARTY, chit_id: PARTY, account: '1300', fy: '2026-27', p: '6', act: 'lock', ref: 'L1' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'viewer-asks', setup: { who: VIEWER } },
  { id: 'ledger-off', setup: { ledgerOn: false } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** { 'METHOD /full/path': template } for every route the books router holds, read from the router itself */
function routesOf(router, mount) {
  const found = {};
  router.stack.filter((layer) => layer.route).forEach((layer) => Object.keys(layer.route.methods).forEach((method) => {
    found[method.toUpperCase() + ' ' + mount + layer.route.path] = mount + layer.route.path;
  }));
  return found;
}
const urlOf = (template, bad) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : PARAM_VALUES[name] || PARTY));

/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler) */
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const PACK_ROW = { pack_id: PARTY, kind: 'year', fiscal_year: '2026-27', storage_path: null, sha256: 'abc' };
const ADVICE_PATCH = (ready) => ({
  store: { payment: async () => ({ payment_id: PARTY }), adviceReady: async () => ready },
  books: { adviceFor: async () => ({ may: { send_advice: { ok: false, why: 'already_sent', say: 'An advice is already sent.' }, share_advice: { ok: true } }, advice: { chit_id: '99999999-9999-4999-8999-999999999999' } }) }
});
/** a registered Indian shop: the identities row the tax routes read (its GSTIN makes a GSTR possible), and a held copy of one chit with its invoice block */
const IN_SHOP = { sqlRows: (sql) => (/FROM identities/.test(sql) ? { rows: [{ identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Ponni Stores', country: 'IN', policy_flags: {}, timezone: 'Asia/Kolkata' }], rowCount: 1 } : null) };
/** the same shop with no GSTIN (unregistered), and one in Australia: the seller facts a handler answers as null */
const shopWith = (extra) => ({ sqlRows: (sql) => (/FROM identities/.test(sql) ? { rows: [Object.assign({ identity_id: SHOP, gstn: null, display_name: null, country: 'IN', policy_flags: {}, timezone: 'Asia/Kolkata' }, extra)], rowCount: 1 } : null) });
const NO_GSTIN_SHOP = shopWith({});
const AU_SHOP = shopWith({ country: 'AU', timezone: 'Australia/Sydney' });
const COPY_ENTRY = { chit_id: PARTY, direction: 'sent', sells: true, status: 'accepted', provisional: false, frozen: true, rated: 1, unrated: 0, seller: { LglNm: 'Ponni Stores' }, buyer: { LglNm: 'Ravi' }, invoice: { Version: '1.1', ValDtls: { AssVal: 100 }, ItemList: [] } };
const COPY_PATCH = { cost: { isCostBlind: async () => false }, taxcopy: { copyOf: async () => ({ chit_id: PARTY }), invoiceOf: async () => require(path.join(HERE, 'lib', 'tax-copy')).invoiceFrom(COPY_ENTRY) } };
const BAD_MONEY = { party_id: PARTY, amount_minor: 100, currency: 'USD', mode: 'cash' };
/** the cash position of a shop with one drawer and nothing owed, made by the cash engine's own project() (the stand-in db cannot seat the ledgers read() needs) */
const CASH_PATCH = {
  cashflow: {
    read: async (h, entity, s, q) => {
      const cashflow = require(path.join(HERE, 'lib', 'books-cashflow'));
      const opening = [{ role: 'cash', code: '1000', name: 'Cash', balance_minor: 50000 }];
      return cashflow.project({ asOf: q.asOf, days: q.days, currency: 'INR', opening, receivable_items: [], payable_items: [], cheques: [], promises: [], gst: { payable_minor: 0, form: 'GSTR-3B', short: 'GST', due_date: null, why: null }, names: new Map(), recurring: [] });
    }
  }
};
/* the READY side of the reads whose not-ready answer the stand-in db gives: the schema is learned from both branches of the handler (API-8 review) */
const RAIL_STOP = (pack) => async () => { throw Object.assign(new Error('Read from the rail.'), { code: 'RETURN_FROM_RAIL', pack }); };
const RETURN_BASE = { currency: 'AUD', pack: 'AU', form: 'BAS', name: 'Business Activity Statement', short: 'BAS', authority: 'ATO', portal: 'https://example.invalid', prepared: 'prepared from the ledgers' };
const RETURN_READY = { patch: { period: { taxReturn: async () => Object.assign({}, RETURN_BASE, { asked: { simpler: true }, periods: [], period: { period: 'Q2' }, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null }) } } };
const RETURN_NEEDS = { patch: { period: { taxReturn: async () => Object.assign({}, RETURN_BASE, { asked: {}, needs: 'period', why: 'Which period?', periods: [], period: null, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null, emirates: [], staggers: {} }) } } };
const REVALUE_READY = { ready: true, date: '2026-09-30', reverses_on: '2026-10-01', functional: 'INR', rows: [], missing: [], gain_minor: 0, posted: null, event: { kind: 'fx_revalue' } };
/* ── API-8 (output allow-list), the writes and the id reads: each stand-in answer mirrors the library's own return literal key for key (the lib/books.js line is named), so the
   closed root is learned from the answer the real writer gives; the figures are placeholders, no posting runs ── */
const ENTRY = '33333333-3333-4333-8333-333333333333';
const ENTRY2 = '55555555-5555-4555-8555-555555555555';
const CHIT = '99999999-9999-4999-8999-999999999999';
const DAY = '2026-09-30';
const PAY_ROW = { payment_id: PARTY, party_id: PARTY, direction: 'in', amount_minor: 1000, currency: 'INR', mode: 'cheque', reference: null, cheque_no: '1', cheque_bank: 'B', cheque_date: DAY, received_at: DAY, status: 'received', advice_chit_id: null, advice_shared_at: null };
const JOURNAL = { ok: true, entry_id: ENTRY, entry_no: 'MJ/2026-27/1', posting_date: DAY, doc_date: DAY, moved: null, lines: 2, items: 0, note: null }; /* writeJournal :452 */
const JOURNAL_MOVED = Object.assign({}, JOURNAL, { doc_date: '2026-09-28', moved: { from: '2026-09-28', to: DAY }, items: 1, note: 'Posted on the first open day.' });
const DUPLICATE = { ok: true, duplicate: true, entry_id: ENTRY, entry_no: 'MJ/2026-27/1', posting_date: DAY }; /* postEntry :239, the replay of a client_ref */
const OFF = { ok: false, off: true }; /* postEntry :233 */
const REVERSAL = { ok: true, entry_id: ENTRY2, entry_no: 'MJ/2026-27/2', posting_date: DAY, moved: null, reverses: 'MJ/2026-27/1', reverses_entry_id: ENTRY, items: 0, reopened: [], words: 'Reversed MJ/2026-27/1.' }; /* writeReversal :1434 */
const REVERSAL_REOPENS = Object.assign({}, REVERSAL, { items: 1, reopened: [{ against_ref: 'bill:1', bill_no: 'B/1' }] });
const ALLOCATION = { ok: true, items: 2, allocated_minor: 1000 }; /* writeAllocation :1174 */
const CHEQUE = (to, extra) => Object.assign({ ok: true, status: to, items: 1 }, extra); /* writeChequeStep :1229 */
const PROPOSAL = { currency: 'INR', account_id: PARTY, items: [], outstanding: { by_ref: {} }, open_minor: 0, proposal: [], apply_minor: 0, on_account_minor: 1000, skipped: [], why: null }; /* proposeFor :706 */
const PROPOSAL_SETTLES = Object.assign({}, PROPOSAL, { items: [{ ref: 'bill:1' }], open_minor: 1500, proposal: [{ against_ref: 'bill:1', bill_no: 'B/1', due_date: DAY, open_minor: 1500, apply_minor: 1000, disputed: false }], apply_minor: 1000, on_account_minor: 0, skipped: [{ against_ref: 'bill:2', why: 'disputed' }] });
/** adviceFor :1110 — may send (on the rail, nothing sent) or may share (off the rail, or already sent) */
const ADVICE = (sendOk) => ({
  payment_id: PARTY,
  party: { party_id: PARTY, name: 'Asha', on_rail: sendOk },
  advice: { chit_id: sendOk ? null : CHIT, state: sendOk ? 'none' : 'sent', shared_at: sendOk ? null : '2026-09-30T10:00:00.000Z' },
  may: sendOk ? { send_advice: { ok: true }, share_advice: { ok: false, why: 'on_rail', say: 'They are on ChitBridge.' } } : { send_advice: { ok: false, why: 'already_sent', say: 'An advice is already sent.' }, share_advice: { ok: true } },
  words: 'Paid Rs 10.00 by cheque.',
  body: sendOk ? { kind: 'payment_advice', to: PARTY } : null,
  share: sendOk ? null : { text: 'Paid Rs 10.00', wa: 'https://wa.me/?text=x', mailto: 'mailto:?body=x' }
});
const RECORDED = { payment: { payment_id: PARTY, status: 'recorded', duplicate: false }, posted: JOURNAL, allocation: null }; /* recordPayment :1332 */
const RECORDED_SETTLES = Object.assign({}, RECORDED, { allocation: { settled: [{ against_ref: 'bill:1', bill_no: 'B/1', amount_minor: 1000 }], items: 2, allocated_minor: 1000 } });
const REPLAY = { payment: { payment_id: PARTY, status: 'cheque_received', duplicate: true }, posted: { ok: true, duplicate: true } }; /* firstPayment :1259 */
const OUTCOME = { words: 'Paid.', settled: [], applied_minor: 0, on_account_minor: 1000, balance_minor: -1000, balance_words: 'They hold an advance.' }; /* paymentOutcome :1158 */
const ENABLED = { ok: true, accounts_added: 40, fiscal_year: '2026-27', parties_numbered: 0 }; /* enable :1546 */
const RETRIED = { tried: 2, posted: 1, still: 1 }; /* books-hooks retryOutbox :1632 */
const CHART = [
  { account_id: PARTY, code: '1300', name: 'Debtors', nature: 'asset', role: 'debtors', is_group: false, parent_id: null, tally_group: 'Sundry Debtors', active: true },
  { account_id: ENTRY, code: '4000', name: 'Income', nature: 'income', role: null, is_group: true, parent_id: null, tally_group: 'Sales', active: true }
];
const LEDGER_LINE = { posting_date: DAY, doc_date: DAY, narration: 'Sale', event_type: 'sale_bill', entry_no: 'S/1', entry_id: ENTRY, reverses_entry_id: null, reversed_by: null, source_chit_id: CHIT, party_id: PARTY, dr_minor: '1000', cr_minor: '0', period: 6, covers: 0, source_ref: null, src_chit_id: CHIT, src_ref: 'B/1', src_by: null, src_by_name: 'Asha', src_till: null, counter_id: null };
const LEDGER_LINE_BARE = Object.assign({}, LEDGER_LINE, { doc_date: null, narration: null, event_type: 'manual', entry_no: 'MJ/1', entry_id: ENTRY2, source_chit_id: null, party_id: null, dr_minor: '0', cr_minor: '1000', src_chit_id: null, src_ref: null, src_by_name: null });
const LEDGER_PATCH = { store: { accounts: async () => CHART, entryLines: async () => [LEDGER_LINE, LEDGER_LINE_BARE] }, books: { ledgerOf: async () => ({ opening_minor: 0, period0: false }) } };
const LEDGER_PAGE_PATCH = { store: Object.assign({}, LEDGER_PATCH.store, { entryPage: async () => ({ rows: [LEDGER_LINE], limit: 10, next: null }), pageSums: async () => ({ before_dr: 0, before_cr: 0, dr: 1000, cr: 0, entries: 1 }) }), books: LEDGER_PATCH.books };
const packIN = () => require(path.join(HERE, 'lib', 'books-engines')).packs().packFor('IN');
const ASSET_DISPOSED = { entity: SHOP, asset_id: PARTY, name: 'Press', asset_class: 'plant', cost_minor: 100000, currency: 'INR', put_to_use: '2025-04-01', source_entry_id: ENTRY, source_chit_id: null, accumulated_minor: 20000, last_dep_fy: '2025-26', disposed_on: DAY, disposal_entry_id: ENTRY, proceeds_minor: 0, created_by: SHOP, wdv_minor: 0 };
const COMPARE_READY = { store: { compareReady: async () => true } };
const COMPARE_PATCH = { store: { compareReady: async () => true, compareParts: async () => [{ snapshot_id: PARTY, part: 'tb', label: 'Tally Q2', source: 'tally', period_from: '2026-07-01', period_to: '2026-09-30', rows: [] }] } };
const STATEMENT_PATCH = { books: { ledgerCtx: async () => ({ s: SETTING_ROW, chart: CHART, pack: packIN(), years: [], cache: {} }), yearBalances: async () => ({}) }, store: { ledgerLines: async () => [], entryLines: async () => [] } };
const MANUAL_PREVIEW = { ok: true, kind: 'expense', voucher: { series: 'MJ', type: 'Journal' }, date: DAY, lines: [{ code: '5000', ledger: 'Rent', dr_minor: 1000, cr_minor: 0, type: 'expense', rule: 'expense' }], balanced: true, totals: { dr_minor: 1000, cr_minor: 1000 }, credit: null, bill: null, flags: [], refusals: [], code: null, duplicate: null }; /* books-manual preview :483 */
const SHOP_TERMS = { credit_days: 30, credit_limit_minor: null, interest: null, early: null };
const PAID = { party_id: PARTY, amount_minor: 1000, mode: 'cash' };
const PAYMENT_PATCH = (recorded) => ({ books: { recordPayment: async () => recorded, paymentOutcome: async () => OUTCOME, adviceFor: async () => ADVICE(true) }, store: { adviceReady: async () => true, payment: async () => PAY_ROW } });
const ADVICE_PATCH_READY = (sendOk, set) => ({ store: { payment: async () => PAY_ROW, adviceReady: async () => true, setAdvice: async () => set, adviceStates: async () => ({ [CHIT]: 'sent' }) }, books: { adviceFor: async () => ADVICE(sendOk) } });
const WRITES_READY = [
  /* ACC-206 B: closing an overridden sale's open item (routes/books-money.js) — one insert in the change log */
  X('money-resolved', 'POST /api/books/money-check/resolve', 200, { body: { chit_id: CHIT, how: 'confirmed', note: 'Customer checked the bill' }, patch: { store: { moneyOverrideState: async () => ({ held: true, resolved: false }), logChange: async () => undefined } } }),
  X('money-resolve-already', 'POST /api/books/money-check/resolve', 200, { body: { chit_id: CHIT, how: 'confirmed', note: 'again' }, patch: { store: { moneyOverrideState: async () => ({ held: true, resolved: true }) } } }),
  X('money-resolve-unknown', 'POST /api/books/money-check/resolve', 404, { body: { chit_id: CHIT, how: 'confirmed', note: 'x' }, patch: { store: { moneyOverrideState: async () => ({ held: false, resolved: false }) } } }),
  X('money-resolve-no-reason', 'POST /api/books/money-check/resolve', 400, { body: { chit_id: CHIT, how: 'confirmed' } }),
  X('setting-grain-shift', 'POST /api/books/setting', 200, { body: { walkin_grain: 'shift' } }),
  X('setting-switched-off', 'POST /api/books/setting', 200, { body: { enabled: false } }),
  X('terms-shop-saved', 'POST /api/books/terms', 200, { body: { credit_days: 30 }, patch: { terms: { migrated: async () => true, saveShop: async () => SHOP_TERMS } } }),
  X('terms-party-saved', 'POST /api/books/terms', 200, { body: { party_id: PARTY, credit_days: 15 }, patch: { terms: { migrated: async () => true, saveParty: async () => ({ credit_days: { value: 15, from: 'party' } }) } } }),
  X('account-added', 'POST /api/books/accounts', 200, { body: { name: 'Fees', parent_code: '4000' }, patch: { store: { accounts: async () => CHART }, books: { addAccount: async () => ({ code: '4010', account_id: ENTRY2, name: 'Fees' }) } } }),
  X('account-added-source-code', 'POST /api/books/accounts', 200, { body: { name: 'Fees', parent_id: ENTRY, source_code: '200' }, patch: { books: { addAccount: async () => ({ code: '4010', account_id: ENTRY2, name: 'Fees', source_code: '200', source_code_written: true }) } } }),
  X('account-added-source-code-unwritten', 'POST /api/books/accounts', 200, { body: { name: 'Fees', parent_id: ENTRY, source_code: '200' }, patch: { books: { addAccount: async () => ({ code: '4010', account_id: ENTRY2, name: 'Fees', source_code: null, source_code_written: false }) } } }), /* addAccount :1678: before b302 the code is not written, null */
  X('enable-switched-on', 'POST /api/books/enable', 200, { body: { walkin_grain: 'day' }, patch: { books: { enable: async () => ENABLED } } }),
/* ACC-274: a GIVEN date that is not a real day is a 400 DATE_INVALID naming the field, on a write and on a read (it was today, with a 200) */
  X('date-given-slashes-write', 'POST /api/books/entries', 400, { body: { narration: 'x', date: '03/10/2026', lines: [] } }),  X('date-given-not-a-day-write', 'POST /api/books/entries', 400, { body: { narration: 'x', date: '2026-02-30', lines: [] } }),  X('date-given-slashes-read', 'GET /api/books/trial-balance', 400, { url: MOUNT + '/trial-balance?asOf=03%2F10%2F2026' }),
  X('date-given-pl-both-bad', 'GET /api/books/pl', 400, { url: MOUNT + '/pl?from=03%2F10%2F2026&to=03%2F10%2F2026' }),
  X('date-given-bs-read', 'GET /api/books/bs', 400, { url: MOUNT + '/bs?asOf=tomorrow' }),
  X('date-given-dues-read', 'GET /api/books/dues', 400, { url: MOUNT + '/dues?asOf=2026-02-30' }),
  X('date-given-ledger-read', 'GET /api/books/ledger/:account', 400, { url: MOUNT + '/ledger/1300?from=31-12-2026', patch: LEDGER_PATCH }),
  X('outbox-retried', 'POST /api/books/outbox/retry', 200, { patch: { hooks: { retryOutbox: async () => RETRIED } } }),
  X('payment-preview-advance', 'POST /api/books/payments/preview', 200, { body: { party_id: PARTY, amount_minor: 1000 }, patch: { books: { proposeFor: async () => PROPOSAL, duplicateWarnings: async () => [] } } }),
  X('payment-preview-settles', 'POST /api/books/payments/preview', 200, { body: { party_id: PARTY, amount_minor: 1000, allocate: 'oldest_first' }, patch: { books: { proposeFor: async () => PROPOSAL_SETTLES, duplicateWarnings: async () => [{ code: 'W1', words: 'The same money within 24 hours.', entry_no: 'R/1' }] } } }),
  X('payment-recorded', 'POST /api/books/payments', 200, { body: PAID, patch: PAYMENT_PATCH(RECORDED) }),
  X('payment-recorded-settles', 'POST /api/books/payments', 200, { body: Object.assign({ allocate: 'oldest_first' }, PAID), patch: PAYMENT_PATCH(RECORDED_SETTLES) }),
  X('payment-replayed', 'POST /api/books/payments', 200, { body: Object.assign({ client_ref: 'c1' }, PAID), patch: PAYMENT_PATCH(REPLAY) }),
  X('advice-read', 'GET /api/books/payments/:id/advice', 200, { patch: ADVICE_PATCH_READY(true, null) }),
  X('advice-read-sent', 'GET /api/books/payments/:id/advice', 200, { patch: ADVICE_PATCH_READY(false, null) }),
  X('advice-recorded', 'PATCH /api/books/payments/:id', 200, { body: { advice_chit_id: CHIT }, patch: ADVICE_PATCH_READY(true, { advice_chit_id: CHIT, advice_shared_at: null }) }),
  X('advice-shared', 'PATCH /api/books/payments/:id', 200, { body: { advice_shared_at: true }, patch: ADVICE_PATCH_READY(false, { advice_chit_id: null, advice_shared_at: '2026-09-30T10:00:00.000Z' }) }),
  X('propose-advance', 'POST /api/books/payments/:id/propose', 200, { patch: { store: { payment: async () => PAY_ROW }, books: { proposeFor: async () => PROPOSAL } } }),
  X('propose-settles', 'POST /api/books/payments/:id/propose', 200, { patch: { store: { payment: async () => PAY_ROW }, books: { proposeFor: async () => PROPOSAL_SETTLES } } }),
  X('confirm-allocated', 'POST /api/books/payments/:id/confirm', 200, { body: { allocations: [{ against_ref: 'bill:1', amount_minor: 1000 }] }, patch: { store: { payment: async () => PAY_ROW }, books: { postEntry: async () => ALLOCATION } } }),
  X('confirm-ledger-off', 'POST /api/books/payments/:id/confirm', 200, { body: { allocations: [] }, patch: { store: { payment: async () => PAY_ROW }, books: { postEntry: async () => OFF } } }),
  X('cheque-deposited', 'POST /api/books/cheques/:id/status', 200, { body: { status: 'deposited' }, patch: { books: { postEntry: async () => CHEQUE('deposited') } } }),
  X('cheque-cleared', 'POST /api/books/cheques/:id/status', 200, { body: { status: 'cleared', date: DAY }, patch: { books: { postEntry: async () => CHEQUE('cleared', { posted: JOURNAL }) } } }),
  X('cheque-bounced', 'POST /api/books/cheques/:id/status', 200, { body: { status: 'bounced' }, patch: { books: { postEntry: async () => CHEQUE('bounced', { reversed: REVERSAL }) } } }),
  X('dispute-held', 'POST /api/books/parties/:id/dispute', 200, { body: { against_ref: 'bill:1', note: 'short' }, patch: { books: { postEntry: async () => ({ ok: true, status: 'disputed' }) } } }),
  X('dispute-released', 'POST /api/books/parties/:id/dispute', 200, { body: { against_ref: 'bill:1', disputed: false, side: 'supplier' }, patch: { books: { postEntry: async () => ({ ok: true, status: 'undisputed' }) } } }),
  X('dispute-ledger-off', 'POST /api/books/parties/:id/dispute', 200, { body: { against_ref: 'bill:1' }, patch: { books: { postEntry: async () => OFF } } }),
  X('preview-expense', 'POST /api/books/preview', 200, { body: { event: { kind: 'expense', amount: 10 } }, patch: { manual: { preview: async () => MANUAL_PREVIEW } } }),
  X('event-posted', 'POST /api/books/events', 200, { body: { event: 'expense', amount: 10 }, patch: { manual: { post: async () => Object.assign({ kind: 'expense' }, JOURNAL) } } }),
  X('event-replayed', 'POST /api/books/events', 200, { body: { event: 'expense', amount: 10, client_ref: 'c1' }, patch: { manual: { post: async () => Object.assign({ kind: 'expense' }, DUPLICATE) } } }),
  X('event-posted-undated', 'POST /api/books/events', 200, { body: { event: 'expense', amount: 10 }, patch: { manual: { post: async () => Object.assign({ kind: 'expense' }, JOURNAL, { doc_date: null }) } } }), /* composeEntry :362 ymd(ev.date) is null for an undated event */
  X('entry-posted', 'POST /api/books/entries', 200, { body: { narration: 'Rent', lines: [] }, patch: { books: { postEntry: async () => JOURNAL } } }),
  X('entry-posted-moved', 'POST /api/books/entries', 200, { body: { narration: 'Rent', date: '2026-09-28', lines: [] }, patch: { books: { postEntry: async () => JOURNAL_MOVED } } }),
  X('entry-replayed', 'POST /api/books/entries', 200, { body: { narration: 'Rent', lines: [], client_ref: 'c1' }, patch: { books: { postEntry: async () => DUPLICATE } } }),
  X('entry-ledger-off', 'POST /api/books/entries', 200, { body: { narration: 'Rent', lines: [] }, patch: { books: { postEntry: async () => OFF } } }),
  /* CUR-1 · ACC-332: a journal line that names another currency than the shop's is refused 409 CURRENCY_MISMATCH, nothing posted */
  X('entry-line-other-currency', 'POST /api/books/entries', 409, { body: { narration: 'Rent', lines: [{ account: '5100', dr_minor: 10000, currency: 'USD' }, { account: '1000', cr_minor: 10000 }] } }),
  X('entry-reversed', 'POST /api/books/entries/:id/reverse', 200, { body: { reason: 'wrong party' }, patch: { books: { reverseEntry: async () => REVERSAL } } }),
  X('entry-reversed-reopens', 'POST /api/books/entries/:id/reverse', 200, { body: { reason: 'wrong party' }, patch: { books: { reverseEntry: async () => REVERSAL_REOPENS } } }),
  X('write-off-posted', 'POST /api/books/write-off', 200, { body: { party_id: PARTY, amount_minor: 500, reason: 'bad debt' }, patch: { books: { postEntry: async () => JOURNAL } } }),
  X('write-off-replayed', 'POST /api/books/write-off', 200, { body: { party_id: PARTY, amount_minor: 500, reason: 'bad debt', client_ref: 'c1' }, patch: { books: { postEntry: async () => DUPLICATE } } }),
  X('opening-posted', 'POST /api/books/opening', 200, { body: { rows: [{ code: '1300', dr_minor: 1000, cr_minor: 0 }] }, patch: { books: { postOpening: async () => Object.assign({}, JOURNAL, { suspense_minor: -1000 }) } } }),
  X('opening-replayed', 'POST /api/books/opening', 200, { body: { rows: [{ code: '1300', dr_minor: 1000, cr_minor: 0 }], client_ref: 'c1' }, patch: { books: { postOpening: async () => Object.assign({}, DUPLICATE, { suspense_minor: 0 }) } } }),
  X('ledger-read', 'GET /api/books/ledger/:account', 200, { patch: LEDGER_PATCH }),
  X('ledger-read-party', 'GET /api/books/ledger/:account', 200, { url: MOUNT + '/ledger/debtors?party=' + PARTY, patch: LEDGER_PATCH }),
  X('ledger-page', 'GET /api/books/ledger/:account', 200, { url: MOUNT + '/ledger/1300?limit=10', patch: LEDGER_PAGE_PATCH }),
  X('statement-read', 'GET /api/books/party/:id/statement', 200, { patch: { books: STATEMENT_PATCH.books, store: Object.assign({}, STATEMENT_PATCH.store, { partyOn: async () => ({ customer: true, supplier: false, ledgered: false }) }) } }),
  X('statement-ledgered-only', 'GET /api/books/party/:id/statement', 200, { patch: { books: STATEMENT_PATCH.books, store: Object.assign({}, STATEMENT_PATCH.store, { partyOn: async () => ({ customer: false, supplier: false, ledgered: true }) }) } }),
  X('statement-stranger', 'GET /api/books/party/:id/statement', 404, {}),
  /* S35 (Wave M · M3): the own id of a route whose other worlds (unknown, foreign) run the real code over the stand-in db; inWorlds is what those worlds keep too */
  X('compare-read', 'GET /api/books/compare/:id', 200, { patch: COMPARE_PATCH, inWorlds: COMPARE_READY }),
  X('compare-read-csv', 'GET /api/books/compare/:id/csv', 200, { patch: COMPARE_PATCH, inWorlds: COMPARE_READY }),
  X('pack-file-served', 'GET /api/books/packs/:id/file', 200, { patch: { pack: { download: async () => ({ found: true, stored: true, pack: PACK_FULL, bytes: Buffer.from('zip') }) } } }),
  X('asset-disposed', 'POST /api/books/assets/:id/dispose', 200, { body: { date: DAY }, patch: { period: { disposeAsset: async () => Object.assign({ asset: ASSET_DISPOSED }, JOURNAL, { moved: false }) } } })
];
/* ── API-8 (2 of 2): months and the year, audit packs, recurring entries, exchange rates, the parallel run and the move-in preflight ── */
const STAMP = '2026-09-30T10:00:00.000Z';
const PACK_FULL = { pack_id: PARTY, kind: 'month', fiscal_year: '2026-27', period: 6, created_at: STAMP, sha256: 'abc', prev_sha256: 'aaa', manifest: { files: [{ file: 'tb.csv', sha256: 'x', bytes: 12, rows: 3 }], controls: { ok: true } }, storage_path: 'packs/x.zip', acknowledged_at: '2026-10-01T10:00:00.000Z', delete_after: '2035-04-01' };
const PACK_BARE = Object.assign({}, PACK_FULL, { kind: 'exit', fiscal_year: null, period: null, prev_sha256: null, manifest: { files: [] }, storage_path: null, acknowledged_at: null, delete_after: null }); /* books_pack: fiscal_year, period, prev_sha256, storage_path, acknowledged_at, delete_after nullable */
const PACK_BUILT = (stored) => ({ pack_id: PARTY, sha256: 'abc', stored, manifest: PACK_FULL.manifest, bytes: 1200, zip: stored ? null : Buffer.from('zip') }); /* books-pack build :268 */
const RECURRING = { recurring_id: PARTY, name: 'Rent', event: { kind: 'expense', amount: 10 }, frequency: 'monthly', next_on: '2026-11-01', anchor_day: 1, end_on: null, auto: false, active: true, last_done_on: null, created_by: null, created_at: STAMP, updated_at: STAMP }; /* recurring_entry COLS: end_on, last_done_on, created_by nullable */
const RECURRING_FULL = Object.assign({ entity: SHOP }, RECURRING, { end_on: '2027-03-31', auto: true, last_done_on: '2026-10-01', created_by: SHOP }); /* entity first, as the web contract's row carries it (tests/support/books-memory rows); the bare row leaves it out */
const viewOf = (t) => Object.assign({}, t, { due: !!(t.active && t.next_on) }); /* books-recurring view :223 */
const FX_ROW = { rate_id: PARTY, rate_date: DAY, currency: 'USD', rate: '83.5', source: 'manual', source_ref: null, created_at: STAMP };
const CSV_TB = 'Particulars,Debit,Credit\nCash,100,0\nSales,0,100';
const TB_DECISIONS = [{ incoming: 'Particulars', field: 'account' }, { incoming: 'Debit', field: 'debit' }, { incoming: 'Credit', field: 'credit' }];
const MONTHS_PACKS_RATES = [
  X('period-locked', 'POST /api/books/periods/:fy/:p/:act', 200, { url: MOUNT + '/periods/2026-27/6/lock', body: { reason: 'month done' }, patch: { books: { setPeriod: async () => ({ ok: true, fiscal_year: '2026-27', period: 6, status: 'soft_locked' }) } } }),
  X('period-unlocked', 'POST /api/books/periods/:fy/:p/:act', 200, { url: MOUNT + '/periods/2026-27/6/unlock', body: { reason: 'a late bill' }, patch: { books: { setPeriod: async () => ({ ok: true, fiscal_year: '2026-27', period: 6, status: 'open' }) } } }),
  X('year-closed', 'POST /api/books/year/:fy/close', 200, { body: {}, patch: { books: { closeYear: async () => ({ ok: true, fiscal_year: '2026-27', next: '2027-28', locked: 12, opening: { rows: 3, retained_minor: 100, profit_minor: 100, balanced: true } }) } } }),
  X('year-closed-already', 'POST /api/books/year/:fy/close', 200, { body: {}, patch: { books: { closeYear: async () => ({ ok: true, duplicate: true, fiscal_year: '2026-27', next: '2027-28' }) } } }),
  X('pack-built', 'POST /api/books/packs', 200, { body: { kind: 'month', fiscal_year: '2026-27', period: 6 }, patch: { pack: { build: async () => PACK_BUILT(true) } } }),
  X('pack-built-unstored', 'POST /api/books/packs', 200, { body: { kind: 'year', fiscal_year: '2026-27' }, patch: { pack: { build: async () => PACK_BUILT(false) } } }),
  X('pack-read', 'GET /api/books/packs/:id', 200, { patch: { store: { pack: async () => PACK_FULL } } }),
  X('pack-read-bare', 'GET /api/books/packs/:id', 200, { patch: { store: { pack: async () => PACK_BARE } } }),
  X('pack-acknowledged', 'POST /api/books/packs/:id/ack', 200, { patch: { store: { pack: async () => PACK_FULL, ackPack: async () => ({ acknowledged_at: STAMP }) } } }),
  X('recurring-created', 'POST /api/books/recurring', 200, { body: { name: 'Rent', event: { kind: 'expense' }, frequency: 'monthly', next_on: '2026-11-01' }, patch: { recurring: { create: async () => viewOf(RECURRING) } } }),
  X('recurring-created-full', 'POST /api/books/recurring', 200, { body: { name: 'Rent', event: { kind: 'expense' }, frequency: 'monthly', next_on: '2026-11-01', end_on: '2027-03-31', auto: true }, patch: { recurring: { create: async () => viewOf(RECURRING_FULL) } } }),
  X('recurring-patched', 'PATCH /api/books/recurring/:id', 200, { body: { auto: true }, patch: { recurring: { patch: async () => viewOf(RECURRING_FULL) } } }),
  X('recurring-patched-bare', 'PATCH /api/books/recurring/:id', 200, { body: { name: 'Shop rent' }, patch: { recurring: { patch: async () => viewOf(RECURRING) } } }),
  X('recurring-stopped', 'DELETE /api/books/recurring/:id', 200, { patch: { recurring: { stop: async () => Object.assign(viewOf(Object.assign({}, RECURRING, { active: false })), { stopped: true }) } } }),
  X('recurring-stopped-full', 'DELETE /api/books/recurring/:id', 200, { patch: { recurring: { stop: async () => Object.assign(viewOf(Object.assign({}, RECURRING_FULL, { active: false })), { stopped: true }) } } }),
  X('recurring-accepted', 'POST /api/books/recurring/:id/post', 200, { body: {}, patch: { recurring: { accept: async () => ({ posted: JOURNAL, template: viewOf(RECURRING_FULL), date: '2026-11-01' }) } } }),
  X('recurring-skipped', 'POST /api/books/recurring/:id/skip', 200, { body: {}, patch: { recurring: { skip: async () => ({ skipped: '2026-11-01', template: viewOf(RECURRING) }) } } }),
  X('fx-rate-added', 'POST /api/books/fx-rates', 201, { body: { date: DAY, currency: 'USD', rate: 83.5 }, patch: { fxr: { add: async () => FX_ROW } } }),
  X('fx-rates-imported', 'POST /api/books/fx-rates/import', 200, { body: { csv: 'date,currency,rate\n2026-09-30,USD,83.5\n2026-09-30,EUR,' }, patch: { fxr: { importCsv: async () => ({ added: 1, refused: [{ line: 3, why: 'No rate.' }], rates: [FX_ROW] }) } } }),
  X('fx-revalued', 'POST /api/books/fx-revalue', 200, { body: { fiscal_year: '2026-27', period: 6 }, patch: { fxr: { revalue: async () => ({ ok: true, entry_no: 'MJ/2026-27/3', reversal_no: 'MJ/2026-27/4', gain_minor: 500, date: DAY, reverses_on: '2026-10-01' }) } } }),
  X('fx-revalue-replayed', 'POST /api/books/fx-revalue', 200, { body: { fiscal_year: '2026-27', period: 6 }, patch: { fxr: { revalue: async () => ({ ok: true, duplicate: true, entry_no: 'MJ/2026-27/3', gain_minor: 500 }) } } }),
  X('compare-preflight-csv', 'POST /api/books/compare/preflight', 200, { body: { part: 'tb', source: 'tally', csv: CSV_TB } }),
  X('compare-snapshot-stored', 'POST /api/books/compare/snapshots', 200, { body: { label: 'Tally Q2', source: 'tally', part: 'tb', period_to: '2026-09-30', csv: CSV_TB, decisions: TB_DECISIONS }, patch: { store: { compareReady: async () => true, insertComparePart: async () => PARTY } } }),
  X('compare-snapshot-second-part', 'POST /api/books/compare/snapshots', 200, { body: { snapshot_id: PARTY, part: 'pl', source: 'tally', csv: 'Particulars,Amount\nSales,100', decisions: [{ incoming: 'Particulars', field: 'account' }, { incoming: 'Amount', field: 'amount' }] }, patch: { store: { compareReady: async () => true, compareParts: async () => [{ part: 'tb', label: 'Tally Q2', source: 'tally', period_from: '2026-07-01', period_to: '2026-09-30' }], insertComparePart: async () => PARTY } } }),
  X('move-in-preflight-csv', 'POST /api/books/move-in/preflight', 200, { body: { kind: 'contacts', source: 'xero', csv: 'ContactName,PhoneNumber,EmailAddress\nAsha Traders,9999,a@x.in' } })
];
const EXTRAS = WRITES_READY.concat(MONTHS_PACKS_RATES, [
  X('returns-ready', 'GET /api/books/returns', 200, RETURN_READY),
  X('returns-needs-period', 'GET /api/books/returns', 200, RETURN_NEEDS),
  X('returns-from-rail-other-pack', 'GET /api/books/returns', 200, { patch: { period: { taxReturn: RAIL_STOP('AU') } } }),
  X('returns-from-rail-no-pack', 'GET /api/books/returns', 200, { patch: { period: { taxReturn: RAIL_STOP(undefined) } } }),
  X('move-in-ready', 'GET /api/books/move-in/imports', 200, { patch: { movein: { list: async () => ({ ready: true, why: null, imports: [] }) } } }),
  X('compare-ready', 'GET /api/books/compare', 200, { patch: { store: { compareReady: async () => true, compareSnapshots: async () => [] } } }),
  X('fx-rates-ready', 'GET /api/books/fx-rates', 200, { patch: { fxr: { ready: async () => true, list: async () => [] } } }),
  X('fx-revalue-ready', 'GET /api/books/fx-revalue', 200, { url: MOUNT + '/fx-revalue?fiscal_year=2026-27&period=6', patch: { fxr: { revaluation: async () => REVALUE_READY } } }),
  X('status-before-migration', 'GET /api/books/status', 200, { patch: { books: { settingOf: async () => null } } }),
  X('cashflow-owner-reads', 'GET /api/books/cashflow', 200, { patch: CASH_PATCH }),
  X('fx-revalue-reads', 'GET /api/books/fx-revalue', 200, { url: MOUNT + '/fx-revalue?fiscal_year=2026-27&period=6' }),
  X('currency-not-the-ledgers', 'POST /api/books/payments/preview', 422, { body: BAD_MONEY }),
  X('currency-not-the-ledgers', 'POST /api/books/payments', 422, { body: BAD_MONEY }),
  /* FIN-63: the four money doors refuse a call with no Idempotency-Key in words, before the ledger's own gates (the same 422 on every path) */
  X('key-required', 'POST /api/books/payments', 422, { body: PAID, noKey: true }),
  X('key-required', 'PATCH /api/books/payments/:id', 422, { body: { advice_shared_at: true }, noKey: true }),
  X('key-required', 'POST /api/books/payments/:id/confirm', 422, { body: { allocations: [] }, noKey: true }),
  X('key-required', 'POST /api/books/gst/pay', 422, { body: { fy: '2026-27', period: 6, amounts: { cgst_minor: 1 }, bank: 'bank', challan_no: 'CPIN1' }, noKey: true }),
  X('window-too-long', 'GET /api/books/bank/rail', 400, { url: MOUNT + '/bank/rail?from=2020-01-01&to=2026-01-01' }),
  X('nothing-to-change', 'PATCH /api/books/payments/:id', 400, { body: {} }),
  X('which-advice-chit', 'PATCH /api/books/payments/:id', 400, { body: { advice_chit_id: 'not-an-id' } }),
  X('when-was-it-shared', 'PATCH /api/books/payments/:id', 400, { body: { advice_shared_at: 'not-a-time' } }),
  X('cheque-step-unnamed', 'POST /api/books/cheques/:id/status', 400, { body: {} }),
  X('dispute-bill-unnamed', 'POST /api/books/parties/:id/dispute', 400, { body: {} }),
  X('write-off-customer-unnamed', 'POST /api/books/write-off', 400, { body: {} }),
  X('opening-no-rows', 'POST /api/books/opening', 400, { body: {} }),
  X('import-not-confirmed', 'POST /api/books/move-in/import', 400, { body: {} }),
  X('dues-staff-collections', 'GET /api/books/dues', 403, { setup: { who: STAFF }, url: MOUNT + '/dues?finance=1' }),
  X('dues-staff-payables', 'GET /api/books/dues', 403, { setup: { who: STAFF }, url: MOUNT + '/dues?finance=1&side=supplier' }),
  X('cashflow-staff-asks', 'GET /api/books/cashflow', 403, { setup: { who: STAFF } }),
  X('terms-not-migrated', 'POST /api/books/terms', 503, { body: {} }),
  X('period-unknown-action', 'POST /api/books/periods/:fy/:p/:act', 404, { url: MOUNT + '/periods/2026-27/6/shred', body: {} }),
  X('which-month', 'POST /api/books/fx-revalue', 400, { body: {} }),
  X('which-month-read', 'GET /api/books/fx-revalue', 400, {}),
  X('year-not-a-year', 'GET /api/books/year/:fy/status', 404, { url: MOUNT + '/year/nope/status' }),
  X('db-fails-with-lines', 'POST /api/tax/rate', 500, { setup: { db: 'fail' }, body: { lines: [{ name: 'tea', qty: 1 }] } }),
  X('db-fails-with-lines', 'POST /api/tax/compute', 500, { setup: { db: 'fail' }, body: { lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  X('quantity-not-above-zero', 'POST /api/tax/compute', 400, { body: { lines: [{ name: 'tea', qty: 0, price: 10 }] } }),
  X('flag-not-true-or-false', 'POST /api/tax/compute', 400, { body: { priceIncludesTax: 'maybe', lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  X('no-country-no-tax', 'POST /api/tax/compute', 422, { body: { lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  /* B2 (4 Nov): the chit id in the address is no uuid → the unknown id's 404, never the driver's 500 (K-1) */
  X('chit-id-not-a-uuid', 'GET /api/invoice/:chit_id', 404, { setup: { db: 'uuid' }, url: '/api/invoice/abc' }),
  X('chit-id-holds-nul', 'GET /api/invoice/:chit_id', 404, { setup: { db: 'uuid' }, url: '/api/invoice/a%00b' }),
  /* API-31 (Wave M, tax + invoice): the 2xx answers of the seven routes, so their shapes close from recordings and the handlers' own literals (tools/api-allowlist.cjs) */
  X('rated-lines', 'POST /api/tax/rate', 200, { setup: IN_SHOP, body: { lines: [{ key: 'a', name: 'tea', qty: 1, hsn: '0902' }] } }),
  X('computed-intra-state', 'POST /api/tax/compute', 200, { setup: IN_SHOP, body: { buyer: { name: 'Walk-in' }, lines: [{ key: 'a', name: 'tea', qty: 2, price: 100, gst_rate: 5 }] } }),
  X('computed-inclusive-flag', 'POST /api/tax/compute', 200, { setup: IN_SHOP, body: { priceIncludesTax: true, lines: [{ key: 'a', name: 'tea', qty: 1, price: 105, gst_rate: 5 }] } }),
  X('built-invoice', 'POST /api/invoice/build', 200, { setup: IN_SHOP, body: { buyer: { name: 'Priya' }, lines: [{ key: 'a', name: 'tea', qty: 2, listPrice: 100, gst_rate: 5 }] } }),
  X('chit-invoice', 'GET /api/tax/invoice/:chit_id', 200, { setup: IN_SHOP, patch: COPY_PATCH }),
  X('chit-invoice', 'GET /api/invoice/:chit_id', 200, { setup: IN_SHOP, patch: COPY_PATCH }),
  X('chit-invoice-cost-blind', 'GET /api/invoice/:chit_id', 200, { setup: IN_SHOP, patch: Object.assign({}, COPY_PATCH, { cost: { isCostBlind: async () => true } }) }),
  X('gstr1-of-the-month', 'GET /api/tax/gstr', 200, { setup: IN_SHOP, url: '/api/tax/gstr?month=2026-10&form=gstr1' }),
  X('gstr3b-of-the-month', 'GET /api/tax/gstr', 200, { setup: IN_SHOP, url: '/api/tax/gstr?month=2026-10&form=gstr3b' }),
  X('ledger-of-a-registered-shop', 'GET /api/tax/ledger', 200, { setup: IN_SHOP, url: '/api/tax/ledger?month=2026-10' }),
  X('rated-lines-no-hsn', 'POST /api/tax/rate', 200, { setup: NO_GSTIN_SHOP, body: { lines: [{ name: 'tea', qty: 1 }] } }),
  X('computed-unregistered-seller', 'POST /api/tax/compute', 200, { setup: NO_GSTIN_SHOP, body: { lines: [{ name: 'tea', qty: 1, price: 10, gst_rate: 0 }] } }),
  X('computed-non-india-seller', 'POST /api/tax/compute', 200, { setup: AU_SHOP, body: { lines: [{ name: 'tea', qty: 1, price: 10, gst_rate: 10 }] } }),
  X('built-unregistered-seller', 'POST /api/invoice/build', 200, { setup: NO_GSTIN_SHOP, body: { lines: [{ name: 'tea', qty: 1, listPrice: 10 }] } }),
  /* ACC-272: the shop has no tax number and never said whether it is registered: the question, 409, never priced at no tax */
  X('computed-registration-never-said', 'POST /api/tax/compute', 409, { setup: Object.assign({}, NO_GSTIN_SHOP, { registration: 'unknown' }), body: { lines: [{ name: 'tea', qty: 1, price: 10, gst_rate: 0 }] } }),
  X('built-registration-never-said', 'POST /api/invoice/build', 409, { setup: Object.assign({}, NO_GSTIN_SHOP, { registration: 'unknown' }), body: { lines: [{ name: 'tea', qty: 1, listPrice: 10 }] } }),
  X('built-non-india-seller', 'POST /api/invoice/build', 200, { setup: AU_SHOP, body: { lines: [{ name: 'tea', qty: 1, listPrice: 10, gst_rate: 10 }] } }),
  X('db-fails-with-lines', 'POST /api/invoice/build', 500, { setup: { db: 'fail' }, body: { lines: [{ name: 'tea', qty: 1, price: 10 }] } }),
  X('entry-already-reversed', 'POST /api/books/entries/:id/reverse', 409, { patch: { books: { reverseEntry: async () => ({ duplicate: true, entry_no: 'MJ/1', entry_id: PARTY }) } } }),
  X('todo-things-to-do', 'GET /api/books/todo', 200, { patch: { todo: { todo: async () => [{ kind: 'bills_to_accept', count: 1, words: 'One bill to accept', action: { label: 'Accept', screen: 'bills', call: null }, items: [{ chit_id: PARTY }] }, { kind: 'months_unlocked', count: 2, words: 'Two months not locked', action: { label: 'Lock', screen: 'periods', call: null } }] } } }),
  X('pack-built-without-storage', 'GET /api/books/packs/:id/file', 409, { patch: { store: { pack: async () => PACK_ROW } } }),
  X('pack-no-file-to-confirm', 'POST /api/books/packs/:id/ack', 409, { patch: { store: { pack: async () => PACK_ROW } } }),
  X('snapshot-part-twice', 'POST /api/books/compare/snapshots', 409, { body: { snapshot_id: PARTY, part: 'tb', source: 'tally' }, patch: { store: { compareReady: async () => true, compareParts: async () => [{ part: 'tb', label: 'x', source: 'tally' }] } }, who: 'auditor' }),
  X('advice-already-recorded', 'PATCH /api/books/payments/:id', 409, { body: { advice_chit_id: PARTY }, patch: ADVICE_PATCH(true) }),
  X('advice-not-ready', 'PATCH /api/books/payments/:id', 503, { body: { advice_chit_id: PARTY }, patch: ADVICE_PATCH(false) })
]);

/* FIN-63: every call is its own attempt (a fresh Idempotency-Key: the money doors require one); `noKey` leaves it off to see the refusal */
let attempts = 0;
function send(port, method, urlPath, body, noKey) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const once = noKey ? {} : { 'idempotency-key': 'attempt-' + ++attempts };
    const options = { port, path: urlPath, method, headers: Object.assign(once, data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) };
    const request = http.request(options, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text, json: safeParse(text) }));
    });
    request.setTimeout(4000, () => {
      request.destroy();
      resolve({ status: 0, type: '', text: '', json: null });
    });
    request.on('error', () => {});
    if (data) request.write(data);
    request.end();
  });
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
}

/** every scenario as { id, route, url, body, setup, extra } */
function scenariosOf(routes) {
  const generic = [];
  Object.keys(routes).sort().forEach((route) => {
    const method = route.split(' ')[0];
    WORLDS.forEach((one) => {
      const needsId = one.badId && !routes[route].includes(':');
      if (needsId) return;
      generic.push({ id: one.id, route, url: urlOf(routes[route], one.badId), body: BODY_METHODS.includes(method) ? {} : undefined, setup: one.setup });
    });
  });
  const extras = EXTRAS.map((one) => Object.assign({}, one, { url: one.url || urlOf(routes[one.route] || '', false), extra: true }));
  return generic.concat(extras.filter((one) => routes[one.route]));
}

/** a scenario that needs a row the stand-in db cannot make swaps one library function for its answer, then puts the real one back */
function applyPatch(patch) {
  const lib = (name) => require(path.join(HERE, 'lib', name));
  const modules = { books: lib('books'), store: lib('books-store'), cashflow: lib('books-cashflow'), fxr: lib('fx-rates'), period: lib('books-period'), movein: lib('move-in-proof'), manual: lib('books-manual'), hooks: lib('books-hooks'), terms: lib('finance-terms'), pack: lib('books-pack'), recurring: lib('books-recurring'), taxcopy: lib('tax-copy'), cost: lib('cost'), todo: lib('books-todo') };
  const undo = [];
  Object.keys(patch || {}).forEach((which) => Object.keys(patch[which]).forEach((name) => {
    undo.push([modules[which], name, modules[which][name]]);
    modules[which][name] = patch[which][name];
  }));
  return () => undo.forEach(([owner, name, original]) => (owner[name] = original));
}

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
  if (scenario.who === 'auditor') world.who = OWNER;
  const restore = applyPatch(scenario.patch);
  const method = scenario.route.split(' ')[0];
  const answer = await send(port, method, scenario.url, scenario.body === undefined && BODY_METHODS.includes(method) ? {} : scenario.body, scenario.noKey);
  restore();
  return answer;
}

const legacyOf = (key, scenario) => (JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

function checkProblemBody(label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
}

function checkLegacy(label, answer, frozen) {
  if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
  check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
  const missing = Object.keys(frozen.fixture).filter((name) => !sameValue(answer.json[name], frozen.fixture[name]));
  check(label + ': every frozen legacy key is still there, byte for byte', missing.length === 0, missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name])));
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

/** the sign-in middleware's own 401 and requireScope's 403 are still the old body: tested, not yet a Problem (a follow-up for the auth middleware) */
const inherited = (scenario, answer) =>
  (answer.status === 401 && scenario.id === 'signed-out') || (answer.status === 403 && scenario.id === 'key-asks' && !scenario.route.includes(' ' + MOUNT + '/')); /* requireScope's 403: a follow-up for the auth middleware */
/** the statuses a test may see from a route, by the contract of the area that owns it */
function allowedFor() {
  const books = require(path.join(HERE, 'lib', 'books-contract.js')).allowedStatuses();
  const tax = require(path.join(HERE, 'lib', 'tax-contract.js')).allowedStatuses();
  return (route) => (route.includes(' ' + MOUNT + '/') ? books(route) : tax(route));
}

/** a body's clock stamps and minted ids (a new snapshot's id) are the same answer on every run: masked before a body is hashed */
const steady = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, 'UUID').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'STAMP');
const shaOf = (answer) => crypto.createHash('sha256').update(steady(answer.text)).digest('hex');
/** --compare F: the answers now against a capture of the code before, byte for byte (status, content type, body); every difference printed */
function compare(captureFile, recording) {
  const before = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const differing = Object.keys(before).filter((key) => !recording[key] || recording[key].status !== before[key].status || recording[key].type !== before[key].type || recording[key].sha !== before[key].sha);
  console.log('compared ' + Object.keys(before).length + ' answers: ' + (Object.keys(before).length - differing.length) + ' identical, ' + differing.length + ' different');
  differing.forEach((key) => console.log('  ' + key + ' [' + before[key].status + ' -> ' + (recording[key] && recording[key].status) + ']'));
  return differing.length;
}
const recordingOnly = () => argv.includes('--capture') || argv.includes('--compare');

async function checkRoutes(port, scenarios, recording) {
  const tested = {};
  const allowed = recordingOnly() ? null : allowedFor();
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, type: answer.type, sha: shaOf(answer), body: answer.json, request: { url: scenario.url, body: scenario.body } }; /* the request is kept so tools/api-allowlist.cjs can hand the generated output_allowlist case a request known to reach the success answer (R2-13) */
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (recordingOnly()) continue;
    check(label + ': answers (not a hang)', answer.status !== 0);
    if (scenario.expect) check(label + ': answers the status the row expects', answer.status === scenario.expect, [answer.status, scenario.expect]); /* ACC-274: a 200 where a refusal was expected used to pass silently (the status was only checked for 4xx answers) */
    if (answer.status < 400) continue;
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    checkProblemBody(label, answer);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/books_entry|SELECT|vault|relation/.test(answer.text), answer.text);
    else checkLegacy(label, answer, legacyOf(scenario.route, scenario.id));
  }
  return tested;
}

/** a capture becomes frozen answers: { route: { answers: [{ scenario, status, body_keys, fixture }] } } (4xx and 5xx only, the 401 of the sign-in middleware left out) */
function freeze(captureFile) {
  const recording = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const file = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  Object.keys(recording).forEach((key) => {
    const one = recording[key];
    const scenario = key.split('|')[1];
    const only = flagValue('--only');
    if (one.status < 400 || (one.status === 401 && scenario === 'signed-out') || !one.body || (only && !one.route.includes(' ' + only + '/'))) return;
    const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
    if (!entry.answers.some((answer) => answer.scenario === scenario)) entry.answers.push({ scenario, status: one.status, body_keys: one.body, fixture: one.body });
  });
  file.routes = Object.fromEntries(Object.keys(file.routes).sort().map((route) => [route, file.routes[route]]));
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(file, null, 1) + '\n');
  console.log('froze ' + Object.keys(file.routes).filter(MINE).length + ' routes');
}

/** lib/books-contract.js refusalOf as a unit: each coded refusal of the ledger, in the words and status it always had */
function checkRefusals() {
  const { refusalOf } = require(path.join(HERE, 'lib', 'books-contract.js'));
  const said = (code, extra) => refusalOf(Object.assign(new Error('Because.'), { code }, extra));
  const table = [
    ['PERIOD_LOCKED', 409], ['YEAR_CLOSED', 409], ['SUSPENSE_NOT_NIL', 409], ['BOOKS_NOT_FOUND', 404], ['FX_RATE_MISSING', 422], ['NO_COUNTRY_PACK', 422],
    ['NO_COUNTRY', 422], ['COUNTRY_SETUP_PENDING', 422], ['NO_MONEY', 422], ['RETURN_FROM_RAIL', 422], ['BOOKS_ENGINE', 503], ['BOOKS_NOT_MIGRATED', 503], ['BOOKS_BAD_REQUEST', 400], ['23505', 409]
  ];
  table.forEach(([code, status]) => check('refusalOf ' + code + ' → ' + status, said(code).status === status, said(code)));
  check('refusalOf: a refusal a screen branches on keeps its own code', said('PERIOD_LOCKED').code === 'PERIOD_LOCKED' && said('PERIOD_LOCKED').legacy.message === 'Because.');
  check('refusalOf: a named stock refusal carries its items', said('STOCK_NOT_COUNTED', { refused: true, items: ['p1'] }).legacy.items[0] === 'p1' && said('STOCK_NOT_COUNTED', { refused: true }).status === 422);
  check('refusalOf: a terms sentence the owner can fix keeps its 400 and words', refusalOf(Object.assign(new Error('x'), { say: 'Fix this.', status: 400 })).detail === 'Fix this.');
  check('refusalOf: the database refusing a write on purpose is a 503 in words', refusalOf(Object.assign(new Error('insert-only'), { code: '42501' })).status === 503);
  const unknown = refusalOf(new Error(SECRET_SQL));
  check('refusalOf: anything else is a 500 INTERNAL that says nothing of its cause', unknown.status === 500 && unknown.code === 'INTERNAL' && !JSON.stringify(unknown).includes('vault'), unknown);
}

/**
 * API-8 output allow-list (S34), the way tests/api-problem-till.test.cjs proves it: a books route whose success schema is CLOSED (additionalProperties false, derived in
 * docs/contracts/api-output-shapes.json) and whose recorded success answers fit that schema, with no key pruned, is proved here — the generator's proxy world cannot seat the
 * ledger, so it never reaches these answers. → { route: { output_allowlist: true } } for the routes that held
 */
const { refusesUnknownKeys } = require(path.join(HERE, 'tools', 'api-register.cjs')); /* the register's own rule for a closed answer: one definition */
function checkAllowList(recording) {
  const proved = {};
  const fixture = require('./support/books-capture.cjs').answersOf(ANSWERS_FILE); /* the period-end answers the sweep cannot reach, recorded by the tests that do (docs/contracts/books-answers.json) */
  const recorded = Object.assign({}, Object.fromEntries(Object.entries(fixture).filter(([, one]) => closedByRecordings(one.route))), recording); /* only for the routes whose shape is closed from them */
  const words = { OPERATIONS: Object.assign({}, require(path.join(HERE, 'lib', 'books-contract.js')).OPERATIONS, require(path.join(HERE, 'lib', 'tax-contract.js')).OPERATIONS) }; /* the ledger's routes and the tax and invoice services' (API-31) */
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  Object.keys(words.OPERATIONS).sort().forEach((route) => {
    const status = Number(Object.keys(words.OPERATIONS[route].responses).find((code) => /^2\d\d$/.test(code)) || 200);
    const schema = (((words.OPERATIONS[route].responses[status] || {}).content || {})['application/json'] || {}).schema;
    if (!refusesUnknownKeys(schema)) return; /* an object that lists its keys, or a list whose rows do (GET /todo) */
    const answers = Object.values(recorded).filter((one) => one.route === route && one.status === status && one.body);
    const fits = engine.compile(schema);
    const held = answers.length > 0 && answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    check(route + ': every recorded ' + status + ' (' + answers.length + ') holds only the keys its operation lists (a closed schema the answers fit)', held, { answers: answers.length, errors: fits.errors });
    if (held) proved[route] = Object.assign({ output_allowlist: true }, closedByRecordings(route) ? { output_allowlist_basis: 'recordings' } : {});
  });
  const filter = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  check('the output filter dropped no key from any answer of any scenario (' + filter.droppedCount() + ' dropped)', filter.droppedCount() === 0, filter.droppedKeys());
  return FOREIGN.ownedBy(proved, MINE); /* only the routes this test owns: another area's routes it happens to call are proved in that area's test */
}
/** is this route's shape closed from recorded answers alone (docs/contracts/api-output-shapes.json closed_by), not from keys its handler names */
const closedByRecordings = (route) => ((require(path.join(HERE, 'lib', 'output-allowlist.js')).shapeOf(route) || {}).closed_by === 'recordings');
/**
 * S35 foreign_id_404 (Wave M · M3), the generator's own rule (tools/api-contract-tests.cjs foreignIdCase) over this file's worlds, because its proxy world never
 * reaches a books route (the country gate stops it): a route addressed by a uuid in its path is proved when (1) some recorded scenario found the caller's own
 * id (a 2xx), (2) the unknown id (the nothing-found world) is a 404, and (3) another shop's id (the foreign-id world: the row exists, owned by OTHER) answers
 * byte for byte as the unknown id. → { route: { foreign_id_404: true } } for the routes that held; a route whose path value is not a row's uuid (a year, a ref) is left to
 * docs/contracts/api-hardening-scope.json public_ids (cb-api); the ledger's account code is read from the caller's own chart, so it is proved here too.
 */
async function checkForeignIds(port, routes, recording) {
  const proved = {};
  const idRoutes = Object.keys(routes).filter((route) => route.includes(' ' + MOUNT + '/') && /:(id|chit_id|account)\b/.test(route));
  for (const route of idRoutes) {
    const outcome = await foreignIdOutcome(port, routes, recording, route);
    if (route === 'POST ' + MOUNT + '/parties/:id/dispute') check('a dispute of a party that is not the shop writes no party_item row (unknown id and another shop id)', outcome.held && !outcome.wrote, outcome);
    if (outcome.held) proved[route] = { foreign_id_404: true };
    else console.log('  note  ' + route + ': foreign_id_404 not held here (' + outcome.why + ') — the register keeps it open');
  }
  check("S35: on every books route addressed by a uuid whose own id a scenario finds, another shop's id answers the unknown id's 404 byte for byte — or the route is named above (" + Object.keys(proved).length + ' of ' + idRoutes.length + ' held)', Object.keys(proved).length > 0);
  await checkForeignBite(port, routes, recording);
  return proved;
}
/** one route: the request that found the caller's own id (a recorded 2xx: its body passes the route's own input checks), sent again at an unknown id and at another shop's; worldPatch swaps a store read in both worlds */
async function foreignIdOutcome(port, routes, recording, route, worldPatch) {
  const key = Object.keys(recording).find((one) => recording[one].route === route && recording[one].status >= 200 && recording[one].status < 300);
  if (!key) return { held: false, why: 'no scenario finds the own id' };
  const own = EXTRAS.find((one) => one.id === key.slice(route.length + 1)) || {};
  const patch = Object.assign({}, own.inWorlds, worldPatch);
  const seen = [];
  const ask = (id, setup) => runScenario(port, { id, route, url: urlOf(routes[route], false), body: recording[key].request.body, setup: Object.assign({ sqlLog: seen }, setup), patch });
  const unknown = await ask('unknown-id', {});
  const foreign = await ask('foreign-id', { rowOwner: OTHER });
  return { wrote: seen.some((one) => /INSERT INTO party_item/i.test(one)), held: unknown.status === 404 && foreign.status === 404 && shaOf(foreign) === shaOf(unknown), why: 'unknown id ' + unknown.status + ', foreign id ' + foreign.status };
}
/** the bite: a pack read by its id alone (no entity_id) must NOT hold, or the foreign-id world could not fail (S35, as tests/api-contract.test.cjs does for the generator) */
async function checkForeignBite(port, routes, recording) {
  const unscoped = { store: { pack: async (db, entity, id) => (await db.query('SELECT * FROM books_pack WHERE pack_id = $1', [id])).rows[0] || null } };
  const outcome = await foreignIdOutcome(port, routes, recording, 'GET ' + MOUNT + '/packs/:id', unscoped);
  check("foreign_id_404 bites: a pack read by its id alone (no entity_id) is NOT held (" + outcome.why + ')', !outcome.held);
}
/** the books routes the evidence file says foreign_id_404 for */
function foreignIdEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => route.includes(' ' + MOUNT + '/') && routes[route].foreign_id_404).sort().map((route) => [route, { foreign_id_404: true }]));
}
/** the books reads the evidence file says output_allowlist for */
function allowListEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => MINE(route) && routes[route].output_allowlist).sort().map((route) => [route, Object.assign({ output_allowlist: true }, routes[route].output_allowlist_basis ? { output_allowlist_basis: routes[route].output_allowlist_basis } : {})]));
}
/** write this file's output_allowlist rows into the evidence file (other routes and columns stay as they are) */
function writeAllowList(proved) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).filter(MINE).forEach((route) => {
    if (!(proved[route] && proved[route].output_allowlist)) {
      delete routes[route].output_allowlist;
      delete routes[route].output_allowlist_basis;
    }
    if (route.includes(' ' + MOUNT + '/')) delete routes[route].foreign_id_404; /* foreign ids are proved for the books mount only */
  });
  Object.keys(proved).forEach((route) => (routes[route] = Object.assign(routes[route] || {}, proved[route])));
  Object.keys(routes).filter((route) => !Object.keys(routes[route]).length).forEach((route) => delete routes[route]);
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes }), null, 1) + '\n'); /* every row keeps its place (the file is not one sorted list); a newly proved route is added at the end */
}

/** lib/tax-contract.js as a unit: the words of a tax refusal and of a fault, as the service always said them */
function checkTaxWords() {
  const { taxSaid, faultOf } = require(path.join(HERE, 'lib', 'tax-contract.js'));
  const bad = taxSaid(400, 'NO_LINES', 'Send at least one line.');
  check('taxSaid: a 400 keeps { error: "Bad request", code, message }', bad.status === 400 && sameValue(bad.legacy, { error: 'Bad request', code: 'NO_LINES', message: 'Send at least one line.' }), bad);
  const cannot = taxSaid(422, 'NO_PRICE', 'No price.', { line: 'a' });
  check('taxSaid: a 422 says "Cannot compute" and carries its extra keys', cannot.legacy.error === 'Cannot compute' && cannot.legacy.line === 'a', cannot);
  const fault = faultOf(new Error(SECRET_SQL), { id: 'r1' });
  check('faultOf: anything else is a 500 TAX_FAILED that says nothing of its cause', fault.status === 500 && fault.code === 'TAX_FAILED' && fault.legacy.error === 'Failed' && !JSON.stringify(fault).includes('vault'), fault);
}

/** lib/contract-kit.js as a unit: a table of routes becomes operations whose refusals are Problem responses, with the statuses the register can check */
function checkKit() {
  console.log('\n-- lib/contract-kit.js: the operations an area builds from its table --');
  const kit = require(path.join(HERE, 'lib', 'contract-kit.js'));
  const rows = { 'POST /thing/:id': { summary: 'Change a thing', gates: ['owner'], body: ['name'], inline: [409] }, 'GET /things': { summary: 'List things', query: ['page'] } };
  const contract = kit.contractOf({ mount: '/api/x', routes: rows, gateStatus: { owner: 403 }, refusals: [{ status: 503 }], refusalsWhen: 'owner', extension: 'x-refusals' });
  const change = contract.OPERATIONS['POST /api/x/thing/:id'];
  const statuses = Object.keys(change.responses).map(Number).filter((status) => status >= 400);
  check('kit: a write behind the owner gate declares 401 sign-in, 403 refused, 404 for the id, 409 it writes itself, 422 the schema, 500 a fault', sameValue(statuses, [401, 403, 404, 409, 422, 500]), statuses);
  check('kit: every refusal is a Problem response, never a bare description', statuses.every((status) => JSON.stringify(change.responses[status]).includes('application/problem+json')));
  check('kit: a route that takes no write has no 422 unless it reads a query argument', !Object.keys(kit.contractOf({ mount: '/api/x', routes: { 'GET /ping': { summary: 'Ping' } } }).OPERATIONS['GET /api/x/ping'].responses).includes('422'));
  check('kit: a query argument is optional text, so a bad one stays a fallback and is never refused', contract.OPERATIONS['GET /api/x/things'].parameters[0].required === false);
  check('kit: allowedStatuses adds the shared refusals of a gated route and closed to anything unknown', contract.allowedStatuses()('POST /api/x/thing/:id').includes(503) && contract.allowedStatuses()('GET /nowhere').length === 0);
  check('kit: the paths fragment writes an express :id as {id}', Object.keys(contract.pathsOf()).includes('/api/x/thing/{id}'));
}

/** the whole sweep in four sentences: who is refused, how a malformed request is answered, and that every recorded refusal was replayed */
function checkAnswers(recording) {
  const answers = Object.values(recording);
  const gated = answers.filter((one) => one.route.includes('/api/tax/rate') || one.route.includes('/api/invoice/build'));
  const outs = Object.keys(recording);
  check('a caller who is not signed in is refused with 401, and a key without the scope with 403', outs.filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401) && gated.filter((one) => one.status === 403).length >= 2);
  const junkChit = ['chit-id-not-a-uuid', 'chit-id-holds-nul'].map((id) => recording['GET /api/invoice/:chit_id|' + id]);
  check('K-1: a chit id that is no uuid (or holds a NUL) answers the unknown id 404 NOT_FOUND, never the driver 500', junkChit.every((one) => one && one.status === 404 && one.body.code === 'NOT_FOUND' && one.body.error === 'Not found'), junkChit.map((one) => one && one.status));
  const nothing = answers.filter((one) => one.route === 'POST /api/tax/compute');
  check('a malformed tax request is refused with 400 in words (validation), never a crash', nothing.some((one) => one.status === 400 && one.body && one.body.code === 'NO_LINES'));
  const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(MINE).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 300);
  check('a 500 never says its cause: no answer of any route carries the database text', answers.every((one) => !JSON.stringify(one.body || {}).includes('vault')));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (flagValue('--freeze')) return freeze(flagValue('--freeze'));
  installStubs();
  const mounted = MOUNTS.map((mount) => ({ mount, router: require(path.join(HERE, ROUTE_FILES[mount])) }));
  mounted.push({ mount: '/api/books', router: require(path.join(HERE, 'routes', 'books-money.js')) }); /* ACC-206 B: a second router under the same mount (the ledger's own gates, its own file) */
  const routes = Object.assign({}, ...mounted.map((one) => routesOf(one.router, one.mount)));
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  mounted.forEach((one) => app.use(one.mount, one.router));
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, scenariosOf(routes), recording);
  server.close();
  if (flagValue('--capture')) {
    fs.writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (flagValue('--compare')) process.exit(compare(flagValue('--compare'), recording) ? 1 : 0);
  console.log('\n-- lib/books-contract.js: the ledger refusals as a unit --');
  checkRefusals();
  checkTaxWords();
  checkKit();
  checkAnswers(recording);
  const proved = checkAllowList(recording);
  const server2 = app.listen(0);
  const foreignProved = await checkForeignIds(server2.address().port, routes, recording);
  server2.close();
  Object.keys(foreignProved).forEach((route) => (proved[route] = Object.assign(proved[route] || {}, foreignProved[route])));
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    writeAllowList(proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/books.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    const allowProved = Object.fromEntries(Object.keys(proved).filter((route) => proved[route].output_allowlist).map((route) => [route, Object.fromEntries(Object.entries(proved[route]).filter(([key]) => key.startsWith('output_allowlist')))]));
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the books routes whose success answers held closed here', sameValue(allowListEvidenceOnDisk(), allowProved), { onDisk: Object.keys(allowListEvidenceOnDisk()).length, held: Object.keys(allowProved).length });
    const foreignOnDisk = foreignIdEvidenceOnDisk();
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the books routes that held it here', sameValue(foreignOnDisk, Object.fromEntries(Object.keys(foreignProved).sort().map((route) => [route, foreignProved[route]]))), { onDisk: Object.keys(foreignOnDisk).length, held: Object.keys(foreignProved).length });
  }
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();

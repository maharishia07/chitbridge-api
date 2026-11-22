#!/usr/bin/env node
// @type: unit
/**
 * bkbeh-books-doors-behaviour.test.cjs — BEHAVIOUR of four books doors that had only a shape test:
 *   GET /api/books/party/:id/bills · GET /api/books/evidence/:id · GET /api/books/bank/statement-files/:id/file · POST /api/books/bank/statements.
 *
 * OWNS      what each door DOES on the real routes/books.js:
 *           · party bills: the bills of THAT party with what is still owed, the age of the late one, the total owed as the sum of the open bills (one carried number, compared with the page's own total), a party of
 *             another shop or no id is the one 404 and the reader is never called, a cost-blind seat gets no supplier bills;
 *           · evidence: the bytes of a file only when it is a document behind an entry of THIS shop (the real isEvidence statement runs, scoped by shop), never cached, nosniff, and a file that is not evidence is a 404
 *             exactly as one that is not there (the blob store is not asked);
 *           · statement file: the bytes of the kept file, never cached, and the audit event row (who opened it, how) is written with the person's stamp; a stranger's file is 404 and nothing is written;
 *           · signing a statement: the BRS figures are stored AS CARRIED (nothing recomputed), `tied` is true only when the carried difference is nil, the person who signed is stamped, a statement in another
 *             currency than the account's is 409 CURRENCY_MISMATCH and nothing is stored, a viewer is refused and nothing is stored.
 * CALLED BY CI (T1). No database, no network: the real routes/books.js, lib/bank-rec-log, lib/bank-statement-file, lib/books-evidence and lib/books-party-bills over a scripted statement log; the stores that need a ledger
 *           (chart, party items, the blob store) are recording stand-ins.
 * FLOW      seat → real route → real lib → statements and stand-in calls recorded → asserts on what was asked, written and answered
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
/** the route as the register names it (/:id) with the one id of this scene put in: the path of every call below is the route's own template */
const at = (route, id) => route.replace(':id', id);
const path = require('path');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const HERE = path.join(__dirname, '..');
const { harness, SHOP, PARTY, OWNER, STAFF } = require('./lib/problem-world.cjs');

const MOUNT = '/api/books';
const FILE_ID = '55555555-5555-4555-8555-555555555555';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const SETTING = { entity_id: SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 4, functional_currency: 'INR', country: 'IN', pack_version: '1', timezone: 'Asia/Kolkata' };
const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer', display_name: 'Viewer' });
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/books.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'), inherited: () => false, notFrozen: () => true });
const { check, world } = lab;
const register = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'error-codes.json'), 'utf8')).codes.map((row) => row.code));
const ACCOUNTANT = Object.assign({}, STAFF, { hat: 'manager' }); /* the owner's own accountant (RC-7): passes the money reader */
const writes = (log) => log.filter((one) => /^\s*(INSERT|UPDATE|DELETE)/i.test(one.sql));

(async () => {
  lab.installStubs();
  const lib = (name) => require(path.join(HERE, 'lib', name + '.js'));
  const CS = lib('country-setup'), B = lib('books'), schema = lib('schema'), store = lib('books-store'), storage = lib('storage'), terms = lib('finance-terms'), needs = lib('books-needs'), billChecks = lib('bill-checks');
  CS.gate = async () => undefined;
  B.settingOf = async () => SETTING;
  schema.hasTable = async () => true;
  schema.hasColumn = async () => true;
  const router = require(path.join(HERE, 'routes', 'books.js'));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  let log = [];
  /** the scripted statements: a scene gives `answer(sql, params)`; every statement is kept */
  const play = async (method, url, body, who, answer, extra) => {
    log = [];
    Object.assign(world, { realAuth: false, asKey: false, db: 'ok', who: who || OWNER, sqlRows: (sql, params) => { log.push({ sql: String(sql), params }); return answer ? answer(String(sql), params) : null; } }, extra);
    return lab.send(port, method, url, body === null ? undefined : body);
  };
  const refused = (label, a, status, code, untouched) => check(label, a.status === status && a.json && a.json.code === code && register.has(code) && untouched(), [a.status, a.json && a.json.code]);

  /* =========================== GET /party/:id/bills =========================== */
  const bill = (ref, minor, day, due) => ({ item_id: ref, entry_id: null, party_id: PARTY, account_id: 'acc-debtors', side: 'receivable', ref_kind: 'bill', ref, against_ref: ref, amount_minor: minor, currency: 'INR', doc_date: day, due_date: due, created_at: day + 'T06:00:00Z' });
  const asked = { parties: [], items: [] };
  B.knownParty = async (h, e, id) => { asked.parties.push([e, id]); return id === PARTY; };
  store.accounts = async () => [{ role: 'debtors', account_id: 'acc-debtors' }, { role: 'creditors', account_id: 'acc-creditors' }];
  store.items = async (h, e, party, account) => { asked.items.push([e, party, account]); return [bill('B1', 50000, '2026-09-01', '2026-10-01'), bill('B2', 20000, '2026-11-10', '2026-12-10')]; };
  store.billNos = async () => ({ B1: 'INV-1', B2: 'INV-2' });
  terms.customerTerms = async () => ({ shop: {}, by_party: new Map() });
  needs.partyNeeds = async (h, e, req, opt, rows) => ({ reasons: new Map(rows.filter((row) => row.days_overdue > 0).map((row) => [row.ref, ['overdue']])) });
  billChecks.attach = async () => ({ mark_actions: null });
  let a = await play('GET', at('/api/books/party/:id/bills?side=customer&asOf=2026-11-18', PARTY));
  check('the owner reads the party\'s bills: 200', a.status === 200, a.text);
  const bills = (a.json && a.json.bills) || [];
  const b1 = bills.find((one) => one.ref === 'B1'), b2 = bills.find((one) => one.ref === 'B2');
  check('both open bills are listed with their numbers', bills.length === 2 && b1 && b1.bill_no === 'INV-1' && b2 && b2.bill_no === 'INV-2', bills);
  check('B1 (50,000.00 INR due 1 Oct) is 48 days late as at 18 Nov; B2 (due 10 Dec) is not yet due', b1 && b1.days_overdue === 48 && b2 && b2.days_overdue === null, [b1 && b1.days_overdue, b2 && b2.days_overdue]);
  check('each bill shows what is still owed in minor units, nothing recomputed in major (50000 and 20000)', b1.amount_minor === 50000 && b1.owed_minor === 50000 && b2.amount_minor === 20000 && b2.owed_minor === 20000 && b1.status === 'unpaid', [b1, b2]);
  check('the default order is newest first, and only the late bill carries a reason (overdue)', bills[0].ref === 'B2' && b1.why === 'overdue' && b2.why === null, bills.map((one) => [one.ref, one.why]));
  const summed = bills.reduce((sum, one) => sum + one.owed_minor, 0);
  check('the carried total owed equals the sum of the bills\' owed (70000 = 50000 + 20000), in INR', a.json.owed_minor === 70000 && a.json.owed_minor === summed && a.json.currency === 'INR', [a.json.owed_minor, summed, a.json.currency]);
  check('the counts agree with the rows: 2 open, 0 paid, 2 all, 1 needing you', a.json.counts.open === 2 && a.json.counts.paid === 0 && a.json.counts.all === 2 && a.json.counts.needs === 1, a.json.counts);
  check('the items were read for THIS shop and THIS party, on the debtors control account', asked.items.some((one) => one[0] === SHOP && one[1] === PARTY && one[2] === 'acc-debtors'), asked.items);
  check('the read wrote nothing', writes(log).length === 0, log.map((one) => one.sql.slice(0, 40)));
  const needing = await play('GET', at('/api/books/party/:id/bills?tab=needs&asOf=2026-11-18', PARTY));
  check('the Needs you tab holds only the late bill, and the count says 1 of 2', needing.json && needing.json.bills.length === 1 && needing.json.bills[0].ref === 'B1' && needing.json.counts.needs === 1 && needing.json.counts.open === 2 && needing.json.total === 1, needing.json);
  asked.parties.length = 0; asked.items.length = 0;
  a = await play('GET', at('/api/books/party/:id/bills', '12121212-1212-4212-8212-121212121212'));
  refused('a party that is not this shop\'s is the one 404 NOT_FOUND and its bills are never read', a, 404, 'NOT_FOUND', () => asked.items.length === 0);
  asked.parties.length = 0; asked.items.length = 0;
  a = await play('GET', at('/api/books/party/:id/bills', 'not-an-id'));
  refused('an id that is no id is the same 404, the reader is not called', a, 404, 'NOT_FOUND', () => asked.items.length === 0 && asked.parties.length === 0);
  const costBlind = lib('cost');
  const realBlind = costBlind.isCostBlind;
  costBlind.isCostBlind = async () => true;
  a = await play('GET', at('/api/books/party/:id/bills?side=customer', PARTY), null, STAFF);
  refused('a co-assist who is no accountant may not read the money of the ledger: 403 OWNER_ONLY and nothing is read', a, 403, 'OWNER_ONLY', () => asked.items.length === 0);
  a = await play('GET', at('/api/books/party/:id/bills?side=supplier', PARTY), null, ACCOUNTANT);
  check('a seat that may not see costs gets NO supplier bills and no owed figure (empty, null), never the figures', a.status === 200 && a.json.bills.length === 0 && a.json.owed_minor === null && asked.items.length === 0, a.json);
  costBlind.isCostBlind = realBlind;
  a = await play('GET', at('/api/books/party/:id/bills', PARTY), null, null, null, { asKey: true });
  check('a device key is refused with a register code and nothing is read', a.status >= 400 && a.json && register.has(a.json.code) && asked.items.length === 0, [a.status, a.json && a.json.code]);

  /* =========================== GET /evidence/:id =========================== */
  const blobs = [];
  storage.hasEntryColumns = async () => true;
  storage.getBlob = async (id, e, opt) => { blobs.push({ id, e, opt }); return { name: 'bill.pdf', mime: 'application/pdf', size: 4, data: Buffer.from('%PDF') }; };
  const evidenceRows = (held) => (sql, params) => (/FROM cb_attachment a/.test(sql) ? (held ? { rows: [{ '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 }) : null);
  a = await play('GET', at('/api/books/evidence/:id', FILE_ID), null, null, evidenceRows(true));
  check('a document behind an entry of this shop is served: 200 with its bytes', a.status === 200 && a.bytes.toString() === '%PDF', [a.status, a.text.slice(0, 60)]);
  check('a PDF renders inline, is never cached (a revoked grant must stop at once) and is not sniffed', /inline/.test(a.disposition) && /no-store/.test(a.cache) && a.type === 'application/pdf', [a.disposition, a.cache, a.type]);
  const asking = log.find((one) => /FROM cb_attachment a/.test(one.sql));
  check('the evidence statement was scoped by file id AND by this shop', asking && asking.params[0] === FILE_ID && asking.params[1] === SHOP && /a\.entity_id = \$2/.test(asking.sql), asking && asking.params);
  check('the blob store was asked for this file in this shop, documents only', blobs.length === 1 && blobs[0].id === FILE_ID && blobs[0].e === SHOP && blobs[0].opt && blobs[0].opt.documentsOnly === true, blobs);
  blobs.length = 0;
  a = await play('GET', at('/api/books/evidence/:id', FILE_ID), null, null, evidenceRows(false));
  refused('a file that is not behind an entry of these books is 404 NOT_FOUND and the blob store is never asked', a, 404, 'NOT_FOUND', () => blobs.length === 0);
  a = await play('GET', at('/api/books/evidence/:id', 'not-an-id'), null, null, evidenceRows(true));
  refused('an id that is no id is the same 404 and nothing is asked', a, 404, 'NOT_FOUND', () => blobs.length === 0 && !log.some((one) => /cb_attachment/.test(one.sql)));
  a = await play('GET', at('/api/books/evidence/:id', FILE_ID), null, null, evidenceRows(true), { asKey: true });
  check('a device key cannot read evidence and the blob store is never asked', a.status >= 400 && blobs.length === 0, [a.status]);

  /* =========================== GET /bank/statement-files/:id/file =========================== */
  const ROW = { id: FILE_ID, account_id: ACCOUNT_ID, label: '..1234', period_from: '2026-10-01', period_to: '2026-10-31', currency: 'INR', name: 'oct.csv', size: 12, mime: 'text/csv', kind: 'bank_statement', source: 'upload', overlaps: false, by_user: SHOP, by_name: 'Test shop', by_firm: null, grant_id: null, created_at: '2026-11-01T00:00:00Z', attachment_id: '66666666-6666-4666-8666-666666666666' };
  const fileRows = (held) => (sql, params) => (/FROM bank_statement_file WHERE id = \$1 AND entity_id = \$2/.test(sql) ? (held && params[1] === SHOP ? { rows: [ROW], rowCount: 1 } : { rows: [], rowCount: 0 }) : /INSERT INTO bank_statement_file_event/.test(sql) ? { rows: [], rowCount: 1 } : null);
  const eventsOf = () => log.filter((one) => /INSERT INTO bank_statement_file_event/.test(one.sql));
  storage.getBlob = async (id, e) => { blobs.push({ id, e }); return { name: 'oct.csv', mime: 'text/csv', data: Buffer.from('a,b\n1,2\n') }; };
  blobs.length = 0;
  a = await play('GET', at('/api/books/bank/statement-files/:id/file', FILE_ID), null, null, fileRows(true));
  check('the owner downloads the kept statement: 200 and the very bytes kept', a.status === 200 && a.bytes.toString() === 'a,b\n1,2\n', [a.status, a.text.slice(0, 60)]);
  check('a CSV is a download (attachment), never cached, not sniffed', /attachment/.test(a.disposition) && /no-store/.test(a.cache), [a.disposition, a.cache]);
  check('the blob was read by the attachment id of THE row of this shop', blobs.length === 1 && blobs[0].id === ROW.attachment_id && blobs[0].e === SHOP, blobs);
  check('the audit event is written: one row, "downloaded", this shop, this file, stamped with the person (no firm, no grant)', eventsOf().length === 1 && eventsOf()[0].params[0] === SHOP && eventsOf()[0].params[1] === FILE_ID && eventsOf()[0].params[2] === 'downloaded' && eventsOf()[0].params[3] === SHOP && eventsOf()[0].params[5] === null && eventsOf()[0].params[6] === null, eventsOf().map((one) => one.params));
  a = await play('GET', at('/api/books/bank/statement-files/:id/file?use=read', FILE_ID), null, null, fileRows(true));
  check('use=read (the Bank page loading it into its reader) is recorded as "read", not "downloaded"', a.status === 200 && eventsOf().length === 1 && eventsOf()[0].params[2] === 'read', eventsOf().map((one) => one.params));
  blobs.length = 0;
  a = await play('GET', at('/api/books/bank/statement-files/:id/file', FILE_ID), null, null, fileRows(false));
  refused('a statement that is not this shop\'s is 404 NOT_FOUND, no bytes are read and no event is written', a, 404, 'NOT_FOUND', () => blobs.length === 0 && eventsOf().length === 0);
  a = await play('GET', at('/api/books/bank/statement-files/:id/file', 'not-an-id'), null, null, fileRows(true));
  refused('an id that is no id is the same 404, nothing asked', a, 404, 'NOT_FOUND', () => blobs.length === 0 && eventsOf().length === 0);
  a = await play('GET', at('/api/books/bank/statement-files/:id/file', FILE_ID), null, null, fileRows(true), { asKey: true });
  check('a device key is refused and no bytes are read, no event written', a.status >= 400 && blobs.length === 0 && eventsOf().length === 0, [a.status]);

  /* =========================== POST /bank/statements =========================== */
  const chart = [{ account_id: ACCOUNT_ID, code: '1510', name: 'Bank', role: 'bank', is_group: false }];
  store.accounts = async () => chart;
  B.ledgerCtx = async () => ({ pack: B.packOf({ country: 'IN', fy_start_month: 4, functional_currency: 'INR', pack_version: '1' }) }); /* WALK U: the statement is signed only against the books' own figure on the period end (150000 here, the trial balance's debit less credit) */
  B.ensureYear = async () => []; /* AM-F-05: the lock check reads the real period rows; proved in am-bank-twice.test.cjs */
  B.trialBalance = async () => ({ rows: [{ code: '1510', debit_minor: 150000, credit_minor: 0 }] });
  const STATEMENT = { account: '1510', period_from: '2026-10-01', period_to: '2026-10-31', opening_minor: 100000, closing_bank_minor: 150000, closing_books_minor: 150000, difference_minor: 0, currency: 'INR', file_hash: 'abc123' };
  const inserted = () => log.filter((one) => /INSERT INTO bank_rec_log/.test(one.sql));
  const statementRows = (sql, params) => (/INSERT INTO bank_rec_log/.test(sql) ? { rows: [{ id: FILE_ID, seq: 2, account_id: params[1], kind: 'statement', file_hash: params[2], period_from: params[3], period_to: params[4], opening_minor: params[5], closing_bank_minor: params[6], closing_books_minor: params[7], difference_minor: params[8], currency: params[9], tied: params[10], made_by: params[11], made_at: '2026-11-20T10:00:00Z' }], rowCount: 1 } : null);
  a = await play('POST', `/api/books/bank/statements`, STATEMENT, null, statementRows);
  check('the owner signs a statement: 201 with the statement', a.status === 201 && a.json && a.json.statement, [a.status, a.text.slice(0, 200)]);
  check('exactly one row is inserted, for THIS shop and the account the code named', inserted().length === 1 && inserted()[0].params[0] === SHOP && inserted()[0].params[1] === ACCOUNT_ID, inserted().map((one) => one.params));
  const kept = inserted()[0] && inserted()[0].params;
  check('the BRS figures are stored as carried: opening 100000, bank 150000, books 150000, difference 0 (whole minor units, nothing recomputed), in INR, hash as given', kept && kept[5] === 100000 && kept[6] === 150000 && kept[7] === 150000 && kept[8] === 0 && kept[9] === 'INR' && kept[2] === 'abc123', kept);
  check('tied is true because the carried difference is nil, and the signer is the owner', kept && kept[10] === true && kept[11] === SHOP, kept);
  check('the answer carries the same figures back (compared with the request, not recomputed)', a.json.statement.closing_bank_minor === STATEMENT.closing_bank_minor && a.json.statement.closing_books_minor === STATEMENT.closing_books_minor && a.json.statement.difference_minor === 0 && a.json.statement.tied === true && a.json.statement.by === SHOP, a.json.statement);
  a = await play('POST', `/api/books/bank/statements`, Object.assign({}, STATEMENT, { closing_books_minor: 150000, closing_bank_minor: 149500, difference_minor: 500 }), null, statementRows);
  check('a carried difference of 500 is stored as 500 and the statement is NOT tied (the page\'s figure is kept, never forced to nil)', a.status === 201 && inserted()[0].params[8] === 500 && inserted()[0].params[10] === false && a.json.statement.tied === false, [a.status, inserted().map((one) => one.params)]);
  a = await play('POST', `/api/books/bank/statements`, Object.assign({}, STATEMENT, { currency: 'AUD' }), null, statementRows);
  refused('a statement in AUD for an INR account is 409 CURRENCY_MISMATCH and nothing is stored', a, 409, 'CURRENCY_MISMATCH', () => inserted().length === 0);
  a = await play('POST', `/api/books/bank/statements`, Object.assign({}, STATEMENT, { period_from: '2026-11-01', period_to: '2026-10-01' }), null, statementRows);
  check('a period that ends before it starts is refused (4xx) and nothing is stored', a.status >= 400 && a.status < 500 && inserted().length === 0, [a.status, a.text.slice(0, 120)]);
  a = await play('POST', `/api/books/bank/statements`, Object.assign({}, STATEMENT, { closing_bank_minor: 1500.5 }), null, statementRows);
  check('a figure that is not a whole number of minor units is refused (4xx) and nothing is stored', a.status >= 400 && a.status < 500 && inserted().length === 0, [a.status, a.text.slice(0, 120)]);
  a = await play('POST', `/api/books/bank/statements`, Object.assign({}, STATEMENT, { file_hash: '' }), null, statementRows);
  check('a statement with no file hash is refused (4xx) and nothing is stored', a.status >= 400 && a.status < 500 && inserted().length === 0, [a.status, a.text.slice(0, 120)]);
  a = await play('POST', `/api/books/bank/statements`, Object.assign({}, STATEMENT, { account: 'no-such' }), null, statementRows);
  refused('an account the books do not know is 404, nothing stored', a, 404, 'NOT_FOUND', () => inserted().length === 0);
  a = await play('POST', `/api/books/bank/statements`, STATEMENT, VIEWER, statementRows);
  check('a viewer cannot sign a statement: refused 403 with a register code and nothing is stored', a.status === 403 && a.json && register.has(a.json.code) && inserted().length === 0, [a.status, a.json && a.json.code]);
  a = await play('POST', `/api/books/bank/statements`, STATEMENT, null, statementRows, { asKey: true });
  check('a device key cannot sign a statement and nothing is stored', a.status === 403 && inserted().length === 0, [a.status]);

  server.close();
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 4).join(' | ') : failure));
  process.exit(1);
});

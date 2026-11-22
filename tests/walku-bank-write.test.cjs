#!/usr/bin/env node
// @type: unit
/**
 * walku-bank-write.test.cjs — WALK U (AU, 21 Nov): the bank reconciliation is a books WRITE, and a sign-off is true only for the books it saw.
 * OWNS      U-F-01 a Cashier (editor level) POSTs /bank/statements, /bank/marks, /bank/statement-files: 403 OWNER_ONLY in words, nothing stored; the owner and the owner's accountant (hat manager) may.
 *           U-F-02 a statement carrying closing books A$0.01 against a books bank of A$5,000.00 (500000 minor) is refused 409 BOOKS_FIGURE_DIFFERS, nothing stored (was 201, tied).
 *           U-F-03 sign off Nov at books 500000, then a reversal of the A$12.50 fee (1250) lifts the books to 501250: signed_as_at says stale, tied false, moved 1250, books now 501250 (was tied true).
 * CALLED BY CI (T1). No database: the real routes/books.js and lib/bank-rec-log over a scripted statement log.
 * FLOW      seat → real route → real lib → statements recorded → asserts
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const HERE = path.join(__dirname, '..');
const { harness, SHOP, OWNER, STAFF } = require('./lib/problem-world.cjs');
const MOUNT = '/api/books';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const SETTING = { entity_id: SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 7, functional_currency: 'AUD', country: 'AU', pack_version: '1', timezone: 'Australia/Sydney' };
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/books.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'), inherited: () => false, notFrozen: () => true });
const { check, world } = lab;
const CASHIER = Object.assign({}, STAFF, { access_level: 'editor', display_name: 'Cashier' });
const ACCOUNTANT = Object.assign({}, STAFF, { hat: 'manager' });

(async () => {
  lab.installStubs();
  const lib = (name) => require(path.join(HERE, 'lib', name + '.js'));
  const CS = lib('country-setup'), B = lib('books'), schema = lib('schema'), store = lib('books-store'), LOG = lib('bank-rec-log');
  CS.gate = async () => undefined;
  B.settingOf = async () => SETTING;
  schema.hasTable = async () => true;
  schema.hasColumn = async () => true;
  const chart = [{ account_id: ACCOUNT_ID, code: '1510', name: 'Bank', role: 'bank', is_group: false }];
  store.accounts = async () => chart;
  let booksBank = 500000; /* A$5,000.00 */
  B.ledgerCtx = async () => ({ pack: B.packOf(SETTING) });
  B.ensureYear = async () => []; /* AM-F-05: the lock check reads the real period rows; proved in am-bank-twice.test.cjs */
  B.trialBalance = async () => ({ rows: [{ code: '1510', debit_minor: booksBank, credit_minor: 0 }] });
  const server = lab.appOf([{ mount: MOUNT, router: require(path.join(HERE, 'routes', 'books.js')) }]).listen(0);
  const port = server.address().port;
  let log = [];
  const play = async (method, url, body, who) => {
    log = [];
    const rows = (sql, params) => {
      log.push({ sql: String(sql), params });
      return /INSERT INTO bank_rec_log/.test(sql) ? { rows: [{ id: ACCOUNT_ID, seq: 1, account_id: params[1], kind: 'statement', closing_bank_minor: params[6], closing_books_minor: params[7], difference_minor: params[8], currency: params[9], tied: params[10] }] } : null;
    };
    Object.assign(world, { realAuth: false, asKey: false, db: 'ok', who: who || OWNER, sqlRows: rows });
    return lab.send(port, method, url, body);
  };
  const stored = () => log.filter((one) => /INSERT INTO bank_rec_log|INSERT INTO bank_statement/.test(one.sql)).length;
  const NOV = { account: '1510', period_from: '2026-10-01', period_to: '2026-10-31', opening_minor: 0, closing_bank_minor: 1, closing_books_minor: 1, difference_minor: 0, currency: 'AUD', file_hash: 'abc123' };
  const FILE = { account: '1510', period_from: '2026-10-01', period_to: '2026-10-31', currency: 'AUD', sha256: 'a', name: 'n.csv', text: 'x' };

  /* U-F-01 */
  const doors = [['/api/books/bank/statements', NOV], ['/api/books/bank/marks', { account: '1510', marks: [{ act: 'note', key: 'k', text: 'x' }] }], ['/api/books/bank/statement-files', FILE]];
  for (const [route, body] of doors) {
    const a = await play('POST', route, body, CASHIER);
    check('U-F-01 a Cashier POST ' + route + ' is refused 403 OWNER_ONLY in words and nothing is stored', a.status === 403 && a.json && a.json.code === 'OWNER_ONLY' && /accountant or bookkeeper/.test(a.text) && stored() === 0, [a.status, a.text.slice(0, 160)]);
  }
  /* U-F-02 */
  let a = await play('POST', '/api/books/bank/statements', NOV, OWNER);
  check('U-F-02 closing books A$0.01 against books bank A$5,000.00 is refused 409 BOOKS_FIGURE_DIFFERS, nothing stored', a.status === 409 && a.json && a.json.code === 'BOOKS_FIGURE_DIFFERS' && stored() === 0, [a.status, a.text.slice(0, 200)]);
  check('U-F-02 the refusal says both figures in words (5,000.00 and 0.01)', /AUD 5,000 in this account/.test(a.text) && /not AUD 0\.01/.test(a.text), a.text.slice(0, 260));
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, NOV, { closing_bank_minor: 498750, closing_books_minor: 500000, difference_minor: -1250 }), OWNER);
  check('U-F-02 the honest statement (bank 4,987.50, books 5,000.00 as the books hold it, 12.50 unexplained) is stored, not tied', a.status === 201 && stored() === 1 && a.json.statement.tied === false, [a.status, a.text.slice(0, 160)]);
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, NOV, { closing_bank_minor: 500000, closing_books_minor: 500000, difference_minor: 0 }), ACCOUNTANT);
  check('U-F-01 the owner\'s accountant (hat manager) may sign off: 201', a.status === 201, [a.status, a.text.slice(0, 160)]);

  /* U-F-03 */
  const signed = { account_id: ACCOUNT_ID, period_to: '2026-10-31', difference_minor: 0, closing_bank_minor: 500000, closing_books_minor: 500000, made_at: '2026-12-01 09:00:00+00', currency: 'AUD' };
  const db = { async query() { return { rows: [signed] }; } };
  let out = await LOG.signedAsAt(db, SHOP, '2026-10-31', chart);
  check('U-F-03 before any reversal: tied, not stale, moved 0', out.accounts[0].tied === true && out.accounts[0].stale === false && out.accounts[0].moved_minor === 0, out.accounts[0]);
  booksBank = 501250; /* the fee entry (Cr bank 12.50) is reversed: the books bank goes back up by 1,250 */
  out = await LOG.signedAsAt(db, SHOP, '2026-10-31', chart);
  check('U-F-03 after the reversal: stale, NOT tied, moved 1250, books now 501250 (was tied true)', out.accounts[0].tied === false && out.accounts[0].stale === true && out.accounts[0].moved_minor === 1250 && out.accounts[0].books_now_minor === 501250, out.accounts[0]);
  check('U-F-03 without a chart the old carried answer is unchanged (no extra keys)', !('stale' in (await LOG.signedAsAt(db, SHOP, '2026-10-31')).accounts[0]));

  server.close();
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 4).join(' | ') : failure));
  process.exit(1);
});

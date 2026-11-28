#!/usr/bin/env node
// @type: unit
/**
 * ba-1129.test.cjs — WALK BA (India, 22 Nov, harness wkba): the bank record and a delivery on a closed order.
 * OWNS      BA-F-01 a bank line the books reversed is not an exception, and a re-sent ref says in words it was reversed
 *           BA-F-07 marks and sign-offs only on a bank ledger; a sign-off whose figures do not add (closing_bank 404,975 / closing_books 111,111 / difference 0) is refused 409 in words, never stored tied;
 *                   tied is the server's own sum (bank = books + listed items + unexplained difference); a period that ends in the future is refused
 *           BA-F-05 a delivery recorded by the BUYER on an order the other side REJECTED (the sent copy keeps its own status) is refused 409 wrong_step through the rail's deliveryOn table
 * CALLED BY CI (T1). No database: the real routes/books.js, lib/bank-rec-log and lib/deliverline over scripted rows.
 * FLOW      seat -> real route -> real lib -> asserts
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const HERE = path.join(__dirname, '..');
const { harness, SHOP, OWNER } = require('./lib/problem-world.cjs');
const MOUNT = '/api/books';
const BANK_ID = '44444444-4444-4444-8444-444444444444', CASH_ID = '55555555-5555-4555-8555-555555555555', GROUP_ID = '66666666-6666-4666-8666-666666666666';
const SETTING = { entity_id: SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 4, functional_currency: 'INR', country: 'IN', pack_version: '1', timezone: 'Asia/Kolkata' };
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/books.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'), inherited: () => false, notFrozen: () => true });
const { check, world } = lab;

(async () => {
  lab.installStubs();
  const lib = (name) => require(path.join(HERE, 'lib', name + '.js'));
  const CS = lib('country-setup'), B = lib('books'), schema = lib('schema'), store = lib('books-store'), LOG = lib('bank-rec-log');
  CS.gate = async () => undefined;
  B.settingOf = async () => SETTING;
  schema.hasTable = async () => true;
  schema.hasColumn = async () => true;
  const chart = [
    { account_id: GROUP_ID, code: '1500', name: 'Bank accounts', role: null, is_group: true },
    { account_id: BANK_ID, code: '1510', name: 'Bank', role: 'bank', is_group: false, parent_id: GROUP_ID },
    { account_id: CASH_ID, code: '1400', name: 'Cash', role: 'cash', is_group: false, parent_id: null }
  ];
  store.accounts = async () => chart;
  B.ledgerCtx = async () => ({ pack: B.packOf(SETTING), country: 'IN' }); /* AM-F-05 (1129): a sign-off asks the entries' lock rule, which needs the pack to find the fiscal year */
  B.trialBalance = async () => ({ rows: [{ code: '1510', debit_minor: 111111, credit_minor: 0 }, { code: '1400', debit_minor: 5000, credit_minor: 0 }] });
  require('../lib/books-closing').closingAsAt = async (db, e, account, day) => { const row = (await B.trialBalance(db, e, day)).rows.find((x) => String(x.code) === String(account.code)); return row ? row.debit_minor - row.credit_minor : 0; }; /* RC5: the sign-off's books figure is books-closing; no database here, so the stand-in answers the trial-balance row this test stubs */
  const server = lab.appOf([{ mount: MOUNT, router: require(path.join(HERE, 'routes', 'books.js')) }]).listen(0);
  const port = server.address().port;
  let log = [];
  const play = async (method, url, body) => {
    log = [];
    const rows = (sql, params) => {
      log.push({ sql: String(sql), params });
      return /INSERT INTO bank_rec_log/.test(sql) ? { rows: [{ id: BANK_ID, seq: 1, account_id: params[1], kind: 'statement', difference_minor: 0, tied: true, currency: 'INR' }] } : { rows: [] };
    };
    Object.assign(world, { realAuth: false, asKey: false, db: 'ok', who: OWNER, sqlRows: rows });
    return lab.send(port, method, url, body);
  };
  const stored = () => log.filter((one) => /INSERT INTO bank_rec_log/.test(one.sql)).length;
  const tiedStored = () => log.find((one) => /INSERT INTO bank_rec_log/.test(one.sql)).params[10];
  const STMT = { account: '1510', period_from: '2026-04-01', period_to: '2026-04-30', opening_minor: 0, currency: 'INR', file_hash: 'abc' };

  /* BA-F-07 marks on a cash ledger */
  let a = await play('POST', '/api/books/bank/marks', { account: '1400', marks: [{ act: 'note', key: 'k', text: 'x' }] });
  check('BA-F-07 marks on the cash ledger 1400 are refused 409 NOT_A_BANK_ACCOUNT in words, nothing stored', a.status === 409 && a.json.code === 'NOT_A_BANK_ACCOUNT' && /not a bank account/.test(a.text) && stored() === 0, [a.status, a.text.slice(0, 200)]);
  a = await play('POST', '/api/books/bank/marks', { account: '1510', marks: [{ act: 'note', key: 'k', text: 'x' }] });
  check('BA-F-07 marks on the bank ledger 1510 are still stored (201)', a.status === 201 && stored() === 1, [a.status, a.text.slice(0, 200)]);
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, STMT, { account: '1400', closing_bank_minor: 5000, closing_books_minor: 5000, difference_minor: 0 }));
  check('BA-F-07 a sign-off on the cash ledger is refused 409 NOT_A_BANK_ACCOUNT', a.status === 409 && a.json.code === 'NOT_A_BANK_ACCOUNT' && stored() === 0, [a.status, a.text.slice(0, 160)]);

  /* BA-F-07 figures that do not add (the walk's own: bank 404,975, books 111,111, difference 0) */
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, STMT, { closing_bank_minor: 404975, closing_books_minor: 111111, difference_minor: 0 }));
  check('BA-F-07 bank 4,049.75 / books 1,111.11 / difference 0 is refused 409 BANK_FIGURES_DONT_ADD in words, nothing stored', a.status === 409 && a.json.code === 'BANK_FIGURES_DONT_ADD' && /do not add up/.test(a.text) && stored() === 0, [a.status, a.text.slice(0, 260)]);
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, STMT, { closing_bank_minor: 404975, closing_books_minor: 111111, exceptions_minor: 293864, difference_minor: 0 }));
  check('BA-F-07 the same bank and books with 2,938.64 of listed items add up: stored, tied', a.status === 201 && stored() === 1 && tiedStored() === true, [a.status, a.text.slice(0, 200)]);
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, STMT, { closing_bank_minor: 111111, closing_books_minor: 111111, difference_minor: 0 }));
  check('BA-F-07 equal figures, no items, difference 0: stored, tied', a.status === 201 && stored() === 1 && tiedStored() === true, [a.status, a.text.slice(0, 160)]);
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, STMT, { closing_bank_minor: 110000, closing_books_minor: 111111, difference_minor: -1111 }));
  check('BA-F-07 a true unexplained remainder (bank 1,100.00, books 1,111.11, -11.11) is stored and NOT tied', a.status === 201 && stored() === 1 && tiedStored() === false, [a.status, a.text.slice(0, 160)]);
  a = await play('POST', '/api/books/bank/statements', Object.assign({}, STMT, { period_to: '2099-12-31', closing_bank_minor: 111111, closing_books_minor: 111111, difference_minor: 0 }));
  check('BA-F-07 a period ending in 2099 is refused 400, nothing stored', a.status === 400 && stored() === 0, [a.status, a.text.slice(0, 160)]);

  /* BA-F-01 */
  const posted = [
    { entry_id: 'e1', entry_no: 'JV-1', source_ref: 'manual:bank:' + 'a'.repeat(24) + '-1', posting_date: '2026-04-10', total_minor: 500000, currency: 'INR', reversed: true },
    { entry_id: 'e2', entry_no: 'JV-2', source_ref: 'manual:bank:' + 'b'.repeat(24) + '-2', posting_date: '2026-04-11', total_minor: 1000, currency: 'INR', reversed: false }
  ];
  const exc = LOG.exceptionsOf(posted, []);
  check('BA-F-01 a reversed bank entry is not an exception; the live one still is', exc.length === 1 && exc[0].entry_no === 'JV-2', exc.map((x) => x.entry_no));
  const dup = require(path.join(HERE, 'lib', 'books-duplicate.js')).answerOf({ entry_id: 'e1', entry_no: 'JV-1', reversal_entry_no: 'JV-9' }, '2026-04-10');
  check('BA-F-01 a re-sent ref whose entry was reversed answers duplicate AND reversed:true with the reversal and words', dup && dup.duplicate === true && dup.reversed === true && dup.reversal_entry_no === 'JV-9' && /reversed/.test(dup.note), dup);

  /* BA-F-05 the buyer's delivery on an order the seller rejected */
  let theirs = 'rejected';
  const mine = 'pending';
  const fake = {
    query: async (sql) => {
      if (/FROM chit_line WHERE/.test(sql)) return { rows: [{ line_id: 'L1', unit: 'piece' }] };
      if (/FROM chit_status/.test(sql)) return { rows: [{ current_status: mine }] };
      if (/chit_participants/.test(sql)) return { rows: [{ entity_id: 'me', current_status: mine }, { entity_id: 'them', current_status: theirs }] };
      return { rows: [], rowCount: 0 };
    }
  };
  require(path.join(HERE, 'db')).withEntity = async (e, fn) => fn(fake);
  delete require.cache[require.resolve(path.join(HERE, 'lib', 'deliverline.js'))];
  const DL = lib('deliverline');
  const tryDeliver = async () => {
    try {
      await DL.record('me', 'c1', [{ line_id: 'L1', quantity: 1, unit: 'piece' }], {});
      return { ok: true };
    } catch (e) {
      return { status: e.status, body: e.body, msg: e.message };
    }
  };
  let r = await tryDeliver();
  check('BA-F-05 the buyer delivering on an order the other side REJECTED is refused 409 wrong_step in words', r.status === 409 && r.body && r.body.why === 'wrong_step' && /rejected/.test(r.msg), r);
  theirs = 'cancelled';
  r = await tryDeliver();
  check('BA-F-05 the same when the other side CANCELLED it', r.status === 409 && r.body && r.body.why === 'wrong_step', r);
  theirs = 'accepted';
  r = await tryDeliver();
  check('BA-F-05 an order the other side accepted is not refused by this gate', !(r.status === 409 && r.body && r.body.why === 'wrong_step'), r);

  server.close();
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 4).join(' | ') : failure));
  process.exit(1);
});

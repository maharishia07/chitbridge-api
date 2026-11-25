#!/usr/bin/env node
// @type: unit
/**
 * tests/l16-statement-box.test.cjs — the STATEMENTS BOX (l16, W15-51, b872): a bank statement kept against an account and a period. No database: the writer runs on a scripted handle and a stubbed storage adapter.
 *   · the ONE hash: sha256 of the UTF-8 text (BOM and CRLF kept), the same as the page's bkbHash (TextEncoder + SubtleCrypto); a mismatch is refused before any byte is stored
 *   · a file type outside csv/json/txt, a NUL byte, over 6 MB, no period, a period that ends before it starts, no currency, another currency than the account's, a body naming who or when: each refused in words
 *   · duplicate (same account + same hash) is refused and nothing is stored; a crossing period is stored with overlaps: true and the words say so; a 20 Oct to 20 Nov file fills BOTH months of the grid
 *   · the grant doors: owner (no header, untouched), adviser (list, download, add), auditor (list and download, never add), an ended grant refused for every role
 * The database half (RLS, the unique index, the insert-only trigger) is run on a real database by the CI integration job and on SIT.
 * OWNS      the offline checks of lib/bank-statement-file.js and the Statements box's doors in middleware/books-grant.js.   CALLED BY scripts/guards.cjs (CI guards job).   CARD  16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'l16_statement_box_test_secret_at_least_32_chars';
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const API = path.join(__dirname, '..');
let fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400)); }
};

const BSF = require(path.join(API, 'lib', 'bank-statement-file.js'));
const storage = require(path.join(API, 'lib', 'storage.js'));
const schema = require(path.join(API, 'lib', 'schema.js'));
const A = require(path.join(API, 'middleware', 'books-grant.js'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const contract = require(path.join(API, 'lib', 'books-contract.js'));

const ENTITY = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = { account_id: '44444444-4444-4444-8444-444444444444', code: '1020', name: 'CBA Business' };
const TEXT = '﻿Date,Description,Debit,Credit\r\n2026-10-01,Opening,,100.00\r\n';
const hex = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const body = (extra) => Object.assign({ account: '1020', label: '..1234', period_from: '2026-10-01', period_to: '2026-10-31', currency: 'AUD', sha256: hex(TEXT), name: 'oct.csv', text: TEXT }, extra || {});

/** a scripted database handle: answers by the SQL's own words, records every INSERT */
function fakeShop(options) {
  const opt = Object.assign({ existing: [], migrated: true }, options || {});
  const inserted = [], events = [], put = [];
  schema.hasTable = async () => opt.migrated;
  storage.putForParticipants = async (file) => { put.push(file); return '55555555-5555-4555-8555-555555555555'; };
  const db = {
    async query(sql, params) {
      if (/INSERT INTO bank_statement_file_event/.test(sql)) { events.push(params); return { rows: [] }; }
      if (/INSERT INTO bank_statement_file /.test(sql)) {
        const row = { id: '66666666-6666-4666-8666-666666666666', account_id: params[1], label: params[2], period_from: params[3], period_to: params[4], currency: params[5], name: params[8], size: params[9], mime: params[10], kind: 'bank_statement', source: params[11], overlaps: params[12], by_user: params[13], by_name: params[14], by_firm: params[15], grant_id: params[16], created_at: new Date().toISOString() };
        inserted.push(row);
        return { rows: [row] };
      }
      if (/SELECT label FROM bank_statement_file/.test(sql)) return { rows: opt.existing.filter((item) => item.label).slice(0, 1).map((item) => ({ label: item.label })) };
      if (/FROM bank_statement_file WHERE entity_id = \$1 AND account_id = \$2 AND \(sha256/.test(sql)) {
        const [, , sha, from, to] = params;
        return { rows: opt.existing.filter((item) => item.sha256 === sha || (item.period_from <= to && item.period_to >= from)).map((item) => Object.assign({}, item, { same: item.sha256 === sha })) };
      }
      return { rows: [] };
    }
  };
  return { withEntity: async (entity, fn) => fn(db), inserted, events, put };
}
const earlier = (extra) => Object.assign({ id: '77777777-7777-4777-8777-777777777777', sha256: 'a'.repeat(64), period_from: '2026-10-15', period_to: '2026-11-05', name: 'old.csv', label: '..1234' }, extra || {});
const by = { user: '22222222-2222-4222-8222-222222222222', name: 'Sam', firm: null, grant_id: null };
const refused = (code) => (err) => err.statementBox === true && err.code === code;

(async () => {
  console.log('\nl16 · the Statements box (offline)');

  await t('ONE hash: sha256 of the UTF-8 text, BOM and CRLF kept, the same as the page (TextEncoder + SubtleCrypto)', async () => {
    const page = Buffer.from(await crypto.webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(TEXT))).toString('hex');
    assert.strictEqual(BSF.hashOf(TEXT), page);
    assert.notStrictEqual(BSF.hashOf(TEXT), BSF.hashOf(TEXT.replace(/\r\n/g, '\n')), 'a CRLF file is not its LF twin');
  });
  await t('a good body reads whole: the bytes are the text, the type from the extension, the currency the books\'', () => {
    const got = BSF.validate(body(), 'AUD');
    assert.strictEqual(got.mime, 'text/csv');
    assert.strictEqual(got.buffer.toString('utf8'), TEXT);
    assert.strictEqual(got.from, '2026-10-01');
    assert.strictEqual(got.label, '..1234');
  });
  await t('hash mismatch: refused in words, before any byte is stored', async () => {
    const shop = fakeShop();
    await assert.rejects(() => BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body({ sha256: 'b'.repeat(64) }), by), refused('HASH_MISMATCH'));
    await assert.rejects(() => BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body({ text: TEXT + 'x' }), by), refused('HASH_MISMATCH'));
    assert.strictEqual(shop.put.length + shop.inserted.length, 0);
  });
  await t('type, size, empty and NUL are refused in shopkeeper words', () => {
    assert.throws(() => BSF.validate(body({ name: 'oct.pdf' }), 'AUD'), refused('FILE_TYPE_NOT_KEPT'));
    assert.throws(() => BSF.validate(body({ name: 'oct' }), 'AUD'), refused('FILE_TYPE_NOT_KEPT'));
    assert.throws(() => BSF.validate(body({ text: '' }), 'AUD'), refused('FILE_EMPTY'));
    const nul = 'a\u0000b';
    assert.throws(() => BSF.validate(body({ text: nul, sha256: hex(nul) }), 'AUD'), refused('FILE_TYPE_NOT_KEPT'));
    const big = 'a'.repeat(6 * 1024 * 1024 + 1);
    assert.throws(() => BSF.validate(body({ text: big, sha256: hex(big) }), 'AUD'), (err) => err.code === 'FILE_TOO_LARGE' && err.status === 413 && /6 MB/.test(err.message));
    const edge = 'a'.repeat(6 * 1024 * 1024);
    assert.doesNotThrow(() => BSF.validate(body({ text: edge, sha256: hex(edge) }), 'AUD'), 'exactly 6 MB is kept');
  });
  await t('no period, an impossible day, or a period that ends before it starts: asked for, never guessed', () => {
    assert.throws(() => BSF.validate(body({ period_from: undefined }), 'AUD'), refused('PERIOD_NEEDED'));
    assert.throws(() => BSF.validate(body({ period_to: '2026-02-30' }), 'AUD'), refused('PERIOD_NEEDED'));
    assert.throws(() => BSF.validate(body({ period_from: '2026-11-01', period_to: '2026-10-01' }), 'AUD'), refused('PERIOD_NEEDED'));
  });
  await t('currency: none is asked for; another than the account\'s is refused with a sentence (409), nothing stored', async () => {
    assert.throws(() => BSF.validate(body({ currency: '' }), 'AUD'), refused('CURRENCY_NEEDED'));
    const shop = fakeShop();
    await assert.rejects(() => BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body({ currency: 'nzd' }), by), (err) => err.code === 'CURRENCY_MISMATCH' && err.status === 409 && /NZD but the account is kept in AUD/.test(err.message));
    assert.strictEqual(shop.put.length + shop.inserted.length, 0);
  });
  await t('a body that names who, when, the source or the kind is refused, not ignored', () => {
    for (const key of ['by', 'at', 'source', 'kind', 'by_user', 'created_at']) assert.throws(() => BSF.validate(body({ [key]: 'x' }), 'AUD'), refused('UNKNOWN_FIELD'), key);
  });
  await t('a first file is kept: bytes through the ONE adapter, one row, its added event, the server\'s stamp', async () => {
    const shop = fakeShop();
    const out = await BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body(), by);
    assert.strictEqual(shop.put.length, 1);
    assert.deepStrictEqual(shop.put[0].participants, [ENTITY]);
    assert.strictEqual(shop.put[0].buffer.toString('utf8'), TEXT);
    assert.strictEqual(shop.inserted.length, 1);
    assert.strictEqual(shop.inserted[0].source, 'owner');
    assert.strictEqual(shop.events.length, 1);
    assert.strictEqual(shop.events[0][2], 'added');
    assert.deepStrictEqual(out.overlaps, []);
    assert.strictEqual(out.file.overlaps, false);
    assert.strictEqual('sha256' in out.file || 'attachment_id' in out.file, false, 'no hash and no storage id leave the server');
  });
  await t('an adviser\'s file is stamped adviser with the person, the firm and the grant', async () => {
    const shop = fakeShop();
    const out = await BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body(), { user: by.user, name: 'Ada', firm: 'Bayside', grant_id: '88888888-8888-4888-8888-888888888888' });
    assert.strictEqual(shop.inserted[0].source, 'adviser');
    assert.strictEqual(out.file.by_firm, 'Bayside');
    assert.strictEqual(out.file.for_client, true);
  });
  await t('DUPLICATE: the same file on the same account is refused "already in the box", nothing stored', async () => {
    const shop = fakeShop({ existing: [earlier({ sha256: hex(TEXT), period_from: '2026-10-01', period_to: '2026-10-31' })] });
    await assert.rejects(() => BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body(), by), (err) => err.code === 'ALREADY_IN_BOX' && err.status === 409 && /Already in the box/.test(err.message));
    assert.strictEqual(shop.put.length + shop.inserted.length, 0, 'no bytes, no row');
  });
  await t('OVERLAP: dates that cross are stored with the flag, and the answer says so', async () => {
    const shop = fakeShop({ existing: [earlier()] });
    const out = await BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body(), by);
    assert.strictEqual(out.file.overlaps, true);
    assert.strictEqual(shop.inserted[0].overlaps, true);
    assert.strictEqual(out.overlaps.length, 1);
    assert.match(out.words, /overlaps 1 other statement/);
    assert.match(out.words, /15 Oct 2026 to 5 Nov 2026/);
  });
  await t('a file that only touches by a month label is NOT an overlap: dates decide (1 to 14 Oct, then 15 to 31 Oct)', async () => {
    const shop = fakeShop({ existing: [earlier({ period_from: '2026-10-01', period_to: '2026-10-14' })] });
    const out = await BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body({ period_from: '2026-10-15' }), by);
    assert.strictEqual(out.file.overlaps, false);
  });
  await t('the label is the owner\'s own, typed once: an empty one reuses the account\'s last, never a guess', async () => {
    const shop = fakeShop({ existing: [earlier({ period_from: '2026-08-01', period_to: '2026-08-31', label: '..9876' })] });
    const out = await BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body({ label: '' }), by);
    assert.strictEqual(out.file.label, '..9876');
    const none = fakeShop();
    assert.strictEqual((await BSF.add(none.withEntity, ENTITY, ACCOUNT, 'AUD', body({ label: '' }), by)).file.label, null);
  });
  await t('not migrated (b872 not run): 503 in words, nothing stored, never a 500', async () => {
    const shop = fakeShop({ migrated: false });
    await assert.rejects(() => BSF.add(shop.withEntity, ENTITY, ACCOUNT, 'AUD', body(), by), (err) => err.code === 'BOOKS_NOT_MIGRATED' && err.status === 503 && /arrives after the next update/.test(err.message) && !/b872/.test(err.message));
    assert.strictEqual(shop.put.length, 0);
  });
  await t('the grid: a month with no file reads missing; a 20 Oct to 20 Nov file fills BOTH months; each account its own row', () => {
    const months = BSF.monthsUpTo('2026-11', 3);
    assert.deepStrictEqual(months, ['2026-09', '2026-10', '2026-11']);
    const other = { account_id: '99999999-9999-4999-8999-999999999999' };
    const files = [{ id: 'f1', account_id: ACCOUNT.account_id, period_from: '2026-10-20', period_to: '2026-11-20' }];
    const grid = BSF.cells([ACCOUNT, other], files, months);
    const at = (account, month) => grid.find((cell) => cell.account_id === account.account_id && cell.month === month);
    assert.strictEqual(at(ACCOUNT, '2026-09').missing, true);
    assert.deepStrictEqual([at(ACCOUNT, '2026-10').missing, at(ACCOUNT, '2026-11').missing], [false, false]);
    assert.deepStrictEqual(at(ACCOUNT, '2026-10').file_ids, ['f1']);
    assert.strictEqual(at(other, '2026-10').missing, true, 'another account\'s gap is not filled by this one');
    assert.deepStrictEqual(BSF.monthsUpTo('2026-02', 3), ['2025-12', '2026-01', '2026-02'], 'across a year end');
    assert.deepStrictEqual(BSF.monthBounds('2028-02'), { first: '2028-02-01', last: '2028-02-29' }, 'a leap February');
  });
  await t('the window: 6 months ending this month by default; 1 to 24 only; a bad month is a sentence', () => {
    assert.strictEqual(BSF.windowOf({}, '2026-11-15').length, 6);
    assert.strictEqual(BSF.windowOf({}, '2026-11-15')[5], '2026-11');
    assert.strictEqual(BSF.windowOf({ months: '24', to: '2026-06' }).length, 24);
    assert.throws(() => BSF.windowOf({ months: '25' }, '2026-11-15'), refused('MONTHS_INVALID'));
    assert.throws(() => BSF.windowOf({ to: '2026-13' }, '2026-11-15'), refused('MONTH_INVALID'));
  });
  await t('the list: the page\'s own accounts, plus an account that holds files but left the list; two reads', async () => {
    const files = [{ id: '1', account_id: 'gone', label: '..1', period_from: '2026-10-01', period_to: '2026-10-31', currency: 'AUD', name: 'a.csv', size: 5, mime: 'text/csv', kind: 'bank_statement', source: 'owner', overlaps: false, created_at: 'x' }];
    let reads = 0;
    schema.hasTable = async () => true;
    const db = { async query(sql) { reads++; return /bank_statement_file_event/.test(sql) ? { rows: [{ file_id: '1', reads: '2', read_at: 'y' }] } : { rows: files }; } };
    const out = await BSF.list(db, ENTITY, { accounts: [ACCOUNT], chart: [], months: ['2026-10', '2026-11'] });
    assert.strictEqual(reads, 2);
    assert.deepStrictEqual(out.accounts.map((item) => item.account_id), [ACCOUNT.account_id, 'gone']);
    assert.strictEqual(out.files[0].reads, 2);
    assert.strictEqual(out.cells.find((cell) => cell.account_id === 'gone' && cell.month === '2026-10').missing, false);
    assert.strictEqual(out.older, 0);
  });

  /* ── the grant doors (ACC-176 / 176b), offline ── */
  const row = (preset, over) => Object.assign({ preset, revoked_at: null, unexpired: true, edge_live: true }, over || {});
  const FILE_PATH = '/bank/statement-files/3f2c9e1a-1111-4222-8333-444455556666/file';
  await t('classification: the list is an open read (auditor list), the download is a FILE read (an adviser grant only, MONEY-01 A6), the add is an adviser door, and all three are real routes of the books router', () => {
    const books = require(path.join(API, 'routes', 'books.js'));
    const routes = books.stack.filter((layer) => layer.route).map((layer) => Object.keys(layer.route.methods).map((method) => method.toUpperCase() + ' ' + layer.route.path)).flat();
    for (const door of ['GET /bank/statement-files', 'GET /bank/statement-files/:id/file', 'POST /bank/statement-files']) assert.ok(routes.includes(door), door + ' is a route');
    assert.ok(A.GRANT_READS.has('/bank/statement-files') && !A.GRANT_READS.has('/bank/statement-files/:id/file') && A.FILE_READS.has('/bank/statement-files/:id/file'));
    assert.deepStrictEqual(A.unclassifiedGets(books), []);
    assert.strictEqual(A.adviserDoor('POST', '/api/books/bank/statement-files'), 'POST /api/books/bank/statement-files');
    assert.strictEqual(A.adviserDoor('POST', '/api/books/bank/statement-files/3f2c9e1a-1111-4222-8333-444455556666/file'), null, 'no other write under the box');
    assert.strictEqual(A.listedPattern(FILE_PATH), null, 'a file download is not on the auditor list');
    assert.strictEqual(A.routeForLog('GET', FILE_PATH), 'GET /bank/statement-files/:id/file', 'the grant log names the pattern, never an id');
  });
  await t('AUDITOR: lists under a live grant, the file download is not listed for it (A6); adding is refused read-only; the rail stays held back', () => {
    assert.strictEqual(grants.verdictOf(row('auditor'), { method: 'GET', listed: A.listedPattern('/bank/statement-files') !== null }), 'allowed');
    assert.strictEqual(grants.verdictOf(row('auditor'), { method: 'GET', listed: A.listedFor('auditor', { method: 'GET', path: FILE_PATH, baseUrl: '/api/books' }) }), 'not_listed', 'MONEY-01 A6: no auditor download of a kept statement');
    assert.strictEqual(grants.verdictOf(row('auditor'), { method: 'POST', listed: true }), 'read_only');
    assert.strictEqual(A.listedPattern('/bank/log'), '/bank/log', 'W15-71: the bank log is the auditor read too (marks, who matched, signed months)');
    assert.strictEqual(A.listedPattern('/bank/rail'), null, 'the rail (party and bank details) stays held back');
  });
  await t('ADVISER: lists, downloads and adds under a live grant; any other POST is not listed', () => {
    assert.strictEqual(grants.verdictOf(row('adviser'), { method: 'POST', listed: A.adviserDoor('POST', '/api/books/bank/statement-files') !== null }), 'allowed');
    assert.strictEqual(grants.verdictOf(row('adviser'), { method: 'GET', listed: A.listedFor('adviser', { method: 'GET', path: FILE_PATH, baseUrl: '/api/books' }) }), 'allowed');
    assert.strictEqual(grants.verdictOf(row('adviser'), { method: 'POST', listed: A.adviserDoor('POST', '/api/books/entries') !== null }), 'not_listed');
  });
  await t('ENDED GRANT: revoked, expired or the edge off, the next request is refused for every role and every box door', () => {
    for (const preset of ['auditor', 'adviser']) {
      for (const ended of [{ revoked_at: new Date() }, { unexpired: false }, { edge_live: false }]) {
        for (const method of ['GET', 'POST']) assert.notStrictEqual(grants.verdictOf(row(preset, ended), { method, listed: true }), 'allowed', preset + ' ' + method + ' ' + JSON.stringify(ended));
      }
    }
    assert.strictEqual(grants.verdictOf(null, { method: 'GET', listed: true }), 'no_grant');
  });
  await t('OWNER: no header, the grant front does nothing (the owner\'s own door), and the box doors take no API key', () => {
    let called = false;
    A.frontOf(() => assert.fail('auth must not run'))({ headers: {} }, {}, () => { called = true; });
    assert.ok(called);
    for (const route of ['POST /bank/statement-files', 'GET /bank/statement-files', 'GET /bank/statement-files/:id/file']) assert.ok(contract.operationFor(route), route + ' has its contract operation');
    assert.ok(contract.ROUTES['POST /bank/statement-files'].gates.includes('noKey'));
  });
  await t('the consent words say what an auditor can read, from the same list the guard allows (the list, not the file: A6)', () => {
    const { READS_IN_WORDS } = require(path.join(API, 'lib', 'books-grants-contract.js'));
    for (const route of ['/bank/statement-files']) { assert.ok(A.GRANT_READS.has(route) && READS_IN_WORDS[route], route + ' has its plain words'); assert.match(READS_IN_WORDS[route], /Statements box/); }
    assert.ok(!READS_IN_WORDS['/bank/statement-files/:id/file'], 'the download is no auditor read, so it has no words in the auditor list');
  });
  await t('the download is served by the ONE sender: nosniff, a download for a csv, never cached', () => {
    const headers = {};
    const res = { setHeader: (name, value) => { headers[name] = value; }, send() {} };
    require(path.join(API, 'lib', 'attachment-send.js')).sendBlob(res, { name: 'oct.csv', mime: 'text/csv', data: Buffer.from(TEXT) }, { cache: 'private, no-store' });
    assert.strictEqual(headers['X-Content-Type-Options'], 'nosniff');
    assert.strictEqual(headers['Cache-Control'], 'private, no-store');
    assert.match(headers['Content-Disposition'], /^attachment;/);
    assert.strictEqual(headers['Content-Type'], 'application/octet-stream');
  });
  await t('the migration: insert-only, forced RLS with an entity policy, unique per account and hash, NOT NULL period and hash', () => {
    const sql = require('fs').readFileSync(path.join(API, 'migrations', 'b872_bank_statement_file.sql'), 'utf8');
    for (const needle of ['FORCE ROW LEVEL SECURITY', 'bank_statement_file_once ON bank_statement_file (entity_id, account_id, sha256)', 'period_from    date        NOT NULL', 'sha256         text        NOT NULL', 'books_insert_only', 'GRANT SELECT ON bank_statement_file TO cb_backup', 'GRANT SELECT, INSERT ON bank_statement_file TO cb_app', "source         text        NOT NULL CHECK (source IN ('owner', 'adviser', 'feed'))"]) assert.ok(sql.includes(needle), needle);
    assert.ok(!/GRANT[^;]*(UPDATE|DELETE)[^;]*TO cb_app/.test(sql), 'cb_app never gets UPDATE or DELETE');
  });

  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();

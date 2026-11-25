/**
 * am-bank-twice.test.cjs - AM-F-04 / AM-F-05 (walk AM, UAE, 21 Nov 2026; batch 1129 fixAM): a bank statement sign-off.
 * AM-F-04: the same statement (account + period + file hash) signed again with the same carried figures is refused 409 STATEMENT_ALREADY_SIGNED, nothing stored; new books figures are a re-sign (a new row).
 * AM-F-05: a period end inside a LOCKED month is refused by the entries' own rule (books.postingDateFor, strict): 409-class PERIOD_LOCKED, nothing stored; an open month signs.
 * Break check: drop the mustBeNew call in lib/bank-rec-log.appendStatement and case 2 fails; drop mustBeOpen and case 4 fails.
 * Run: node tests/am-bank-twice.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const path = require('path'), assert = require('assert');
const HERE = path.join(__dirname, '..');
const lib = (n) => require(path.join(HERE, 'lib', n + '.js'));
const BRL = lib('bank-rec-log'), B = lib('books'), schema = lib('schema'), store = lib('books-store');
const E = { SHOP: '11111111-1111-4111-8111-111111111111', ACC: '22222222-2222-4222-8222-222222222222' };
const ACCOUNT = { account_id: E.ACC, code: '1510', name: 'Bank', role: 'bank', is_group: false };
const SETTING = { entity_id: E.SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 1, functional_currency: 'AED', country: 'AE', pack_version: '1', timezone: 'Asia/Dubai' };
schema.hasTable = async () => true; schema.hasColumn = async () => true;
B.settingOf = async () => SETTING;
B.ledgerCtx = async () => ({ s: SETTING, pack: B.packOf(SETTING), chart: [ACCOUNT] });
B.trialBalance = async () => ({ rows: [{ code: '1510', debit_minor: 150000, credit_minor: 0 }] });
let LOCKED = []; /* the month numbers that are hard-locked in the shop's year */
store.periods = async (db, e, fy) => { const rows = [{ fiscal_year: fy, period: 0, status: 'open' }]; for (let p = 1; p <= 12; p++) rows.push({ fiscal_year: fy, period: p, status: LOCKED.includes(p) ? 'hard_locked' : 'open', start_date: fy + '-' + String(p).padStart(2, '0') + '-01', end_date: fy + '-' + String(p).padStart(2, '0') + '-28' }); return rows; };
const rows = [];
const db = { async query(sql, args) {
  if (/^\s*INSERT INTO bank_rec_log/.test(sql)) { const row = { seq: String(rows.length + 1), kind: 'statement', entity_id: args[0], account_id: args[1], file_hash: args[2], period_from: args[3], period_to: args[4], opening_minor: String(args[5]), closing_bank_minor: String(args[6]), closing_books_minor: String(args[7]), difference_minor: String(args[8]), currency: args[9], tied: args[10], made_by: args[11], made_at: '2026-11-22T10:00:00.000Z' }; rows.push(row); return { rows: [row] }; }
  if (/FROM bank_rec_log WHERE .* file_hash = \$3/.test(sql)) return { rows: rows.filter((r) => r.entity_id === args[0] && r.account_id === args[1] && r.file_hash === args[2] && r.period_from === args[3] && r.period_to === args[4] && Number(r.closing_bank_minor) === Number(args[5]) && Number(r.closing_books_minor) === Number(args[6])).map((r) => ({ seq: r.seq })) };
  if (/FROM identities/.test(sql)) return { rows: [] };
  if (/FROM information_schema|pg_/.test(sql)) return { rows: [] };
  throw new Error('unexpected: ' + sql.slice(0, 90));
} };
const sheet = { period_from: '2026-09-01', period_to: '2026-09-30', opening_minor: 100000, closing_bank_minor: 150000, closing_books_minor: 150000, difference_minor: 0, currency: 'AED', file_hash: 'abc123' };
const sign = (over) => BRL.appendStatement(db, E.SHOP, ACCOUNT, 'AED', Object.assign({}, sheet, over || {}), E.SHOP);
const refused = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };
let n = 0; const ok = async (what, fn) => { await fn(); n++; console.log('  ok  ' + what); };
(async () => {
  await ok('1 a first sign-off is stored', async () => { const got = await sign(); assert.strictEqual(got.tied, true); assert.strictEqual(rows.length, 1); });
  await ok('2 the same statement again (same account, period, hash, figures) is refused STATEMENT_ALREADY_SIGNED 409, nothing stored', async () => {
    const err = await refused(() => sign());
    assert.ok(err && err.code === 'STATEMENT_ALREADY_SIGNED' && err.status === 409, err && err.code);
    assert.ok(/already signed off/.test(err.message)); assert.strictEqual(rows.length, 1);
  });
  await ok('3 another file (hash) or another period is another statement: signs', async () => {
    await sign({ file_hash: 'zzz999' }); await sign({ period_from: '2026-09-02' }); assert.strictEqual(rows.length, 3);
  });
  await ok('4 a month the books hold hard-locked refuses by the entries\' rule (PERIOD_LOCKED), nothing stored; an open month signs', async () => {
    LOCKED = [10];
    const before = rows.length;
    const err = await refused(() => sign({ period_from: '2026-10-01', period_to: '2026-10-31', file_hash: 'oct' }));
    assert.ok(err && err.code === 'PERIOD_LOCKED', err && (err.code || err.message)); assert.strictEqual(rows.length, before);
    await sign({ file_hash: 'nov-b' }); assert.strictEqual(rows.length, before + 1);
  });
  await ok('5 the route maps the new code to 409 in words', () => {
    const src = require('fs').readFileSync(path.join(HERE, 'routes', 'books.js'), 'utf8');
    assert.ok(/STATEMENT_FAULT_STATUS = \{[^}]*STATEMENT_ALREADY_SIGNED: 409/.test(src) && /const fault = statementFault\(err\);\s+if \(fault\) return problem\(req, res, fault\)/.test(src));
  });
  console.log('\n  ' + n + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });

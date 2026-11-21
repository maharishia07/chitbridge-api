'use strict';
/**
 * tests/samecount-opening.test.cjs - SAMECOUNT A-F-39: the year strip's "opening" is the SAME total as the opening entry and the trial balance.
 * The ledger keeps both grains of a balance (account, and account+party); a total over both counted a debtor's 1,100 twice: 7,500 over a 6,400 entry.
 * Offline. Run: node tests/samecount-opening.test.cjs
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const row = (code, dr, cr, party) => ({ fiscal_year: '2026-27', period: 0, code, party: party || null, dr_minor: dr, cr_minor: cr });
/* the opening entry: bank 5,300 + debtors 1,100 (Dr 6,400) = creditors 660 + capital 5,740 (Cr 6,400); debtors and creditors also kept per party */
const balances = [row('1510', 530000, 0), row('1200', 110000, 0), row('1200', 110000, 0, 'P1'), row('2000', 0, 66000), row('2000', 0, 66000, 'S1'), row('3000', 0, 574000)];
const real = require('../lib/books.js');
stub('lib/books', Object.assign({}, real, {
  ledgerCtx: async () => ({ pack: { currency: 'AUD' }, chart: [], years: ['2026-27'] }),
  yearBalances: async () => balances,
  carryOut: async () => ({ ok: true, rows: balances.map((r) => Object.assign({}, r)), retained_minor: 0, profit_minor: 0 })
}));
const Opening = require('../lib/books-opening.js');
(async () => {
  const year = (await Opening.yearsView({}, 'e1')).years[0];
  const entryDebits = balances.filter((r) => !r.party).reduce((t, r) => t + r.dr_minor, 0);
  assert.strictEqual(entryDebits, 640000);
  assert.strictEqual(year.opening_minor, entryDebits);
  assert.strictEqual(year.closing_minor, entryDebits);
  console.log('  ok  the year strip opening and closing = the account-grain debit total 6,400.00 (not 7,500.00)');
})().catch((e) => { console.log('  FAIL ' + e.message); process.exit(1); });

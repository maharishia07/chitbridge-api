/**
 * one-figure-money-roles.test.cjs — ONE-FIGURE RC9 (Athi 28 Nov 2026, batch 1141): the ledger roles that are money are listed ONCE (lib/money-roles.js).
 * The value is UNCHANGED: each consumer's list equals the list it carried before this change (golden, written from the code BEFORE it moved).
 * A hand-kept copy anywhere in lib/ routes/ (a quoted 'cash' list with upi and card, in any order) fails; SCAN_SELFTEST=1 plants one and must fail.
 * A hand-kept copy is refused by the build (it fails closed); a role outside the lists is never summed as money.
 * Run: node tests/one-figure-money-roles.test.cjs
 * OWNER cb-accounting · CALLS lib/money-roles
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const R = require(path.join(API, 'lib', 'money-roles'));
/* golden: the lists as the four owners carried them before (books-cashflow CASH_ROLES · books-store TENDER_ROLES · books-period-taxed MONEY_ROLES) */
ok('CASH_ROLES = cash bank upi card, in the order the cash-flow opening rows print them', JSON.stringify(R.CASH_ROLES) === JSON.stringify(['cash', 'bank', 'upi', 'card']), JSON.stringify(R.CASH_ROLES));
ok('TENDER_ROLES = the same four (as before: cash upi card bank)', sameSet(R.TENDER_ROLES, ['cash', 'upi', 'card', 'bank']));
ok('MONEY_ROLES = the four + bank_od (as before)', sameSet(R.MONEY_ROLES, ['bank', 'cash', 'card', 'upi', 'bank_od']) && R.MONEY_ROLES.length === 5);
ok('the overdraft is money for a tax settlement, never cash on hand', R.MONEY_ROLES.includes('bank_od') && !R.CASH_ROLES.includes('bank_od'));
ok('the lists cannot be changed at run time (frozen)', Object.isFrozen(R.CASH_ROLES) && Object.isFrozen(R.MONEY_ROLES));
const cash = require(path.join(API, 'lib', 'books-cashflow')).CASH_ROLES, taxed = require(path.join(API, 'lib', 'books-period-taxed')).MONEY_ROLES;
ok('books-cashflow, books-period-taxed read the owner (the same arrays)', cash === R.CASH_ROLES && taxed === R.MONEY_ROLES);
/* the scan: a quoted list holding cash AND (upi or card) AND bank, outside the owner */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const files = [];
const walk = (rel) => { const abs = path.join(API, rel); if (!fs.existsSync(abs)) return; for (const f of fs.readdirSync(abs)) { const r = rel + '/' + f; if (fs.statSync(path.join(API, r)).isDirectory()) { if (f !== 'node_modules') walk(r); } else if (f.endsWith('.js') && !/\.browser\.js$/.test(f)) files.push(r); } };
['lib', 'routes', 'middleware', 'src'].forEach(walk);
const listy = (text) => { const hits = []; const re = /\[[^\]\n]{0,120}\]/g; let m; while ((m = re.exec(text))) { const q = (m[0].match(/['"]([a-z_]+)['"]/g) || []).map((x) => x.slice(1, -1)); if (q.includes('cash') && q.includes('bank') && (q.includes('upi') || q.includes('card')) && q.length <= 6) hits.push(m[0]); } return hits; };
const hits = [];
for (const rel of files.concat(process.env.SCAN_SELFTEST ? ['selftest.js'] : [])) {
  if (rel === 'lib/money-roles.js') continue;
  const text = rel === 'selftest.js' ? "const X = ['cash', 'upi', 'card', 'bank'];" : strip(fs.readFileSync(path.join(API, rel), 'utf8'));
  listy(text).forEach((h) => hits.push(rel + ' ' + h));
}
/* the payment-mode word lists of other countries (reg-jp/reg-us: modes, not ledger roles) are the pack's own; they carry other words */
const real = hits.filter((h) => !/reg-(jp|us|au|ae|in|sg|my)\.js|chits-input\.js/.test(h));
ok('no hand-kept copy of the money roles outside lib/money-roles.js', real.length === 0, 'second list at ' + real.join(' | '));
/* mutation: a copy planted in a consumer is found by the same scan */
ok('the scan bites: a planted copy is found', listy("const roles = ['cash', 'upi', 'card', 'bank'];").length === 1);
console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);

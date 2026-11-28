/**
 * one-figure-gross.test.cjs - ONE-FIGURE RC8 (28 Nov 2026, drift exit): gross profit / gross margin has ONE definition (lib/books-report-period.js: grossOf for the P&L and the Overview, marginPctOf + salesRoleSql + costRoleSql for the practice statement).
 *  - golden margins by hand (rounding half away from zero, as the practice SQL did): 1000.00 sales / 600.00 cost = 40.0; 16.00 / 15.99 = 0.1; a 6.25 percent margin reads 6.3, a -6.25 one -6.3; no sale = no margin.
 *  - the P&L route (grossOf) and the practice margin tie: purchase returns on the income side or on the expense side give the same cost, the same percent.
 *  - the SQL tests say the same as the JS ones (sales prefix, cost list) and the practice statement is built from them; a second spelling of the sales test outside the owner fails (SCAN_SELFTEST=1 plants one).
 * Offline. Run: node tests/one-figure-gross.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const R = require(path.join(API, 'lib', 'books-report-period'));
ok('golden: 1000.00 sales, 600.00 cost = 40 percent', R.marginPctOf(100000, 60000) === 40);
ok('golden: 16.00 sales, 15.99 cost = 0.1 (0.0625 rounds up)', R.marginPctOf(1600, 1599) === 0.1);
ok('golden: a 6.25 percent margin reads 6.3, a -6.25 percent one reads -6.3 (half away from zero)', R.marginPctOf(1600, 1500) === 6.3 && R.marginPctOf(1600, 1700) === -6.3, [R.marginPctOf(1600, 1500), R.marginPctOf(1600, 1700)].join());
ok('no sale (zero, negative, none) is no margin, never 0', R.marginPctOf(0, 500) === null && R.marginPctOf(-5, 1) === null && R.marginPctOf(null, 1) === null);
const sales = (n) => ({ role: 'sales', amount_minor: n }), purchases = (n) => ({ role: 'purchases', amount_minor: n }), returns = (n) => ({ role: 'purchase_returns', amount_minor: n });
const incomeSide = R.grossOf([sales(100000), returns(5000)], [purchases(60000)], 'INR');
const expenseSide = R.grossOf([sales(100000)], [purchases(60000), returns(-5000)], 'INR');
ok('golden: sales 1000.00, purchases 600.00, returns 50.00 = gross profit 450.00 either side the returns sit', incomeSide.gross_profit_minor === 45000 && expenseSide.gross_profit_minor === 45000, JSON.stringify([incomeSide, expenseSide]));
ok('the P&L figures and the practice percent tie: 45 either way', R.marginPctOf(incomeSide.sales_minor, incomeSide.cost_of_sales_minor) === 45 && R.marginPctOf(expenseSide.sales_minor, expenseSide.cost_of_sales_minor) === 45);
// the SQL spelling is the same test as the JS one
const like = (fragment) => new RegExp('^' + fragment.split("LIKE '")[1].replace(/'$/, '').replace('%', '.*') + '$');
const roles = ['sales', 'sales_export', 'sales_returns', 'sales_gst_free', 'purchases', 'debtors', 'cash', 'purchase_returns', 'resales'];
ok('the SQL sales test and grossOf agree on every role (a role starts with the sales word)', roles.every((role) => like(R.salesRoleSql('x.role')).test(role) === role.startsWith(R.SALES_ROLE_PREFIX)));
const listed = (R.costRoleSql('x.role').match(/IN \((.*)\)/)[1]).replace(/'/g, '').split(',');
ok('the SQL cost test is the list grossOf subtracts (COST_OF_SALES_ROLES)', JSON.stringify(listed) === JSON.stringify(R.COST_OF_SALES_ROLES));
const practice = fs.readFileSync(path.join(API, 'lib', 'books-practice.js'), 'utf8');
ok('the practice statement is built from them (no typed sales test, no typed cost list, no own percent)', /salesRoleSql\('la\.role'\)/.test(practice) && /costRoleSql\('la\.role'\)/.test(practice) && !/LIKE 'sales/.test(practice) && !/round\(\(100\.0 \* \(s - c\)/.test(practice));
// the scan: no second spelling of the sales test outside the owner (the books-store sold read is RC7's, a dated waiver)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const files = [];
const walk = (rel) => { const abs = path.join(API, rel); if (!fs.existsSync(abs)) return; for (const f of fs.readdirSync(abs)) { const r = rel + '/' + f; if (fs.statSync(path.join(API, r)).isDirectory()) { if (f !== 'node_modules') walk(r); } else if (f.endsWith('.js')) files.push(r); } };
['lib', 'routes', 'middleware', 'scripts', 'src'].forEach(walk);
const WAIVED = ['lib/books-report-period.js', 'lib/books-store.js' /* 2026-11-28: the SOLD read (RC7) keeps its own sales_ids until RC7 lands */, 'lib/tax-engine.browser.js'];
const SIGN = /LIKE\s+'sales%'|startsWith\(\s*['"]sales['"]\s*\)|\^sales/;
const hits = [];
files.concat(process.env.SCAN_SELFTEST ? ['selftest.js'] : []).forEach((rel) => {
  if (WAIVED.includes(rel) || /^lib\/reg-[a-z]+\.js$/.test(rel)) return;
  const text = rel === 'selftest.js' ? "const t = (r) => r.startsWith('sales');" : strip(fs.readFileSync(path.join(API, rel), 'utf8'));
  if (SIGN.test(text)) hits.push(rel);
});
ok('no second spelling of the sales-account test outside the owner (1 dated waiver: books-store, RC7)', hits.length === 0, 'second spelling in ' + hits.join(' '));
if (!process.env.ONE_FIGURE_INNER) ok('MUTATION: a planted second spelling turns the scan red', require('child_process').spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { SCAN_SELFTEST: '1', ONE_FIGURE_INNER: '1' }), encoding: 'utf8', windowsHide: true }).status === 1);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);

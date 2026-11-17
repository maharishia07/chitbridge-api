'use strict';
/* NEUTRAL CORE (2026-10-17) — web side. N0: an assumed (b299) country is said once and confirmed with one tap; the server refuses a document
   with no country or money, and the screens paint its sentence. Source-level plus the units in node (no browser). Run: node tests/neutral-core.test.cjs */
const fs = require('fs'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const read = (f) => fs.readFileSync(__dirname + '/../public/' + f, 'utf8');

const country = read('app/cap-country.js');
ok(country.includes('!(answer && answer.assumed)') && /data-testid="cs-assumed"/.test(country), 'N0: the Country setup screen says "assumed" once when the server says so');
ok(/data-testid="cs-confirm"[^>]*onclick="csuSave\(\)"/.test(country), 'N0: one tap (Confirm) saves the step, the same write as Save');
ok(/\(assumed\) — confirm or change/.test(country), 'N0: the sentence names the country and both ways out');


/* ── N1 · N2 · N4: the helpers, run as the page runs them (engines + helpers.js in one sandbox, no browser) ── */
const vm = require('vm');
const win = {}; const el0 = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} });
const sandbox = { window: win, console, setTimeout, clearTimeout, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el0, addEventListener() {}, body: el0(), head: el0() }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { language: 'en-IN' } };
sandbox.self = win; Object.assign(win, sandbox); sandbox.window = win;
const cx = vm.createContext(sandbox);
cx.window = cx; cx.self = cx; Object.keys(win).forEach((key) => { if (!(key in cx)) cx[key] = win[key]; });
for (const file of ['engine/money.js', 'engine/tax.js', 'engine/locale.js', 'app/helpers.js']) vm.runInContext(fs.readFileSync(__dirname + '/../public/' + file, 'utf8'), cx);
const run = (code) => vm.runInContext(code, cx);

/* myCur as the page defines it (app.html) */
const appHtml = fs.readFileSync(__dirname + '/../public/app.html', 'utf8');
const curLine = (appHtml.match(/^function myCur\(\)[\s\S]*?^\}/m) || [])[0];
ok(curLine && !/'INR'/.test(curLine) && /\|\| null/.test(curLine), 'N1: app.html myCur() ends in null, not INR');
run('var SESSION = {};' + curLine);

/* a shop that stated nothing */
ok(run('moneyCode()') === null, 'N1: no currency anywhere -> moneyCode() is null, not INR');
const bare = run('fmtMoney(1234567.5)');
ok(!/₹|INR|Rs/.test(bare) && bare === '1,234,567.50', 'N1: an amount with no money stated prints bare, plain grouping (' + bare + ')');
ok(run('fmtMoney("", null, "-")') === '-', 'N1: the empty marker still works');
ok(run('cbSumByCurrency([{ amt: 5 }])[0].currency') === '', 'N1: a row with no currency and no shop money is grouped under none, not INR');
/* N2: no pack is neutral */
ok(run('packSplitsByState()') === false && run('payHasUpi()') === false && run('packHasHsn()') === false, 'N2: no country, no pack -> no state split, no UPI, no HSN');
/* an India shop is unchanged */
run('SESSION.country = "IN"; SESSION.currency = "INR";');
ok(run('packSplitsByState()') === true && run('payHasUpi()') === true && run('packHasHsn()') === true, 'India shop: state split, UPI and HSN exactly as before');
ok(run('moneyCode()') === 'INR' && /₹/.test(run('fmtMoney(1234.5)')) && /₹/.test(run('fmtMoney(1234.5, "INR")')), 'India shop: money is INR and prints the rupee sign, as before');
ok(run('fmtMoney(123456.5, "INR")') === run('CBLocale.money(123456.5, "INR")') && run('fmtMoney(123456.5)') === run('CBLocale.money(123456.5, "INR")'), 'India shop: fmtMoney is CBLocale.money unchanged (lakh grouping)');
/* a border-pack shop */
run('SESSION.country = "AU"; SESSION.currency = "AUD";');
ok(run('packSplitsByState()') === false && run('payHasUpi()') === false && run('moneyCode()') === 'AUD', 'AU shop: no state split, no UPI, its own money');
ok(run('moneyCode("usd")') === 'USD', 'a row\'s own currency wins over the shop\'s');

/* N4: the books year starts where the setting or the pack says - no April of our own */
const books = fs.readFileSync(__dirname + '/../public/app/cap-books.js', 'utf8');
const startAt = books.indexOf('function bkYearStart()');
const yearFn = books.slice(startAt, books.indexOf('\n}', startAt) + 2);
ok(!/\|\|\s*4\b|:\s*4\b/.test(yearFn), 'N4: bkYearStart has no "|| 4" / ": 4" fallback');
const withYear = vm.createContext({ BK: { year: { start_month: 7 } }, shopReg: () => ({ fiscalYear: { startMonth: 4 } }) });
vm.runInContext('function bkFyPack(){ return shopReg(); }' + yearFn, withYear);
ok(vm.runInContext('bkYearStart()', withYear) === 7, 'N4: the books setting\'s start month wins');
vm.runInContext('BK.year = null', withYear); ok(vm.runInContext('bkYearStart()', withYear) === 4, 'N4: else the pack\'s fiscalYear.startMonth (India: 4)');
const noYear = vm.createContext({ BK: {}, shopReg: () => null }); vm.runInContext('function bkFyPack(){ return shopReg(); }' + yearFn, noYear);
ok(vm.runInContext('bkYearStart()', noYear) === 1, 'N4: neither known -> the calendar year (1), never April');

/* N1: the screens the sweep touched hold no INR fallback (read by literal path, so the module trace sees this test) */
const path = require('path');
const screens = {
  'cap-supplies.js': path.join(__dirname, '..', 'public', 'app', 'cap-supplies.js'),
  'cap-worklist.js': path.join(__dirname, '..', 'public', 'app', 'cap-worklist.js'),
  'cap-finance.js': path.join(__dirname, '..', 'public', 'app', 'cap-finance.js'),
  'cap-finance-pay.js': path.join(__dirname, '..', 'public', 'app', 'cap-finance-pay.js'),
  'cap-tasks.js': path.join(__dirname, '..', 'public', 'app', 'cap-tasks.js'),
  'cap-traceability.js': path.join(__dirname, '..', 'public', 'app', 'cap-traceability.js'),
};
for (const screen of Object.keys(screens)) {
  const text = fs.readFileSync(screens[screen], 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(!/'INR'/.test(text), 'N1: ' + screen + ' holds no INR fallback');
}

/* N1 (app.html, shop.html): the pay field, the UPI links and the currency list state no India */
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const shopSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'shop.html'), 'utf8');
ok(!appSource.includes('&cu=INR') && appSource.replace(/\s+/g, '').includes("'&cu='+encodeURIComponent(moneyCode()||'')"), 'N1: the UPI link carries the shop money, not a typed INR');
ok(!shopSource.includes('&cu=INR') && shopSource.includes('_SHOPDATA.shop.currency_code'), 'N1: the storefront UPI link carries the shop money, not a typed INR');
ok(appSource.replace(/\s+/g, '').includes("CBLocale.symbol(moneyCode()):'')}</b>"), 'N1: the pay-amount field shows the shop symbol, none when no money is stated (no rupee sign)');
ok(/\['CHF',\s*'Swiss Franc . 2dp'\]\s*\]\.sort\(/.test(appSource), 'N1: the currency list is sorted by code - none leads');

/* the ratchet itself */
const guard = require('child_process').spawnSync(process.execPath, [__dirname + '/../e2e/neutral-literals-guard.cjs'], { encoding: 'utf8' });
ok(guard.status === 0, 'N1: the literal ratchet passes (' + (guard.stdout || '').trim().split('\n').pop().trim() + ')');

console.log('\n' + n + ' checks');

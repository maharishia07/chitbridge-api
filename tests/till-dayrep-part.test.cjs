/**
 * till-dayrep-part.test.cjs — the day report's table builders (tools/tally-connector/till-dayrep.js) reach the counter on both hosts, and add up as issued.
 * OWNS      the part file's wiring (kit copy = web copy, served by the program, in the kit zip, on the offline service-worker shelf, loaded by the page before its main script) and its sums
 * CARD      02-counter-till/day-report
 * MIN       offline-sync-once · unit-per-rule
 * Offline: no database, no network. The web twin is read from CB_WEB_DIR (else ../chitbridge-web), as tests/till-vendor.test.js does.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const API = path.join(__dirname, '..');
const KIT = path.join(API, 'tools', 'tally-connector');
const WEB = process.env.CB_WEB_DIR ? path.resolve(process.env.CB_WEB_DIR, 'public') : path.join(API, '..', 'chitbridge-web', 'public');
const norm = (s) => s.replace(/\r\n/g, '\n');
const read = (f) => norm(fs.readFileSync(f, 'utf8'));
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('   ok   ' + name); };

console.log('\n== till-dayrep · wiring (offline: the file must be on the shelf and in the kit) ==\n');
const PART = 'tools/tally-connector/till-dayrep.js'; /* the whole path as one string: the trace reads it as "this test names the file" */
const part = read(path.join(API, PART));
t('the web copy is a byte copy of the kit master', () => assert.strictEqual(fs.existsSync(path.join(WEB, 'app', 'till-dayrep.js')) ? read(path.join(WEB, 'app', 'till-dayrep.js')) : '', part, 'run scripts/vendor-till.cjs'));
t('the program serves it at the web\'s own path and refreshes it with the kit', () => {
  const prog = read(path.join(KIT, 'till.js'));
  assert.ok(/'\/app\/till-dayrep\.js': \['till-dayrep\.js'/.test(prog), 'till.js does not serve /app/till-dayrep.js');
  assert.ok(/live: \[[^\]]*'till-dayrep\.js'/.test(prog), 'the kit update does not refresh it');
});
t('the kit zip carries it', () => assert.ok(/'till-dayrep\.js'/.test((read(path.join(API, 'routes', 'integrations.js')).match(/const KIT_NAMES = \[([^\]]*)\]/) || [])[1] || '')));
t('the offline shelf holds it (the service worker lists it, and the shelf was bumped)', () => {
  const sw = read(path.join(WEB, 'till-sw.js'));
  assert.ok(/'\/app\/till-dayrep\.js'/.test(sw) && /cb-till-v10/.test(sw));
});
t('the page loads it before its main script, with the missing-file hook', () => {
  const page = read(path.join(KIT, 'till.html'));
  assert.ok(/<script src="\/app\/till-dayrep\.js" onerror="engineMissed\('till-dayrep'\)">/.test(page));
  assert.ok(page.indexOf('/app/till-dayrep.js') < page.indexOf('function dayReportHTML('), 'the builders load after the page that calls them');
  assert.ok(!/function dayRep(Rows|Table|Summary|Foot)\(/.test(page), 'the page still holds a second copy');
});

console.log('\n== till-dayrep · the sums, as the bills were issued ==\n');
const ctx = vm.createContext({
  esc: (s) => String(s), money: (n) => 'Rs ' + n, rmoney: (n) => Math.round(n * 100) / 100, r2: (n) => Math.round(n * 100) / 100,
  hhmm: () => '10:00', bohniOf: () => null, schemeWord: () => 'GST', cbQuiet: () => {}, isReturnRow: (b) => !!(b && b.kind === 'credit_note'), window: {}
});
vm.runInContext(part, ctx);
t('1 bill / 2 bills: no table says "1 bills"', () => { assert.strictEqual(ctx.dayRepCount(1, 'bill', 'bills'), '1 bill'); assert.strictEqual(ctx.dayRepCount(2, 'bill', 'bills'), '2 bills'); });
t('items, rates and pay ways add up across bills, a way counted once per bill', () => {
  const bills = [
    { lines: [{ name: 'Tea', qty: 1, gross: 100, net: 95, save: 5, tax: 5 }], by_rate: { 5: { taxable: 95, tax: 5 } }, payments: [{ how: 'cash', amount: 50 }, { how: 'cash', amount: 50 }] },
    { lines: [{ name: 'Tea', qty: 2, gross: 200, net: 200, save: 0, tax: 10 }], by_rate: { 5: { taxable: 190, tax: 10 } }, payments: [{ how: 'upi', amount: 200 }] }
  ];
  const sums = ctx.dayRepRows(bills);
  assert.strictEqual(sums.items.Tea.qty, 3);
  assert.strictEqual(sums.items.Tea.net, 295);
  assert.strictEqual(sums.byRate[5].tax, 15);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sums.byPay)), { cash: 100, upi: 200 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sums.payBills)), { cash: 1, upi: 1 });
  assert.strictEqual(sums.byKind, null, 'no bill named a kind');
});
t('a table with no rows is empty, never an empty heading', () => assert.strictEqual(ctx.dayRepTable('Nothing', [{ label: 'a' }], []), ''));
console.log('\n' + pass + ' checks');

'use strict';
/* T2e, offline: M179 the age of an online order is right in every zone · M182 the shopper's typed name is the order's party.
   Run: node tests/t2e-orders.test.cjs   (TZ is forced to India inside, the zone where the 5½ h slip showed) */
process.env.TZ = 'Asia/Kolkata';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const till = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8');
const i = till.indexOf('function onlineOrderAge('); let d = 0, j = till.indexOf('{', i), end;
for (let k = j; k < till.length; k++) { if (till[k] === '{') d++; else if (till[k] === '}' && --d === 0) { end = k + 1; break; } }
const NOW = Date.parse('2026-10-10T12:00:00Z');
class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
const cx = vm.createContext({ Date: FakeDate, Math, isFinite }); vm.runInContext(till.slice(i, end), cx);
ok(cx.onlineOrderAge('2026-10-10T11:59:00.000Z') === '1 min', 'M179: an order placed a minute ago reads 1 min (instant with its zone, TZ=IST)');
ok(cx.onlineOrderAge('2026-10-10T09:00:00Z') === '3 h', 'M179: three hours ago reads 3 h');
ok(cx.onlineOrderAge('2026-10-10T11:59:00') === '6 h', 'M179: why the fix is at the source: a zone-less stamp read in IST reads "6 h" for a minute-old order (this is what the server must never send)');
const sel = fs.readFileSync(__dirname + '/../lib/select.js', 'utf8');
ok(/\(ch\.created_at AT TIME ZONE current_setting\('TimeZone'\)\) AS created_at/.test(sel), 'M179: the server pins created_at (timestamp without zone) to its session zone, so the JSON carries a real instant');
const oo = require('../lib/open-orders');
ok(oo.orderOf({ order_details: { channel: 'online', name: 'Priya (test)' } }).name === 'Priya (test)', 'M182: orderOf carries the name typed at checkout');
ok(oo.orderOf({ order_details: { channel: 'online' } }).name === null, 'M182: no typed name → null (the till falls back to the account name)');
const src = fs.readFileSync(__dirname + '/../lib/open-orders.js', 'utf8');
ok(/party: \(orderOf\(h\.summary_json\) \|\| \{\}\)\.name \|\| h\.counterparty_name/.test(src), 'M182: the task party is the typed name, else the account name');
ok(/_cname = _short\(req\.body && req\.body\.name, 80\)/.test(fs.readFileSync(__dirname + '/../routes/catalogue.js', 'utf8')), 'M182: the storefront stores the typed name in order_details');
console.log(n + ' passed'); process.exit(0);

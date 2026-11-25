'use strict';
/**
 * till-earlier-window-1130.test.cjs — FW-31 (walk 25 Nov): "Earlier bills · last 30 days" listed 12 bills dated Aug–Oct, because the
 * window cut on the row's STORE time (created_at) while every row prints the bill's own moment. The window, the order and the printed
 * date are now one moment: tax-copy POSTED_AT_SQL (the moment the books post at). Hand case: today 25 Nov; bill A billed 17 Nov, stored
 * 17 Nov → in 30 days; bill B billed 15 Aug, stored 20 Nov (seeded/late sync) → OUT of 30 days; both arms (page and withdrawn) agree.
 * Run: node tests/till-earlier-window-1130.test.cjs
 * CARD      09-counter/returns
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8');
const i = src.indexOf('const BILLS_SQL = `');
const sql = src.slice(i, src.indexOf('ORDER BY posted_at DESC`;', i) + 30);
assert(i > 0 && /ORDER BY posted_at DESC`;/.test(sql), 'BILLS_SQL orders the union by the bill moment');
assert.strictEqual((sql.match(/\$\{POSTED_AT_SQL\} > NOW\(\) - \(\$2/g) || []).length, 2, 'both arms (page + withdrawn) cut the window on the posted moment');
assert(!/h\.created_at > NOW\(\)/.test(sql), 'no arm cuts the window on the store time');
assert(/require\('\.\.\/lib\/tax-copy'\)/.test(src), 'the one helper, not a copy');
/* the helper itself: billed_at in its shape wins over the store time */
const tc = require('../lib/tax-copy');
assert(/billed_at/.test(tc.POSTED_AT_SQL) && /created_at/.test(tc.POSTED_AT_SQL), 'POSTED_AT_SQL reads billed_at, falls back to created_at');
console.log('ok till-earlier-window-1130');

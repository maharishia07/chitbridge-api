'use strict';
/* RW3 HOME (walk 3, 1130): the Day book answer carries the audited shop's own zone (RW3-11); a Cash sentence writes A$ like every figure beside it (RW3-09).
   Hand: 2,851,105 minor = A$28,511.05. Run: node tests/rw3home-1130.test.cjs */
const fs = require('fs'), path = require('path'), assert = require('assert');
const hooks = require('../lib/books-hooks');
assert.strictEqual(hooks.zoneOf({ timezone: 'Australia/Brisbane', country: 'AU' }), 'Australia/Brisbane', 'the setting row names its zone');
const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'books.js'), 'utf8');
assert(/timezone: require\('\.\.\/lib\/books-hooks'\)\.zoneOf\(req\.books\)/.test(route), 'GET /daybook answers the audited shop\'s zone');
const cash = require('../lib/books-cashflow');
assert.strictEqual(cash.shortWords({ date: '2026-12-01', short_minor: 2851105, driver: null }, '2026-11-26', 'AUD'), 'On 1 Dec 2026 you will be A$28,511.05 short.', 'A$ with its cents, never "AUD 28,511.05"');
console.log('rw3home-1130 api: ok');

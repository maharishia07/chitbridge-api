#!/usr/bin/env node
/**
 * rw2ctr-1130.test.cjs - re-walk 2 (26 Nov), counter rows RW2-05 / RW2-07 / RW2-09 on the till MASTER and the bills route.
 * OWNS    RW2-05: GET /api/till/bills answers ONE bill by ?chit=<uuid> of any age (window skipped, both arms, 7th parameter), the till asks for it by id and
 *         returns an old bill from memory; RW2-07: the Earlier empty state says what it lists; RW2-09: a number the shop never gave is not a counter name.
 * CALLED BY CI (tests/*.test.cjs). No database, no browser.
 * CARD      09-counter/returns
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const till = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'latin1');
const i = route.indexOf('const BILLS_SQL = `'), sql = route.slice(i, route.indexOf('ORDER BY posted_at DESC`;', i) + 30);
assert.strictEqual((sql.match(/\$7::text IS NOT NULL OR \$\{POSTED_AT_SQL\} > NOW\(\)/g) || []).length, 2, 'RW2-05: both arms skip the window when one bill is asked for');
assert.strictEqual((sql.match(/\$7::text IS NULL OR h\.chit_id::text = \$7::text/g) || []).length, 2, 'RW2-05: both arms filter on the chit id');
assert(/BILLS_SQL, \[entity_id, String\(days\), page\.limit[^\]]*page\.offset, chit\]/.test(route), 'the page read passes the 7th parameter');
assert(/BILLS_SQL, \[entity_id, String\(days\), limit, till, by, offset, chit \|\| null\]/.test(route), 'the past-the-end read passes it too');
assert(/req\.query\.chit === 'string' && \/\^\[0-9a-f-\]\{36\}\$\/i\.test/.test(route), 'only a uuid is taken');
assert(/'chit'\]/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'till-contract.js'), 'utf8')), 'the route contract names the query');
assert(/async history\(days, till, chit\)/.test(till) && /'&chit=' \+ encodeURIComponent\(chit\)/.test(till), 'the till host can ask by chit id');
assert(/HOST\.history\(365, null, id\)/.test(till), 'returnFindBill reads the bill by its id, not the 30-day page');
assert(!/not among the shop’s counter bills of the last/.test(till), 'the 30-day refusal is gone');
assert(/retOpen\(found\.bill\.no, found\.bill\)/.test(till) && /async function retOpen\(no, given\)/.test(till), 'an old bill opens the one return sheet from memory');
assert(/No bills rung on a counter in the last/.test(till), 'RW2-07: Earlier says it lists counter bills only');
assert(/RW2-09/.test(till) && /if \(!given\) return 'Counter'/.test(till), 'RW2-09: no shop-given number, no numbered name');
console.log('ok rw2ctr-1130');

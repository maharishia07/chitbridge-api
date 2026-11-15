#!/usr/bin/env node
// @type: unit
/**
 * sec-127b-ctpreturn-dispute-entity.test.cjs — SEC-127b (cb-rail): EVERY chit_disputes READ IN lib/ctpreturn.js NAMES THE SHOP, NOT ONLY ROW SECURITY.
 * The remote party's copy is read under withEntity(remote); row security covered it, the SQL did not say whose copy. Each statement that touches chit_disputes
 * must carry "entity_id = $n" in the same statement (a second shop holding the same dispute_id must read 0 rows on a database without RLS).
 * HAND-COMPUTED: lib/ctpreturn.js has 4 statements on chit_disputes (the scope read, the held-copy checks x2, the own-copy role read); 4 of 4 name entity_id.
 *   The check runs on the source text of each quoted statement, and fails on a statement with chit_disputes and no entity_id (proved by a planted one).
 * RUN       node tests/sec-127b-ctpreturn-dispute-entity.test.cjs
 * CARD      05-ctp-and-cross-installation/ctp-return-path
 */
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
/** every single-quoted SQL string in the source that names chit_disputes */
const statementsOn = (src) => (src.match(/'[^'\n]*chit_disputes[^'\n]*'/g) || []).filter((s) => /\b(SELECT|UPDATE|DELETE|INSERT)\b/i.test(s));
const unscoped = (list) => list.filter((s) => !/entity_id\s*=\s*\$\d/.test(s));

console.log('\n== SEC-127b · ctpreturn names the shop on every dispute statement ==');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ctpreturn.js'), 'utf8');
const found = statementsOn(src);
t('the four statements are found', found.length === 4, 'found ' + found.length);
t('each names entity_id = $n', unscoped(found).length === 0, unscoped(found).join('\n'));
t('a planted statement without it is caught', unscoped(statementsOn("db.query('SELECT 1 FROM chit_disputes WHERE dispute_id = $1')")).length === 1);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

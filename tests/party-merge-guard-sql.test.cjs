/**
 * CRM-43 · b782 trigger function (party_merge_guard) is one function on TWO tables. plpgsql resolves NEW.<column> when it evaluates the expression, so a
 * CASE that names customer_identity_id AND supplier_entity_id fails on every row of either table: 'record "new" has no field "supplier_entity_id"'
 * (a 500 on every merge; found by CI's fresh-db build, PR 505, 29 Oct). A column of one table may only be read inside the IF branch for that table.
 * No database: reads the migration text. The live proof is tests/party-gorilla-truth.realstack.cjs GT-1 (CI builds the schema from migrations/, b782 included).
 * Run: node tests/party-merge-guard-sql.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } };

const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'b782_party_merge_guard.sql'), 'utf8');
const body = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
const fn = (body.match(/AS \$\$([\s\S]*?)\$\$/) || [])[1] || '';
ok('the function body is found', fn.length > 100);
/* any CASE ... END that reads a NEW.<table-only column> */
const cases = fn.match(/\bCASE\b[\s\S]*?\bEND\b(?!\s+IF)/g) || [];
ok('no CASE reads a NEW column (an IF branch per table instead)', !cases.some((c) => /\bNEW\./.test(c)), cases.join(' | '));
ok('the customer column is read only under the customer_list branch', /IF TG_TABLE_NAME = 'customer_list' THEN me := NEW\.customer_identity_id; ELSE me := NEW\.supplier_entity_id; END IF;/.test(fn));
const outside = fn.replace(/IF TG_TABLE_NAME = 'customer_list'[\s\S]*?END IF;/, '');
ok('NEW.customer_identity_id / NEW.supplier_entity_id are named nowhere else', !/NEW\.(customer_identity_id|supplier_entity_id)/.test(outside), outside.match(/NEW\.\w+/g).join(','));
const app = fs.readFileSync(path.join(__dirname, '..', 'lib', 'party-fields.js'), 'utf8');
ok('the function takes the per-shop lock first, with the key merge: + owner uuid text', /PERFORM pg_advisory_xact_lock\(hashtext\('merge:' \|\| NEW\.owner_entity_id::text\)\);/.test(fn) && fn.indexOf('pg_advisory_xact_lock') < fn.indexOf('EXISTS'));
ok('the app takes the same key (merge: + lower-case owner)', /pg_advisory_xact_lock\(hashtext\(\$1\)\)', \['merge:' \+ String\(owner\)\.toLowerCase\(\)\]/.test(app));
ok('its header says Athi ran it', /RUN by Athi 2026-10-29/.test(sql));
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;

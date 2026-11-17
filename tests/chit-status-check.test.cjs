/**
 * tests/chit-status-check.test.cjs — b773's CHECK list IS the rail's list (K-DB / DB-72, 21 Oct 2026).
 *
 * The status vocabulary lives once, in lib/rail.js TRANSITIONS (lib/rail-actions.js STATES = its keys). b773 copies it into
 * the database as a CHECK; this test fails if the two ever differ, and if the CHECK would refuse a value production holds today
 * (READ-2026-10-21-1: pending delivered completed in_progress accepted cancelled partial). It also pins the two sibling files'
 * safety words (b774 counts before it builds; b775 is scoped by the READ-4 predicate and guarded). Pure file reads; no DB.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { STATES } = require('../lib/rail-actions');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8').replace(/\r\n/g, '\n');
let fail = 0, total = 0;
const t = (name, ok, extra) => { total++; if (ok) console.log('  ✓ ' + name); else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); } };

const b773 = read('b773_chit_status_current_status_check.sql');
const m = b773.match(/CHECK \(current_status IN \(([^)]*)\)\)/);
const listed = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort() : [];
const code = [...STATES].sort();

t('b773 carries one CHECK (current_status IN (…))', !!m);
t('the CHECK list equals the rail list (rail-actions STATES)', JSON.stringify(listed) === JSON.stringify(code), 'sql=' + listed + ' code=' + code);
const PROD = ['pending', 'delivered', 'completed', 'in_progress', 'accepted', 'cancelled', 'partial'];
t('every value production holds is allowed (READ-2026-10-21-1)', PROD.every((s) => listed.includes(s)));
t('added NOT VALID, then VALIDATE in its own step', /NOT VALID;/.test(b773) && /VALIDATE CONSTRAINT chit_status_current_status_chk/.test(b773));

const b774 = read('b774_definition_name_unique_folded.sql');
t('b774 counts duplicates before it builds the unique index', /RAISE EXCEPTION/.test(b774) && /CREATE UNIQUE INDEX IF NOT EXISTS definition_entity_kind_name_folded_uq/.test(b774));
t('b774 folds the name like READ-2 (lower(btrim(name)))', /lower\(btrim\(name\)\)/.test(b774) && /kind <> 'testcase'/.test(b774));

const b775 = read('b775_minted_parties_to_local.sql');
t('b775 uses the READ-4 predicate and only touches rows not yet local', /identity_type = 'entity' AND user_id LIKE '~%'/.test(b775) && /entity_kind IS DISTINCT FROM 'local'/.test(b775));
t('b775 stops above the expected count and notices on 0', /moved > 5/.test(b775) && /RAISE NOTICE/.test(b775));

console.log('\n  ' + total + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);

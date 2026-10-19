'use strict';
/**
 * actors-max-tasks-cap.test.cjs — SET-31 (TB-CORE-3): a person's max_tasks is bounded by the entity's own ceiling
 * (entity_actor_settings.default_max_tasks, Settings > Work) and a new person with none given takes that default.
 * Offline: reads routes/actors.js (POST and PATCH both go through entityTaskCap) and FIELDS.md (the key has its entry).
 * Run: node tests/actors-max-tasks-cap.test.cjs
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'routes', 'actors.js'), 'utf8');
const fields = fs.readFileSync(path.join(root, 'docs', 'FIELDS.md'), 'utf8');

ok(/async function entityTaskCap\(entity_id\)[\s\S]*?schema\.hasTable\('entity_actor_settings'\)[\s\S]*?default_max_tasks/.test(src),
  'one reader of the ceiling, safe before the table exists');
ok(/const max_tasks\s+= req\.body\.max_tasks \|\| taskCap \|\| 10;/.test(src), 'create: none given takes the entity default, else 10');
ok(/if \(taskCap && max_tasks > taskCap\) return res\.status\(400\)\.json\(overTaskCap\(taskCap\)\)/.test(src), 'create: above the ceiling is refused with the number');
ok(/if \(taskCap && wanted > taskCap\) return res\.status\(400\)\.json\(overTaskCap\(taskCap\)\)/.test(src), 'edit: above the ceiling is refused with the number');
ok((src.match(/await entityTaskCap\(entity_id\)/g) || []).length === 2, 'exactly two call sites (create, edit), no second path');
ok(/MAX_TASKS_OVER_ENTITY/.test(src) && /MAX_TASKS_OVER_ENTITY/.test(fields), 'the code the client can branch on is in FIELDS.md');
ok(/default_max_tasks` ceiling on `identities\.max_tasks`/.test(fields), 'FIELDS.md names the key, its layer and who sets it');
ok(/ONE tax-not-applicable decision \(SET-20\)/.test(fields) && /policy_flags\.gst_registration/.test(fields), 'SET-20: gst_registration is named as the single tax-not-applicable decision');
console.log(n + ' checks passed');

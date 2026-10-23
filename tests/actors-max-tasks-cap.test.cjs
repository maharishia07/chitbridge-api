'use strict';
/**
 * actors-max-tasks-cap.test.cjs — SET-31 (TB-CORE-3): a person's max_tasks is bounded by the entity's own ceiling
 * (entity_actor_settings.default_max_tasks, Settings > Work) read only when max_tasks is sent; a new person with none given keeps 10.
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
ok(src.includes("sent === undefined || sent === null || sent === ''") && src.indexOf('return next();', src.indexOf('async function taskCapGuard')) < src.indexOf('await entityTaskCap(auth.entityOf(req))'),
  'no max_tasks in the body = no read (round-trip budget); a new person keeps the default of 10');
ok(src.includes('ceiling && parseInt(sent, 10) > ceiling) return problem(req, res, { status: 400, ...words.overTaskCap(ceiling) })'), 'the guard refuses above the ceiling with the number (API-4: as a Problem, the old keys kept)');
ok(/router\.post\(\s*'\/',\s*auth,\s*ownerWrite,\s*taskCapGuard,/.test(src) && /router\.patch\(\s*'\/:id',\s*auth,\s*ownerWrite,\s*taskCapGuard,/.test(src), 'create and edit both run the guard before the handler');
ok((src.match(/await entityTaskCap\(/g) || []).length === 1, 'exactly one call site (the guard), no second path');
const contractSrc = fs.readFileSync(path.join(root, 'lib', 'actors-contract.js'), 'utf8'); /* API-4: the words of the refusal moved to the contract (overTaskCap) */
ok(/MAX_TASKS_OVER_ENTITY/.test(contractSrc) && /MAX_TASKS_OVER_ENTITY/.test(fields), 'the code the client can branch on is in FIELDS.md');
ok(/default_max_tasks` ceiling on `identities\.max_tasks`/.test(fields), 'FIELDS.md names the key, its layer and who sets it');
ok(/ONE tax-not-applicable decision \(SET-20\)/.test(fields) && /policy_flags\.gst_registration/.test(fields), 'SET-20: gst_registration is named as the single tax-not-applicable decision');
console.log(n + ' checks passed');

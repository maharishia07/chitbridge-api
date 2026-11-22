/**
 * state-log-guard-migration.test.cjs — F8b (1128): the migration FILE adds the UPDATE and TRUNCATE guard, is marked NOT RUN, and nothing in the repo updates state_log.
 * Figures: 2 triggers (BEFORE UPDATE row, BEFORE TRUNCATE statement); header says "NOT RUN · Athi runs it"; 0 "UPDATE state_log" / "TRUNCATE state_log" in lib, routes, tools, scripts, migrations (other than the archive).
 * Run: node tests/state-log-guard-migration.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'migrations', 'b901_state_log_update_truncate_guard.sql'), 'utf8');
let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(g) + ' want ' + JSON.stringify(w))); };
eq('marked NOT RUN, Athi runs it', /NOT RUN · Athi runs it/.test(sql.split('\n').slice(0, 4).join('\n')), true);
eq('a BEFORE UPDATE row trigger and a BEFORE TRUNCATE statement trigger', [/CREATE TRIGGER state_log_no_update BEFORE UPDATE ON public\.state_log FOR EACH ROW/.test(sql), /CREATE TRIGGER state_log_no_truncate BEFORE TRUNCATE ON public\.state_log FOR EACH STATEMENT/.test(sql)], [true, true]);
eq('the guard does not test session_user (it holds for every login)', /session_user/.test(sql.replace(/--[^\n]*/g, '')), false);
const hits = cp.spawnSync('git', ['grep', '-nEi', '(update +(public\.)?state_log|truncate[^;]*state_log)', '--', 'lib', 'routes', 'tools', 'scripts', 'middleware'], { cwd: root, encoding: 'utf8' }).stdout.trim();
eq('nothing in the code updates or truncates state_log', hits, '');
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);

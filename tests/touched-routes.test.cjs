/**
 * tests/touched-routes.test.cjs — THE TOUCH RULE FOR ROUTES, OFFLINE (MNT-30).
 *
 * OWNS      the proof of tools/touched-routes.cjs on small registers: a route whose hash moved is touched, a new one is touched, an untouched one is not;
 *           13/13 counts as met; warn mode never fails, fail mode fails on a touched route below 13/13; the checklist line; the real register against itself.
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      two tiny registers ──▶ touchedOf / judge / line ──▶ asserts ──▶ the tool run on this checkout with base = HEAD (nothing touched)
 * CARD      qa/api-register
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const tool = require('../tools/touched-routes.cjs');

let pass = 0, fail = 0;
const t = (what, ok) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + what); } };

const COLUMNS = ['schema_in', 'schema_out'];
const route = (key, hash, columns, status) => ({ key, file: 'routes/x.js', hash, columns, status });
const base = { machine_columns: COLUMNS, routes: [route('GET /a', 'h1', { schema_in: true, schema_out: true }, 'meets standard'), route('GET /b', 'h2', { schema_in: true, schema_out: false }, 'partial'), route('GET /c', 'h3', { schema_in: false, schema_out: false }, 'partial')] };
const head = { machine_columns: COLUMNS, routes: [route('GET /a', 'h1', { schema_in: true, schema_out: true }, 'meets standard'), route('GET /b', 'h2b', { schema_in: true, schema_out: false }, 'partial'), route('GET /c', 'h3', { schema_in: false, schema_out: false }, 'partial'), route('POST /d', 'h4', { schema_in: true, schema_out: true }, 'meets standard')] };

const touched = tool.touchedOf(base, head);
t('a route whose hash moved is touched', touched.some((r) => r.key === 'GET /b'));
t('a new route is touched and marked new', touched.some((r) => r.key === 'POST /d' && r.isNew));
t('an untouched route is not judged (even below 13/13)', !touched.some((r) => r.key === 'GET /c' || r.key === 'GET /a'));
t('columns passing are counted out of the register columns', touched.find((r) => r.key === 'GET /b').passing === 1 && touched.find((r) => r.key === 'GET /b').of === 2);
t('the lacking column is named', touched.find((r) => r.key === 'GET /b').failing[0] === 'schema_out');
t('no base register: every route counts as new', tool.touchedOf(null, head).length === 4);

const warn = tool.judge(base, head, 'warn');
t('warn mode: one route at 13/13, one below, never failed', warn.at13 === 1 && warn.below.length === 1 && warn.failed === false);
const strict = tool.judge(base, head, 'fail');
t('fail mode fails a touched route below 13/13', strict.failed === true);
t('fail mode passes when every touched route meets the standard', tool.judge(base, { machine_columns: COLUMNS, routes: [head.routes[3]] }, 'fail').failed === false);

t('the checklist line carries the three numbers and the mode', /Touch rule, routes \(report, warn mode until \d{4}-\d\d-\d\d\): routes touched 2 · at 13\/13 1 · below 1/.test(tool.line(warn)));
t('the report names the route and what it lacks', /GET \/b \(routes\/x\.js\) 1\/2 — lacks schema_out/.test(tool.report(warn)));
t('mode: warn before the switch, fail from it, an explicit option wins', tool.modeFor('2026-11-06') === 'warn' && tool.modeFor('2099-01-01') === 'fail' && tool.modeFor('2026-11-06', 'fail') === 'fail');

const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'touched-routes.cjs'), '--base', 'HEAD', '--md'], { encoding: 'utf8' });
t('the tool runs on this checkout with base = HEAD: nothing touched, exit 0', run.status === 0 && /touched routes: 0/.test(run.stdout) && /Touch rule, routes/.test(run.stdout));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);

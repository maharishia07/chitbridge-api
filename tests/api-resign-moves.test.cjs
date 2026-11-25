/**
 * api-resign-moves.test.cjs — D1 + D3 (batch 1130): the judge (what the tool may re-sign), the line patch of docs/api-signoffs.json, and the signed-at-fold check of the ratchet.
 * Run: node tests/api-resign-moves.test.cjs
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { judge, patchSignoffs } = require('../tools/api-resign-moves.cjs');
const { checkSignedAtFold } = require('../tools/api-ratchet.cjs');
const { MACHINE_COLUMNS } = require('../tools/api-register.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const allTrue = Object.fromEntries(MACHINE_COLUMNS.map((name) => [name, true]));
const row = (hash, extra) => Object.assign({ key: 'GET /api/x', hash, file: 'routes/x.js', columns: allTrue, status: 'meets standard', human: { signed_off_by_date: 'cb-api 2026-11-01 stage2' } }, extra || {});
const parts = (handler, extra) => Object.assign({ file: 'routes/x.js', chain: [], op: '{}', raw: [handler] }, extra || {});
const H1 = 'async (req, res) => { const a = 1; const b = 2; res.json({ a, b }); }';
const H2 = 'async (req, res) => { const a = 1, b = 2; res.json({ a, b }); }';
const entry = { hash: 'old', signed_off_by_date: 'x' };

ok('judge: a joined declaration is proven', judge(row('new'), row('old'), parts(H1), parts(H2), entry).outcome === 'proven');
ok('judge: a changed line goes to a human', judge(row('new'), row('old'), parts(H1), parts(H2.replace('res.json', 'log(); res.json')), entry).outcome === 'human');
ok('judge: a moved operation text goes to a human', judge(row('new'), row('old'), parts(H1), parts(H1, { op: '{"a":1}' }), entry).outcome === 'human');
ok('judge: a moved chain goes to a human', judge(row('new'), row('old'), parts(H1), parts(H1, { chain: ['x'] }), entry).outcome === 'human');
ok('judge: unsigned at the base goes to a human', judge(row('new'), row('old', { status: 'partial', human: { signed_off_by_date: null } }), parts(H1), parts(H1), entry).outcome === 'human');
ok('judge: a column not true goes to a human', judge(row('new', { columns: Object.assign({}, allTrue, { strict_input: false }) }), row('old'), parts(H1), parts(H1), entry).outcome === 'human');
ok('judge: stale is read from the entry', judge(row('new'), row('old'), parts(H1), parts(H1), entry).stale === true && judge(row('new'), row('old'), parts(H1), parts(H1), { hash: 'new' }).stale === false);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resign-test-'));
const file = path.join(dir, 'api-signoffs.json');
const lines = ['{', ' "about": "x",', ' "version": 1,', ' "routes": {',
  '  "GET /api/a": {"hash":"h1","names_clear":true,"signed_off_by_date":"cb-api 2026-11-01 stage2","lifecycle":"stable"},',
  '  "GET /api/x": {"names_clear":true,"hash":"old","signed_off_by_date":"cb-api 2026-11-01 stage2","lifecycle":"stable"},',
  '  "GET /api/z": {"hash":"h3","signed_off_by_date":"cb-api 2026-11-01 stage2"}', ' }', '}', ''];
fs.writeFileSync(file, lines.join('\n'));
const verdicts = [{ key: 'GET /api/x', outcome: 'proven', level: 'declaration-join', why: 'w', stale: true }, { key: 'GET /api/a', outcome: 'human', stale: true }];
const count = patchSignoffs(verdicts, [{ key: 'GET /api/x', hash: 'newhash' }], '2026-11-25', 'origin/main', file);
const after = fs.readFileSync(file, 'utf8').split('\n');
ok('patch: one line re-signed', count === 1);
ok('patch: only that line changed (no reserialise, no re-sort)', after.length === lines.length && after.filter((line, i) => line !== lines[i]).length === 1 && after[5] !== lines[5]);
const patched = JSON.parse(after[5].replace(/^ {2}"[^"]+": /, '').replace(/,$/, ''));
ok('patch: hash and stamp set, key order kept, other fields kept', patched.hash === 'newhash' && /^cb-api 2026-11-25 moved, body identical \(tool\)/.test(patched.signed_off_by_date) && Object.keys(patched).join() === 'names_clear,hash,signed_off_by_date,lifecycle');
fs.rmSync(dir, { recursive: true, force: true });

const base = { routes: [{ key: 'A', hash: '1' }, { key: 'B', hash: '2' }, { key: 'C', hash: '3' }] };
const head = { routes: [{ key: 'A', hash: '1', status: 'partial' }, { key: 'B', hash: '9', status: 'meets standard' }, { key: 'C', hash: '8', status: 'partial', human: { stale_since: '8' }, columns: {} }, { key: 'D', hash: '4', status: 'partial', human: {}, columns: {} }] };
const problems = checkSignedAtFold(base, head, 'origin/main');
ok('D3: an unchanged partial route is not this PR\'s to sign', !problems.some((sentence) => sentence.startsWith('A ')));
ok('D3: a changed route that is signed passes', !problems.some((sentence) => sentence.startsWith('B ')));
ok('D3: a changed stale route and a new unsigned route fail, each with both commands', problems.length === 2 && problems.every((sentence) => sentence.includes('api-resign-moves.cjs --base origin/main --write') && sentence.includes('cb-api')));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

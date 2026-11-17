#!/usr/bin/env node
// @type: unit
/**
 * pm-8-verdict-build.test.cjs — PM-8 (proof 2026-11-14): a verdict records WHERE it was recorded. The test panel (public/app/cap-testing.js testMark)
 * sends the build with every verdict, and on a failure or a block the browser, OS, viewport, page and screen ride in the evidence; a pass carries no machinery.
 * The REAL testMark / testEnv / testEnvLine are lifted and run over a stand-in api. (The incident path reads a global nobody defines: see pm-8-incident-build.red.cjs.)
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node tests/pm-8-verdict-build.test.cjs
 */
'use strict';
const assert = require('assert');
const { sliceFrom, run } = require('./lib/proof-lift.cjs');

let pass = 0;
const ok = (condition, name) => { assert(condition, name); pass++; console.log('  ok  ' + name); };

const code = sliceFrom('public/app/cap-testing.js', 'function testBuild() {', '\n}\n') + '\n}\n'
  + sliceFrom('public/app/cap-testing.js', 'async function testMark(key, status) {', '\n}\n') + '\n}\n'
  + sliceFrom('public/app/cap-testing.js', 'function testEnv() {', 'function testCallsSince()');

async function record(status, typed) {
  const sent = [];
  const sandbox = {
    CB_BUILD: '2026-11-13c',
    CBTEST: { run: { id: 'run-1', label: 'walk', kind: 'manual' }, cases: [{ case_key: 'CAT001-H01', module_key: 'CAT', layer: 'ui' }], last: {}, mark: 0 },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' },
    window: { innerWidth: 390, innerHeight: 844, CBCALLS: [] },
    location: { hash: '#/standards' },
    document: { getElementById: (id) => (id === 'cbt_e_CAT001-H01' ? { value: typed || '' } : id === 'cbt_n_CAT001-H01' ? { value: 'note ' + status } : null) },
    api: async (name, options) => { sent.push({ name, body: options.body }); return { results: [{ id: 1 }] }; },
    testCallsSince: () => '', testWho: () => 'tester', testPaint() {}, screenCasesPaint() {}, testRunLoad() {}, testMarkLost() {}, toast() {},
    SESSION: { name: 'tester' }
  };
  run(code + '\nthis.testMark = testMark;', sandbox);
  await sandbox.testMark('CAT001-H01', status);
  return sent[0];
}

(async () => {
  const fail = await record('fail', 'the total is wrong');
  ok(fail.name === 'testRecord' && fail.body.build === '2026-11-13c', 'PM-8: every verdict carries the build');
  const ev = fail.body.results[0].evidence;
  ok(/the total is wrong/.test(ev) && ev.indexOf('the total is wrong') === 0, "PM-8: the tester's own sentence comes first in the evidence");
  ok(/build 2026-11-13c/.test(ev) && /Chrome 141/.test(ev) && /Windows/.test(ev) && /390×844/.test(ev) && /#\/standards/.test(ev), 'PM-8: a failure names build, browser (Chrome, not Safari), OS, viewport and the page');
  const pass1 = await record('pass', 'fine');
  ok(pass1.body.build === '2026-11-13c' && pass1.body.results[0].evidence === 'fine', 'PM-8: a pass carries the build but no browser machinery in its evidence');
  const blocked = await record('blocked', 'waiting on the till');
  ok(/Chrome 141/.test(blocked.body.results[0].evidence), 'PM-8: a block is a failure for this purpose (the browser line is added)');
  console.log(pass + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });

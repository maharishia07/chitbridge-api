/*
 * OWNS      the wide endpoint run's matching rules: a comment is not a call, a static segment meets only itself, a dynamic one only a :param,
 *           a registry entry is not a call, and a bucket follows its best evidence.
 * CALLED BY scripts/guards.cjs (offline, no database, no server)
 * FLOW      tools/endpoint-usage-callers.cjs -> tools/endpoint-usage-report.cjs -> asserts
 */
'use strict';
const assert = require('assert');
const callers = require('../tools/endpoint-usage-callers.cjs');
const report = require('../tools/endpoint-usage-report.cjs');
const twinsOf = require('../tools/endpoint-usage-twins.cjs');
const markdown = require('../tools/endpoint-usage-md.cjs');
const pageOf = require('../tools/endpoint-usage-page.cjs');
const wideRun = require('../tools/endpoint-usage-run.cjs');
const mountsOf = require('../tools/server-mounts.cjs');
const fs = require('fs');
const path = require('path');

let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log('  ok   ' + name);
};
const cand = (text, open) => callers.candidateOf({ text, open: !!open, more: false });
const route = (full) => ({ full, segs: full.split('/').filter(Boolean) });

check('a comment is blanked, line numbers kept', () => {
  const out = callers.stripComments("a // POST /api/x\n/* GET /api/y\n*/ b\n'http://h/api/z'", false);
  assert.strictEqual(out.split('\n').length, 4);
  assert.ok(out.indexOf('/api/x') < 0 && out.indexOf('/api/y') < 0);
  assert.ok(out.indexOf('http://h/api/z') >= 0, 'a URL inside a string stays');
});

check("'/api/chits/' + id names the :param route, never GET /api/chits/inbox", () => {
  const dynamic = cand('/api/chits/', true);
  assert.ok(callers.shapeMatches(dynamic, route('/api/chits/:chit_id')));
  assert.ok(!callers.shapeMatches(dynamic, route('/api/chits/inbox')));
});

check('a static literal meets its own static route and a :param route', () => {
  const inbox = cand('/api/chits/inbox');
  assert.ok(callers.shapeMatches(inbox, route('/api/chits/inbox')));
  assert.ok(callers.shapeMatches(inbox, route('/api/chits/:chit_id')));
  assert.ok(!callers.shapeMatches(inbox, route('/api/chits/outbox')));
});

check('a query string is cut and a template expression becomes a dynamic segment', () => {
  const joined = callers.piecesOf("fetch('/api/crm/parties/' + id + '/timeline?limit=5')")[0];
  const found = callers.candidateOf(joined);
  assert.deepStrictEqual(found.segs, ['api', 'crm', 'parties', ':p', 'timeline']);
  assert.ok(callers.shapeMatches(found, route('/api/crm/parties/:id/timeline')));
});

check('a bucket follows its best evidence: A over C over B; a declaration alone is C; nothing is D', () => {
  const rows = [{ declared: null }, { declared: 'webhook' }, {}, {}, {}];
  const unit = { cls: 'B', kind: 'unit', label: 'api:tests/t.cjs' };
  const page = { cls: 'A', kind: 'page', label: 'web:public/app.html' };
  const hits = [
    { route: 2, src: unit, line: 3, strength: 'exact' },
    { route: 3, src: unit, line: 3, strength: 'exact' },
    { route: 3, src: page, line: 9, strength: 'path-only' },
    { route: 4, src: page, line: 9, strength: 'prefix' }
  ];
  report.bucketsOf(rows, hits);
  assert.deepStrictEqual(
    rows.map((r) => r.bucket),
    ['D', 'C', 'B', 'A', 'A']
  );
  assert.strictEqual(rows[4].weak, true);
  assert.strictEqual(rows[3].weak, false);
});

check('the CTP router is the one handler at two addresses; no array path', () => {
  const API = path.join(__dirname, '..');
  const text = fs.readFileSync(path.join(API, 'server.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const rows = report.serverRows(API, mountsOf.serverMountsAll(text));
  const found = twinsOf.twins(API, rows).twoAddresses;
  assert.ok(
    found.mountedTwice.every((item) => item.at.indexOf('routes/ctp.js') === 0),
    'only ctp.js is mounted twice'
  );
  assert.ok(found.mountedTwice.length >= 3);
  assert.strictEqual(found.arrayPaths.length, 0);
});

check('the page names the gap list and the route, and the run module exposes runWide', () => {
  const tests = { unit: true, unitWhy: '', walk: false, board: false, cycle: false, screens: [], shared: false, gap: true };
  const caller = { cls: 'A', kind: 'page', label: 'web:public/a.js', line: 1, strength: 'exact' };
  const rows = [
    { area: 'x', method: 'GET', full: '/api/x', file: 'routes/x.js', line: 1, bucket: 'A', weak: false, why: 'web:public/a.js:1', callers: [caller], tests }
  ];
  const text = pageOf.page({ rows, meta: {} }, markdown.summarize(rows), markdown.gapGroups(rows), { A: 'A', B: 'B', C: 'C', D: 'D' });
  assert.ok(text.indexOf('THE GAP LIST') > 0 && text.indexOf('GET /api/x') > 0);
  assert.strictEqual(typeof wideRun.runWide, 'function');
});

console.log('\n  ' + checks + ' checks · 0 failed');

/**
 * tests/junit-board.test.js — ONE T1 RUN LANDS ON THE BOARD AS ONE RESULT PER CASE (N01).
 *
 * ⭐ A PLANTED RUN, THROUGH THE REAL ROUTE. A Playwright-shaped JUnit report (three spec files, one of them under
 * two projects, one test failing) is posted to POST /api/testing/results/junit on an Express app built from
 * routes/testing.js. Only the database and the token check are stood in for: the reading, the folding and the
 * one recorder are the code that ships. The INSERT the route sends is captured and counted.
 *
 * The invariants it holds (MASTER-BUILD row 1, §3 I15):
 *   · every T1 run writes exactly ONE test_result row per (run, case, layer)
 *   · a fail anywhere in a case is the case's result — never dropped behind an earlier pass
 *   · a key the board does not list is RECORDED and SAID (`not_on_board`), never silent
 *   · nothing is written on an aborted run (the API harness writes no JUnit when it stopped early)
 *
 * Run: node tests/junit-board.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');

let pass = 0;
const it = async (what, fn) => {
  try { await fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; }
};

const J = require('../lib/junitresults');
const PREFIX = 'chitbridge-web/e2e/tests';
const BOARD = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45';

/* what Playwright 1.61 writes: classname = the spec file under testDir, name = the title; one testcase per
   test PER PROJECT, so a spec run in two projects names its file twice as often */
const XML = `<testsuites id="" name="" tests="7" failures="1" skipped="1" errors="0" time="9.1">
<testsuite name="one-board.spec.js" hostname="noauth" tests="1" failures="0" skipped="0">
<testcase name="[BOARD-01] a brand-new shop sees the product board, not an empty one" classname="one-board.spec.js" time="4.2"></testcase>
</testsuite>
<testsuite name="disputes.spec.js" hostname="authed" tests="3" failures="1" skipped="0">
<testcase name="[DISP-01] raise names B only" classname="disputes.spec.js" time="1"></testcase>
<testcase name="[DISP-02] C is excluded &amp; sees nothing" classname="disputes.spec.js" time="1"><failure message="expected 0, received 1" type="expect.toHaveCount"><![CDATA[boom]]></failure></testcase>
<testcase name="[DISP-03] A resolves per party" classname="disputes.spec.js" time="1"></testcase>
</testsuite>
<testsuite name="disputes.spec.js" hostname="laptop" tests="1" failures="0" skipped="0">
<testcase name="[DISP-01] raise names B only" classname="disputes.spec.js" time="1"></testcase>
</testsuite>
<testsuite name="brand-new.spec.js" hostname="noauth" tests="2" failures="0" skipped="1">
<testcase name="[NEW-01] untracked spec" classname="brand-new.spec.js" time="1"></testcase>
<testcase name="[NEW-02] skipped one" classname="brand-new.spec.js" time="0"><skipped/></testcase>
</testsuite>
</testsuites>`;

/* ── the database and the token, stood in for; everything else is the shipped code ── */
const sent = [];
const KNOWN = { 'chitbridge-web/e2e/tests/one-board.spec.js': 1, 'chitbridge-web/e2e/tests/disputes.spec.js': 1 };
function fakeDb() {
  return {
    query: async (sql, params) => {
      if (/FROM definition/.test(sql)) {
        return { rows: params[1].filter((k) => KNOWN[k]).map((k) => (
          { definition_id: '00000000-0000-4000-8000-00000000000' + KNOWN[k], name: k, sub_kind: 'e2e', current_version: 3 })) };
      }
      if (/INSERT INTO test_result/.test(sql)) {
        sent.push(params);
        const seen = new Set();
        /* uq_test_result_once, honestly: (run, case, COALESCE(layer,'')) — a duplicate is DO NOTHING */
        const rows = params[3].map((k, i) => ({ k, layer: params[8][i] || '', status: params[5][i] }))
          .filter((r) => { const u = r.k + '|' + r.layer; if (seen.has(u)) return false; seen.add(u); return true; })
          .map((r, i) => ({ result_id: i + 1, case_key: r.k, status: r.status, at: new Date().toISOString() }));
        return { rows };
      }
      return { rows: [] };
    },
  };
}
function stub(rel, exports) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('../db', { withEntity: async (_e, fn) => fn(fakeDb()), withTransaction: async (_e, fn) => fn(fakeDb()),
  query: async () => ({ rows: [] }), pool: { query: async () => ({ rows: [] }) } });
const fakeAuth = (req, _res, next) => {
  req.identity = { identity_id: 'aaaaaaaa-0000-4000-8000-000000000001', parent_entity_id: BOARD, display_name: 'T1 runner' };
  next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id;
stub('../middleware/auth', fakeAuth);

function post(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const rq = http.request({ host: '127.0.0.1', port, path: '/api/testing/results/junit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (rs) => {
      let t = ''; rs.on('data', (c) => { t += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, body: JSON.parse(t) }); } catch (e) { reject(e); } });
    });
    rq.on('error', reject); rq.end(data);
  });
}

(async () => {
  console.log('— reading a Playwright report —');

  await it('⭐ key_from "file" keys every test by the spec file the board lists', () => {
    const r = J.read(XML, { keyFrom: 'file', keyPrefix: PREFIX, runKind: 't1', layer: 'web' });
    assert.strictEqual(r.unmatched.length, 0);
    assert.strictEqual(r.results.length, 7);
    assert.deepStrictEqual([...new Set(r.results.map((x) => x.case_key))].sort(),
      [PREFIX + '/brand-new.spec.js', PREFIX + '/disputes.spec.js', PREFIX + '/one-board.spec.js']);
  });

  await it('⚠️ the old bracket keys name cases the board does not hold — the reason runs never showed', () => {
    const r = J.read(XML, { runKind: 't1', layer: 'web' });
    const board = require('../data/test-cases.json').cases.map((c) => c.case_key);
    const onBoard = r.results.filter((x) => board.indexOf(x.case_key) >= 0);
    assert.strictEqual(onBoard.length, 0, 'a bracket tag matched a board case — the diagnosis is out of date');
    assert.ok(board.indexOf(PREFIX + '/one-board.spec.js') >= 0, 'the board lists the spec by its file');
  });

  await it('⚠️ key_from "file" refuses a prefix that is not a repo path', () => {
    assert.throws(() => J.read(XML, { keyFrom: 'file', keyPrefix: '../etc' }));
    assert.throws(() => J.read(XML, { keyFrom: 'file' }));
  });

  await it('⭐⭐ fold: one per (case, layer), worst wins, the note counts', () => {
    const f = J.fold(J.read(XML, { keyFrom: 'file', keyPrefix: PREFIX, runKind: 't1', layer: 'web' }).results);
    assert.strictEqual(f.length, 3);
    const d = f.filter((x) => /disputes/.test(x.case_key))[0];
    assert.strictEqual(d.status, 'fail');
    assert.ok(/3 of 4 passed · 1 failed/.test(d.note), d.note);
    assert.ok(/DISP-02.*expected 0, received 1/.test(d.note), 'the failing test and its message travel');
    assert.strictEqual(f.filter((x) => /brand-new/.test(x.case_key))[0].status, 'pass', 'a skip beside a pass is a pass');
    const one = { case_key: 'CTR-05', status: 'pass', note: 'mine', layer: 'web' };
    assert.strictEqual(J.fold([one])[0], one, 'a single tap passes through untouched');
  });

  console.log('— a planted T1 run, through the route —');
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/testing', require('../routes/testing'));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  try {
    await it('⭐⭐⭐ ONE row per (run, case, layer) reaches the INSERT, and the fail is the one kept', async () => {
      const r = await post(port, { xml: XML, key_from: 'file', key_prefix: PREFIX, run_kind: 't1', layer: 'web',
        run_label: 'planted N01' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(sent.length, 1, 'one INSERT for the run');
      const keys = sent[0][3], layers = sent[0][8], statuses = sent[0][5];
      const pairs = keys.map((k, i) => k + '|' + (layers[i] || ''));
      assert.strictEqual(new Set(pairs).size, pairs.length, 'a (case, layer) twice in one run: ' + pairs.join(', '));
      assert.strictEqual(keys.length, 3);
      assert.strictEqual(statuses[keys.indexOf(PREFIX + '/disputes.spec.js')], 'fail');
      assert.strictEqual(r.body.recorded, 3);
      assert.strictEqual(r.body.skipped, 0, 'nothing left for ON CONFLICT to drop');
      assert.strictEqual(r.body.folded, 4);
      assert.strictEqual(sent[0][1][keys.indexOf(PREFIX + '/one-board.spec.js')] !== null, true,
        'a board case is joined to its definition');
    });

    await it('⚠️ a key the board does not list is recorded AND named back', async () => {
      const r = await post(port, { xml: XML, key_from: 'file', key_prefix: PREFIX, run_kind: 't1' });
      assert.deepStrictEqual(r.body.not_on_board, [PREFIX + '/brand-new.spec.js']);
    });

    await it('the default (bracket) door still reads a tagged report', async () => {
      const r = await post(port, { xml: XML, run_kind: 't1' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.folded, 1, 'DISP-01 under two projects is one result');
    });
  } finally { srv.close(); }

  console.log('— nothing is written on an aborted run —');
  await it('⚠️⚠️ the API harness writes no JUnit when it stopped early, and removes the last one', () => {
    const H = require('./run-tests.js');
    fs.mkdirSync(path.dirname(H.JUNIT_FILE), { recursive: true });
    fs.writeFileSync(H.JUNIT_FILE, '<testsuites><testcase name="yesterday"/></testsuites>');
    H.state.results = [{ section: 'Health', test: 'up', passed: true, detail: '' }];
    const real = console.log; console.log = () => {};
    try { H.writeBoardArtefacts('fetch failed'); } finally { console.log = real; }
    assert.strictEqual(fs.existsSync(H.JUNIT_FILE), false, 'an aborted run left a report that would post as a pass');
  });

  console.log('\n  ' + pass + ' passed' + (process.exitCode ? ' — RED' : ''));
})();

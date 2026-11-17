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
 *   · a run carries its PROJECT (b292) when the column is there, and is written WITHOUT it — never refused,
 *     never silent — while it is not; every result read narrows to ?project=
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
/* ⚠️ the REAL guard, taken before the stub below replaces it for the route — the scope is asked of the shipped map */
const realAuth = require('../middleware/auth');
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
const sent = [], reads = [];
/* ⭐ b292 stood in: is test_result.project there? The INSERT refuses the column (42703) exactly as Postgres would. */
const COLS = { project: false };
const KNOWN = { 'chitbridge-web/e2e/tests/one-board.spec.js': 1, 'chitbridge-web/e2e/tests/disputes.spec.js': 1 };
function fakeDb() {
  return {
    query: async (sql, params) => {
      if (/information_schema\.columns/.test(sql)) return { rows: COLS.project ? [{ one: 1 }] : [] };
      if (/FROM definition/.test(sql) && /name = ANY/.test(sql)) {
        return { rows: params[1].filter((k) => KNOWN[k]).map((k) => (
          { definition_id: '00000000-0000-4000-8000-00000000000' + KNOWN[k], name: k, sub_kind: 'e2e', current_version: 3 })) };
      }
      if (/INSERT INTO test_result/.test(sql)) {
        if (/, project\)/.test(sql) && !COLS.project) {
          const e = new Error('column "project" of relation "test_result" does not exist'); e.code = '42703'; throw e;
        }
        sent.push(params); sent.sql = sql;
        const seen = new Set();
        /* uq_test_result_once, honestly: (run, case, COALESCE(layer,'')) — a duplicate is DO NOTHING */
        const rows = params[3].map((k, i) => ({ k, layer: params[8][i] || '', status: params[5][i] }))
          .filter((r) => { const u = r.k + '|' + r.layer; if (seen.has(u)) return false; seen.add(u); return true; })
          .map((r, i) => ({ result_id: i + 1, case_key: r.k, status: r.status, at: new Date().toISOString() }));
        return { rows };
      }
      if (/FROM test_result/.test(sql)) reads.push({ sql, params });
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

/* POST to the JUnit door by default; another path with `where`, and a GET when there is no body */
function post(port, body, where) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const rq = http.request({ host: '127.0.0.1', port, path: where || '/api/testing/results/junit',
      method: body === undefined ? 'GET' : 'POST',
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

  console.log('— the guards write JUnit the board reads (2026-10-07) —');
  /* what scripts/guards.cjs hands write(): one entry per file, named by the board's key */
  const GKEY = (f) => 'chitbridge-api/tests/' + f;
  const GUARD_RUN = [
    { name: GKEY('dispute-scoping.test.cjs'), status: 'pass', time: 1.2 },
    { name: GKEY('pages-parse.test.js'), status: 'fail', message: 'FAIL <script> #3 & "quoted"\n\u001b[31mexpected 0\u001b[0m', output: 'x' },
    { name: GKEY('tax-vendor.test.js'), status: 'skipped', message: 'needs chitbridge-engines (private), not checked out' },
  ];
  const GXML = J.write('guards', GUARD_RUN);

  await it('⭐ write → read(key_from name): one result per guard file, keyed by the path, status kept', () => {
    const r = J.read(GXML, { keyFrom: 'name', runKind: 'unit', layer: 'engine' });
    assert.strictEqual(r.unmatched.length, 0);
    assert.deepStrictEqual(r.results.map((x) => x.case_key), GUARD_RUN.map((x) => x.name));
    assert.deepStrictEqual(r.results.map((x) => x.status), ['pass', 'fail', 'skipped'], 'a skip is never a pass');
    assert.strictEqual(r.results[0].module_key, 'chitbridge-api/tests');
  });

  await it('⚠️ the failure reason survives escaping as one line; an ANSI colour cannot break the XML', () => {
    assert.ok(!/\u001b/.test(GXML), 'a control character reached the XML');
    const f = J.read(GXML, { keyFrom: 'name' }).results[1];
    assert.strictEqual(f.note, 'FAIL <script> #3 & "quoted" | [31mexpected 0[0m');
  });

  await it('⚠️ a pass is written OPEN, not <testcase/> — read() would run a self-closed one into its neighbour', () => {
    assert.ok(!/<testcase[^>]*\/>/.test(GXML), 'a self-closing testcase was written');
    const two = J.write('g', [{ name: 'a', status: 'pass' }, { name: 'b', status: 'fail', message: 'boom' }]);
    assert.deepStrictEqual(J.read(two, { keyFrom: 'name' }).results.map((x) => x.status), ['pass', 'fail']);
  });

  await it('⭐⭐ guards.cjs keys each file the way the board lists it — the guards ARE board cases', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'guards.cjs'), 'utf8');
    assert.ok(src.indexOf("const KEY = (f) => 'chitbridge-api/tests/' + f;") >= 0, 'guards.cjs no longer keys by the board path');
    assert.ok(/require\('\.\.\/lib\/junitresults'\)\.write\(/.test(src), 'guards.cjs writes its own JUnit instead of the one writer');
    const list = src.slice(src.indexOf('const GUARDS'), src.indexOf('];', src.indexOf('const GUARDS')));
    const files = [...list.matchAll(/'([^']+\.test\.c?js)'/g)].map((m) => m[1]);
    const board = new Set(require('../data/test-cases.json').cases.map((c) => c.case_key));
    const off = files.filter((f) => !board.has(GKEY(f)));
    /* ⚠ said, not failed: a guard added since the board was rebuilt is recorded and named back as not_on_board */
    if (off.length) console.log('       (not yet on the board: ' + off.join(', ') + ' — run C:\\dev\\board.cjs)');
    assert.ok(files.length > 100 && off.length * 10 < files.length, off.length + ' of ' + files.length + ' guards are not board cases');
  });

  await it('⭐ the testing scope is mintable and reaches the JUnit door — and nothing a CI box should not', () => {
    assert.ok(realAuth.SCOPE_NAMES.indexOf('testing') >= 0, 'POST /api/keys would refuse scopes:["testing"]');
    assert.ok(realAuth.allowsKey(['testing'], 'POST', '/api/testing/results/junit'));
    [['POST', '/api/keys'], ['POST', '/api/testing/cases/seed'], ['POST', '/api/testing/cases/import'], ['GET', '/api/products']]
      .forEach(([m, u]) => assert.ok(!realAuth.allowsKey(['testing'], m, u), 'a testing key reaches ' + m + ' ' + u));
  });

  await it('⚠️ CI posts after a red run too, and a failed post can never fail the build', () => {
    const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const step = ci.slice(ci.indexOf('- name: post the guards to the test board'), ci.indexOf('integration:'));
    assert.ok(/node scripts\/guards\.cjs --junit test-results\/guards\.xml/.test(ci), 'the guards step writes no JUnit');
    assert.ok(/always\(\)/.test(step) && /continue-on-error: true/.test(step), 'the post is skipped on red, or can fail the build');
    assert.ok(/secrets\.CB_BOARD_TOKEN/.test(step) && /::warning::/.test(step), 'no secret must be a warning, not silence');
    assert.ok(/post-results\.cjs/.test(step) && /--keys name/.test(step) && /--warn/.test(step), 'not the one poster, keyed by name');
    assert.ok(/--project "\$\{\{ vars\.CB_BOARD_PROJECT \}\}"/.test(step) && !/secrets\.CB_BOARD_PROJECT/.test(step),
      'the project is a repo VARIABLE passed with --project, not a secret');
  });

  console.log('— a planted T1 run, through the route —');
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const testingRoute = require('../routes/testing');
  app.use('/api/testing', testingRoute);
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

    await it('⭐ a guards report through the route: one row per file, unknown files named back', async () => {
      sent.length = 0;
      const r = await post(port, { xml: GXML, key_from: 'name', run_kind: 'unit', layer: 'engine', run_label: 'guards abc1234' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.recorded, 3);
      assert.deepStrictEqual(sent[0][3], GUARD_RUN.map((x) => x.name));
      assert.deepStrictEqual(sent[0][5], ['pass', 'fail', 'skipped']);
      assert.deepStrictEqual(r.body.not_on_board.sort(), GUARD_RUN.map((x) => x.name).sort(), 'the stand-in board knows none of them');
    });

    await it('the default (bracket) door still reads a tagged report', async () => {
      const r = await post(port, { xml: XML, run_kind: 't1' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.folded, 1, 'DISP-01 under two projects is one result');
    });

    console.log('— the project a run belongs to (b292) —');
    const P = '2026-10 build \u00b7 Stage 1';
    const TAP = { results: [{ case_key: 'CTR-05', status: 'pass', run_kind: 'manual' }] };
    const warned = []; const realWarn = console.warn; console.warn = (m) => warned.push(String(m));
    try {
      await it('⚠️⚠️ before b292: a post with a project is RECORDED without it, said back, logged once', async () => {
        sent.length = 0;
        const r = await post(port, { xml: GXML, key_from: 'name', run_kind: 'unit', layer: 'engine', project: P });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.recorded, 3, 'the run was lost because a column is missing');
        assert.strictEqual(r.body.project, null);
        assert.ok(/b292/.test(r.body.project_not_written || ''), 'the dropped project was not said back');
        assert.ok(!/project/.test(sent.sql), 'the INSERT named a column that is not there');
        const t = await post(port, Object.assign({ project: P }, TAP), '/api/testing/results');
        assert.strictEqual(t.status, 200, 'a tap broke on the missing column');
        assert.strictEqual(warned.filter((w) => /test_result\.project/.test(w)).length, 1, 'warned ' + warned.length + ' times, not once');
      });

      await it('⚠️ before b292: ?project= reads answer (nothing matches), never a 500', async () => {
        reads.length = 0;
        const r = await post(port, undefined, '/api/testing/runs?project=' + encodeURIComponent(P));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.deepStrictEqual(r.body.projects, []);
        assert.ok(reads.length && reads.every((q) => !/project =|max\(project\)/.test(q.sql)), 'a read named the missing column');
      });

      await it('⚠️ the column vanishing under the cache (42703) still records the run, without the project', async () => {
        testingRoute._proj.has = true; sent.length = 0;
        const r = await post(port, Object.assign({ project: P }, TAP), '/api/testing/results');
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.recorded, 1);
        assert.ok(r.body.project_not_written, 'the 42703 retry dropped the project quietly');
        assert.strictEqual(testingRoute._proj.has, false);
      });

      await it('⭐⭐ after b292: the tap and the JUnit post both WRITE the project, trimmed', async () => {
        COLS.project = true; testingRoute._proj.has = null;
        sent.length = 0;
        let r = await post(port, Object.assign({ project: '  ' + P + ' ' }, TAP), '/api/testing/results');
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.project, P);
        assert.ok(/, project\)/.test(sent.sql) && sent[0][sent[0].length - 1] === P, 'the tap did not write the project');
        sent.length = 0;
        r = await post(port, { xml: GXML, key_from: 'name', run_kind: 'unit', layer: 'engine', project: P });
        assert.strictEqual(r.body.project, P);
        assert.strictEqual(r.body.project_not_written, undefined);
        assert.strictEqual(sent[0][sent[0].length - 1], P, 'the JUnit post did not write the project');
        sent.length = 0;
        r = await post(port, Object.assign({ project: '   ' }, TAP), '/api/testing/results');
        assert.ok(!/, project\)/.test(sent.sql) && r.body.project === null, 'a blank project is no project');
      });

      await it('⚠️ a project over 80 characters is refused and SAID, never cut short quietly', async () => {
        const r = await post(port, Object.assign({ project: 'x'.repeat(81) }, TAP), '/api/testing/results');
        assert.strictEqual(r.status, 422);
        assert.ok(/80/.test(r.body.message));
      });

      await it('⭐⭐ ?project= narrows /results, /runs, /coverage and /report — every test_result read', async () => {
        for (const u of ['/api/testing/results', '/api/testing/runs', '/api/testing/coverage', '/api/testing/report']) {
          reads.length = 0;
          const r = await post(port, undefined, u + '?project=' + encodeURIComponent(P));
          assert.strictEqual(r.status, 200, u + ' ' + JSON.stringify(r.body).slice(0, 200));
          const list = reads.filter((q) => !/project IS NOT NULL/.test(q.sql));
          const loose = list.filter((q) => !/\$\d+::text IS NULL OR project = \$\d+/.test(q.sql) || q.params.indexOf(P) < 0);
          assert.ok(list.length, u + ' read no results');
          assert.strictEqual(loose.length, 0, u + ': a result read ignored the project: ' + (loose[0] || {}).sql);
          assert.strictEqual(r.body.project, P, u + ' does not say which project it answered for');
        }
        reads.length = 0;
        await post(port, undefined, '/api/testing/runs');
        assert.ok(reads.some((q) => q.params.indexOf(null) >= 0), 'no ?project= must pass null — all projects');
      });
    } finally { console.warn = realWarn; COLS.project = false; }
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

  console.log('\n  ' + pass + ' checks' + (process.exitCode ? ' — RED' : ''));
})();

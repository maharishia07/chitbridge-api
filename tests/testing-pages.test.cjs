'use strict';
/**
 * testing-pages.test.cjs — ⭐ T2-PAGING: the test board's five lists page (DISCIPLINES §2).
 *
 * /api/testing cases · results · runs · requirements · incidents answer top-level `total` · `page` · `limit`, the size
 * clamped by lib/page-limit.js (the client's ?limit= never beats the server's max), and the page is cut by the
 * database AFTER its order. ⚠️ /requirements and /incidents were cut at 500 by date BEFORE the priority/severity
 * sort, so an old High vanished and `total` counted the cut: the order and the counts are now SQL's, over every row.
 *
 * Runs the real routes with db and auth replaced by recorders — no database, no server.
 * Run: node tests/testing-pages.test.cjs
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* ── the recorder: every statement, and a scripted answer per statement shape ── */
let stmts = [], answer = () => [];
const dbStub = {
  query: async (sql, params) => { stmts.push({ sql: String(sql), params }); return { rows: answer(String(sql), params) }; },
  withEntity: async (entity, fn) => fn({ query: dbStub.query }),
};
const authStub = Object.assign((req, res, next) => next(), { entityOf: () => 'shop-1' });
require.cache[require.resolve(path.join(API, 'db'))] = { id: 'db', filename: 'db', loaded: true, exports: dbStub };
require.cache[require.resolve(path.join(API, 'middleware', 'auth'))] = { id: 'auth', filename: 'auth', loaded: true, exports: authStub };
const router = require(path.join(API, 'routes', 'testing.js'));

async function get(p, query) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods.get);
  assert.ok(layer, 'GET ' + p + ' is gone from routes/testing.js');
  const st = layer.route.stack; let body = null, status = 200;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await st[st.length - 1].handle({ query: query || {}, identity: { identity_id: 'u1' } }, res);
  return { body, status };
}
const pageStmt = () => stmts.find((s) => /count\(\*\) OVER \(\)/.test(s.sql));
const lp = (s) => s.params.slice(-2);   // [limit, offset]

const ROUTES = [
  ['/cases', 5000, 'cases'], ['/results', 5000, 'results'], ['/runs', 50, 'runs'],
  ['/requirements', 500, 'requirements'], ['/incidents', 500, 'incidents'],
];

(async () => {
  console.log('\nTHE TEST BOARD\'S LISTS PAGE\n');

  for (const [p, max, key] of ROUTES) {
    await ita(`${p}: top-level total · page · limit; ?limit= clamped to ${max}; page 3 → OFFSET 2×limit`, async () => {
      stmts = []; answer = (sql) => (/OVER \(\)/.test(sql) ? [{ full_count: 1234 }] : []);
      const r = await get(p, { limit: '1000000', page: '3' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.total, r.body.page, r.body.limit], [1234, 3, max]);
      assert.ok(Array.isArray(r.body[key]), key + ' is the array');
      assert.deepStrictEqual(lp(pageStmt()), [max, 2 * max]);
      assert.ok(!(key in r.body) || !r.body[key].some((x) => 'full_count' in x), 'the window count never leaks into a row');
    });
    await ita(`${p}: no ?limit= → today's size (${max}), page 1`, async () => {
      stmts = []; answer = () => [];
      const r = await get(p, {});
      assert.deepStrictEqual([r.body.total, r.body.page, r.body.limit], [0, 1, max]);
      assert.deepStrictEqual(lp(pageStmt()), [max, 0]);
    });
  }

  await ita('a page past the end asks the count once more — total stays true', async () => {
    stmts = []; answer = (sql) => (/^SELECT count\(\*\)::int AS n FROM \(SELECT 1/.test(sql) ? [{ n: 7 }] : []);
    const r = await get('/cases', { page: '9', limit: '5' });
    assert.deepStrictEqual([r.body.total, r.body.page, r.body.limit, r.body.cases.length], [7, 9, 5, 0]);
  });

  await ita('⭐ /requirements: priority is the ORDER BY of the cut (an old High cannot fall off), the filter is SQL', async () => {
    stmts = []; answer = () => [];
    await get('/requirements', { state: 'open' });
    const s = pageStmt().sql;
    assert.ok(/ORDER BY CASE COALESCE\(v\.rules->>'priority','Medium'\) WHEN 'High' THEN 0/.test(s), s);
    assert.ok(s.indexOf('ORDER BY') < s.indexOf('LIMIT'), 'ordered, then cut');
    assert.ok(!/LIMIT 500/.test(s), 'no cut before the order');
    assert.strictEqual(pageStmt().params[1], 'open');
  });

  await ita('⭐ /requirements: counts are over EVERY row (GROUP BY), `open` = raised + accepted, total = the filter\'s rows', async () => {
    stmts = [];
    answer = (sql) => (/GROUP BY 1/.test(sql) ? [{ state: 'raised', n: 600 }, { state: 'accepted', n: 4 }, { state: 'rejected', n: 2 }]
      : (/OVER \(\)/.test(sql) ? [{ definition_id: 'd1', name: 'C-1', rules: { state: 'raised', priority: 'High' }, full_count: 604 }] : []));
    const r = await get('/requirements', {});
    assert.deepStrictEqual(r.body.counts, { raised: 600, accepted: 4, implemented: 0, rejected: 2 });
    assert.strictEqual(r.body.open, 604);
    assert.strictEqual(r.body.total, 604);
    assert.strictEqual(r.body.requirements[0].priority, 'High');
  });

  await ita('⭐ /incidents: severity is the ORDER BY of the cut; open_by_severity counts only open states, over every row', async () => {
    stmts = [];
    answer = (sql) => (/GROUP BY 1, 2/.test(sql)
      ? [{ state: 'raised', severity: 'Sev-1', n: 2 }, { state: 'investigating', severity: 'Sev-3', n: 1 }, { state: 'closed', severity: 'Sev-1', n: 9 }]
      : []);
    const r = await get('/incidents', { state: 'all' });
    assert.ok(/ORDER BY CASE COALESCE\(v\.rules->>'severity','Sev-3'\) WHEN 'Sev-1' THEN 0/.test(pageStmt().sql));
    assert.deepStrictEqual(r.body.counts, { raised: 2, investigating: 1, resolved: 0, closed: 9 });
    assert.deepStrictEqual(r.body.open_by_severity, { 'Sev-1': 2, 'Sev-2': 0, 'Sev-3': 1, 'Sev-4': 0 });
    assert.strictEqual(r.body.open, 3);
  });

  await ita('/results latest-per: the count is over the latest rows (DISTINCT ON inside), not the ledger', async () => {
    stmts = []; answer = () => [];
    await get('/results', {});
    assert.ok(/FROM \(SELECT DISTINCT ON \(case_key, COALESCE\(layer,''\)\) \*/.test(pageStmt().sql), pageStmt().sql);
  });

  console.log('\n' + pass + ' passed' + (process.exitCode ? ' — FAILURES above' : ''));
})();

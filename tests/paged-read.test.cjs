'use strict';
/**
 * tests/paged-read.test.cjs — column 21 of the API register, paged_read (PERF1): the static facts of a list read, and the one request-log count it is settled by.
 * Run: node tests/paged-read.test.cjs
 * MIN refusal-path
 * MIN fail-closed: a NEW list route with no server maximum fails; a list that answers every row when nothing is asked fails the column (the ratchet holds the count down).
 */
const assert = require('assert');
const { factsOf, causesOf, sizeArgs } = require('../lib/paged-read');
const { noteRows, requestLine } = require('../lib/request-log');
let pass = 0, fail = 0;
const check = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };
const facts = (text, extra) => factsOf(Object.assign({ method: 'GET', file: 'routes/x.js', path: '/api/x/list', text, treeText: text, fileText: text, urlSchema: null, root: __dirname + '/..' }, extra || {}));

check('limitOf names a default and a maximum: bounded when nothing is asked', () => {
  const f = facts("router.get('/', async (req, res) => { const limit = PL.limitOf(req.query.limit, 40, 100); const r = await q('select 1 limit $1', [limit]); res.json({ items: r.rows }); })");
  assert.deepStrictEqual([f.kind, f.default, f.max, f.unasked], ['list', 40, 100, 'bounded']);
  assert.deepStrictEqual(causesOf(f), []);
});
check('pageArgs with no fallback answers EVERY row when nothing is asked (PERF1 breach)', () => {
  const f = facts("const pg = PL.pageArgs(req.query, 50, 200); const r = await q('select 1'); res.json(PL.pageOut('rows', r.rows, pg));");
  assert.deepStrictEqual([f.default, f.max, f.unasked], [50, 200, 'everything']);
  assert.deepStrictEqual(causesOf(f), ['whole_when_unasked']);
});
check('pageArgs handed a limit with a fallback is bounded', () => {
  const f = facts("const pg = PL.pageArgs({ page: req.query.page, limit: req.query.limit || 25 }, 25, 100); const r = await q('select 1'); res.json({ rows: r.rows });");
  assert.strictEqual(f.unasked, 'bounded');
});
check('a list that reads a limit but names no maximum fails with no_server_max', () => {
  const f = facts("const n = Number(req.query.limit); const r = await q('select 1 limit $1', [n]); res.json({ rows: r.rows });");
  assert.deepStrictEqual([f.kind, f.max], ['list', null]);
  assert.ok(causesOf(f).includes('no_server_max'));
});
check('a handler that answers no rows is a single read and holds', () => {
  const f = facts("const r = await q('select 1'); res.json({ one: r.rows[0] });");
  assert.strictEqual(f.kind, 'single');
  assert.deepStrictEqual(causesOf(f), []);
});
check('lib/list-allowance: a route nobody allowed gets no reason (fail closed: it must page), an allowed one keeps its sentence', () => {
  const { reasonFor, ALLOWED } = require('../lib/list-allowance');
  assert.strictEqual(reasonFor('routes/books.js', '/api/books/not-a-route'), null);
  assert.strictEqual(reasonFor('routes/books.js', '/api/books/trial-balance'), ALLOWED['books.js /trial-balance']);
});
check('a POST is not a read', () => assert.strictEqual(facts('x', { method: 'POST' }).kind, 'n/a'));
check('a constant name resolves to its number', () => {
  assert.deepStrictEqual(sizeArgs('req.query, PAGE_DEFAULT, PAGE_MAX', { PAGE_DEFAULT: 100, PAGE_MAX: 500 }), { default: 100, max: 500 });
});
check('rows returned: the longest top-level array, and the answer total', () => {
  const res = { locals: {} };
  noteRows(res, { items: [1, 2, 3], tags: [1], total: 40, page: 1 });
  assert.deepStrictEqual([res.locals.rows, res.locals.rows_total], [3, 40]);
  const bare = { locals: {} };
  noteRows(bare, [1, 2]);
  assert.strictEqual(bare.locals.rows, 2);
  const none = { locals: {} };
  noteRows(none, { ok: true });
  assert.strictEqual(none.locals.rows, undefined);
});
check('the request line carries rows and total (null when not a list)', () => {
  const req = { id: 'r', method: 'GET', originalUrl: '/api/x', headers: {} };
  const line = requestLine(req, { statusCode: 200, locals: { rows: 7, rows_total: 90 } }, Date.now());
  assert.deepStrictEqual([line.rows, line.total], [7, 90]);
  assert.deepStrictEqual([requestLine(req, { statusCode: 200, locals: {} }, Date.now()).rows], [null]);
});
check('the register: every GET row carries the facts and the new list routes need a server maximum', () => {
  const register = require('../docs/api-register.json');
  const rows = register.routes;
  assert.ok(rows.every((row) => row.reported_facts && row.reported_facts.paged_read && typeof row.reported.paged_read === 'boolean'));
  const noMax = rows.filter((row) => row.reported_facts.paged_read.kind === 'list' && row.reported_facts.paged_read.max === null).map((row) => row.key);
  assert.ok(noMax.length <= 3, 'lists with no server maximum rose above 3: ' + noMax.join(', '));
});
check('docs/contracts/paged-read-routes.json (the web scan reads its copy) equals what the register says', () => {
  const fs = require('fs');
  const { textOf } = require('../tools/paged-reads-routes.cjs');
  const file = fs.readFileSync(__dirname + '/../docs/contracts/paged-read-routes.json', 'utf8').split(String.fromCharCode(13)).join('');
  assert.strictEqual(file, textOf(require('../docs/api-register.json')), 'run node tools/paged-reads-routes.cjs');
});
check('the report lists a route over the line, worst first, and counts a line with no rows as unmeasured', () => {
  const { reportOf } = require('../tools/paged-reads-report.cjs');
  const line = (route, rows, total) => JSON.stringify({ msg: 'request', method: 'GET', status: 200, route, rows, total, seat: 'owner' });
  const r = reportOf([line('/api/a', 50), line('/api/b', 900, 900), line('/api/b', 20), line('/api/a', 150, 400), JSON.stringify({ msg: 'request', method: 'GET', status: 200, route: '/api/c' }), 'not json'], 100);
  assert.deepStrictEqual(r.routes.map((x) => [x.route, x.max_rows]), [['GET /api/b', 900], ['GET /api/a', 150]]);
  assert.strictEqual(r.unmeasured, 1);
});
check('a write is never a list: a non-GET is refused the column (n/a), and nothing is thrown for an empty read', () => {
  assert.strictEqual(facts('res.json({ items: [] })', { method: 'POST' }).kind, 'n/a');
  assert.deepStrictEqual(causesOf(null), []);
});
check('the drive tool counts the longest list of an answer, refuses nothing it cannot read, and a box that is down is status -1', () => {
  const { rowsOf, answerOf } = require('../tools/paged-reads-drive.cjs');
  assert.strictEqual(rowsOf({ items: [1, 2, 3], tags: [1] }), 3);
  assert.strictEqual(rowsOf([1, 2]), 2);
  assert.strictEqual(rowsOf({ ok: true }), -1);
  assert.deepStrictEqual([answerOf('{"items":[1],"total":9}').rows, answerOf('{"items":[1],"total":9}').total], [1, 9]);
  assert.strictEqual(answerOf('<html>').rows, -1);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

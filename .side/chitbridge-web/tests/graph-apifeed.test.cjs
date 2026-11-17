'use strict';
/* tools/graph/apifeed.cjs (FEEDGRAPH): every source joins what it says it joins, on the knowledge-graph fixture where the truth is known.
 * Unit level: feed() gets a hand-made context (no scan of the repos), so a break names the one source that broke.
 * Run: node tests/graph-apifeed.test.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { feed, parseLessons, parseLessonsChecked } = require('../tools/graph/apifeed.cjs');

const FIXTURE = path.join(__dirname, '..', 'tools', 'graph', 'fixture');
const API = path.join(FIXTURE, 'api');
const HOME = path.join(FIXTURE, 'home');
let passed = 0;
const ok = (cond, what) => {
  assert(cond, what);
  passed++;
  console.log('  ok  ' + what);
};

/** a graph context over the fixture: the four register routes, one pay test, the pay lib file, and recorders for nodes and edges */
function makeContext(overrides) {
  const nodes = new Map();
  const edges = [];
  const route = (routePath, start, end) => ({ id: 'route:api:routes/books.js GET ' + routePath, method: 'GET', path: '/api/books' + routePath, tail: routePath, file: 'routes/books.js', start, end });
  const payment = Object.assign(route('/payments', 0, 100), { method: 'POST', id: 'route:api:routes/books.js POST /payments' });
  const routes = [payment, route('/status', 100, 200), route('/never', 200, 300), route('/orphan', 300, 400)];
  payment.fileRec = { scan: { strings: [{ start: 10, text: 'PAY_REFUSED' }, { start: 150, text: 'NEVER_USED' }] } };
  const byId = new Map([['test:api:tests/pay.test.cjs', {}], ['file:api:lib/pay.js', {}]]);
  const ctx = {
    A: API,
    HOME,
    node: (id, fields) => nodes.set(id, Object.assign(nodes.get(id) || { id }, fields)),
    edge: (from, to, kind, via) => edges.push({ from, to, kind, via }),
    byId,
    routes,
    files: [{ repo: 'api', rel: 'lib/pay.js', id: 'file:api:lib/pay.js', kind: 'lib' }],
    norm: (value) => value,
    meta: { notes: [] },
    present: { api: true }
  };
  return Object.assign(ctx, overrides || {}, { nodes, edges });
}
const hasEdge = (ctx, from, to, kind, via) => ctx.edges.some((edge) => edge.from === from && edge.to === to && edge.kind === kind && (via === undefined || edge.via === via));

/* 1 · parseLessons reads the audit table */
const lessons = parseLessons(fs.readFileSync(path.join(HOME, 'PM', 'API-LESSONS-AUDIT-fixture.md'), 'utf8'));
ok(lessons.length === 4 && lessons.map((lesson) => lesson.verdict).join() === 'addressed,rule-only,not-addressed,addressed', 'parseLessons: four rows, verdicts addressed / rule-only / not-addressed / addressed (partly)');
ok(lessons[3].partial === true && parseLessons('not a table row').length === 0, 'parseLessons: a "(partly)" verdict is flagged, a non-row line is skipped');

/* 2 · the whole feed on the fixture */
const ctx = makeContext();
feed(ctx);
const stats = ctx.meta.apiFeed;
ok(stats.routesJoined === 4 && stats.registerNotInScan === 0 && stats.scanNotInRegister === 0, 'feed: all four register rows join the four scanned routes');
ok(ctx.nodes.get('route:api:routes/books.js POST /payments').reg.signed === true && ctx.nodes.get('route:api:routes/books.js GET /never').reg.status === 'not started', 'feed: the register status and sign-off land on the route node');
ok(hasEdge(ctx, 'route:api:routes/books.js GET /status', 'check:api:docs/contracts/api-error-tests.json', 'tested-by', 'error-tests-refusal'), 'feed: a 401/500-only error-tests row becomes a WEAK tested-by edge (error-tests-refusal) when no sweep names the file');
ok(hasEdge(ctx, 'route:api:routes/books.js GET /orphan', 'check:api:tools/api-contract-tests.cjs', 'tested-by', 'contract') && ctx.nodes.get('route:api:routes/books.js GET /orphan').contractCases === 2, 'feed: a contract-results row becomes a tested-by edge with its case count');
ok(stats.testedByFeed === 2 && stats.evidenceRows === 0, 'feed: two proofs counted, no evidence rows in the fixture');
ok(hasEdge(ctx, 'route:api:routes/books.js POST /payments', 'errcode:PAY_REFUSED', 'returns', 'literal') && !hasEdge(ctx, 'route:api:routes/books.js POST /payments', 'errcode:NEVER_USED', 'returns') && ctx.nodes.has('errcode:NEVER_USED'), 'feed: a route returns only the code its own text names; an unused code is still a node');
ok(ctx.nodes.get('test:api:tests/pay.test.cjs').level === 'T1' && stats.libraryMatched === 1, 'feed: the test library gives the known test its level');
ok(hasEdge(ctx, 'lesson:api:1', 'test:api:tests/pay.test.cjs', 'enforced-by', 'audit') && hasEdge(ctx, 'lesson:api:1', 'file:api:lib/pay.js', 'mentions', 'audit') && !hasEdge(ctx, 'lesson:api:1', 'file:api:lib/pay.js', 'enforced-by') && ctx.nodes.get('lesson:api:2').gap === true && ctx.nodes.get('lesson:api:3').verdict === 'not-addressed', 'feed: fix 4: lesson 1 is enforced by its test and only MENTIONS lib/pay.js (via audit); lessons 2 and 3 are gaps');
ok(stats.lessons === 4 && ctx.nodes.get('lesson:api:4').partly === true && !ctx.nodes.get('lesson:api:4').gap && ctx.nodes.get('lesson:api:1').checksFound === 1, 'feed: four lessons counted (lesson 4 is partly, not a gap), lesson 1 found its one check');
ok(ctx.meta.notes.some((note) => /api-hardening-evidence-areas\.json is absent/.test(note)), 'feed: the absent areas-evidence file is SAID in the notes, not an error');

/* 3 · when the api repo is absent nothing is joined and the counts say zero */
const absent = makeContext({ present: { api: false } });
feed(absent);
ok(absent.meta.apiFeed.routesJoined === 0 && absent.nodes.size === 0 && absent.edges.length === 0, 'feed: api absent → zero counts, no node, no edge');

/* 4 · a register that is not there, or does not parse, is said (with the reason) and the routes carry no register columns */
const emptyApi = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-apifeed-'));
fs.mkdirSync(path.join(emptyApi, 'docs'));
fs.writeFileSync(path.join(emptyApi, 'docs', 'api-register.json'), '{ not json');
const broken = makeContext({ A: emptyApi, HOME: emptyApi });
feed(broken);
ok(broken.meta.notes.some((note) => /could not read .*api-register\.json/.test(note)) && broken.meta.notes.some((note) => /api-register\.json is missing or unreadable/.test(note)), 'feed: an unreadable register says why and what the reader gets instead');
ok(broken.meta.notes.some((note) => /error-codes\.json is missing/.test(note)) && broken.meta.notes.some((note) => /TEST-LIBRARY\.json not found/.test(note)) && broken.meta.notes.some((note) => /API-LESSONS-AUDIT/.test(note)), 'feed: every missing source is named in the notes');
ok(!broken.nodes.has('route:api:routes/books.js GET /never') || broken.nodes.get('route:api:routes/books.js GET /never').reg === undefined, 'feed: no register → no register columns on any route');
fs.rmSync(emptyApi, { recursive: true, force: true });

console.log(passed + ' passed');

/* 5 · the critic's six points (web PR #390), each on a small throw-away api folder */
/** a throw-away api folder holding docs/api-register.json and any generated files named in `files` ({ 'docs/contracts/x.json': object }) */
function tempApi(register, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-apifeed-'));
  fs.mkdirSync(path.join(dir, 'docs', 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'api-register.json'), JSON.stringify(register));
  Object.entries(files || {}).forEach(([name, body]) => fs.writeFileSync(path.join(dir, name), JSON.stringify(body)));
  return dir;
}
const registerRow = (method, routePath, key) => ({ key: key || method + ' ' + routePath, method, path: routePath, owner_area: 'books', file: 'routes/books.js', columns: {}, declared: [], notes: [], human: {}, status: 'partial' });
const PAY = 'route:api:routes/books.js POST /payments';
const STATUS = 'route:api:routes/books.js GET /status';

/* fix 1 · an error-tests row with a handler status is proof; one with only 401/403/500 is weak */
const strengthDir = tempApi({ routes: [registerRow('POST', '/api/books/payments'), registerRow('GET', '/api/books/status')] }, { 'docs/contracts/api-error-tests.json': { 'POST /api/books/payments': [200, 401], 'GET /api/books/status': [401, 403, 500] } });
const strength = makeContext({ A: strengthDir, HOME: strengthDir });
feed(strength);
ok(hasEdge(strength, PAY, 'check:api:docs/contracts/api-error-tests.json', 'tested-by', 'error-tests') && hasEdge(strength, STATUS, 'check:api:docs/contracts/api-error-tests.json', 'tested-by', 'error-tests-refusal'), 'fix 1: a row with a handler status is via error-tests, a 401/403/500-only row is via error-tests-refusal');

/* fix 2 · a contract row with failed > 0 is no proof; evidence with every flag false is no proof */
const failedDir = tempApi(
  { routes: [registerRow('POST', '/api/books/payments'), registerRow('GET', '/api/books/status')] },
  {
    'docs/contracts/api-contract-results.json': { routes: { 'POST /api/books/payments': { cases: 3, failed: 1 }, 'GET /api/books/status': { cases: 2, failed: 0 } } },
    'docs/contracts/api-hardening-evidence.json': { routes: { 'POST /api/books/payments': { output_allowlist: false }, 'GET /api/books/status': { output_allowlist: true } } }
  }
);
const failed = makeContext({ A: failedDir, HOME: failedDir });
feed(failed);
ok(!hasEdge(failed, PAY, 'check:api:tools/api-contract-tests.cjs', 'tested-by') && hasEdge(failed, STATUS, 'check:api:tools/api-contract-tests.cjs', 'tested-by', 'contract') && failed.meta.apiFeed.contractFailed === 1, 'fix 2: a contract row with failed > 0 makes no tested-by edge (and is counted); a passing one does');
ok(!failed.edges.some((edge) => edge.from === PAY && edge.via === 'evidence') && hasEdge(failed, STATUS, 'check:api:docs/contracts/api-hardening-evidence.json', 'tested-by', 'evidence'), 'fix 2: evidence with every flag false makes no tested-by edge; one true flag does');

/* fix 5 · two register rows for one route node: both are kept, the collision is counted and said */
const collideDir = tempApi({ routes: [registerRow('GET', '/api/books/status', 'GET /api/books/status'), registerRow('GET', '/api/books/status', 'GET /api/network/status')] });
const collide = makeContext({ A: collideDir, HOME: collideDir });
feed(collide);
ok(collide.nodes.get(STATUS).reg.key === 'GET /api/books/status' && collide.nodes.get(STATUS).regAlso.length === 1 && collide.nodes.get(STATUS).regAlso[0].key === 'GET /api/network/status', 'fix 5: the second register row is kept in regAlso, the first reg is not overwritten');
ok(collide.meta.apiFeed.registerCollisions.length === 1 && collide.meta.notes.some((note) => /rows map to a route another row already owns/.test(note)), 'fix 5: the collision is counted in meta.apiFeed and said in the notes');

/* fix 6 · columns by header name; no header = refused; repeated ids and bold verdicts */
const HEAD = '| # | Ledger | Lesson | Notes | By what | Status |\n|---|---|---|---|---|---|\n';
const reordered = parseLessons(HEAD + '| 1 | 4 | one | n | `x.js` | **ADDRESSED** |');
ok(reordered.length === 1 && reordered[0].verdict === 'addressed' && reordered[0].by === '`x.js`', 'fix 6: Status and "By what" are found by header name (reordered columns, a bold verdict still reads)');
const refused = parseLessonsChecked(['| a | b |', '|---|---|', '| 1 | ADDRESSED |'].join('\n'));
ok(refused.lessons.length === 0 && /no table header/.test(refused.problems[0]), 'fix 6: a table without the Status / "By what" headers is refused with a problem, not read by position');
const repeated = parseLessonsChecked(HEAD + ['| defect | 1 | a | n | `x.js` | ADDRESSED |', '| defect | 2 | b | n | `y.js` | RULE ONLY |'].join('\n'));
ok(repeated.lessons.map((lesson) => lesson.id).join() === 'defect,defect#2' && /repeats lesson id\(s\) defect/.test(repeated.problems[0]), 'fix 6: a repeated lesson id is kept as its own node (defect#2) and reported');
const noHeader = tempApi({ routes: [] });
fs.mkdirSync(path.join(noHeader, 'PM'));
fs.writeFileSync(path.join(noHeader, 'PM', 'API-LESSONS-AUDIT-x.md'), '| 1 | 4 | text | ADDRESSED | `x.js` |');
const refusedFeed = makeContext({ A: noHeader, HOME: noHeader });
feed(refusedFeed);
ok(refusedFeed.meta.apiFeed.lessons === 0 && refusedFeed.meta.notes.some((note) => /no table header with "Status"/.test(note)), 'fix 6: the feed says in meta.notes that the audit was refused');

[strengthDir, failedDir, collideDir, noHeader].forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
console.log('\n' + passed + ' checks passed');

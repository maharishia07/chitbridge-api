/**
 * e2e/knowledge-graph.cjs — THE GRAPH TOOL READS WHAT IT CLAIMS TO (KG1, 2026-10-12). Offline: no browser, no server, no npm install.
 *
 * tools/graph/graph.cjs builds the call graph + the joined knowledge graph over three repos and reasons over it (impact · changed ·
 * gaps). A scanner that under-matches reports its own blindness as a fact about the code (api tools/endpoint-usage.cjs learned that
 * three times in one session), so this test pins every join on a FIXTURE where the truth is known (tools/graph/fixture/):
 *   1. build on the fixture: every node kind · screen→fn (dispatch) · fn→fn · fn→route (http) · route→lib fn · fn→table · step→code ·
 *      code→test · adopted copy→engines source · pack
 *   2. impact payScreen names the step, the screen, the route and BOTH tests (api + web)
 *   3. gaps names the untested step, the orphan route, the untouched table and the function on no flow — with the right counts
 *   4. changed <range> on a throw-away git repo of the fixture: an edit inside pay.post names the api test; a doc edit names nothing
 *   5. the guard bites: impact on an invented name exits 1
 *   6. the REAL repos: with ../chitbridge-api beside this checkout, sendChit → POST /api/chits/send is a known truth; without it
 *      (web CI) the web half is built and the cross-repo parts are shape-checked, and SAID (the pattern of e2e/process-map.cjs)
 *
 * Run: node e2e/knowledge-graph.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'graph', 'graph.cjs');
const FIX = path.join(ROOT, 'tools', 'graph', 'fixture');
const API = path.join(ROOT, '..', 'chitbridge-api');
const EU = path.join(API, 'tools', 'endpoint-usage.cjs');
const haveApi = fs.existsSync(API);
const haveEU = fs.existsSync(EU);

let bad = 0;
const ok = (cond, what) => { if (cond) console.log('  ✓ ' + what); else { bad++; console.log('  ✗ ' + what); } };
const run = (args, opts) => spawnSync(process.execPath, [TOOL].concat(args), Object.assign({ encoding: 'utf8', maxBuffer: 256 << 20 }, opts || {}));
const roots = (fix) => ['--roots', 'web=' + path.join(fix, 'web') + ',api=' + path.join(fix, 'api') + ',engines=' + path.join(fix, 'engines')];

console.log('');
/* ── 1 · build on the fixture ────────────────────────────────────────────────────────────────────────────────────── */
const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-graph-'));
const buildArgs = ['build'].concat(roots(FIX), ['--out', out1, '--home', path.join(FIX, 'home')], haveEU ? ['--endpoint-usage', EU] : []);
const b = run(buildArgs);
ok(b.status === 0, 'build on the fixture exits 0' + (b.status ? '\n' + b.stdout + b.stderr : ''));
const G = JSON.parse(fs.readFileSync(path.join(out1, 'graph.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(out1, 'calls.json'), 'utf8'));
const ids = new Set(G.nodes.map((n) => n.id));
const has = (from, to, kind, via) => G.edges.some((e) => e.from === from && e.to === to && e.kind === kind && (via == null || e.via === via));
const kinds = {}; G.nodes.forEach((n) => { kinds[n.kind] = (kinds[n.kind] || 0) + 1; });
ok(['step', 'screen', 'function', 'route', 'table', 'test', 'pack', 'file'].every((k) => kinds[k] > 0), 'every node kind is present: ' + JSON.stringify(kinds));
ok(ids.has('screen:web:public/app.html#pay') && G.nodes.find((n) => n.id === 'screen:web:public/app.html#pay').code === 'PAY001', 'the nav screen carries its CBSCREENS code (PAY001)');
ok(has('screen:web:public/app.html#pay', 'fn:web:public/app.html#payScreen', 'calls', 'dispatch'), 'screen #pay → payScreen (UI.nav dispatch)');
ok(has('fn:web:public/app.html#payScreen', 'fn:web:public/app.html#paintPay', 'calls'), 'payScreen → paintPay (a call)');
ok(has('fn:web:public/app.html#paintPay', 'fn:web:public/app/cap-pay.js#fmtAmt', 'calls'), 'paintPay → fmtAmt (across files, one window)');
ok(has('fn:web:public/app.html#paintPay', 'fn:web:public/app.html#payAgain', 'calls', 'handler'), 'paintPay → payAgain (onclick inside a template string)');
ok(has('screen:web:public/app.html', 'fn:web:public/app.html#payScreen', 'calls', 'markup'), 'page markup onclick → payScreen');
ok(has('fn:web:public/app/cap-pay.js#fmtAmt', 'fn:web:public/engine/money.js#round', 'calls', 'member'), 'fmtAmt → CBMoney.round (a global holder → the engine copy)');
ok(has('fn:web:public/app/cap-pay.js#payLater', 'fn:web:public/app/cap-pay.js#paintPayLater', 'calls', 'ref'), 'payLater → paintPayLater (a callback passed by name)');
ok(!ids.has('fn:web:public/app.html#notReal'), 'a "function" inside a comment is not a declaration');
const ROUTE = 'route:api:routes/books.js POST /payments';
ok(ids.has(ROUTE) && G.nodes.find((n) => n.id === ROUTE).path === '/api/books/payments', 'the route node exists with its mounted path');
if (haveEU) ok(has('fn:web:public/app.html#paintPay', ROUTE, 'calls', 'http'), 'paintPay → POST /api/books/payments through api(\'pay\') and the registry (endpoint-usage.cjs --json)');
else { console.log('  · api(\'key\') → route join needs ../chitbridge-api/tools/endpoint-usage.cjs beside this checkout — checked by shape only here'); ok(G.meta.endpointUsage === 'absent' && G.meta.notes.some((n) => /endpoint-usage/.test(n)), 'and the build SAYS the registry join was skipped'); }
ok(has('fn:web:public/app.html#orphanRead', 'route:api:routes/books.js GET /orphan', 'calls', 'http'), 'orphanRead → GET /api/books/orphan through a fetch(\'/api/…\') literal');
ok(has(ROUTE, 'fn:api:lib/pay.js#post', 'calls', 'member'), 'route → pay.post (a required lib function)');
ok(has(ROUTE, 'table:books_setting', 'reads'), 'route reads books_setting (SQL in the handler)');
ok(has('fn:api:lib/pay.js#post', 'table:books_payment', 'writes') && has('fn:api:lib/pay.js#post', 'table:chit_header', 'reads'), 'pay.post writes books_payment and reads chit_header');
ok(G.nodes.find((n) => n.id === 'table:never_touched') && G.nodes.find((n) => n.id === 'table:never_touched').declared === true, 'never_touched is a declared table (from the migration)');
ok(has('step:O2C/1', 'fn:web:public/app.html#payScreen', 'implements') && has('step:O2C/1', ROUTE, 'implements') && has('step:O2C/1', 'fn:engines:src/money.js#round', 'implements'), 'step O2C/1 implements its screen fn, its route and its engine fn');
ok(has('step:O2C/1', 'test:api:tests/pay.test.cjs', 'tested-by', 'flows.json'), 'step O2C/1 is tested-by the test flows.json names');
ok(has('fn:api:lib/pay.js#post', 'test:api:tests/pay.test.cjs', 'tested-by'), 'pay.post is tested-by the api test that requires it');
ok(has(ROUTE, 'test:api:tests/pay.test.cjs', 'tested-by', 'http'), 'the route is tested-by the api test that calls it (call(\'POST\', \'/api/…\'))');
ok(has('screen:web:public/app.html#pay', 'test:web:e2e/pay.cjs', 'tested-by', 'opens') && has('fn:web:public/app.html#payScreen', 'test:web:e2e/pay.cjs', 'tested-by'), 'the web test opens #/app/pay and evaluates payScreen');
ok(has('file:api:lib/money.js', 'file:engines:src/money.js', 'vendors') && has('file:web:public/engine/money.js', 'file:engines:src/money.js', 'vendors'), 'both adopted copies point back to engines src/money.js (vendors)');
ok(ids.has('pack:engines:src/reg-xx.js') && G.nodes.find((n) => n.id === 'pack:engines:src/reg-xx.js').code === 'XX', 'the regulation pack is a node');
ok(has('fn:engines:src/money.js#round', 'test:engines:tests/money.test.js', 'tested-by'), 'engines round is tested-by the engines test');
ok(G.meta.notes.some((n) => /decisions file/.test(n)), 'the build SAYS no decisions file exists (decided-by skipped)');
/* screen→route comes through the api('key') registry join, so it needs endpoint-usage.cjs beside the checkout (as line 58) — in web CI
   the api is absent and the join is checked by shape only (CI run 38321611157 failed here before this split) */
ok(C.functions.length > 10 && C.calls.length > 3 && Array.isArray(C.screenToRoute), 'calls.json carries functions, calls and a screen→route list');
if (haveEU) ok(C.screenToRoute.some((x) => x[0] === 'screen:web:public/app.html#pay'), '…and screen→route holds the pay screen (registry join)');

/* ── 2 · impact ──────────────────────────────────────────────────────────────────────────────────────────────────── */
const imp = run(['impact', 'payScreen', '--json', '--out', out1]);
let I = {}; try { I = JSON.parse(imp.stdout); } catch (_) {}
ok(imp.status === 0 && I.steps && I.steps.includes('step:O2C/1'), 'impact payScreen → step O2C/1');
ok(I.screens && I.screens.includes('screen:web:public/app.html#pay') && I.screens.includes('screen:web:public/app.html'), 'impact payScreen → the nav screen and the page');
ok(I.tests && I.tests.includes('test:api:tests/pay.test.cjs') && I.tests.includes('test:web:e2e/pay.cjs'), 'impact payScreen → both tests (api via the step, web via the screen)');
const impT = run(['impact', 'books_payment', '--json', '--out', out1]);
let IT = {}; try { IT = JSON.parse(impT.stdout); } catch (_) {}
ok(impT.status === 0 && IT.routes && IT.routes.includes(ROUTE) && IT.tests.includes('test:api:tests/pay.test.cjs'), 'impact books_payment (a table) → the route that reaches it and its test');

/* ── 3 · gaps ────────────────────────────────────────────────────────────────────────────────────────────────────── */
const gp = run(['gaps', '--json', '--out', out1]);
let Gp = {}; try { Gp = JSON.parse(gp.stdout); } catch (_) {}
ok(gp.status === 0 && Gp.stepsNoTest && Gp.stepsNoTest.total === 2 && Gp.stepsNoTest.noTestAtAll === 1 && /O2C step 2/.test(Gp.stepsNoTest.list[0]), 'gaps: 1 of 2 built steps has no test (O2C step 2)');
ok(Gp.stepsMissing && Gp.stepsMissing.length === 1, 'gaps: the MISSING step is listed apart, not as untested');
ok(Gp.routesNoScreen && Gp.routesNoScreen.total === 4 && Gp.routesNoScreen.uncalledByWeb === 1 && Gp.routesNoScreen.examples[0] === 'GET /api/books/never', 'gaps: 1 of 4 routes has no screen call (GET /api/books/never) — /status counts as called through the onclick handler');
ok(Gp.tablesNoRoute && Gp.tablesNoRoute.declared === 4 && Gp.tablesNoRoute.noRouteTouches === 1 && Gp.tablesNoRoute.list[0] === 'never_touched', 'gaps: 1 of 4 tables is touched by no route (never_touched)');
ok(Gp.functionsOnNoFlow && Gp.functionsOnNoFlow.off >= 2 && Gp.functionsOnNoFlow.total > Gp.functionsOnNoFlow.off, 'gaps: functions on no flow counted (helperUnused, unusedHelper …) and fewer than all');

/* ── 3b · FEEDGRAPH (tools/graph/apifeed.cjs): the api registers, tests, error codes and lessons audit, joined ───────────────────── */
const regOf = (id) => (G.nodes.find((n) => n.id === id) || {}).reg || {};
ok(regOf(ROUTE).status === 'meets standard' && regOf(ROUTE).signed === true && regOf(ROUTE).owner_area === 'books' && regOf(ROUTE).columnsPassing === 2, 'feed: the route node carries its register status, owner, columns and sign-off');
ok(regOf('route:api:routes/books.js GET /never').status === 'not started' && regOf('route:api:routes/books.js GET /never').signed === false, 'feed: an unsigned, not-started route says so');
ok(has('route:api:routes/books.js GET /status', 'check:api:docs/contracts/api-error-tests.json', 'tested-by', 'error-tests-refusal'), 'feed: an api-error-tests.json row of only 401/500 becomes a WEAK tested-by edge (via error-tests-refusal)');
ok(has('route:api:routes/books.js GET /orphan', 'check:api:tools/api-contract-tests.cjs', 'tested-by', 'contract'), 'feed: an api-contract-results.json row becomes a tested-by edge (via contract)');
ok(has(ROUTE, 'errcode:PAY_REFUSED', 'returns') && ids.has('errcode:NEVER_USED'), 'feed: route → errcode from the code literal in the route text; an unused code is still a node');
ok((G.nodes.find((n) => n.id === 'test:api:tests/pay.test.cjs') || {}).level === 'T1', 'feed: the test library gives the test node its level');
ok(has('lesson:api:1', 'test:api:tests/pay.test.cjs', 'enforced-by', 'audit') && has('lesson:api:1', 'file:api:lib/pay.js', 'mentions', 'audit') && !has('lesson:api:1', 'file:api:lib/pay.js', 'enforced-by') && (G.nodes.find((n) => n.id === 'lesson:api:2') || {}).gap === true && (G.nodes.find((n) => n.id === 'lesson:api:3') || {}).verdict === 'not-addressed', 'feed: lesson 1 is enforced by its test and only MENTIONS lib/pay.js (a lib file is named, not run in CI); lessons 2 and 3 are gaps');
ok(G.meta.notes.some((n) => /api-hardening-evidence-areas\.json is absent/.test(n)), 'feed: the absent areas-evidence file (api #337) is SAID, not an error');
ok(Gp.routesNoProof && Gp.routesNoProof.total === 4 && Gp.routesNoProof.unproven === 1 && Gp.routesNoProof.weakOnly === 1 && Gp.routesNoProof.weakOnlyRefusal === 1 && Gp.routesNoProof.strong === 2 && /^GET \/api\/books\/never/.test(Gp.routesNoProof.examples[0]) && Gp.routesNoProof.byRegisterStatus['not started'] === 1, 'gaps 6: 1 of 4 routes has no test of any kind (GET /api/books/never, not started), 1 has a refusal-only row (weak), 2 are strong');
ok(Gp.lessonsNoCheck && Gp.lessonsNoCheck.total === 4 && Gp.lessonsNoCheck.unenforced === 2 && Gp.lessonsNoCheck.partly === 1 && Gp.lessonsNoCheck.ruleOnly === 1 && Gp.lessonsNoCheck.notAddressed === 1, 'gaps 7: 2 of 4 lessons are enforced by nothing (1 rule only, 1 not addressed) and 1 only partly');

/* ── 4 · changed <range> on a throw-away git repo of the fixture ────────────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-graph-git-'));
fs.cpSync(FIX, tmp, { recursive: true });
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'kg1', GIT_AUTHOR_EMAIL: 'kg1@x', GIT_COMMITTER_NAME: 'kg1', GIT_COMMITTER_EMAIL: 'kg1@x' }) });
const apiDir = path.join(tmp, 'api');
let gitOk = git(['init', '-q'], apiDir).status === 0 && git(['add', '-A'], apiDir).status === 0 && git(['commit', '-q', '-m', 'fixture'], apiDir).status === 0;
if (gitOk) {
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-graph-'));
  const b2 = run(['build'].concat(roots(tmp), ['--out', out2], haveEU ? ['--endpoint-usage', EU] : []));
  ok(b2.status === 0, 'build on the git copy exits 0');
  const payJs = path.join(apiDir, 'lib', 'pay.js');
  fs.writeFileSync(payJs, fs.readFileSync(payJs, 'utf8').replace("const amount = round(body.amount_minor);", "const amount = round(body.amount_minor); /* edited */"));
  fs.writeFileSync(path.join(apiDir, 'README.md'), 'a doc\n');
  git(['add', '-A'], apiDir);
  const ch = run(['changed', 'HEAD', '--repo', 'api', '--json', '--out', out2].concat(roots(tmp)));
  let Ch = {}; try { Ch = JSON.parse(ch.stdout); } catch (_) {}
  ok(ch.status === 0 && Ch.touched && Ch.touched.some((t) => t.file === 'lib/pay.js' && t.functions === 1), 'changed HEAD (api): the edit lands inside pay.post (1 function touched)');
  ok(Ch.touched && Ch.touched.some((t) => t.file === 'README.md' && t.unknown), 'changed HEAD: the doc edit is reported as not in the graph');
  ok(Ch.tests && Ch.tests.includes('test:api:tests/pay.test.cjs') && Ch.steps.includes('step:O2C/1'), 'changed HEAD → the api test and step O2C/1');
  ok(Ch.tests && Ch.tests.includes('test:web:e2e/pay.cjs'), 'changed HEAD → the web test too (route ← paintPay ← payScreen ← the web test)');
} else console.log('  · git is not available: `changed` is not exercised here');

/* ── 5 · the guard bites ─────────────────────────────────────────────────────────────────────────────────────────── */
const bite = run(['impact', 'fnNobodyEverWrote', '--out', out1]);
ok(bite.status === 1 && /nothing in the graph/.test(bite.stdout), 'impact on an invented name exits 1 and says so');

/* ── 6 · the real repos ──────────────────────────────────────────────────────────────────────────────────────────── */
const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-graph-'));
const real = run(['build', '--out', out3]);
ok(real.status === 0, 'build on the real repos exits 0' + (real.status ? '\n' + real.stdout + real.stderr : ''));
const R = JSON.parse(fs.readFileSync(path.join(out3, 'graph.json'), 'utf8'));
const rids = new Set(R.nodes.map((n) => n.id));
ok(rids.has('fn:web:public/app.html#sendChit') && rids.has('screen:web:public/app.html#task') && rids.has('step:O2C/3'), 'the real web: sendChit, screen #task and step O2C/3 are nodes');
ok(R.nodes.filter((n) => n.kind === 'function' && n.repo === 'web').length > 3000 && R.nodes.filter((n) => n.kind === 'test' && n.repo === 'web').length > 100, 'the real web: thousands of functions, hundreds of tests');
if (haveApi) {
  const SEND = 'route:api:routes/chits.js POST /send';
  ok(rids.has(SEND) && R.nodes.find((n) => n.id === SEND).path === '/api/chits/send', 'the real api: POST /api/chits/send is a route node with its mounted path');
  ok(R.edges.some((e) => e.to === SEND && e.kind === 'calls' && e.via === 'http' && /^fn:web:/.test(e.from)), 'the real join: a web function calls POST /api/chits/send');
  ok(R.edges.some((e) => e.from === 'step:O2C/3' && e.to === SEND && e.kind === 'implements'), 'the real join: step O2C/3 implements POST /api/chits/send');
  ok(R.nodes.some((n) => n.kind === 'table' && n.name === 'chit_header' && n.declared), 'the real api: chit_header is a declared table');
  ok(rids.has('route:api:server.js GET /health'), 'the real api: the app own GET /health is a route node of server.js (W2: the register lists it, a module must serve it)');
} else {
  console.log('  · ../chitbridge-api is not beside this checkout: routes, tables, api functions and the screen→route join are checked by SHAPE only');
  ok(R.meta.present.api === false && R.meta.notes.some((n) => /chitbridge-api is not beside/.test(n)), 'and the build SAYS the api half is absent');
  ok(!R.nodes.some((n) => n.kind === 'route'), 'no route node is invented without the api');
}

console.log('\n' + (bad ? '✗ ' + bad + ' FAILED — the graph tool no longer reads what it claims to\n' : '✓ the graph tool reads what it claims to' + (haveApi ? '' : ' (api half by shape only)') + '\n'));
process.exit(bad ? 1 : 0);

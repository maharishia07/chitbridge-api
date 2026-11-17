/**
 * tests/resource-cap.test.cjs — column 16 (resource_cap, OWASP API4:2023): the three static claims, the named limiters, and the promise that the column is REPORTED only.
 * Proves: a list read's limit must be capped through bounds or page-limit (a hand Math.min is not) · every route reads a NAMED limiter (the global one is named) · a mail, SMS or AI write needs its
 * own limiter tighter than the global · the limiter keeps its name and still answers the one 429 Problem · every rateLimit( in the code carries a name · the column never enters "meets".
 * Run: node tests/resource-cap.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
const cap = require('../lib/resource-cap');
const B = require('../lib/bounds');
const reported = require('../tools/api-reported.cjs');
const loader = require('../tools/load-app.cjs');

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};
const url = (props) => ({ type: 'object', properties: props, required: [] });
const one = { name: 'api-global', max: 500, own: false };

/* ── list_cap ── */
check('a list read with the B.limit bound is capped', cap.listCapProblems({ method: 'GET', urlSchema: url({ limit: B.limit() }), text: '' }).length === 0);
check('a list read with a limit and no maximum is refused', cap.listCapProblems({ method: 'GET', urlSchema: url({ limit: { type: 'integer' } }), text: '' })[0] === 'no_list_cap');
check('a declared maximum above the bounds limit is refused', cap.listCapProblems({ method: 'GET', urlSchema: url({ limit: { type: 'integer', maximum: B.LIMIT_MAX + 1 } }), text: '' })[0] === 'no_list_cap');
check('a list read that clamps through page-limit holds', cap.listCapProblems({ method: 'GET', urlSchema: null, text: 'pageArgs({ page: req.query.page, limit: req.query.limit }, 25, 100)' }).length === 0);
check('a hand Math.min on the query limit is a second helper, named adhoc_clamp', cap.listCapProblems({ method: 'GET', urlSchema: null, text: 'limit: Math.min(Number(req.query.limit) || 100, 500)' })[0] === 'adhoc_clamp');
check('a GET that takes no limit or page is no list read', cap.listCapProblems({ method: 'GET', urlSchema: url({ id: { type: 'string' } }), text: 'res.json({})' }).length === 0);
check('a write is never a list read', cap.listCapProblems({ method: 'POST', urlSchema: url({ limit: { type: 'integer' } }), text: '' }).length === 0);

/* ── named limiter and the own limit ── */
check('no limiter in front of a route is a cause', cap.limiterProblems({ method: 'GET', limiters: [], text: '', globalMax: 500 })[0] === 'no_named_limiter');
check('a limiter with no name is a cause', cap.limiterProblems({ method: 'GET', limiters: [{ name: null, max: 10, own: false }], text: '', globalMax: 500 })[0] === 'unnamed_limiter');
check('the named global limiter is enough for a plain read', cap.limiterProblems({ method: 'GET', limiters: [one], text: 'res.json({})', globalMax: 500 }).length === 0);
check('a write that sends mail with only the global limiter needs its own', cap.limiterProblems({ method: 'POST', limiters: [one], text: 'await sendEmail(a, b, c)', globalMax: 500 })[0] === 'no_own_limit');
check('a write that calls the AI with only the global limiter needs its own', cap.limiterProblems({ method: 'POST', limiters: [one], text: "await require('../lib/ai').invokeSkill(e, s, c)", globalMax: 500 })[0] === 'no_own_limit');
check('an own limiter as loose as the global is not tighter', cap.limiterProblems({ method: 'POST', limiters: [one, { name: 'x', max: 500, own: true }], text: 'await sendEmail()', globalMax: 500 })[0] === 'own_limit_not_tighter');
check('a tighter own limiter holds', cap.limiterProblems({ method: 'POST', limiters: [one, { name: 'x', max: 40, own: true }], text: 'await sendEmail()', globalMax: 500 }).length === 0);
check('a GET that mentions sending is no outbound write', cap.limiterProblems({ method: 'GET', limiters: [one], text: 'sendEmail()', globalMax: 500 }).length === 0);

/* ── the limiter keeps its name ── */
const { rateLimit } = require('../lib/rate-limit');
const named = rateLimit({ name: 'probe', windowMs: 1000, max: 3 });
check('rateLimit keeps the name and the budget on the middleware', named.limiterName === 'probe' && named.limiterBudget.max === 3 && typeof named.resetKey === 'function');
check('rateLimit without a name still limits and reads unnamed', !rateLimit({ windowMs: 1000, max: 3 }).limiterName);

/* ── every rateLimit( in the code is named (a new limiter must say what it is) ── */
const files = ['server.js'].concat(['routes', 'lib'].flatMap((dir) => fs.readdirSync(path.join(API, dir)).filter((f) => f.endsWith('.js')).map((f) => dir + '/' + f)));
const unnamed = [];
files.forEach((file) => {
  if (file === 'lib/rate-limit.js') return;
  const text = fs.readFileSync(path.join(API, file), 'utf8');
  for (const hit of text.matchAll(/(?<![\w.])(?:require\('\.\.\/lib\/rate-limit'\)\.)?rateLimit\(\{/g)) {
    if (!/name:\s*'/.test(text.slice(hit.index, hit.index + 120))) unnamed.push(file + ':' + text.slice(0, hit.index).split('\n').length);
  }
});
check('every rateLimit({ in server.js, routes and lib carries a name', unnamed.length === 0, unnamed.join(' · '));

/* ── the real stack ── */
loader.stubDatabase(API);
const leaves = loader.leavesOf(loader.loadApp(API), true);
const find = (method, route) => leaves.find((leaf) => leaf.method === method && leaf.path === route);
const stackOf = (method, route) => reported.limitersOf(find(method, route));
check('the global limiter is named api-global and reaches an /api route', stackOf('GET', '/api/products').some((item) => item.name === 'api-global' && !item.own));
check('the assistant route has its own named limiter below the global one', stackOf('POST', '/api/assist').some((item) => item.own && item.name === 'api-assist-ai' && item.max < 500));
check('the sign-in ask has its own named limiter', stackOf('POST', '/api/signin/ask').some((item) => item.own && item.name));
check('GET /health has no limiter in front of it (a real finding, reported)', stackOf('GET', '/health').length === 0);

/* ── reported only: the column is in REPORTED_COLUMNS, never in MACHINE_COLUMNS ── */
const register = JSON.parse(fs.readFileSync(path.join(API, 'docs', 'api-register.json'), 'utf8'));
check('resource_cap is a reported column', reported.REPORTED_COLUMNS.includes('resource_cap') && register.reported_columns.includes('resource_cap'));
check('resource_cap is not a machine column', !register.machine_columns.includes('resource_cap'));
check('every row carries resource_cap and its causes', register.routes.every((row) => typeof row.reported.resource_cap === 'boolean' && Array.isArray(row.reported_causes.resource_cap)));
check('a failing route names at least one known cause', register.routes.filter((row) => !row.reported.resource_cap).every((row) => row.reported_causes.resource_cap.length > 0 && row.reported_causes.resource_cap.every((cause) => cap.CAUSES.includes(cause))));

console.log('resource-cap: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

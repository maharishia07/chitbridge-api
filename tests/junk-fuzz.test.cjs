/**
 * tests/junk-fuzz.test.cjs — register column 17 (junk_fuzz, OWASP API4/API8), the UNIT half: the junk generator (lib/junk-fuzz.js) is deterministic and covers every kind of junk the column names,
 * the verdict counts a 5xx, a timeout, stack text, a non-Problem refusal and an unregistered code as a FAIL (a 429 is void, a good Problem 4xx and a 2xx pass), the reported column reads only the tool's evidence,
 * and the tool refuses a database that is not a throwaway. The LIVE half (every route as owner, staff and anon on a real Postgres) is tools/junk-fuzz.cjs, run on a SIT box; it alone writes the evidence.
 * Run: node tests/junk-fuzz.test.cjs
 * CARD: 28-platform-and-operations/api-standard
 * @type: unit
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const junk = require('../lib/junk-fuzz');
const reported = require('../tools/api-reported.cjs');

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  NOT OK ' + name + (extra ? '\n       ' + extra : ''));
  }
};

const ROUTE = { key: 'POST /api/things/:id', method: 'POST', path: '/api/things/:id', params: ['id'], query: ['limit'], body: { properties: { name: { type: 'string' }, qty: { type: 'integer' }, tags: { type: 'array' } }, required: ['name'] }, writes: ['things'] };
const GET = { key: 'GET /api/things', method: 'GET', path: '/api/things', params: [], query: [], body: null, writes: [] };

/* deterministic: the same route and seed give the same cases byte for byte; another seed or route does not */
const first = JSON.stringify(junk.casesOf(ROUTE, 17));
check('the same route and seed give the same cases', first === JSON.stringify(junk.casesOf(ROUTE, 17)));
check('another seed gives other cases', first !== JSON.stringify(junk.casesOf(ROUTE, 18)));
check('another route gives other cases', first !== JSON.stringify(junk.casesOf(Object.assign({}, ROUTE, { key: 'PUT /api/things/:id', method: 'PUT' }), 17)));
check('the generator reads no clock and no Math.random', !/Date\.now|new Date|Math\.random/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'junk-fuzz.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//, '')));
const once = junk.seeded(5);
const twice = junk.seeded(5);
check('the seeded generator repeats', [once(), once(), once()].join() === [twice(), twice(), twice()].join());

/* coverage of the junk the column names */
const cases = junk.casesOf(ROUTE, 17);
const kinds = new Set(cases.map((item) => item.kind));
['type', 'string', 'huge', 'unicode', 'number', 'depth', 'unknown_key', 'missing', 'shape', 'array', 'path', 'query'].forEach((kind) => check('a ' + kind + ' case is generated', kinds.has(kind)));
const text = JSON.stringify(cases.map((item) => [item.body, item.raw, item.path, item.query]));
check('SQL-looking text is sent', /DROP TABLE/.test(text));
check('JS-looking text is sent', /<script>/.test(text));
check('RTL and a NUL are sent', text.includes(String.fromCharCode(0x202e)) && text.includes('\\u0000'));
check('a negative and an infinite number are sent', cases.some((item) => /:-1[,}]/.test(item.raw || '')) && cases.some((item) => /1e999/.test(item.raw || '')));
check('a path param that is not an id is sent', cases.some((item) => item.kind === 'path' && item.path.includes('not-an-id')) && cases.some((item) => item.kind === 'path' && item.path.includes('%00')));
check('the path cases keep the route prefix', cases.filter((item) => item.kind === 'path').every((item) => item.path.startsWith('/api/things/')));
check('an oversized array and a deep nest are sent', cases.some((item) => Array.isArray(item.body) && item.body.length >= 10000) && cases.some((item) => /^\[{5000}/.test(item.raw || '')));
check('a missing-required case leaves the required field out', cases.some((item) => item.id === 'missing:name' && item.body.name === undefined));
check('a wrong-type case sends a value of another kind', cases.filter((item) => item.id === 'type:qty').every((item) => typeof item.body.qty !== 'number'));
check('a GET gets query and path junk but no body junk', junk.casesOf(GET, 17).every((item) => ['query', 'path'].includes(item.kind)) && junk.casesOf(GET, 17).length > 0);

/* the verdict */
const CODES = new Set(['INVALID_INPUT', 'NOT_FOUND']);
const problem = (status, code) => ({ status, text: JSON.stringify({ type: 'https://x/' + code, title: 'T', status, code }), body: { type: 'https://x/' + code, title: 'T', status, code }, contentType: 'application/problem+json' });
check('a registered Problem 4xx is good', junk.verdictOf(problem(422, 'INVALID_INPUT'), CODES) === null);
check('a 2xx with a plain answer is good', junk.verdictOf({ status: 200, text: '{"ok":true}', body: { ok: true } }, CODES) === null);
check('an answer carrying [object Object] counts as a fail, even a 201', (junk.verdictOf({ status: 201, text: '{"counter":{"name":"[object Object]"}}', body: { counter: { name: '[object Object]' } } }, CODES) || {}).kind === 'raw_text');
check('a 5xx counts as a fail', (junk.verdictOf({ status: 500, text: '{"status":500,"code":"INTERNAL"}', body: { status: 500, code: 'INTERNAL' } }, CODES) || {}).kind === '5xx');
check('a 503 counts as a fail', (junk.verdictOf({ status: 503, text: '', body: null }, CODES) || {}).kind === '5xx');
check('a timeout counts as a fail', (junk.verdictOf({ status: 0, text: '', body: null, timedOut: true }, CODES) || {}).kind === 'timeout');
check('a 429 is void, not a pass and not a fail', (junk.verdictOf(problem(429, 'RATE_LIMITED'), CODES) || {}).kind === 'void');
check('a 503 saying the door is switched off here is void, a 503 INTERNAL is a fail', (junk.verdictOf(problem(503, 'ADMIN_DISABLED'), CODES) || {}).kind === 'void' && (junk.verdictOf(problem(503, 'ASSIST_NOT_CONFIGURED'), CODES) || {}).kind === 'void' && (junk.verdictOf(problem(503, 'INTERNAL'), CODES) || {}).kind === '5xx');
check('a stack in a 4xx counts as a fail', (junk.verdictOf({ status: 400, text: 'Error: x\n    at handler (/app/routes/a.js:10:5)', body: null }, CODES) || {}).kind === 'raw_text');
check('a SQL error text in a 422 counts as a fail', (junk.verdictOf(Object.assign(problem(422, 'INVALID_INPUT'), { text: '{"detail":"invalid input syntax for type uuid"}' }), CODES) || {}).kind === 'raw_text');
check('the express HTML 404 counts as a fail', (junk.verdictOf({ status: 404, text: '<!DOCTYPE html><pre>Cannot GET /x</pre>', body: null }, CODES) || {}).kind === 'raw_text');
check('a 400 with no JSON body counts as a fail', (junk.verdictOf({ status: 400, text: 'Bad Request', body: null }, CODES) || {}).kind === 'shape');
check('a 4xx whose status disagrees with its body counts as a fail', (junk.verdictOf(Object.assign(problem(422, 'INVALID_INPUT'), { status: 400 }), CODES) || {}).kind === 'shape');
check('a 4xx with a code the register lacks counts as a fail', (junk.verdictOf(problem(422, 'MADE_UP'), CODES) || {}).kind === 'code');
check('a legacy body that also carries the Problem fields is good', junk.verdictOf({ status: 404, text: '{"error":"x"}', body: { error: 'x', type: 't', title: 'T', status: 404, code: 'NOT_FOUND' } }, CODES) === null);
check('only a 4xx is a refusal', junk.isRefusal(400) && junk.isRefusal(499) && !junk.isRefusal(200) && !junk.isRefusal(500));

/* the reported column: only the tool's evidence turns it on */
check('junk_fuzz is a reported column', reported.REPORTED_COLUMNS.includes('junk_fuzz'));
check('junk_fuzz reads only evidence junk_fuzz true', reported.junkFuzzColumn({ junk_fuzz: true }) === true && reported.junkFuzzColumn({}) === false && reported.junkFuzzColumn(undefined) === false && reported.junkFuzzColumn({ junk_fuzz: 'yes' }) === false);
const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'contracts', 'api-hardening-evidence-areas.json'), 'utf8'));
check('the evidence file claims junk_fuzz only as true', Object.values(evidence.routes).every((entry) => entry.junk_fuzz === undefined || entry.junk_fuzz === true));
const guards = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'guards-list.cjs'), 'utf8');
check('this test is enrolled in guards-list.cjs', /'junk-fuzz\.test\.cjs'/.test(guards));

/* the tool refuses a database that is not a throwaway cb_app one, and needs its inputs */
const run = (env) => spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'junk-fuzz.cjs'), '--base', 'http://127.0.0.1:1', '--plan', 'none.json'], { env: Object.assign({ PATH: process.env.PATH }, env), encoding: 'utf8' });
check('the tool refuses with no database', run({}).status === 3);
check('the tool refuses a database that is not cb_app on a known host', /REFUSED/.test(run({ DATABASE_URL: 'postgres://postgres:x@prod.example.com:5432/x', JWT_SECRET: 's' }).stderr));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

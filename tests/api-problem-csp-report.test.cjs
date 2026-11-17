#!/usr/bin/env node
// @type: contract
/**
 * api-problem-csp-report.test.cjs — API-4 sweep, the CSP report door: every refusal of POST /api/csp-report (routes/csp-report.js), asked over the REAL server.js.
 *
 * OWNS      the proof that the one public report door refuses a junk body, an oversized body and a flood the way every route does (a Problem body, never a 5xx, never the
 *           parser's own words), and keeps answering 204 to a report; this file's row of docs/contracts/api-error-tests.json (400 · 413 · 429, which the register's error_tests
 *           column reads); and that no answer is outside the statuses lib/csp-report-contract.js declares. The door stays PUBLIC: no sign-in is asked, no credential read.
 * CALLED BY scripts/guards.cjs · CI. No database, no network beyond 127.0.0.1: the real server.js with a stand-in db (tools/load-app.cjs).
 * FLOW      one report (204) · a body that is not JSON (400, lib/knownerr) · a body over 8 KB (413) · more than REPORTS_PER_MIN from one address (429, lib/rate-limit)
 *           → the Problem fields · no cause · statuses tested → manifest
 * CARD      28-platform-and-operations/limits-idempotency-rate-limits
 * The refusals are made by the route's own stack (body parser, limiter) and worded by the app's one error handler, so they are asked through the whole app, not a bare router.
 *
 *   node tests/api-problem-csp-report.test.cjs            check
 *   node tests/api-problem-csp-report.test.cjs --write    rewrite this route's row of docs/contracts/api-error-tests.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { stubDatabase, loadApp } = require('../tools/load-app.cjs');

const HERE = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
const ROUTE = 'POST /api/csp-report';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REPORT = { 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js?token=1', 'document-uri': 'https://app.example/home?secret=1' } };
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];
const argv = process.argv.slice(2);
const count = { passed: 0, failed: 0 };
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function check(label, condition, info) {
  if (condition) count.passed++;
  else count.failed++;
  if (!condition || argv.includes('--verbose')) console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 400)));
}

/** one report over http: { status, type, text, json } */
function send(port, text, type) {
  return new Promise((resolve) => {
    const data = Buffer.from(text);
    const request = http.request({ port, host: '127.0.0.1', method: 'POST', path: '/api/csp-report', headers: { 'content-type': type || 'application/csp-report', 'content-length': data.length } }, (response) => {
      let body = '';
      response.on('data', (part) => (body += part));
      response.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (failure) {
          json = null;
        }
        resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text: body, json });
      });
    });
    request.setTimeout(4000, () => {
      request.destroy();
      resolve({ status: 0, type: '', text: '', json: null });
    });
    request.on('error', () => {});
    request.end(data);
  });
}

/** a refusal is a Problem: the content type, every field, the status in the body, and none of the parser's or the database's words */
function checkRefusal(label, answer, status, code) {
  check(label + ': answers ' + status, answer.status === status, [answer.status, answer.text.slice(0, 120)]);
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field and the status of the answer', !!answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined) && answer.json.status === status, answer.json);
  check(label + ': the code is ' + code, !!answer.json && answer.json.code === code, answer.json && answer.json.code);
  check(label + ': says nothing of the parser or the stack', !/Unexpected|SyntaxError|JSON at position|stack|at Object|node_modules/.test(answer.text), answer.text.slice(0, 200));
}

(async () => {
  stubDatabase();
  const log = require('../lib/logger');
  const realWarn = log.warn;
  let failing = false;
  log.warn = (...given) => {
    if (failing) throw new Error('disk full -- SELECT secret FROM vault');
    return given.length && undefined; /* the door logs one line per report; the scenarios read the answer */
  };
  const app = loadApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const seen = new Set();
  const note = (answer) => answer.status >= 400 && seen.add(answer.status);
  const contract = require('../lib/csp-report-contract.js').contract;
  const allowed = contract.allowedStatuses()(ROUTE);

  const taken = await send(port, JSON.stringify(REPORT));
  check('a report is taken: 204, no body, no sign-in asked', taken.status === 204 && taken.text === '', [taken.status, taken.text]);
  const taken2 = await send(port, JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://x.example/a.png' } }]), 'application/reports+json');
  check('a Reporting API list is taken too: 204', taken2.status === 204, taken2.status);

  failing = true;
  const unlogged = await send(port, JSON.stringify(REPORT));
  failing = false;
  note(unlogged);
  checkRefusal('a report whose log line cannot be written (a fault of ours)', unlogged, 500, 'INTERNAL');
  check('a fault says nothing of its cause', !/disk full|vault/.test(unlogged.text), unlogged.text.slice(0, 200));

  const junk = await send(port, '{"csp-report": {"blocked-uri":');
  note(junk);
  checkRefusal('a body that is not JSON', junk, 400, 'INVALID_JSON');
  const junkAsJson = await send(port, 'not json at all', 'application/json');
  note(junkAsJson);
  check('plain text declared as application/json is refused the same way: 400', junkAsJson.status === 400 && /problem\+json/.test(junkAsJson.type), [junkAsJson.status, junkAsJson.type]);
  const big = await send(port, JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(9000) } }));
  note(big);
  checkRefusal('a body over 8 KB', big, 413, 'BODY_TOO_LARGE');

  let flood = null;
  for (let sent = 0; sent < 100 && !flood; sent++) {
    const answer = await send(port, JSON.stringify(REPORT));
    if (answer.status === 429) flood = answer;
  }
  note(flood || { status: 0 });
  check('more than the limit from one address is answered 429 (REPORTS_PER_MIN reached before 100 reports)', !!flood);
  if (flood) {
    checkRefusal('a flood', flood, 429, 'RATE_LIMITED');
    check('a flood: Retry-After rides in the body as params.retry_after_seconds', !!flood.json && flood.json.params && flood.json.params.retry_after_seconds >= 1, flood.json && flood.json.params);
  }
  server.close();
  log.warn = realWarn;

  check('every refusal seen is a status lib/csp-report-contract.js declares for this route', [...seen].every((status) => allowed.includes(status)), [[...seen], allowed]);
  const router = require('../routes/csp-report');
  check('the door asks for no credential: the route file reads no sign-in and the operation is public (no 401)', !/middleware\/auth/.test(fs.readFileSync(path.join(HERE, 'routes', 'csp-report.js'), 'utf8')) && !('401' in contract.OPERATIONS[ROUTE].responses) && !!router);

  const coverage = { [ROUTE]: [...seen].sort((first, second) => first - second) };
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  if (argv.includes('--write')) {
    onDisk[ROUTE] = coverage[ROUTE];
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(onDisk).sort().map((route) => [route, onDisk[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses this scenario covers for POST /api/csp-report', sameValue(onDisk[ROUTE], coverage[ROUTE]), { onDisk: onDisk[ROUTE], covered: coverage[ROUTE] });
  console.log('\n  ' + count.passed + ' checks, ' + count.failed + ' failed');
  process.exit(count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});

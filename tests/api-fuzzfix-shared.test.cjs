#!/usr/bin/env node
// @type: contract
/**
 * api-fuzzfix-shared.test.cjs — column 17 (junk fuzz, 18 Nov 2026): the SHARED causes behind most failing routes, each proved once.
 *
 * OWNS      the proof that (1) an address Express cannot decode (a lone %) answers 400 ADDRESS_NOT_READABLE from the one error handler, never 500 INTERNAL;
 *           (2) a page or offset past what Postgres' OFFSET holds (99999999999999999999) is clamped by the one pager (lib/bounds pageNumber / offsetNumber, lib/page-limit);
 *           (3) a storefront shopper's 401 (middleware/customer-auth) is the Problem shape with its old keys kept; (4) the express-validator verdict (middleware/validate)
 *           answers the Problem shape with its old `error` and `details` kept.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real server.js over tools/load-app.cjs.
 * FLOW      request → real server.js → status · problem+json · registered code · the frozen legacy keys
 * Run: node tests/api-fuzzfix-shared.test.cjs · MIN unit-per-rule · refusal-path
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const http = require('http');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

let failed = 0;
let total = 0;
const check = (label, ok, info) => {
  total++;
  if (!ok) failed++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 400)));
};

function send(port, method, urlPath, body) {
  return new Promise((resolve) => {
    const headers = { 'x-request-id': 'req-fuzzfix' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    const request = http.request({ port, path: urlPath, method, headers }, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (e) {
          json = null;
        }
        resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text, json });
      });
    });
    if (body !== undefined) request.write(body);
    request.end();
  });
}
const isProblem = (answer, status, code) => !!answer.json && /application\/problem\+json/.test(answer.type) && answer.status === status && answer.json.status === status && typeof answer.json.title === 'string' && typeof answer.json.type === 'string' && answer.json.code === code;

/* (2) the pager: unit */
const bounds = require(path.join(HERE, 'lib', 'bounds.js'));
const pager = require(path.join(HERE, 'lib', 'page-limit.js'));
const HUGE = '99999999999999999999';
check('pageNumber: a huge page is clamped to PAGE_MAX', bounds.pageNumber(HUGE) === bounds.PAGE_MAX, bounds.pageNumber(HUGE));
check('pageNumber: 1e999, -1, NaN, text and nothing are page 1', ['1e999', '-1', 'NaN', 'abc', undefined, ''].every((value) => bounds.pageNumber(value) === 1));
check('pageNumber: an ordinary page is kept', bounds.pageNumber('7') === 7);
check('offsetNumber: a huge offset is clamped, a junk one is 0, a normal one is kept', bounds.offsetNumber(HUGE) === bounds.PAGE_MAX * bounds.LIMIT_MAX && bounds.offsetNumber('-5') === 0 && bounds.offsetNumber('abc') === 0 && bounds.offsetNumber('40') === 40);
const pg = pager.pageArgs({ page: HUGE, limit: '200' }, 50, 200);
check('pageArgs: a huge page gives an offset Postgres can hold (below 2^31)', Number.isSafeInteger(pg.offset) && pg.offset < 2 ** 31, pg);
check('page-limit pageOf and offsetOf read the same bound', pager.pageOf(HUGE) === bounds.PAGE_MAX && pager.offsetOf(HUGE) === bounds.PAGE_MAX * bounds.LIMIT_MAX);

(async () => {
  const loader = require(path.join(HERE, 'tools', 'load-app.cjs'));
  loader.stubDatabase(HERE);
  const server = http.createServer(loader.loadApp(HERE));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  /* (1) an address that does not decode */
  for (const [method, route] of [['DELETE', '/api/folders/%'], ['GET', '/api/actors/%zz/tasks'], ['DELETE', '/api/chits/%']]) {
    const answer = await send(port, method, route, method === 'DELETE' ? undefined : undefined);
    check(method + ' ' + route + ': 400 ADDRESS_NOT_READABLE as a Problem', isProblem(answer, 400, 'ADDRESS_NOT_READABLE'), { status: answer.status, text: answer.text });
    check(method + ' ' + route + ': no stack, no "decode param" words', !/Failed to decode|URIError|at \w+ \(/.test(answer.text), answer.text);
  }

  /* (3) a shopper's 401 keeps error and message, adds the Problem fields */
  for (const route of ['/api/catalogue/shop/my-orders', '/api/catalogue/shop/my-documents', '/api/privacy/me']) {
    const answer = await send(port, 'GET', route);
    check('GET ' + route + ' without a token: 401 Problem TOKEN_MISSING', isProblem(answer, 401, 'TOKEN_MISSING'), { status: answer.status, text: answer.text });
    check('GET ' + route + ': the old keys error and message are kept', !!answer.json && answer.json.error === 'Unauthorised' && answer.json.message === 'Sign in to view this', answer.json);
  }

  /* (4) the validator's verdict */
  for (const [route, body] of [['/api/actors/login', '{}'], ['/api/entities/verify', '{}'], ['/api/signin/ask', '{"display_name":{"a":1}}'], ['/api/entities/register', '{"display_name":123}']]) {
    const answer = await send(port, 'POST', route, body);
    check('POST ' + route + ': a refusal is a Problem with a registered code', !!answer.json && answer.status >= 400 && answer.status < 500 && typeof answer.json.title === 'string' && typeof answer.json.type === 'string' && answer.json.status === answer.status && typeof answer.json.code === 'string', { status: answer.status, text: answer.text });
    if (answer.json && answer.json.error === 'Validation failed') check('POST ' + route + ': error and details kept beside the Problem fields', !answer.json.details || (Array.isArray(answer.json.details) && answer.json.details.length > 0), answer.json);
  }

  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();

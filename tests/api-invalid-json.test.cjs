#!/usr/bin/env node
// @type: contract
/**
 * api-invalid-json.test.cjs — API-14 (BH-1): a request body that is not JSON answers 400 INVALID_JSON, never 500.
 *
 * OWNS      the proof that a body which is not valid JSON ({"a":), or is a bare JSON null, string or number, is refused with 400 application/problem+json
 *           code INVALID_JSON on three routes: POST /api/crm/leads, POST /api/entities/register (unsigned) and POST /api/books/terms. The parser runs before
 *           every route, so one branch in server.js's error handler answers for all of them; the three are the pin.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real server.js over tools/load-app.cjs.
 * FLOW      4 bad bodies x 3 routes → real server.js → status 400 · problem+json · code INVALID_JSON · nothing of the parser's words leaks · request id echoed
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

const ROUTES = ['/api/crm/leads', '/api/entities/register', '/api/books/terms'];
const BODIES = { 'cut-off object': '{"a":', 'JSON null': 'null', 'JSON string': '"x"', 'JSON number': '42' };

function send(port, urlPath, body) {
  return new Promise((resolve) => {
    const options = { port, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-request-id': 'req-json' } };
    const request = http.request(options, (response) => {
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
    request.write(body);
    request.end();
  });
}

(async () => {
  const loader = require(path.join(HERE, 'tools', 'load-app.cjs'));
  loader.stubDatabase(HERE);
  const server = http.createServer(loader.loadApp(HERE));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  for (const route of ROUTES) {
    for (const [name, body] of Object.entries(BODIES)) {
      const answer = await send(port, route, body);
      const label = 'POST ' + route + ' ' + name + ': ';
      check(label + '400', answer.status === 400, { status: answer.status, text: answer.text });
      check(label + 'application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
      check(label + 'code INVALID_JSON', !!answer.json && answer.json.code === 'INVALID_JSON', answer.json);
      check(label + 'request id echoed, no parser words', !!answer.json && answer.json.request_id === 'req-json' && !/Unexpected|position|token/i.test(answer.text), answer.text);
    }
  }
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();

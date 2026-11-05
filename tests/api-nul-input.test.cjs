#!/usr/bin/env node
// @type: contract
/**
 * api-nul-input.test.cjs — API-15 (BH-3): a NUL byte (0000) in a body or a query answers 400 INVALID_CHARACTER, never 500.
 *
 * OWNS      the proof that a NUL anywhere in a JSON body (a value, a nested value or a key) or in the query string or path is refused at the door with
 *           400 application/problem+json code INVALID_CHARACTER, on three writes (POST /api/folders, /api/crm/leads, /api/books/terms) and two reads
 *           (GET /api/products?q=%00, GET /api/chits/inbox?q=%00); and that a normal request (no NUL, with a tab and a new line) is not stopped by it.
 *           Postgres cannot store a NUL (22021), and the routes catch their own errors, so the only one place that covers them all is the edge: lib/input-hygiene.js.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real server.js over tools/load-app.cjs.
 * FLOW      request with a NUL → real server.js → input-hygiene → status 400 · problem+json · code INVALID_CHARACTER · request id echoed
 * Run: node tests/api-nul-input.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (a NUL is refused, never passed on; nothing is let through when unsure)
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
    const headers = { 'x-request-id': 'req-nul' };
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

const CASES = [
  ['POST', '/api/folders', '{"name":"a\\u0000b"}', 'NUL in a value'],
  ['POST', '/api/crm/leads', '{"name":"ok","extra":{"deep":["x","y\\u0000"]}}', 'NUL deep in a list'],
  ['POST', '/api/books/terms', '{"a\\u0000b":"x"}', 'NUL in a key'],
  ['GET', '/api/products?q=%00', undefined, 'NUL in the query'],
  ['GET', '/api/chits/inbox?q=a%00b', undefined, 'NUL inside a word in the query']
];

const NUL = String.fromCharCode(0);
const hygiene = require(path.join(HERE, 'lib', 'input-hygiene.js')); // unit: hasNul reads strings, keys, nested lists, and leaves a Buffer and plain text alone
check('hasNul: plain text, a tab and a new line are fine', !hygiene.hasNul('rice' + String.fromCharCode(9, 10) + 'bag'));
check('hasNul: a NUL in text, a nested value and a key is found', hygiene.hasNul('a' + NUL) && hygiene.hasNul({ a: [{ b: 'x' + NUL }] }) && hygiene.hasNul({ ['k' + NUL]: 1 }));
check('hasNul: a Buffer, null and a number are left alone', !hygiene.hasNul(Buffer.from([0, 1])) && !hygiene.hasNul(null) && !hygiene.hasNul(7));

(async () => {
  const loader = require(path.join(HERE, 'tools', 'load-app.cjs'));
  loader.stubDatabase(HERE);
  const server = http.createServer(loader.loadApp(HERE));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  for (const [method, route, body, name] of CASES) {
    const answer = await send(port, method, route, body);
    const label = method + ' ' + route + ' (' + name + '): ';
    check(label + '400', answer.status === 400, { status: answer.status, text: answer.text });
    check(label + 'application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
    check(label + 'code INVALID_CHARACTER, request id echoed', !!answer.json && answer.json.code === 'INVALID_CHARACTER' && answer.json.request_id === 'req-nul', answer.json);
  }
  /* unchanged: a body with a tab and a new line (both fine for Postgres) and a plain query reach the route, which answers its own way (never this refusal) */
  const normal = await send(port, 'POST', '/api/folders', JSON.stringify({ name: ['a', 'b', 'c'].join(String.fromCharCode(9, 10)) }));
  check('normal body (tab, new line) is not refused as INVALID_CHARACTER', !(normal.json && normal.json.code === 'INVALID_CHARACTER') && normal.status !== 500, { status: normal.status, text: normal.text });
  const plain = await send(port, 'GET', '/api/products?q=rice%20bag', undefined);
  check('normal query is not refused as INVALID_CHARACTER', !(plain.json && plain.json.code === 'INVALID_CHARACTER') && plain.status !== 500, { status: plain.status, text: plain.text });
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();

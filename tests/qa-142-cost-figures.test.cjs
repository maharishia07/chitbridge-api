#!/usr/bin/env node
/**
 * qa-142-cost-figures.test.cjs — QA-142: POST /api/chits/:id/costs refuses a figure that is not money, with a 422 naming the field.
 * @type regression
 * OWNS      the proof that the cost door's schema (lib/chits-input COST_BODY, lib/bounds amount / int32, mounted by lib/chits-contract routeChecks) refuses, before anything is written:
 *           1e308 (it answered 500 from the database), 9007199254740992 = 2^53 (it was taken, margin -9007199254740890), the chit-total ceiling 1e13 itself, a boolean (true was read as 1),
 *           a text, null, a list or an object in a figure, minutes past a 4-byte integer, in the body as a row, as a list, or inside rows; and takes the figures a shop really sends.
 * CALLED BY scripts/guards.cjs · CI. No database: the real schema check over a throw-away express app; the handler only says "reached".
 * FLOW      body → routeChecks('POST /:chit_id/costs') (schemaValidate) → 422 INVALID_INPUT (field named) | handler (200 reached)
 *
 * THE HAND CASE: the ceiling is the chit total's column (numeric(15,2)): below 10^13, so 9,999,999,999,999.99 is the largest figure a cost may carry and 10,000,000,000,000 is refused;
 * a cost corrects an earlier one, so -50 is taken and so is -9,999,999,999,999.99; 0.01 is the smallest figure a currency counts; minutes are a 4-byte integer, 0 to 2,147,483,647 (either side of 0 when a correction).
 * Run: node tests/qa-142-cost-figures.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const contract = require(path.join(API, 'lib', 'chits-contract'));
const ceiling = require(path.join(API, 'lib', 'chit-ceiling'));

let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};

const app = express();
app.use(express.json());
app.post('/:chit_id/costs', ...contract.routeChecks('POST /:chit_id/costs'), (req, res) => res.json({ reached: true }));
const server = http.createServer(app);
/* a JSON text built by hand, so 1e308 and 9007199254740992 reach the server exactly as a client writes them */
const send = (port, raw) =>
  new Promise((done) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/11111111-2222-4333-8444-555555555555/costs', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } }, (response) => {
      let text = '';
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(text || '{}');
        } catch (_) {
          body = { unreadable: text };
        }
        done({ status: response.statusCode, body });
      });
    });
    request.end(raw);
  });
const refusedWhere = (answer) => answer.status === 422 && answer.body.code === 'INVALID_INPUT';

(async () => {
  console.log('\n══ QA-142 · the cost door takes money, not anything a number can be made of ══\n');
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const post = (raw) => send(port, raw);

  ok('the ceiling is the chit total column (one number): 10^13', ceiling.ceilingOf('total') === 1e13);
  const WORDS = [
    ['1e308 (was a 500)', '{"kind":"other","amount":1e308}'],
    ['9007199254740992 = 2^53 (was taken, margin -9007199254740890)', '{"kind":"other","amount":9007199254740992}'],
    ['10000000000000 = the ceiling itself', '{"kind":"other","amount":10000000000000}'],
    ['-10000000000000 = the ceiling the other way', '{"kind":"other","amount":-10000000000000}'],
    ['true (was read as 1)', '{"kind":"other","amount":true}'],
    ['false', '{"kind":"other","amount":false}'],
    ['the text "50"', '{"kind":"other","amount":"50"}'],
    ['null', '{"kind":"other","amount":null}'],
    ['a list', '{"kind":"other","amount":[50]}'],
    ['an object', '{"kind":"other","amount":{"v":50}}'],
    ['rate_per_hour 1e308', '{"kind":"labour","minutes":80,"rate_per_hour":1e308}'],
    ['rate_per_hour true', '{"kind":"labour","minutes":80,"rate_per_hour":true}'],
    ['minutes 1e308', '{"kind":"labour","minutes":1e308,"rate_per_hour":150}'],
    ['minutes 2147483648 (past a 4-byte integer)', '{"kind":"labour","minutes":2147483648,"rate_per_hour":150}'],
    ['minutes 80.5 (the column is an integer)', '{"kind":"labour","minutes":80.5,"rate_per_hour":150}'],
    ['minutes true', '{"kind":"labour","minutes":true,"rate_per_hour":150}']
  ];
  for (const [what, row] of WORDS) {
    const asBody = await post(row);
    ok('as the body: ' + what + ' → 422 INVALID_INPUT', refusedWhere(asBody), JSON.stringify(asBody));
    const inRows = await post('{"rows":[{"kind":"other","amount":5},' + row + ']}');
    ok('inside rows (the second row): ' + what + ' → 422', refusedWhere(inRows), JSON.stringify(inRows));
    const asList = await post('[' + row + ']');
    ok('as a list body: ' + what + ' → 422', refusedWhere(asList), JSON.stringify(asList));
  }
  const named = await post('{"kind":"other","amount":9007199254740992}');
  ok('the refusal names the field amount and does not echo the figure back', /amount/.test(JSON.stringify(named.body.errors || named.body.field)) && !/9007199254740992/.test(JSON.stringify(named.body)), JSON.stringify(named.body));

  const TAKEN = [
    ['9,999,999,999,999.99, the largest figure below the ceiling', '{"kind":"other","amount":9999999999999.99}'],
    ['-9,999,999,999,999.99, a correction of that size', '{"kind":"other","amount":-9999999999999.99}'],
    ['-50, a correction', '{"kind":"other","amount":-50}'],
    ['0.01', '{"kind":"other","amount":0.01}'],
    ['80 minutes at 150 an hour (no amount: it is derived)', '{"kind":"labour","minutes":80,"rate_per_hour":150}'],
    ['a fare with its note, currency and line', '{"kind":"transport","amount":50,"currency":"inr","note":"auto","line_id":"11111111-2222-4333-8444-555555555555"}'],
    ['minutes 2147483647', '{"kind":"labour","minutes":2147483647,"rate_per_hour":150}']
  ];
  for (const [what, row] of TAKEN) {
    const asBody = await post(row);
    ok('as the body: ' + what + ' → reaches the handler', asBody.status === 200 && asBody.body.reached === true, JSON.stringify(asBody));
    const inRows = await post('{"rows":[' + row + ']}');
    ok('inside rows: ' + what + ' → reaches the handler', inRows.status === 200 && inRows.body.reached === true, JSON.stringify(inRows));
  }
  const both = await post('[{"kind":"fare","amount":50,"currency":"inr","note":"auto"},{"kind":"labour","minutes":80,"rate_per_hour":150}]');
  ok('the two-row list the api tests send reaches the handler', both.status === 200 && both.body.reached === true, JSON.stringify(both));
  const unknown = await post('{"kind":"other","amount":5,"surprise":1}');
  ok('an unknown key is still refused as before (additionalProperties false)', unknown.status === 422, JSON.stringify(unknown));

  server.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();

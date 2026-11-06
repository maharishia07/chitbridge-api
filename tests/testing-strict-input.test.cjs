#!/usr/bin/env node
/**
 * testing-strict-input.test.cjs — S33 strict input, the test board: a closed write body names every key a caller sends, and a key nobody sends is refused by name.
 *
 * OWNS      the proof that closing the test board's write bodies (lib/testing-contract.js, additionalProperties false) refuses nothing a handler reads or a real caller sends,
 *           and that an unknown key answers the board's own 400 (error 'Bad request', message '<key> is not accepted here.') with the field named.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the schema check of each route runs alone (middleware/validate.js).
 * FLOW      lib/testing-contract.js OPERATIONS → schemaValidate → (1) an unknown key is refused 400 UNKNOWN_FIELD, field named; the three open routes let it through ·
 *           (2) the bodies the web Testing screens and toolset scripts send are accepted · (3) every key a handler reads from its body (b.x or req.body.x) is declared
 * CARD      28-platform-and-operations/testing
 * Open on purpose: PUT /cmdb/:ci (the CMDB record itself) · POST /results and POST /results/junit (the CI key calls them: a keyed outward route keeps unknown keys ignored until a /v2, API-43).
 * What it cannot see (each stays a review question): a key read through a computed name; a body handed to another function; nested keys (the items of results[] and cases[] are not closed).
 *
 *   node tests/testing-strict-input.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { schemaValidate } = require('../middleware/validate');
const C = require('../lib/testing-contract');

const ROUTE_LINES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'testing.js'), 'utf8').split('\n');
const MOUNT = '/api/testing';
const OPEN = ['PUT /cmdb/:ci', 'POST /results', 'POST /results/junit'];
let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};

/** what the route's schema check does with a body: { status: 200 } when it lets it on, else the refusal's status and json */
function answerTo(operation, body) {
  let out = { status: 200 };
  const res = {
    statusCode: 200,
    set() { return this; },
    setHeader() {},
    getHeader() {},
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    json(value) { out = { status: this.statusCode, json: value }; return this; },
    send(value) { out = { status: this.statusCode, json: value }; return this; },
    end() { return this; }
  };
  const req = { body, query: {}, params: { id: '11111111-1111-4111-8111-111111111111', ci: 'CAP-SIGNIN' }, headers: {}, id: 'test', method: 'POST', originalUrl: MOUNT, get() { return ''; } };
  schemaValidate(operation, C.schemaOptions)(req, res, () => { out = { status: 200 }; });
  return out;
}
const routeOf = (key) => key.replace(MOUNT, '');
const WRITES = Object.keys(C.OPERATIONS).filter((key) => /^(POST|PUT|PATCH) /.test(key)).map(routeOf);

/* 1 · a made-up key: refused 400 and named on a closed route, let through on the open ones */
let refused = 0;
for (const route of WRITES) {
  const got = answerTo(C.operationFor(route), { not_a_field: 'x' });
  if (OPEN.includes(route)) {
    ok(route + ': open on purpose, an unknown key is let through', got.status === 200, JSON.stringify(got));
    continue;
  }
  ok(route + ': an unknown key is refused 400, named', got.status === 400 && JSON.stringify(got.json).includes('not_a_field'), JSON.stringify(got));
  refused++;
}
ok('13 routes are closed (16 writes less the 3 open)', refused === 13 && WRITES.length === 16, 'closed ' + refused + ' of ' + WRITES.length);

/* 2 · what real callers send (app.html api map, cap-testing.js, testing.html, toolset/pack.cjs, toolset/coverage/board-import.cjs) is accepted */
const CALLERS = {
  'POST /cases/import': [{ mode: 'add', cases: [{ case_key: 'a', any_item_key: 1 }] }, { cases: [{ case_key: 'b' }] }],
  'POST /cases/seed': [{}],
  'POST /cmdb/seed': [{}],
  'POST /cases/close': [{ case_key: 'k', open: true, why: 'because' }],
  'POST /cases/gherkin': [{ text: 'Feature: x' }],
  'POST /trace': [{ minutes: 10 }, { off: true }],
  'POST /requirements': [
    { requirement: 'r', observed: 'o', priority: 'Medium', case_key: null, screen_code: 's', popup_code: null },
    { observed: 'o', requirement: 'r', case_key: 'k', screen_code: 's' }
  ],
  'PATCH /requirements/:id': [{ state: 'accepted', why: 'w' }, { priority: 'High' }],
  'POST /incidents': [
    { observed: 'o', affected: 'a', severity: 'Sev-3', happened_at: null, screen_code: 's', popup_code: null, build: null },
    { observed: 'o', evidence_id: null, affected: 'found by k', happened_at: 'x', severity: 'Sev-3', screen_code: 's', case_key: 'k', build: null }
  ],
  'PATCH /incidents/:id': [{ state: 'resolved', change: { sha: 'abcdef1' } }, { state: 'resolved', why: 'w' }, { state: null, severity: 'Sev-2' }, { defect: 'd' }],
  'POST /evidence': [{ name: 'screen.png', mime: 'image/png', data_base64: 'AAAA' }],
  'POST /changes': [{ summary: 's', backout: 'b', cites: 'INC-1', ref: 'r', repo: 'api', sha: 'abc', proves: [], risk: 'routine', files: 'a.js', migration: false }],
  'POST /releases': [{ name: 'v1', changes: ['CHG-1'], note: 'n' }]
};
for (const [route, bodies] of Object.entries(CALLERS)) {
  const bad = bodies.map((body) => answerTo(C.operationFor(route), body)).filter((got) => got.status !== 200);
  ok(route + ': ' + bodies.length + ' real caller body(ies) accepted', !bad.length, JSON.stringify(bad));
}
ok('every closed route has a caller body above', WRITES.filter((r) => !OPEN.includes(r)).every((r) => CALLERS[r]));

/* 3 · every key a closed handler reads from its body is declared */
const startOf = (method, p) => ROUTE_LINES.findIndex((line) => line.startsWith('router.' + method.toLowerCase() + "('" + p + "'"));
for (const route of WRITES.filter((r) => !OPEN.includes(r))) {
  const [method, p] = route.split(' ');
  const at = startOf(method, p);
  if (at < 0) {
    ok(route + ': its handler is found in routes/testing.js', false);
    continue;
  }
  /* a handler stops at its own closing line, so a helper written between two routes is not part of it */
  let end = at + 1;
  while (end < ROUTE_LINES.length && !/^\}\);\s*$/.test(ROUTE_LINES[end])) end++;
  const text = ROUTE_LINES.slice(at, end + 1).join('\n');
  const read = new Set([...text.matchAll(/(?<![\w.$])(?:b|req\.body)\??\.([A-Za-z_]\w*)/g)].map((m) => m[1]).filter((k) => !['length', 'map', 'filter', 'slice', 'trim'].includes(k)));
  const declared = new Set(Object.keys(C.operationFor(route).requestBody.content['application/json'].schema.properties || {}));
  const missing = [...read].filter((k) => !declared.has(k));
  ok(route + ': every key it reads is declared (' + read.size + ' read)', !missing.length, 'read but not declared: ' + missing.join(', '));
}

console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);

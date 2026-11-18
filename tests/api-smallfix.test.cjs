#!/usr/bin/env node
/**
 * api-smallfix.test.cjs — COL16-3 (the books ledger page is capped at the one B.limit, 200), FUZZ-2 (a folder rule's sort of the wrong type) and FUZZ-3 (a login username that is a list or an object).
 *
 * OWNS      the proof that GET /api/books/ledger/:account declares limit as an integer 1..200 and the store's page maximum is the same 200; that a rule's sort which is not a whole number, and a username which is
 *           not text, are refused 400 problem+json at the route's own schema check (middleware/validate.js) and never reach a handler.
 * CALLED BY CI (tests/run-tests.js picks up *.test.cjs). No database: the real app over a stand-in database, each route's own schema check behind a handler that answers 200.
 * FLOW      route key → its schema check (found on the loaded app) → stand-in handler (200) → status + Problem fields + registered code
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const path = require('path');
const express = require('express');
const loader = require('../tools/load-app.cjs');
const bounds = require('../lib/bounds');
const CODES = new Set(require('../docs/error-codes.json').codes.map((row) => row.code));

loader.stubDatabase(path.join(__dirname, '..'));
const loaded = loader.loadApp(path.join(__dirname, '..'));
const store = require('../lib/books-store');
const CHECKS = {};
loader.leavesOf(loaded, true).forEach((leaf) => {
  const found = leaf.fns.find((fn) => fn && fn.schemaOperation);
  if (found) CHECKS[leaf.method + ' ' + leaf.path] = found;
});
let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log((ok ? 'ok     ' : 'FAILED ') + what);
};
const ZERO = '00000000-0000-4000-8000-000000000001';
const LEDGER = 'GET /api/books/ledger/:account';
const RULE = 'PATCH /api/folders/rules/:rule_id';
const LOGIN = 'POST /api/actors/login';
/** [what, key, url, body, expected] */
const CASES = [
  ['ledger: limit 200 passes', LEDGER, '/api/books/ledger/1300?limit=200', undefined, 200],
  ['ledger: limit 201 is refused', LEDGER, '/api/books/ledger/1300?limit=201', undefined, 422],
  ['ledger: limit 500 is refused', LEDGER, '/api/books/ledger/1300?limit=500', undefined, 422],
  ['ledger: no limit still passes', LEDGER, '/api/books/ledger/1300', undefined, 200],
  ['folder rule: sort as a word', RULE, '/api/folders/rules/' + ZERO, { sort: 'abc' }, 400],
  ['folder rule: sort as a list', RULE, '/api/folders/rules/' + ZERO, { sort: [1] }, 400],
  ['folder rule: sort as an object', RULE, '/api/folders/rules/' + ZERO, { sort: { a: 1 } }, 400],
  ['login: username as a list', LOGIN, '/api/actors/login', { username: ['till@shop'], pin: '1234' }, 400],
  ['login: username as an object', LOGIN, '/api/actors/login', { username: { a: 1 }, pin: '1234' }, 400]
];
async function main() {
  check(store.PAGE_MAX === bounds.LIMIT_MAX, 'books-store PAGE_MAX (' + store.PAGE_MAX + ') equals the one limit bound (' + bounds.LIMIT_MAX + ')');
  for (const [what, key, url, body, expected] of CASES) {
    const found = CHECKS[key];
    check(!!found, what + ' (the route has its schema check)');
    if (!found) continue;
    const [method, expressPath] = key.split(' ');
    const app = express();
    app.use(express.json());
    app[method.toLowerCase()](expressPath, found, (req, res) => res.json({ ok: true }));
    const server = require('http').createServer(app).listen(0);
    try {
      const res = await fetch('http://127.0.0.1:' + server.address().port + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      let answer = {};
      try {
        answer = JSON.parse(await res.text());
      } catch (notJson) {
        answer = {};
      }
      if (expected === 200) check(res.status === 200, what + ' → 200 (got ' + res.status + ')');
      else check(res.status === expected && !!answer.title && answer.status === expected && CODES.has(answer.code), what + ' → ' + expected + ' Problem, registered code (got ' + res.status + ' ' + answer.code + ')');
    } finally {
      server.close();
    }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

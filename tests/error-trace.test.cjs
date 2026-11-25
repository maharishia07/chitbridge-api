#!/usr/bin/env node
// @type: unit
/**
 * error-trace.test.cjs — raised_by follows a route into the helpers it calls (ERR-14 part 1, 22 Nov 2026).
 *
 * OWNS      the proof that tools/error-codes.cjs routesOf gives a route the codes a lib helper raises (call, destructured member, in-place require, a table it names,
 *           a handler handed over by name, a contract line keyed by the route) and that a code no call reaches stays [] (never guessed).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      a small fake repo in a temp folder ──▶ routesOf ──▶ each code lists exactly the routes that reach it
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { routesOf } = require('../tools/error-codes.cjs');
const { functionsOf, requiresOf } = require('../tools/error-trace.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'errtrace-'));
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const rows = ['VIA_CALL', 'VIA_MEMBER', 'VIA_INLINE', 'VIA_TABLE', 'VIA_NAME', 'VIA_KEY', 'NEVER_REACHED', 'OTHER_ROUTE'];
put('docs/ERROR-CODES.md', '<!-- codes:start -->\n| code | status | title | shopkeeper | hint | owner_area | since |\n|---|---|---|---|---|---|---|\n'
  + rows.map((code) => '| ' + code + ' | 409 | t | s | - | x | 2026-11-22 |').join('\n') + '\n<!-- codes:end -->\n');
put('lib/helper.js', [
  "function viaCall() { return { status: 409, code: 'VIA_CALL' }; }",
  "function viaMember() { return { status: 409, code: 'VIA_MEMBER' }; }",
  "function viaInline() { return { status: 409, code: 'VIA_INLINE' }; }",
  "function neverCalled() { return { status: 409, code: 'NEVER_REACHED' }; }",
  "const TABLE = [",
  "  { status: 409, code: 'VIA_TABLE' },",
  "];",
  "const SAYS = {",
  "  'POST /keyed': { refusals: [{ status: 409, code: 'VIA_KEY' }] },",
  "  'POST /other': { refusals: [{ status: 409, code: 'OTHER_ROUTE' }] },",
  "};",
  "function named() { return { status: 409, code: 'VIA_NAME' }; }",
  "function tableOf() { return TABLE; }",
  'module.exports = { viaCall, viaMember, viaInline, tableOf, named, SAYS, neverCalled };',
  '',
].join('\n'));
const routeLines = [
  "const helper = require('../lib/helper');",
  "const { viaMember, tableOf, named } = require('../lib/helper');",
  "router.get('/a', async (req, res) => {",
  '  helper.viaCall();',
  '  viaMember();',
  "  require('../lib/helper').viaInline();",
  '  tableOf();',
  '});',
  "router.post('/b', auth, named);",
  "router.post('/keyed', auth, check('POST /keyed'), (req, res) => {});",
  '',
];
put('routes/x.js', routeLines.join('\n'));
const route = (method, p, line) => ({ key: method + ' /api/x' + p, method, path: '/api/x' + p, file: 'routes/x.js', line, errors: { codes: [] } });
put('docs/api-register.json', JSON.stringify({ routes: [route('GET', '/a', 3), route('POST', '/b', 9), route('POST', '/keyed', 10)] }));

const found = routesOf(root);
assert.deepStrictEqual(found.VIA_CALL, ['GET /api/x/a'], 'alias.fn() is followed');
assert.deepStrictEqual(found.VIA_MEMBER, ['GET /api/x/a'], 'a destructured member is followed');
assert.deepStrictEqual(found.VIA_INLINE, ['GET /api/x/a'], 'require(...).fn() written in place is followed');
assert.deepStrictEqual(found.VIA_TABLE, ['GET /api/x/a'], 'a table the helper names is read');
assert.deepStrictEqual(found.VIA_NAME, ['POST /api/x/b'], 'a handler handed over by name is followed');
assert.ok(found.NEVER_REACHED === undefined, 'a code no call reaches stays unknown, never guessed');
fs.rmSync(root, { recursive: true, force: true });
/* tools/error-trace.cjs itself (unit): the function spans a call is resolved against, and the requires a file makes */
assert.deepStrictEqual(functionsOf(['function a() {', '  return 1;', '}', 'const b = () => 2;', 'function c() { return 3; }']).map((fn) => [fn.name, fn.from, fn.to]), [['a', 1, 3], ['b', 4, 4], ['c', 5, 5]], 'functionsOf gives each function its name and its 1-based line span');
assert.deepStrictEqual(requiresOf("const x = require('npm-pkg');", path.join(process.cwd(), 'routes', 'y.js'), process.cwd()), { aliases: {}, members: {} }, 'a package that is not ours is not followed (never guessed)');
console.log('error-trace.test: 8 passed');

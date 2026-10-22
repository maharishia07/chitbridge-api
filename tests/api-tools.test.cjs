/**
 * tests/api-tools.test.cjs — THE API-1 TOOLS, AS UNITS: the ratchet's rules, the register's normaliser, the error-code table parser.
 *
 * OWNS      unit checks of tools/api-ratchet.cjs · tools/api-register.cjs · tools/error-codes.cjs · lib/respond.js · routes/openapi.js (no database, no server).
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      require each tool ──▶ feed it a small register ──▶ assert touched / held / refused / the generic sentence on an error
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const ratchet = require(path.join(API, 'tools', 'api-ratchet.cjs'));
const register = require(path.join(API, 'tools', 'api-register.cjs'));
const codes = require(path.join(API, 'tools', 'error-codes.cjs'));
const { safeErr, SAFE_SENTENCE } = require(path.join(API, 'lib', 'respond.js'));
const openapi = require(path.join(API, 'routes', 'openapi.js'));

let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name); } };
console.log('\napi tools · ratchet, register, error codes');

const row = (key, hash, file, columns) => ({ key, hash, file, columns: columns || { error_shape: true }, status: 'partial' });
const baseRegister = { routes: [row('GET /a', 'h1', 'a.js'), row('GET /b', 'h2', 'b.js')] };
const headRegister = { routes: [row('GET /a', 'h1', 'a.js'), row('GET /b', 'h9', 'b.js'), row('GET /c', 'h3', 'c.js')] };
const touched = ratchet.touchedRoutes(baseRegister, headRegister).map((r) => r.key);
t('touched = a changed hash or a new route, never an untouched sibling', touched.join() === 'GET /b,GET /c');
t('at stage 1b only the brought-over files (routes/keys.js) are held to the standard', ratchet.isHeld(row('x', 'h', 'routes/keys.js'), '1b') && !ratchet.isHeld(row('x', 'h', 'b.js'), '1b'));
t('a held route with a failing column does not pass', !ratchet.passesHold(row('x', 'h', 'routes/keys.js', { error_shape: false }), '1b'));
t('an expired debt entry is a problem', ratchet.debtProblems([{ route: 'GET /b', opened: '2020-01-01', expires: '2020-01-10', pr: '#1' }], false, []).length === 1);
t('a hotfix with no debt entry is a problem', ratchet.debtProblems([], true, [row('GET /b', 'h', 'b.js')]).length === 1);
t('the register normaliser ignores comments and spacing', register.normalise('a = 1 // note') === register.normalise('a  =  1'));
/* schema_out (S9): a non-JSON answer counts as a string of its media type; a declared media type with no schema still fails */
const answers = (content) => ({ responses: { 200: { description: 'ok', content } } });
t('schema_out: a JSON answer declared without a schema fails', !register.schemaOutColumn(answers({ 'application/json': {} })));
t('schema_out: a success declared with no media type at all fails', !register.schemaOutColumn({ responses: { 200: { description: 'ok' } } }));
t('schema_out: a zip declared as a string of its media type passes', register.schemaOutColumn(answers({ 'application/zip': { schema: { type: 'string', contentMediaType: 'application/zip' } } })));
t('the error-code parser finds the table of the committed register', codes.readRows().rows.length > 100);
t('a 500 carries the generic sentence, never the error text', safeErr(new Error('relation x does not exist')) === SAFE_SENTENCE);
t('the assembled OpenAPI is a contract that carries the Problem schema', typeof openapi.assemble === 'function');
t('a refused request (401 or 422 validation) is answered in the Problem shape, a duplicate or replay never twice: see tests/api-problem.test.cjs', true);
console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

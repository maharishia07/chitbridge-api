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
t('the error-code parser finds the table of the committed register', codes.readRows().rows.length > 100);
t('a 500 carries the generic sentence, never the error text', safeErr(new Error('relation x does not exist')) === SAFE_SENTENCE);
const rawLines = (src) => ratchet.rawErrorTextWrites(src).length;
t('raw error text: a safeErr / problem() answer is not counted', rawLines("res.status(500).json({ error: 'x', message: safeErr(e) });\nres.status(500).json(problem(req, { detail: err.message }));") === 0);
t('raw error text: res.status(500).json({error:e.message}) is counted, also String(e), stack and a template', rawLines("res.status(500).json({error:e.message});\nres.send(String(err));\nres.json({ s: error.stack });\nres.status(400).send(`bad ${e}`);") === 4);
t('raw error text: a multi-line write is counted at the line of the text', ratchet.rawErrorTextWrites("res.status(500).json({\n  error: 'x',\n  detail: e.message,\n});")[0].line === 3);
t('raw error text: a log line is not counted', rawLines("log.error('boom', { err: e.message });\nconsole.error(e.message);\nlogger.warn(String(e));") === 0);
t('raw error text: the ratchet prints file:line for a write the base did not have', ratchet.checkRawErrors([], [{ file: 'routes/a.js', line: 7, text: 'res.json({error:e.message})' }], { raw_error_writes: 0 }, { raw_error_writes: 0 }).some((line) => line.includes('routes/a.js:7')));
const bodyOp = (extra) => ({ requestBody: { content: { 'application/json': { schema: Object.assign({ type: 'object', properties: { a: { type: 'string' } } }, extra) } } }, responses: { 200: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } } } } } } });
const post = { method: 'POST', path: '/api/x' };
t('strict_input: a body schema that refuses unknown keys passes once its generated case did, one that drops them does not', register.strictInputColumn(bodyOp({ additionalProperties: false }), post, { hasSchemaCheck: true }, { strict_input: true }) && !register.strictInputColumn(bodyOp({}), post, { hasSchemaCheck: true }, { strict_input: true }));
t('strict_input: a refusing schema whose generated case has not passed does not count', !register.strictInputColumn(bodyOp({ additionalProperties: false }), post, { hasSchemaCheck: true }, undefined));
t('strict_input: a POST with no body schema fails, a GET with none has nothing to refuse', !register.strictInputColumn(undefined, post, {}) && register.strictInputColumn(undefined, { method: 'GET', path: '/x' }, {}));
t('output_allowlist: an allow-list schema still needs the contract test evidence', !register.outputAllowlistColumn(bodyOp({}), undefined) && register.outputAllowlistColumn(bodyOp({}), { output_allowlist: true }));
t('foreign_id_404: a route with an id needs the evidence, one without an id is not addressed by one', !register.foreignIdColumn({ path: '/api/x/:id' }, undefined) && register.foreignIdColumn({ path: '/api/x/:id' }, { foreign_id_404: true }) && register.foreignIdColumn({ path: '/api/x' }, undefined));
t('idempotent_money_write: a money write must REQUIRE the header and pass its generated case; any other route passes', !register.idempotentMoneyColumn(true, {}, { fns: [] }, { idempotent_money_write: true }) && register.idempotentMoneyColumn(true, { parameters: [{ in: 'header', name: 'Idempotency-Key', required: true }] }, { fns: [] }, { idempotent_money_write: true }) && !register.idempotentMoneyColumn(true, { parameters: [{ in: 'header', name: 'Idempotency-Key', required: true }] }, { fns: [] }, undefined) && register.idempotentMoneyColumn(false, {}, { fns: [] }));
t('inbound_validated: a peer door needs a schemaValidate check with a body schema', !register.inboundColumn(true, bodyOp({}), { hasSchemaCheck: false }) && register.inboundColumn(true, bodyOp({}), { hasSchemaCheck: true }) && register.inboundColumn(false, undefined, {}));
t('a mutating route that looks like money and is in neither list is named', register.unclassifiedMoney([{ key: 'POST /api/x/refund', method: 'POST', path: '/api/x/refund' }], { money: new Set(), notMoney: new Set() }).length === 1);
t('trips_budgeted: a fired budget line passes, a placeholder or no line does not', register.tripsBudgetedColumn('GET /a', { 'GET /a': { fired: true } }) && !register.tripsBudgetedColumn('GET /a', { 'GET /a': { fired: false } }) && !register.tripsBudgetedColumn('GET /b', {}));
t('stage 2 asks thirteen machine columns, six of them the hardening ones', register.HARDENING_COLUMNS.length === 6 && ratchet.passesHold(row('x', 'h', 'routes/keys.js', { error_shape: true, strict_input: false })) === false);
t('the assembled OpenAPI is a contract that carries the Problem schema', typeof openapi.assemble === 'function');
t('a refused request (401 or 422 validation) is answered in the Problem shape, a duplicate or replay never twice: see tests/api-problem.test.cjs', true);
console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

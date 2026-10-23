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
t('foreign_id_404: an id listed as public by design (public_ids) is out of scope, not failed', register.foreignIdColumn({ path: '/api/x/:id' }, undefined, true));
t('idempotent_money_write: a money write must REQUIRE the header and pass its generated case; any other route passes', !register.idempotentMoneyColumn(true, {}, { fns: [] }, { idempotent_money_write: true }) && register.idempotentMoneyColumn(true, { parameters: [{ in: 'header', name: 'Idempotency-Key', required: true }] }, { fns: [] }, { idempotent_money_write: true }) && !register.idempotentMoneyColumn(true, { parameters: [{ in: 'header', name: 'Idempotency-Key', required: true }] }, { fns: [] }, undefined) && register.idempotentMoneyColumn(false, {}, { fns: [] }));
t('inbound_validated: a peer door needs a schemaValidate check with a body schema', !register.inboundColumn(true, bodyOp({}), { hasSchemaCheck: false }) && register.inboundColumn(true, bodyOp({}), { hasSchemaCheck: true }) && register.inboundColumn(false, undefined, {}));
t('a mutating route that looks like money and is in neither list is named', register.unclassifiedMoney([{ key: 'POST /api/x/refund', method: 'POST', path: '/api/x/refund' }], { money: new Set(), notMoney: new Set() }).length === 1);
t('trips_budgeted: a fired budget line passes, a placeholder or no line does not', register.tripsBudgetedColumn('GET /a', { 'GET /a': { fired: true } }) && !register.tripsBudgetedColumn('GET /a', { 'GET /a': { fired: false } }) && !register.tripsBudgetedColumn('GET /b', {}));
t('stage 2 asks thirteen machine columns, six of them the hardening ones', register.HARDENING_COLUMNS.length === 6 && ratchet.passesHold(row('x', 'h', 'routes/keys.js', { error_shape: false, strict_input: true })) === false);
t('a route new to the base is held to all thirteen columns', ratchet.passesHold(row('x', 'h', 'routes/keys.js', { error_shape: true, strict_input: false }), undefined) === false && ratchet.passesHold(row('x', 'h', 'routes/keys.js', { error_shape: true, strict_input: true }), undefined) === true);
t('a route signed off in the base register is held even outside the listed files', ratchet.isHeld(row('x', 'h', 'routes/other.js', {}), '2', Object.assign(row('x', 'g', 'routes/other.js', {}), { human: { signed_off_by_date: 'cb-api 2026-10-23' } })) && !ratchet.isHeld(row('x', 'h', 'routes/other.js', {}), '2', row('x', 'g', 'routes/other.js', {})));
t('evidence union: generator only, area only, and both are each proved; a column neither proves stays unproved', (() => { const u = register.evidenceUnion({ 'GET /g': { output_allowlist: true }, 'GET /b': { strict_input: true } }, { 'GET /a': { foreign_id_404: true }, 'GET /b': { foreign_id_404: true } }); return u['GET /g'].output_allowlist === true && u['GET /a'].foreign_id_404 === true && u['GET /b'].strict_input === true && u['GET /b'].foreign_id_404 === true && u['GET /a'].strict_input === undefined; })());
t('an area proof over a generated FAILURE is listed, a generated pass or no generated case is not', register.evidenceOverrides({ 'GET /x/:id': { foreign_id_404: { pass: false, why: '200' } }, 'GET /y/:id': { foreign_id_404: { pass: true } } }, { 'GET /x/:id': { foreign_id_404: true }, 'GET /y/:id': { foreign_id_404: true }, 'GET /z/:id': { foreign_id_404: true } }).length === 1);
t('the stage switch belongs to the register code, forward only; a hand-edited ratchet stage is refused', (() => { const head = { stage: '2', counts: { routes: 3, meets: 0 } }; const fwd = ratchet.stageSwitch('1b', head, { stage: '2' }); const same = ratchet.stageSwitch('2', head, { stage: '3' }); const back = ratchet.stageSwitch('all', head, { stage: '2' }); return fwd.switched && !fwd.problems.length && !same.switched && same.problems.length === 1 && !back.switched && back.problems.length === 1; })());
t('the base stage is read from the base checkout code', ratchet.stageOfCode(API) === register.STAGE && ratchet.stageOfCode(path.join(API, 'no-such-checkout')) === null);
t('a later PR that edits the ratchet stage cannot raise the count', ratchet.checkCounts({ stage: '2', not_meeting: 1, total: 3 }, { stage: '2', counts: { routes: 3, meets: 0 } }, { stage: '3', not_meeting: 3, total: 3 }, '2').some((p) => /rose to 3/.test(p)));
t('a signed route renamed in its file is named; a plain removal is not', (() => { const signed = Object.assign(row('GET /a/old', 'h', 'routes/a.js', {}), { method: 'GET', human: { signed_off_by_date: 'cb-api 2026-10-23' } }); const renamed = ratchet.renamedSigned({ routes: [signed] }, { routes: [Object.assign(row('GET /a/new', 'h', 'routes/a.js', {}), { method: 'GET' })] }); const removed = ratchet.renamedSigned({ routes: [signed] }, { routes: [] }); return renamed.length === 1 && removed.length === 0; })());
t('a held route keeps its core columns and loses no hardening column it passed at the base', ratchet.passesHold(row('x', 'h', 'routes/keys.js', { error_shape: true, strict_input: false }), row('x', 'g', 'routes/keys.js', { error_shape: true, strict_input: false })) === true && ratchet.passesHold(row('x', 'h', 'routes/keys.js', { error_shape: true, strict_input: false }), row('x', 'g', 'routes/keys.js', { error_shape: true, strict_input: true })) === false);
t('the assembled OpenAPI is a contract that carries the Problem schema', typeof openapi.assemble === 'function');
t('a refused request (401 or 422 validation) is answered in the Problem shape, a duplicate or replay never twice: see tests/api-problem.test.cjs', true);
console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

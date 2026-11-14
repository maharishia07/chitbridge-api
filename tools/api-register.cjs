#!/usr/bin/env node
'use strict';
/*
 * OWNS      docs/API-REGISTER.md and docs/api-register.json: one row per endpoint of the real app, one column per machine check, a status. The number of endpoints is THIS tool's count.
 * CALLED BY CI job api-standard (--check) · tools/api-ratchet.cjs (--json, base and head) · by hand after a route change (no flag writes both files).
 * FLOW      tools/load-app.cjs (server.js offline, routes walked) ──▶ per route: hash · statuses · codes · declared OpenAPI ──▶ columns ──▶ status ──▶ md + json
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/api-register.cjs            write docs/API-REGISTER.md and docs/api-register.json
 *   node tools/api-register.cjs --check    exit 1 when either file differs from what the code says (and when the error-code table fails its own check)
 *   node tools/api-register.cjs --json F   write the register as JSON to file F (the ratchet reads base and head this way); --root <dir> runs it over another checkout
 * Sign-offs (S15): the human columns are read from docs/api-signoffs.json, a hand file this tool never writes; docs/api-register.json only shows them.
 * API-STANDARD S15. Stage "2" adds the six hardening columns (S33-S38, API-3) to the seven of stage "1b": all thirteen are live (schema_in and schema_out from the route's OpenAPI operation and its schemaValidate check; missing_input_answer from
 * docs/contracts/api-contract-results.json, which tools/api-contract-tests.cjs writes). "meets standard" = all thirteen AND a cb-api sign-off in the json.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const card = require('./api-card.cjs');
const reported = require('./api-reported.cjs');

const TOOLS_DIR = __dirname;
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(TOOLS_DIR, '..');
/* 2b (9 Nov 2026): the thirteen columns of stage 2, and a route reads "meets standard" only with a sign-off made at stage 2 (dated on or after SIGNOFF_STAGE_FROM); a seven-column stamp of 23 Oct no longer counts */
const STAGE = '2b';
const SIGNOFF_STAGE_FROM = '2026-10-24';
const MACHINE_COLUMNS = ['schema_in', 'schema_out', 'error_shape', 'codes_registered', 'missing_input_answer', 'error_tests', 'status_codes', 'strict_input', 'output_allowlist', 'foreign_id_404', 'idempotent_money_write', 'inbound_validated', 'trips_budgeted'];
/* the six hardening columns of stage 2 (API-3): they close the OWASP API Top 10 gaps route by route */
const HARDENING_COLUMNS = ['strict_input', 'output_allowlist', 'foreign_id_404', 'idempotent_money_write', 'inbound_validated', 'trips_budgeted'];
const SUCCESS_STATUSES = ['200', '201', '202', '204'];
const HUMAN_COLUMNS = ['names_clear', 'sentence_plain', 'backward_compatible', 'signed_off_by_date', 'lifecycle'];
const BODY_METHODS = ['POST', 'PUT', 'PATCH'];
const MD_FILE = path.join(ROOT, 'docs', 'API-REGISTER.md');
const JSON_FILE = path.join(ROOT, 'docs', 'api-register.json');

/** the hardening evidence: the generator's cases (api-hardening-evidence.json, written only by tools/api-contract-tests.cjs) united with the area tests' worlds (api-hardening-evidence-areas.json, written only by tests/api-problem-<area>.test.cjs); a column is proved when either file proves it */
function hardeningEvidence() {
  return evidenceUnion(readJson('docs/contracts/api-hardening-evidence.json', { routes: {} }).routes, readJson('docs/contracts/api-hardening-evidence-areas.json', { routes: {} }).routes);
}

/** two evidence maps {route: {column: true}} as one: a column is proved when either map proves it */
function evidenceUnion(generated, areas) {
  const union = {};
  [generated || {}, areas || {}].forEach((routes) => Object.entries(routes).forEach(([route, columns]) => { union[route] = Object.assign(union[route] || {}, columns); }));
  return union;
}

/** the columns an area test proves where the generator's own case ran and FAILED: allowed (the area world is the stronger test), never silent; --check lists each one */
function evidenceOverrides(results, areas) {
  const overrides = [];
  Object.entries(areas || {}).forEach(([route, columns]) => Object.keys(columns).forEach((column) => {
    const generated = results && results[route] && results[route][column];
    if (columns[column] === true && generated && generated.pass === false) overrides.push(route + ' · ' + column + ' · the generator saw: ' + (generated.why || 'a failure'));
  }));
  return overrides.sort();
}

/** a JSON file under the repo root, or the fallback when it is absent */
const readJson = (relative, fallback) => {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
};
const shortHash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/** source text with comments and whitespace removed, so a comment edit or a reformat does not change a route's hash */
function normalise(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, '');
}

/** OpenAPI operations from every routes file's fragment, keyed 'METHOD /express/path' ({id} becomes :id) */
function openapiOperations(routerFiles) {
  const operations = {};
  Object.values(routerFiles).forEach(({ exported }) => {
    const paths = (exported && exported.openapi && exported.openapi.paths) || {};
    Object.keys(paths).forEach((apiPath) =>
      Object.keys(paths[apiPath]).forEach((method) => {
        operations[method.toUpperCase() + ' ' + apiPath.replace(/\{([^}]+)\}/g, ':$1')] = paths[apiPath][method];
      })
    );
  });
  return operations;
}

/** every routes file's OpenAPI operations, keyed 'METHOD /express/path' (the register and the generated hardening cases read the same map) */
function operationsOfApp() {
  return openapiOperations(Object.fromEntries([...routerFilesOf().values()].map((info) => [info.file, info])));
}

const ROUTER_DIRS = ['routes', 'src/routes'];

/** { router object -> { file: 'routes/x.js', exported } } for every routes file (they are in the require cache once server.js has loaded) */
function routerFilesOf() {
  const found = new Map();
  ROUTER_DIRS.forEach((dir) => {
    const absolute = path.join(ROOT, dir) + path.sep;
    Object.keys(require.cache)
      .filter((file) => file.startsWith(absolute))
      .forEach((file) => found.set(require.cache[file].exports, { file: dir + '/' + path.basename(file), exported: require.cache[file].exports }));
  });
  return found;
}

/** the owner area of a route file: its name, except that routes/chits-<part>.js (LEAN-PLAN §8: routes/chits.js split by owner area) is still the chits area, so a move-only split changes a row's file and line and nothing else */
/* a part of a split router answers in its parent's group (routes/chits-trace.js, and routes/chit-proposals.js which routes/chits.js uses: tools/server-mounts.cjs partParents) */
const PARTS = require('./server-mounts.cjs').partParents(path.join(ROOT, 'routes'));
const areaOfFile = (file) => path.basename(PARTS[path.basename(file)] || file, '.js').replace(/^chits-.+$/, 'chits');

/** the functions every route shares (middleware/*.js exports): not "own" code of a route, never hashed with it */
function sharedFunctions() {
  const shared = new Set();
  const dir = path.join(ROOT, 'middleware');
  fs.readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .forEach((name) => {
      const exported = require(path.join(dir, name));
      shared.add(exported);
      if (exported && typeof exported === 'object') Object.values(exported).forEach((item) => shared.add(item));
    });
  return shared;
}

/** an express-validator chain, or a schemaValidate(operation) check (middleware/validate.js) */
const isValidationChain = (fn) => typeof fn === 'function' && ((fn.builder && typeof fn.builder.build === 'function') || !!fn.schemaOperation);

/** a validation chain's rules as text (its toString is the same for every chain) */
function chainRules(fn) {
  if (fn.schemaOperation) return 'schema:' + JSON.stringify(fn.schemaOperation);
  try {
    return JSON.stringify(fn.builder.build());
  } catch (failure) {
    return 'unreadable-chain:' + fn.name;
  }
}

/** the functions a route file defines for this route: found by their own text in the file (a middleware from another module is not in it) */
function ownFunctions(handlers, fileText, shared, otherTexts) {
  const inFile = (fn) => fileText.includes(fn.toString());
  /* an ALIAS (routes/actors.js POST /login runs routes/signin.js's handler): a function the route file does not hold is looked up in the other routes files, so the register judges the handler that really answers */
  const inOther = (fn) => (otherTexts || []).some((text) => text.includes(fn.toString()));
  return handlers.filter((fn) => typeof fn === 'function' && !shared.has(fn) && !isValidationChain(fn) && (inFile(fn) || inOther(fn)));
}

/** the text of every routes file but this one, read once */
const routeTexts = new Map();
function readRouteTexts() {
  const found = ROUTER_DIRS.filter((dir) => fs.existsSync(path.join(ROOT, dir)));
  found.forEach((dir) => fs.readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith('.js')).forEach((name) => routeTexts.set(dir + '/' + name, fs.readFileSync(path.join(ROOT, dir, name), 'utf8'))));
}
function otherRouteTexts(file) {
  if (file === 'unknown') return [];
  if (!routeTexts.size) readRouteTexts();
  return [...routeTexts.entries()].filter(([name]) => name !== file).map(([, text]) => text);
}

const statusesWritten = (source) => [...source.matchAll(/(?:\.status\(\s*|\.sendStatus\(\s*|status:\s*)(\d{3})\b/g)].map((match) => Number(match[1])).filter((status) => status >= 400);

/** a status written straight onto the response with a body, the way a route answered before the standard */
const rawErrorWrites = (source) => /\.status\(\s*(?:[45]\d\d|[^)\d][^)]*)\)\s*\.(?:json|send|end)\(/.test(source) || /\.sendStatus\(\s*[45]\d\d/.test(source);

const codesWritten = (source) => [...source.matchAll(/code:\s*'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]);

/** the statuses a route must declare whatever its code says (S15 "not vacuous") */
function impliedStatuses(leaf, hasValidation, usesAuth) {
  const implied = [500];
  if (usesAuth) implied.push(401);
  if (leaf.path.includes(':')) implied.push(404);
  return { implied, takesInput: BODY_METHODS.includes(leaf.method) || hasValidation };
}

/** the status_codes column: declared statuses against the res.status() literals in the handler */
function statusColumn(declared, used, leaf, stackFacts) {
  const { implied, takesInput } = impliedStatuses(leaf, stackFacts.hasValidation, stackFacts.usesAuth);
  const allowedExtra = (stackFacts.hasGate ? [401, 403] : []).concat(stackFacts.gateStatuses);
  if (!declared.length) return false;
  const covers = used.concat(implied).every((status) => declared.includes(status));
  const inputAnswered = !takesInput || declared.includes(400) || declared.includes(422);
  const noInvention = declared.every((status) => used.concat(implied, allowedExtra).includes(status) || (takesInput && (status === 400 || status === 422)));
  return covers && inputAnswered && noInvention;
}

/** facts about the middleware in front of a route: sign-in required, a validation chain, any other gate */
function stackFactsOf(leaf, shared) {
  const route = leaf.fns.slice(0, -1);
  const everyone = leaf.chain.map((item) => (typeof item === 'function' ? item : item.fn)).concat(route);
  const usesAuth = everyone.some((fn) => fn && fn.name === 'auth' && shared.has(fn));
  return {
    usesAuth,
    /* a gate declares the statuses it answers itself in fn.addsStatuses (middleware/idempotency.js ADDS_STATUSES) */
    gateStatuses: everyone.flatMap((fn) => (fn && Array.isArray(fn.addsStatuses) ? fn.addsStatuses : [])),
    hasValidation: route.some(isValidationChain),
    hasSchemaCheck: route.some((fn) => !!(fn && fn.schemaOperation)),
    hasGate: route.some((fn) => typeof fn === 'function' && !isValidationChain(fn))
  };
}

/** a schema is well formed (ajv's own check of it against the JSON Schema meta-schema: no throw) */
const compiles = (schema) => require('../middleware/validate').bodyEngine.validateSchema(schema) === true;

/**
 * schema_out: every success answer declares at least one media type, and each declared schema compiles (204 needs none).
 * application/json carries the JSON shape; a text or binary answer (a markdown page, a zip) is a string of its media type,
 * { type: 'string', contentMediaType: '<type>' } — OpenAPI 3.1, API-STANDARD S9. A media type with no schema still fails.
 */
function schemaOutColumn(operation) {
  const responses = (operation && operation.responses) || {};
  const success = Object.keys(responses).filter((status) => SUCCESS_STATUSES.includes(status));
  if (!success.length) return false;
  return success.every((status) => {
    if (status === '204') return true;
    const declared = Object.values(responses[status].content || {});
    return declared.length > 0 && declared.every((content) => !!(content && content.schema) && compiles(content.schema));
  });
}

/** schema_in: the route declares its input (a body method declares a body) and a schemaValidate check in front of it answers from that schema */
function schemaInColumn(operation, leaf, facts) {
  if (!operation) return false;
  const validate = require('../middleware/validate');
  const hasBody = !!validate.bodySchemaOf(operation);
  const hasUrl = !!validate.urlSchemaOf(operation);
  if (BODY_METHODS.includes(leaf.method) && !hasBody) return false;
  return !(hasBody || hasUrl) || facts.hasSchemaCheck;
}

/** missing_input_answer: a route with no input has nothing to omit; otherwise the generated omit-all and left-out cases all passed (docs/contracts/api-contract-results.json) */
function missingInputColumn(operation, result) {
  if (!operation) return false;
  const validate = require('../middleware/validate');
  const hasInput = !!(validate.bodySchemaOf(operation) || validate.urlSchemaOf(operation));
  return !hasInput || !!(result && result.missing_input_ok && result.failed === 0);
}

/** the success answers' JSON schemas of an operation (204 has none) */
function successSchemas(operation) {
  const responses = (operation && operation.responses) || {};
  return Object.keys(responses)
    .filter((status) => SUCCESS_STATUSES.includes(status) && status !== '204')
    .map((status) => responses[status].content && responses[status].content['application/json'] && responses[status].content['application/json'].schema);
}

/** a schema that lists its fields and refuses any other (the allow-list): an object with additionalProperties false */
/** a schema that lists its keys and refuses the rest: an object itself, or a bare list whose items are such objects (the allow-list filter prunes a list at its rows) */
const refusesUnknownKeys = (schema) => !!schema && (schema.additionalProperties === false || (schema.type === 'array' && !!schema.items && schema.items.additionalProperties === false));

/** strict_input (S33): a route that takes a body declares it with additionalProperties false behind a schemaValidate check, AND its generated case (tools/api-contract-tests.cjs → api-hardening-evidence.json) saw an unknown key refused by name; a route with no body has nothing to refuse */
function strictInputColumn(operation, leaf, facts, evidence) {
  const bodySchema = operation && require('../middleware/validate').bodySchemaOf(operation);
  if (!bodySchema) return !BODY_METHODS.includes(leaf.method);
  return facts.hasSchemaCheck && refusesUnknownKeys(bodySchema) && !!(evidence && evidence.strict_input === true);
}

/** output_allowlist (S34): every success schema is an allow-list AND its generated case (docs/contracts/api-hardening-evidence.json) saw a row's extra column kept out of the answer; a 204 answer has no body to leak */
function outputAllowlistColumn(operation, evidence) {
  const schemas = successSchemas(operation);
  if (!schemaOutColumn(operation)) return false;
  /* an operation that SAYS its answer is text with no keys (x-no-keys-to-leak, set by the route's contract row `noKeys`) and holds no JSON schema has nothing to allow-list; every other text or binary answer stays red until its owner says so and cb-api signs it again */
  const textOnly = !!operation && operation['x-no-keys-to-leak'] === true && schemas.every((schema) => !schema);
  return schemas.length === 0 || textOnly || (schemas.every(refusesUnknownKeys) && !!(evidence && evidence.output_allowlist === true));
}

/** foreign_id_404 (S35): a route addressed by an id needs its generated case to see another shop's id answered with the unknown id's 404; a route with no id in its path, or whose id is public by design (api-hardening-scope.json public_ids), is not addressed by a shop's own id */
const foreignIdColumn = (leaf, evidence, isPublicId) => !leaf.path.includes(':') || !!isPublicId || !!(evidence && evidence.foreign_id_404 === true);

/** does the operation declare an Idempotency-Key header as required, or the chain hold a requireIdempotencyKey gate */
function requiresIdempotencyKey(operation, leaf) {
  const declared = ((operation && operation.parameters) || []).some((item) => item && item.in === 'header' && String(item.name).toLowerCase() === 'idempotency-key' && item.required === true);
  return declared || leaf.fns.some((fn) => typeof fn === 'function' && fn.name === 'requireIdempotencyKey');
}

/** idempotent_money_write (S36): a money write (docs/contracts/api-hardening-scope.json) must REQUIRE the header, and its generated case saw no key refused 422 and a resend replayed; the global middleware only honours the header when sent, which is opt-in */
const idempotentMoneyColumn = (isMoneyWrite, operation, leaf, evidence, machineKeyed) => !isMoneyWrite || !!machineKeyed || (requiresIdempotencyKey(operation, leaf) && !!(evidence && evidence.idempotent_money_write === true));

/** inbound_validated (S37): a peer or webhook door checks its JSON against a schema (schemaValidate with a body schema) before the handler reads it */
const inboundColumn = (isInbound, operation, facts) => !isInbound || (facts.hasSchemaCheck && !!(operation && require('../middleware/validate').bodySchemaOf(operation)));

/** trips_budgeted (S38): the route has a FIRED line (a measured ceiling, not the placeholder) in round-trips.budget.json; tests/round-trips-all.test.cjs fails the guards when the route goes over it. Making it cheaper is cb-speed's; this only checks the budget exists */
const tripsBudgetedColumn = (key, budget) => !!(budget && budget[key] && budget[key].fired === true);

/** a route whose path id S35 does not apply to: public by design (public_ids) or reachable only by the platform or the builder (platform_only); both lists live in api-hardening-scope.json, each entry with its reason */
const idExempt = (scope, key) => scope.publicIds.has(key) || scope.platformOnly.has(key);

/** strict_input applies to a route with a body that is not listed in tolerant_outward (API-43) */
const strictApplies = (hasBody, scope, key) => hasBody && !scope.tolerantOutward[key];

/** which of the six columns apply to a route (a column that does not apply passes, and is not counted as a pass in the per-column baseline) */
function hardeningApplies(leaf, operation, scope) {
  const key = leaf.method + ' ' + leaf.path;
  const hasBody = !!(operation && require('../middleware/validate').bodySchemaOf(operation)) || BODY_METHODS.includes(leaf.method);
  return { strict_input: strictApplies(hasBody, scope, key), output_allowlist: true, foreign_id_404: leaf.path.includes(':') && !idExempt(scope, key), idempotent_money_write: scope.money.has(key), inbound_validated: scope.inbound.has(key), trips_budgeted: true };
}

/** cannot_answer (scope file): { 'METHOD /path': Set of statuses } the route can never answer; an entry without a route, a status and a reason of MIN_REASON characters counts for nothing (scopeProblems, run by --check, names it) */
const MIN_REASON = 20;
const hasReason = (text) => String(text || '').trim().length >= MIN_REASON;
function cannotAnswerOf(list) {
  const found = {};
  (list || []).filter((entry) => entry && entry.route && entry.status && hasReason(entry.reason)).forEach((entry) => (found[entry.route] = (found[entry.route] || new Set()).add(Number(entry.status))));
  return found;
}

/**
 * tolerant_outward (scope file): { 'METHOD /path': { reason, caller_class, test } } — "tolerant by design" (Athi 11 Nov 2026, S33-T). A door whose caller is outside us or queued ignores an unknown body key.
 * An entry counts ONLY with all three: a reason of MIN_REASON characters, a caller class from TOLERANT_CLASSES, and a test file that proves it (checked in tolerantProblems). Anything else counts for nothing (the route stays strict).
 */
const TOLERANT_CLASSES = ['queued_till', 'queued_web_outbox', 'provider_webhook', 'ctp_delivery', 'record_as_body', 'desktop_connector', 'keyed_outward'];
const soundTolerantEntry = (entry) => !!entry && typeof entry === 'object' && hasReason(entry.reason) && TOLERANT_CLASSES.includes(entry.caller_class) && typeof entry.test === 'string' && entry.test.length > 0;
const tolerantOutwardOf = (list) => Object.fromEntries(Object.entries(list || {}).filter(([, entry]) => soundTolerantEntry(entry)).map(([key, entry]) => [key, entry.reason]));

/**
 * machine_keyed (scope file): [{ route, key_order, reason, test }] — a keyed machine door (an agent that sends its own key and cannot send Idempotency-Key) that dedupes by its OWN key order instead (Athi 11 Nov 2026, CON-ERP-IDEM).
 * S36 passes such a route ONLY while its test file proves the cases in MACHINE_KEYED_CASES; a listed route whose test is missing or does not carry the cases fails --check and does not pass the column.
 */
const MACHINE_KEYED_CASES = ['K1 ', 'K2 ', 'K3 ', 'K4 ', 'K5 ', 'K6 ']; /* the case ids the test prints: same payload once · two payloads two chits · failed emit 503 then retry · stale pending re-claimed · header beats hash · same key other body 422 */
/** the sentence for the shape of one machine_keyed entry (route, key order, reason, test named); '' when it is whole */
function machineKeyedShapeProblem(entry, byKey) {
  const name = 'machine_keyed: "' + (entry && entry.route) + '"';
  if (!entry || typeof entry !== 'object' || !entry.route) return 'machine_keyed: each entry must be { route, key_order, reason, test }';
  if (!byKey.has(entry.route)) return name + ' is not a route of the app';
  if (!Array.isArray(entry.key_order) || entry.key_order.length === 0) return name + ' needs a key_order (the keys it dedupes by, in order)';
  return hasReason(entry.reason) ? '' : name + ' needs a reason of at least ' + MIN_REASON + ' characters';
}
/** the sentence for the proof of one machine_keyed entry: its test file exists and carries the route and the cases; '' when it does */
function machineKeyedProofProblem(entry) {
  const name = 'machine_keyed: "' + entry.route + '"';
  if (!entry.test || !fs.existsSync(path.join(ROOT, String(entry.test)))) return name + ' test file ' + entry.test + ' does not exist';
  const text = fs.readFileSync(path.join(ROOT, String(entry.test)), 'utf8');
  const missing = [entry.route].concat(MACHINE_KEYED_CASES).filter((needle) => !text.includes(needle));
  return missing.length ? name + ' test file ' + entry.test + ' does not prove ' + missing.map((word) => '"' + word.trim() + '"').join(', ') : '';
}
/** the sentence for one machine_keyed entry that is not sound; '' when it is */
const machineKeyedProblem = (entry, byKey) => machineKeyedShapeProblem(entry, byKey) || machineKeyedProofProblem(entry);
/** the routes whose machine_keyed entry holds (with no byKey the route is taken as real: the register's own check names an unreal route) */
const machineKeyedOf = (list) => new Set((Array.isArray(list) ? list : []).filter((entry) => !machineKeyedProblem(entry, new Map([[entry && entry.route, true]]))).map((entry) => entry.route));
/** the sentences for the machine_keyed list, for --check */
const machineKeyedProblems = (list, byKey) => (Array.isArray(list) ? list : []).map((entry) => machineKeyedProblem(entry, byKey)).filter(Boolean);

/** the curated lists of docs/contracts/api-hardening-scope.json as sets */
function hardeningScope() {
  const file = readJson('docs/contracts/api-hardening-scope.json', {});
  return { money: new Set(file.money_writes || []), notMoney: new Set(file.money_reviewed_not || []), inbound: new Set(file.inbound || []), publicIds: new Set(Object.keys(file.public_ids || {})), platformOnly: new Set(Object.keys(file.platform_only || {})), cannotAnswer: cannotAnswerOf(file.cannot_answer), tolerantOutward: tolerantOutwardOf(file.tolerant_outward), machineKeyed: machineKeyedOf(file.machine_keyed) };
}

/** the sentence for one tolerant_outward key that is not a route of the app, or no longer checks the fields it reads (schema_in); '' when sound */
function tolerantRouteProblem(key, byKey) {
  if (!byKey.has(key)) return 'tolerant_outward: "' + key + '" is not a route of the app';
  return byKey.get(key).columns.schema_in ? '' : 'tolerant_outward: "' + key + '" must still check the fields it reads (schema_in)';
}

/** the proof a tolerant door owes: its test file exists, names the route, sends an unknown key (zz_unknown) and expects the problem shape; a hand-written file that ignores all of this cannot pass */
function tolerantProofProblem(key, entry) {
  const file = path.join(ROOT, String(entry.test));
  if (!fs.existsSync(file)) return 'tolerant_outward: "' + key + '" test file ' + entry.test + ' does not exist';
  const text = fs.readFileSync(file, 'utf8');
  const word = key.split(' ')[1].split('/').filter((part) => part && !part.startsWith(':')).pop(); /* the route's own last word, for a file that names the route by it (ask('explain', ...)) */
  const missing = [text.includes(key) ? key : word, 'zz_unknown', 'problem'].filter((needle) => !text.includes(needle));
  return missing.length ? 'tolerant_outward: "' + key + '" test file ' + entry.test + ' does not mention ' + missing.map((word) => '"' + word + '"').join(', ') : '';
}

/** the sentences for the tolerant_outward list: each key a sound route with a reason, a caller class from the closed list and a proving test file; the list may not pass its ceiling (S33-T) */
function tolerantProblems(list, byKey, ceiling) {
  const entries = Object.entries(list || {});
  const found = entries.flatMap(([key, entry]) => {
    if (!entry || typeof entry !== 'object') return ['tolerant_outward: "' + key + '" must be { reason, caller_class, test }'];
    return [tolerantRouteProblem(key, byKey), hasReason(entry.reason) ? '' : 'tolerant_outward: "' + key + '" needs a reason of at least ' + MIN_REASON + ' characters', TOLERANT_CLASSES.includes(entry.caller_class) ? '' : 'tolerant_outward: "' + key + '" caller_class must be one of ' + TOLERANT_CLASSES.join(', '), entry.test ? tolerantProofProblem(key, entry) : 'tolerant_outward: "' + key + '" needs a test file'].filter(Boolean);
  });
  if (typeof ceiling === 'number' && entries.length > ceiling) found.push('tolerant_outward has ' + entries.length + ' doors, above its ceiling ' + ceiling + ' (raise tolerant_outward_ceiling only with a cb-api sign-off)');
  return found;
}

/**
 * scopeProblems(file, rows) — the exemptions of api-hardening-scope.json (public_ids, platform_only, cannot_answer) held to one rule each, for --check: a reason of MIN_REASON characters or more,
 * a route the register has, for cannot_answer a status that route declares, and no route and status twice. A one-character reason, a typo'd route or an undeclared status is a sentence here.
 */
function scopeProblems(file, rows) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const found = [];
  ['public_ids', 'platform_only'].forEach((list) => Object.entries(file[list] || {}).forEach(([key, reason]) => {
    if (!byKey.has(key)) found.push(list + ': "' + key + '" is not a route of the app');
    if (!hasReason(reason)) found.push(list + ': "' + key + '" needs a reason of at least ' + MIN_REASON + ' characters');
  }));
  found.push(...tolerantProblems(file.tolerant_outward, byKey, file.tolerant_outward_ceiling));
  found.push(...machineKeyedProblems(file.machine_keyed, byKey));
  const seen = new Set();
  (file.cannot_answer || []).forEach((entry) => {
    const name = 'cannot_answer: "' + entry.route + ' ' + entry.status + '"';
    if (!byKey.has(entry.route)) found.push(name + ' is not a route of the app');
    else if (!byKey.get(entry.route).declared.includes(entry.status)) found.push(name + ': the route does not declare that status');
    if (!hasReason(entry.reason)) found.push(name + ' needs a reason of at least ' + MIN_REASON + ' characters');
    if (seen.has(entry.route + ' ' + entry.status)) found.push(name + ' is listed twice');
    seen.add(entry.route + ' ' + entry.status);
  });
  return found.map((sentence) => 'docs/contracts/api-hardening-scope.json ' + sentence);
}

/** a mutating route whose path reads like money but is in no list: someone must say whether it is a money write (--check fails) */
const MONEY_WORDS = /(^|[/-])(pay|payment|payments|receipt|receipts|refund|refunds|settle|settlement|credit|collect|collection|advance|redeem|wallet|cash|ledger|journal|invoice|invoices|purchase|bill|bills|billing|day-close|expense|expenses|payout|reward|points|transfer|deposit|adjust)(\b|[/:-]|$)/i;
const unclassifiedMoney = (rows, scope) => rows.filter((row) => row.method !== 'GET' && MONEY_WORDS.test(row.path) && !scope.money.has(row.key) && !scope.notMoney.has(row.key)).map((row) => row.key);

/** strict_input, or for an API-43 listed door (tolerant_outward) that it still checks the fields it reads (schema_in) */
const strictOrTolerant = (scope, key, operation, leaf, facts, evidence) => (scope.tolerantOutward[key] ? schemaInColumn(operation, leaf, facts) && knownKeysTyped(operation) : strictInputColumn(operation, leaf, facts, evidence));

/** S33-T proof 2, mechanical: every known key of a tolerant door's body schema says what it holds (a type, enum, const, pattern or $ref); a bare name is not validation */
function knownKeysTyped(operation) {
  const schema = operation && require('../middleware/validate').bodySchemaOf(operation);
  if (schema && schema.$ref) return true; /* a body published as a named schema (offers EvaluateBody) is typed where it is defined; the enforced row is typed in its contract (lib/offers-contract.js) */
  const props = (schema && schema.properties) || {};
  const typed = (property) => !!property && typeof property === 'object' && ['type', 'enum', 'const', 'pattern', '$ref', 'oneOf', 'anyOf'].some((word) => property[word] !== undefined);
  return !!schema && Object.values(props).every(typed); /* a door that reads no body key has nothing untyped: its schema is still required (a door with no schema check is not tolerant, it is unchecked) */
}

/** the thirteen machine columns of one route, each true or false */
function machineColumns({ source, declared, facts, legacyEntry, leaf, tested, registered, operation, result, scope, evidence, budget }) {
  const key = leaf.method + ' ' + leaf.path;
  const codes = codesWritten(source);
  const usesProblem = /\bproblem\(|\bfromError\(|\bsoftFault\(|next\(\s*(?:err|e|error)\s*\)/.test(source);
  /* a `legacy:` that is a problem spec's frozen body needs its entry in api-legacy.json; a boolean ANSWER key of that name (GET /api/signin/sessions says legacy: !req.session, a token from before M05) is data, not a frozen body */
  const legacyOk = !/\blegacy:(?!\s*(?:!|true\b|false\b))/.test(source) || !!legacyEntry;
  return {
    schema_in: schemaInColumn(operation, leaf, facts),
    schema_out: schemaOutColumn(operation),
    missing_input_answer: missingInputColumn(operation, result),
    error_shape: usesProblem && !rawErrorWrites(source) && legacyOk,
    codes_registered: (codes.length > 0 || usesProblem) && codes.every((code) => registered.has(code)),
    error_tests: declared.length > 0 && declared.every((status) => tested.includes(status) || !!(scope.cannotAnswer && scope.cannotAnswer[key] && scope.cannotAnswer[key].has(status))),
    status_codes: statusColumn(declared, statusesWritten(source), leaf, facts),
    strict_input: strictOrTolerant(scope, key, operation, leaf, facts, evidence),
    output_allowlist: outputAllowlistColumn(operation, evidence),
    foreign_id_404: foreignIdColumn(leaf, evidence, idExempt(scope, key)),
    idempotent_money_write: idempotentMoneyColumn(scope.money.has(key), operation, leaf, evidence, scope.machineKeyed.has(key)),
    inbound_validated: inboundColumn(scope.inbound.has(key), operation, facts),
    trips_budgeted: tripsBudgetedColumn(key, budget)
  };
}

/** one row of the register, machine columns only; the human columns are merged in by the caller */
function rowOf(leaf, context) {
  const info = context.routerFiles.get(leaf.router) || { file: leaf.router === context.app ? 'server.js' : 'unknown' };
  const fileText = info.file === 'unknown' ? '' : fs.readFileSync(path.join(ROOT, info.file), 'utf8');
  const key = leaf.method + ' ' + leaf.path;
  const ownHandlers = ownFunctions(leaf.fns, fileText, context.shared, otherRouteTexts(info.file));
  const source = ownHandlers.map((fn) => fn.toString()).join('\n');
  const operation = context.operations[key];
  /* a status the document only DOCUMENTS (x-documented-statuses: a limiter's 429, not written by the handler) is not one the route must write or test */
  const documentedOnly = (operation && operation['x-documented-statuses']) || [];
  const declared = Object.keys((operation && operation.responses) || {}).map(Number).filter((status) => status >= 400 && !documentedOnly.includes(status));
  const facts = stackFactsOf(leaf, context.shared);
  const legacyEntry = context.legacy[key];
  const columns = machineColumns({ source, declared, facts, legacyEntry, leaf, tested: testedStatuses(context, key), registered: context.registered, operation, result: context.contract[key], scope: context.scope, evidence: context.evidence[key], budget: context.budget });
  const hashSource = ownHandlers.map(normalise).join('|') + '#' + leaf.fns.filter(isValidationChain).map(chainRules).join('|') + '#' + JSON.stringify(operation || null);
  const line = lineOf(fileText, leaf);
  const area = areaOfFile(info.file);
  const facts4card = card.cardOf({ root: ROOT, area, source, fileText, fileAbs: info.file === 'unknown' ? '' : path.join(ROOT, info.file), line, declared, codes: codesWritten(source), registeredCodes: context.registered, curatedMoney: context.scope.money.has(key), known: context.tables });
  return Object.assign({ key, method: leaf.method, path: leaf.path, owner_area: area, owner_agent: facts4card.owner_agent, file: info.file, line, hash: shortHash(hashSource), does: facts4card.does, errors: facts4card.errors, reads: facts4card.reads, writes: facts4card.writes, money: facts4card.money, actions: facts4card.actions, derived: facts4card.derived, columns, applies: hardeningApplies(leaf, operation, context.scope), declared, notes: notesOf(facts, legacyEntry) }, exemptOf(context.scope, key), basisOf(columns, context.evidence[key], operation), reportedRow(leaf, source, fileText, context.evidence[key]));
}

/** the reported columns (CAP-17 slice 1, tools/api-reported.cjs): shown on the row as `reported` and `reported_applies`, never in `columns`, so they cannot move a status */
const reportedRow = (leaf, source, fileText, evidence) => {
  const found = reported.reportedOf({ leaf, source, fileText, evidence });
  return { reported: found.columns, reported_applies: found.applies };
};

/** a route whose output_allowlist passes on keys recorded in tests alone (its shape is `closed_by: recordings`, evidence `output_allowlist_basis: recordings`) says so on its row, apart from a route whose handler names its keys; nothing is added to any other row */
const basisOf = (columns, evidence, operation) => (columns.output_allowlist && ((evidence && evidence.output_allowlist_basis === 'recordings') || closedByRecordings(operation)) ? { output_allowlist_basis: 'recordings' } : {});

/** does a success schema of the operation hold a node tools/api-allowlist.cjs closed from recorded answers alone (x-closed-by recordings): the shape file is the one source of the basis, whichever test proved the route */
const closedByRecordings = (operation) => !!operation && successSchemas(operation).some((schema) => JSON.stringify(schema || {}).includes('"x-closed-by":"recordings"'));

/** the 4xx statuses tests cover for a route: the scenario tests' list plus what the generated contract cases answered */
const testedStatuses = (context, key) => (context.errorTests[key] || []).concat((context.contract[key] && context.contract[key].statuses) || []);

/** the plain-words notes on a row (why a column fails, which legacy keys are frozen) */
function notesOf(facts, legacyEntry) {
  const notes = [];
  if (facts.usesAuth) notes.push('auth middleware answers 401 in the old body');
  if (legacyEntry) notes.push('legacy keys frozen in docs/contracts/api-legacy.json');
  return notes;
}

/** 1-based line of the route's registration in its file (0 when the text does not show it plainly) */
function lineOf(fileText, leaf) {
  if (!fileText) return 0;
  const quoted = String(leaf.routePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* router.get('/x' ...) or the shared helper route('get', '/x', ...) (routes/books.js period-end routes): one reader for both (API-11) */
  const direct = new RegExp('\\.(?:' + leaf.method.toLowerCase() + '|all)\\(\\s*[\'"`]' + quoted + '[\'"`]').exec(fileText);
  const helper = new RegExp('^[ \\t]*route\\(\\s*[\'"`]' + leaf.method.toLowerCase() + '[\'"`]\\s*,\\s*[\'"`]' + quoted + '[\'"`]', 'm').exec(fileText);
  const found = direct || helper;
  return found ? fileText.slice(0, found.index).split('\n').length : 0;
}

/** the ISO date inside a sign-off stamp ("cb-api ... 2026-11-08 PR#9"), or null when it shows none */
const stampDate = (stamp) => { const found = /\d{4}-\d\d-\d\d/.exec(String(stamp || '')); return found ? found[0] : null; };

/** a sign-off counts only when its stamp is dated at stage 2 or later (S15: no grandfathering of the seven-column stage); an undated stamp is not current */
const signedAtStage = (stamp) => { const date = stampDate(stamp); return !!date && date >= SIGNOFF_STAGE_FROM; };

/** status: "meets standard" is every machine column AND a current cb-api sign-off (S15); some columns, or a missing sign-off, is "partial" */
function statusOf(columns, human) {
  if (MACHINE_COLUMNS.every((name) => columns[name]) && human && signedAtStage(human.signed_off_by_date)) return 'meets standard';
  /* progress is the seven core columns: a hardening column that does not apply passes for free and would make every route look begun */
  return MACHINE_COLUMNS.slice(0, MACHINE_COLUMNS.length - HARDENING_COLUMNS.length).some((name) => columns[name]) ? 'partial' : 'not started';
}

/** the sign-off hand file (route key -> human block with the hash it was signed against), or null when this checkout has none yet */
const readSignoffs = () => readJson('docs/api-signoffs.json', null);

const blankHuman = () => Object.fromEntries(HUMAN_COLUMNS.map((name) => [name, null]));

/** a hand-file entry as the human block of a row: signed while its hash is the row's hash, stale (date null, stale_since = the row's hash) once the code moved; the entry itself is never touched; a key that is neither a human column nor `hash` is refused (it would reach the derived register) */
function humanFromEntry(entry, row) {
  const { hash, ...block } = entry;
  const stray = Object.keys(block).filter((name) => !HUMAN_COLUMNS.includes(name));
  if (stray.length) throw new Error('docs/api-signoffs.json: "' + row.key + '" has keys that are not human columns: ' + stray.join(', '));
  const human = Object.assign(blankHuman(), block);
  return hash === row.hash ? human : Object.assign(human, { signed_off_by_date: null, stale_since: row.hash });
}

/** the human columns come from docs/api-signoffs.json by route key (S15); no hand file means no sign-offs (the old fallback to the committed register is gone: it let a derived file carry hand facts) */
function mergeHuman(rows, signoffs) {
  rows.forEach((row) => {
    const entry = signoffs && signoffs.routes && signoffs.routes[row.key];
    row.human = entry ? humanFromEntry(entry, row) : blankHuman();
    row.status = statusOf(row.columns, row.human);
  });
}

/** hand-file problems for --check: an entry whose key no route has (a rename is a fresh sign-off, never a carry), or with no hash or no date */
function signoffProblems(signoffs, rows) {
  if (!signoffs) return [];
  const keys = new Set(rows.map((row) => row.key));
  return Object.entries(signoffs.routes || {}).flatMap(([key, entry]) => {
    const found = [];
    if (!keys.has(key)) found.push('docs/api-signoffs.json: "' + key + '" is not a route of the app (a rename needs a fresh sign-off, not a carried one): delete the entry');
    if (!entry || !entry.hash) found.push('docs/api-signoffs.json: "' + key + '" has no hash');
    if (!entry || !entry.signed_off_by_date) found.push('docs/api-signoffs.json: "' + key + '" has no signed_off_by_date');
    return found;
  });
}

/**
 * M7: one router mounted at two prefixes (server.js mounts routes/ctp.js at / and at /api/ctp, deliberately) is ONE handler, so ONE row.
 * Leaves with the same method, the same router and the same handler functions fold into the one with the longest path
 * (the /api one); the shorter paths are listed on it as `aliases`. Nothing else folds: a different handler is a different endpoint.
 */
function foldAliases(all) {
  const groups = new Map();
  all.forEach((leaf) => {
    const same = [...groups.keys()].find((head) => head.method === leaf.method && head.router === leaf.router && head.fns.length === leaf.fns.length && head.fns.every((fn, at) => fn === leaf.fns[at]));
    groups.set(same || leaf, (groups.get(same || leaf) || []).concat(leaf));
  });
  const leaves = [];
  const aliasesOf = new Map();
  groups.forEach((members) => {
    const sorted = members.slice().sort((first, second) => second.path.length - first.path.length);
    leaves.push(sorted[0]);
    if (sorted.length > 1) aliasesOf.set(sorted[0], sorted.slice(1).map((leaf) => leaf.path).sort());
  });
  return { leaves, aliasesOf };
}

/** walk the real app and build the whole register: one row per method and path, counts, hashes */
function buildRegister() {
  const loader = require(path.join(TOOLS_DIR, 'load-app.cjs'));
  loader.stubDatabase(ROOT);
  const app = loader.loadApp(ROOT);
  const routerFiles = routerFilesOf();
  /* a code counts as registered once its shopkeeper sentence is written: a PENDING row is a seed, not a finished entry (S14) */
  const registered = new Set(readJson('docs/error-codes.json', { codes: [] }).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const context = { tables: card.knownTables(ROOT), app, routerFiles, shared: sharedFunctions(), operations: operationsOfApp(), legacy: legacyRoutes(), scope: hardeningScope(), budget: readJson('round-trips.budget.json', { routes: {} }).routes, evidence: hardeningEvidence(), errorTests: readJson('docs/contracts/api-error-tests.json', {}), contract: readJson('docs/contracts/api-contract-results.json', { routes: {} }).routes, registered };
  const seen = new Set();
  const { leaves, aliasesOf } = foldAliases(loader.leavesOf(app, true).filter((leaf) => !seen.has(leaf.method + ' ' + leaf.path) && seen.add(leaf.method + ' ' + leaf.path)));
  const rows = leaves
    .map((leaf) => Object.assign(rowOf(leaf, context), aliasesOf.has(leaf) ? { aliases: aliasesOf.get(leaf) } : {}))
    .sort((left, right) => (left.key < right.key ? -1 : 1));
  mergeHuman(rows, readSignoffs());
  addEffect(rows, context.budget);
  return { version: 1, stage: STAGE, counts: countsOf(rows), machine_columns: MACHINE_COLUMNS, reported_columns: reported.REPORTED_COLUMNS, human_columns: HUMAN_COLUMNS, routes: rows };
}

/** callers, offline and round-trip share, once every row is known (they read the committed docs/contracts/api-callers.json and round-trips.budget.json, never the web checkout) */
function addEffect(rows, budget) {
  const callersByRoute = card.readCallers(ROOT);
  const queueable = card.readQueueable(ROOT);
  rows.forEach((row) => {
    row.callers = callersByRoute[row.key] || [];
    row.offline = card.offlineOf(row.key, queueable, row.applies.idempotent_money_write && row.columns.idempotent_money_write);
    row.round_trips = card.roundTripsOf(row.key, budget, callersByRoute);
    row.measured = card.unmeasured();
  });
}

/** docs/contracts/api-legacy.json: { 'METHOD /path': { answers: [...] } } */
function legacyRoutes() {
  const file = readJson('docs/contracts/api-legacy.json', { routes: {} });
  return file.routes || {};
}

/** a row whose strict_input is met by the tolerant_outward exemption */
const isExempt = (row) => !!(row.exempt && row.exempt.strict_input);

/** the row's exempt note for a tolerant_outward door: { exempt: { strict_input: reason } }, else nothing */
const exemptOf = (scope, key) => (scope.tolerantOutward[key] ? { exempt: { strict_input: scope.tolerantOutward[key] } } : {});

/** totals by status, for the scorecard line */
function countsOf(rows) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  const columns = Object.fromEntries(HARDENING_COLUMNS.map((name) => [name, { applies: rows.filter((row) => row.applies[name]).length, failing: rows.filter((row) => !row.columns[name]).length }]));
  const fromRecordings = rows.filter((row) => row.output_allowlist_basis === 'recordings').length;
  return Object.assign({ routes: rows.length, no_does: card.withoutDoes(rows), not_started: count('not started'), partial: count('partial'), meets: count('meets standard'), columns, reported: reported.reportedCounts(rows), tolerant_outward: rows.filter(isExempt).length }, fromRecordings ? { output_allowlist_from_recordings: fromRecordings } : {});
}

/** a table cell: 'exempt' for a column met by an exemption (tolerant_outward), else yes / no / - */
const exemptMark = (row, name) => (row.exempt && row.exempt[name] && row.columns[name] === true ? 'exempt' : mark(row.columns[name]));
const mark = (value) => (value === true ? 'yes' : value === false ? 'no' : '-');

/** the committed docs/API-REGISTER.md text, LF line endings */
function renderMarkdown(register) {
  const { counts } = register;
  const lines = [
    '# API REGISTER (generated - do not edit by hand)',
    '',
    'Generated by `node tools/api-register.cjs` from the real app (server.js loaded offline, every router walked). API-STANDARD S15. Stage `' + register.stage + '`.',
    '',
    '**' + counts.routes + ' endpoints** counted (a method on a path, once; a router mounted twice counts at each mount). Earlier figures were a grep of 560 and the backlog\'s 605: this count replaces them.',
    '',
    '**Endpoint cards: ' + (counts.routes - counts.no_does) + ' of ' + counts.routes + ' routes have a `@does` line** (the ratchet counts the rest; it may only go down).',
    '',
    '**API standard: ' + counts.meets + ' of ' + counts.routes + ' meet** - partial ' + counts.partial + ' - not started ' + counts.not_started + '.',
    '',
  ].concat(counts.output_allowlist_from_recordings ? ['**Output allow-list closed from recordings only: ' + counts.output_allowlist_from_recordings + ' routes** (`output_allowlist_basis: recordings` in `docs/api-register.json`; their keys are the recorded answers, so a new key is reported and kept, never dropped, until the handler names its keys).', ''] : []).concat([
    'Thirteen machine columns (S15, S33-S38): schema_in · schema_out · error_shape · codes_registered · missing_input_answer · error_tests · status_codes · strict_input · output_allowlist · foreign_id_404 · idempotent_money_write · inbound_validated · trips_budgeted (a column that does not apply to a route reads yes). "meets standard" also needs a cb-api sign-off by someone other than the route builder; the human columns and sign-offs are kept by hand in `docs/api-signoffs.json` (each with the hash it was signed against; a moved hash makes the sign-off stale) and shown here and in `docs/api-register.json`, which are derived and never carry the source.',
    '',
    '**tolerant_outward: ' + counts.tolerant_outward + '** routes read strict_input as exempt, never as yes (S33-T, tolerant by design: an unknown body key is ignored; every known key is typed; a test file proves a junk value is refused and an unknown key ignored; the list is docs/contracts/api-hardening-scope.json tolerant_outward, bounded by tolerant_outward_ceiling).',
    '',
    'Three REPORTED columns (CAP-17 slice 1, `tools/api-reported.cjs`), counted on their own and NOT yet part of "meets standard": ' + reported.REPORTED_COLUMNS.map((name) => name + ' (fails on ' + counts.reported[name].failing + ' of ' + counts.reported[name].applies + ' routes it applies to)').join(' · ') + '. A column that does not apply to a route reads yes.',
    '',
    '| method | path | owner area | file:line | schema_in | schema_out | error_shape | codes_registered | missing_input_answer | error_tests | status_codes | strict_input | output_allowlist | foreign_id_404 | idempotent_money_write | inbound_validated | trips_budgeted | status | bfla_role_check (reported) | parameterised_query (reported) | rate_limited (reported) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'
  ]);
  register.routes.forEach((row) => {
    const columns = MACHINE_COLUMNS.map((name) => exemptMark(row, name));
    const shown = reported.REPORTED_COLUMNS.map((name) => mark(row.reported[name]));
    lines.push('| ' + [row.method, row.path + (row.aliases ? ' (also ' + row.aliases.join(', ') + ')' : ''), row.owner_area, row.file + ':' + row.line].concat(columns, row.status, shown).join(' | ') + ' |');
  });
  return lines.concat(card.renderCards(register.routes)).join('\n') + '\n';
}

const jsonText = (register) => JSON.stringify(register, null, 1) + '\n';

/** --check: the committed files equal the generator output, and the error-code table passes its own check */
function check(register) {
  const problems = [];
  const same = (file, text) => {
    const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (onDisk !== text) problems.push(path.relative(ROOT, file) + ' differs from the code: run node tools/api-register.cjs and commit it (LF line endings)');
  };
  same(MD_FILE, renderMarkdown(register));
  same(JSON_FILE, jsonText(register));
  const codes = require(path.join(TOOLS_DIR, 'error-codes.cjs')).check();
  const unsaid = unclassifiedMoney(register.routes, hardeningScope()).map((key) => key + ' looks like a money write but is in neither list of docs/contracts/api-hardening-scope.json (money_writes or money_reviewed_not)');
  const scopeFound = scopeProblems(readJson('docs/contracts/api-hardening-scope.json', {}), register.routes);
  const overrides = evidenceOverrides(readJson('docs/contracts/api-hardening-results.json', { routes: {} }).routes, readJson('docs/contracts/api-hardening-evidence-areas.json', { routes: {} }).routes);
  if (overrides.length) console.log(overrides.length + ' column(s) proved by an area test where the generated case failed (review each):\n  ' + overrides.join('\n  '));
  return problems.concat(codes.problems, unsaid, scopeFound, signoffProblems(readSignoffs(), register.routes));
}

/** command line: no flag writes both files; --check compares; --json writes one json file for the ratchet */
function main(argv) {
  const register = buildRegister();
  if (argv.includes('--callers')) {
    const webRoot = path.resolve(process.env.CB_WEB_DIR || path.join(ROOT, '..', 'chitbridge-web'));
    console.log('wrote docs/contracts/api-callers.json: ' + card.writeCallers(ROOT, register.routes, webRoot) + ' routes with a calling screen');
    return;
  }
  if (argv.includes('--json')) return fs.writeFileSync(argv[argv.indexOf('--json') + 1], jsonText(register)); /* to a file: process.exit below can cut a piped stdout short */
  if (argv.includes('--check')) {
    const problems = check(register);
    problems.forEach((sentence) => console.log('FAIL ' + sentence));
    console.log('API standard: ' + register.counts.meets + ' of ' + register.counts.routes + ' meet (partial ' + register.counts.partial + ', not started ' + register.counts.not_started + ')' + (problems.length ? '' : ' - register ok'));
    process.exitCode = problems.length ? 1 : 0;
    return;
  }
  fs.writeFileSync(MD_FILE, renderMarkdown(register));
  fs.writeFileSync(JSON_FILE, jsonText(register));
  console.log('wrote docs/API-REGISTER.md and docs/api-register.json: ' + JSON.stringify(register.counts));
}

if (require.main === module) {
  main(process.argv.slice(2));
  process.exit(process.exitCode || 0); /* routers start no timers we need; do not wait for any a route file opened on load */
}
module.exports = { lineOf, statusOf, MACHINE_COLUMNS, signedAtStage, SIGNOFF_STAGE_FROM, refusesUnknownKeys, basisOf, addEffect, mergeHuman, humanFromEntry, signoffProblems, hardeningEvidence, evidenceUnion, evidenceOverrides, STAGE, operationsOfApp, successSchemas, hardeningApplies, hardeningScope, knownKeysTyped, scopeProblems, tripsBudgetedColumn, HARDENING_COLUMNS, strictInputColumn, outputAllowlistColumn, foreignIdColumn, idempotentMoneyColumn, machineKeyedOf, machineKeyedProblems, inboundColumn, unclassifiedMoney, buildRegister, renderMarkdown, normalise, check, schemaOutColumn };

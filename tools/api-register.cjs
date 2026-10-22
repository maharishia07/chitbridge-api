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
 * API-STANDARD S15. Slice 1a (stage "1a"): the live machine columns are error_shape · codes_registered · error_tests · status_codes; schema_in, schema_out and
 * missing_input_answer need ajv and are reported as "-" (not yet measured), never as passing. "meets standard" cannot be reached in 1a.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOLS_DIR = __dirname;
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(TOOLS_DIR, '..');
const STAGE = '1a';
const LIVE_COLUMNS = ['error_shape', 'codes_registered', 'error_tests', 'status_codes'];
const LATER_COLUMNS = ['schema_in', 'schema_out', 'missing_input_answer'];
const HUMAN_COLUMNS = ['names_clear', 'sentence_plain', 'backward_compatible', 'signed_off_by_date', 'lifecycle'];
const BODY_METHODS = ['POST', 'PUT', 'PATCH'];
const MD_FILE = path.join(ROOT, 'docs', 'API-REGISTER.md');
const JSON_FILE = path.join(ROOT, 'docs', 'api-register.json');

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

const isValidationChain = (fn) => typeof fn === 'function' && fn.builder && typeof fn.builder.build === 'function';

/** a validation chain's rules as text (its toString is the same for every chain) */
function chainRules(fn) {
  try {
    return JSON.stringify(fn.builder.build());
  } catch (failure) {
    return 'unreadable-chain:' + fn.name;
  }
}

/** the functions a route file defines for this route: found by their own text in the file (a middleware from another module is not in it) */
function ownFunctions(handlers, fileText, shared) {
  return handlers.filter((fn) => typeof fn === 'function' && !shared.has(fn) && !isValidationChain(fn) && fileText.includes(fn.toString()));
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
  const allowedExtra = stackFacts.hasGate ? [401, 403] : [];
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
    hasValidation: route.some(isValidationChain),
    hasGate: route.some((fn) => typeof fn === 'function' && !isValidationChain(fn))
  };
}

/** the four live machine columns of one route, each true or false */
function machineColumns({ source, declared, facts, legacyEntry, leaf, tested, registered }) {
  const codes = codesWritten(source);
  const usesProblem = /\bproblem\(|\bfromError\(|next\(\s*(?:err|e|error)\s*\)/.test(source);
  const legacyOk = !/legacy:/.test(source) || !!legacyEntry;
  return {
    error_shape: usesProblem && !rawErrorWrites(source) && legacyOk,
    codes_registered: (codes.length > 0 || usesProblem) && codes.every((code) => registered.has(code)),
    error_tests: declared.length > 0 && declared.every((status) => tested.includes(status)),
    status_codes: statusColumn(declared, statusesWritten(source), leaf, facts)
  };
}

/** one row of the register, machine columns only; the human columns are merged in by the caller */
function rowOf(leaf, context) {
  const info = context.routerFiles.get(leaf.router) || { file: leaf.router === context.app ? 'server.js' : 'unknown' };
  const fileText = info.file === 'unknown' ? '' : fs.readFileSync(path.join(ROOT, info.file), 'utf8');
  const key = leaf.method + ' ' + leaf.path;
  const ownHandlers = ownFunctions(leaf.fns, fileText, context.shared);
  const source = ownHandlers.map((fn) => fn.toString()).join('\n');
  const operation = context.operations[key];
  const declared = Object.keys((operation && operation.responses) || {}).map(Number).filter((status) => status >= 400);
  const facts = stackFactsOf(leaf, context.shared);
  const legacyEntry = context.legacy[key];
  const columns = machineColumns({ source, declared, facts, legacyEntry, leaf, tested: context.errorTests[key] || [], registered: context.registered });
  const hashSource = ownHandlers.map(normalise).join('|') + '#' + leaf.fns.filter(isValidationChain).map(chainRules).join('|') + '#' + JSON.stringify(operation || null);
  return { key, method: leaf.method, path: leaf.path, owner_area: path.basename(info.file, '.js'), file: info.file, line: lineOf(fileText, leaf), hash: shortHash(hashSource), columns, declared, notes: notesOf(facts, legacyEntry) };
}

/** the plain-words notes on a row (why a column fails, which legacy keys are frozen) */
function notesOf(facts, legacyEntry) {
  const notes = [];
  if (facts.usesAuth) notes.push('auth middleware answers 401 in the old body (slice 1b)');
  if (legacyEntry) notes.push('legacy keys frozen in docs/contracts/api-legacy.json');
  return notes;
}

/** 1-based line of the route's registration in its file (0 when the text does not show it plainly) */
function lineOf(fileText, leaf) {
  if (!fileText) return 0;
  const quoted = String(leaf.routePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp('\\.(?:' + leaf.method.toLowerCase() + '|all)\\(\\s*[\'"`]' + quoted + '[\'"`]').exec(fileText);
  return found ? fileText.slice(0, found.index).split('\n').length : 0;
}

/** status from the columns: stage 1a can say "not started" or "partial", never "meets standard" */
function statusOf(columns) {
  return LIVE_COLUMNS.some((name) => columns[name]) ? 'partial' : 'not started';
}

/** the human columns are kept from the committed json by route key; a changed hash drops a sign-off to stale */
function mergeHuman(rows, previous) {
  const before = new Map((previous.routes || []).map((row) => [row.key, row]));
  rows.forEach((row) => {
    const old = before.get(row.key);
    const human = old && old.human ? old.human : Object.fromEntries(HUMAN_COLUMNS.map((name) => [name, null]));
    const stale = !!(human.signed_off_by_date && old.hash !== row.hash);
    row.human = stale ? Object.assign({}, human, { signed_off_by_date: null, stale_since: row.hash }) : human;
    row.status = statusOf(row.columns);
  });
}

/** walk the real app and build the whole register: one row per method and path, counts, hashes */
function buildRegister() {
  const loader = require(path.join(TOOLS_DIR, 'load-app.cjs'));
  loader.stubDatabase(ROOT);
  const app = loader.loadApp(ROOT);
  const routerFiles = routerFilesOf();
  /* a code counts as registered once its shopkeeper sentence is written: a PENDING row is a seed, not a finished entry (S14) */
  const registered = new Set(readJson('docs/error-codes.json', { codes: [] }).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const context = { app, routerFiles, shared: sharedFunctions(), operations: openapiOperations(Object.fromEntries([...routerFiles.values()].map((info) => [info.file, info]))), legacy: legacyRoutes(), errorTests: readJson('docs/contracts/api-error-tests.json', {}), registered };
  const seen = new Set();
  const rows = loader
    .leavesOf(app, true)
    .filter((leaf) => !seen.has(leaf.method + ' ' + leaf.path) && seen.add(leaf.method + ' ' + leaf.path))
    .map((leaf) => rowOf(leaf, context))
    .sort((left, right) => (left.key < right.key ? -1 : 1));
  mergeHuman(rows, readJson('docs/api-register.json', {}));
  return { version: 1, stage: STAGE, counts: countsOf(rows), live_columns: LIVE_COLUMNS, later_columns: LATER_COLUMNS, human_columns: HUMAN_COLUMNS, routes: rows };
}

/** docs/contracts/api-legacy.json: { 'METHOD /path': { answers: [...] } } */
function legacyRoutes() {
  const file = readJson('docs/contracts/api-legacy.json', { routes: {} });
  return file.routes || {};
}

/** totals by status, for the scorecard line */
function countsOf(rows) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  return { routes: rows.length, not_started: count('not started'), partial: count('partial'), meets: count('meets standard') };
}

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
    '**API standard: ' + counts.meets + ' of ' + counts.routes + ' meet** - partial ' + counts.partial + ' - not started ' + counts.not_started + '.',
    '',
    'Columns: error_shape · codes_registered · error_tests · status_codes are measured in slice 1a; schema_in · schema_out · missing_input_answer (`-`) need ajv and arrive in slice 1b. The human columns and sign-offs live in `docs/api-register.json`.',
    '',
    '| method | path | owner area | file:line | error_shape | codes_registered | error_tests | status_codes | schema_in | schema_out | missing_input_answer | status |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'
  ];
  register.routes.forEach((row) => {
    const columns = LIVE_COLUMNS.map((name) => mark(row.columns[name])).concat(LATER_COLUMNS.map(() => '-'));
    lines.push('| ' + [row.method, row.path, row.owner_area, row.file + ':' + row.line].concat(columns, row.status).join(' | ') + ' |');
  });
  return lines.join('\n') + '\n';
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
  return problems.concat(codes.problems);
}

/** command line: no flag writes both files; --check compares; --json writes one json file for the ratchet */
function main(argv) {
  const register = buildRegister();
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
module.exports = { buildRegister, renderMarkdown, normalise, check };

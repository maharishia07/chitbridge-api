#!/usr/bin/env node
'use strict';
/*
 * OWNS      the contract tests GENERATED from each route's own schema (API-STANDARD S18, schema-level cases that need no data): what a request with a field missing, a field of the wrong kind, or nothing at all is answered.
 *           Also docs/contracts/api-contract-results.json, the proof the register's missing_input_answer column and part of error_tests read (never filled by hand, S15).
 * CALLED BY tests/api-contract.test.cjs (guards.cjs) · tools/api-register.cjs (reads the results file) · by hand: --write after a schema changes.
 * FLOW      tools/load-app.cjs (server.js offline) ──▶ every route whose stack holds schemaValidate(operation) ──▶ cases from the operation's schema ──▶ run the route's OWN middleware ──▶ results per "METHOD path"
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/api-contract-tests.cjs           run every generated case, compare with the committed results (exit 1 on a failed case or a drift)
 *   node tools/api-contract-tests.cjs --write   run, then rewrite docs/contracts/api-contract-results.json
 * Cases that need data (a valid answer, 404, 409, role 403, replay) are T2 on realstack, not here. No database is touched: the middleware runs alone, on a stand-in request.
 */
const fs = require('fs');
const path = require('path');
const { bodySchemaOf, urlSchemaOf } = require('../middleware/validate');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = path.join(ROOT, 'docs', 'contracts', 'api-contract-results.json');
const SAMPLES = { string: 'x', integer: 1, number: 1, boolean: true, array: [], object: {} };
const WRONG = { string: 12345, integer: 'abc', number: 'abc', boolean: 'maybe', array: 'abc', object: 'abc' };
const NOTHING_SENT = 'nothing sent';

/** a value that fits a schema (its first example, else the first enum value, else a sample of its type; an object carries every required property) */
function sampleOf(schema) {
  const shape = schema || {};
  if (Array.isArray(shape.examples) && shape.examples.length) return shape.examples[0]; /* a pattern a bare 'x' cannot meet names its own example */
  if (shape.enum) return shape.enum[0];
  if (shape.examples) return shape.examples[0]; /* a schema that states a valid value (JSON Schema 2020 examples) — a pattern or an anyOf the type alone cannot meet */
  const type = [].concat(shape.type || 'object')[0];
  if (type !== 'object') return SAMPLES[type];
  const made = {};
  (shape.required || []).forEach((name) => {
    made[name] = sampleOf((shape.properties || {})[name]);
  });
  return made;
}

/** the places a request carries input for this operation: { where: 'body'|'url', schema } */
function placesOf(operation) {
  const places = [];
  if (bodySchemaOf(operation)) places.push({ where: 'body', schema: bodySchemaOf(operation) });
  if (urlSchemaOf(operation)) places.push({ where: 'url', schema: urlSchemaOf(operation) });
  return places;
}

/** a request with one place replaced: the body is req.body, the url facts are req.params (path ids and query values alike) */
const requestOf = (valid, place, value) => ({ id: 'contract-test', path: '/', body: place === 'body' ? value : valid.body, params: place === 'url' ? value : valid.url, query: {} });

/** what the middleware answered: whether it let the request through, the status and the Problem body */
function runCheck(check, request) {
  const seen = { accepted: false, status: null, body: null };
  const res = {
    locals: {},
    status(code) {
      seen.status = code;
      return res;
    },
    set() {
      return res;
    },
    json(body) {
      seen.body = body;
      return res;
    }
  };
  check(request, res, () => {
    seen.accepted = true;
  });
  return seen;
}

/** the request that is fully valid for an operation: a body and url facts built from its schemas */
function validRequestOf(places) {
  const of = (where) => places.find((place) => place.where === where);
  return { body: of('body') ? sampleOf(of('body').schema) : undefined, url: of('url') ? sampleOf(of('url').schema) : {} };
}

/** the cases for one place of the request: nothing sent, each needed field left out, each field of the wrong kind */
function casesForPlace(valid, { where, schema }) {
  const required = schema.required || [];
  const whole = where === 'body' ? valid.body : valid.url;
  const refused = (name, value, fields, code) => ({ name, valid, place: where, value, expect: { fields, code } });
  const cases = [
    required.length
      ? refused(NOTHING_SENT + ': every needed ' + where + ' field is named', {}, required, 'MISSING_FIELD')
      : { name: NOTHING_SENT + ': nothing is needed, so it is let through', valid, place: where, value: {}, expect: 'accept' }
  ];
  required.forEach((name) => cases.push(refused(where + ' field ' + name + ' left out is named', Object.assign({}, whole, { [name]: undefined }), [name], 'MISSING_FIELD')));
  Object.keys(schema.properties || {}).forEach((name) => {
    const type = [].concat((schema.properties[name] || {}).type || [])[0];
    /* a url value is text already: a number is a fine id, so a string is never the wrong kind there */
    if (WRONG[type] !== undefined && !(where === 'url' && type === 'string')) cases.push(refused(where + ' field ' + name + ' of the wrong kind is named', Object.assign({}, whole, { [name]: WRONG[type] }), [name], 'WRONG_VALUE'));
  });
  return cases;
}

/** every case of one operation, the valid request first */
function casesFor(operation) {
  const places = placesOf(operation);
  const valid = validRequestOf(places);
  const first = { name: 'a valid request is let through', valid, place: 'body', value: valid.body, expect: 'accept' };
  return places.reduce((all, place) => all.concat(casesForPlace(valid, place)), [first]);
}

/** what is wrong with a refusal that was expected: the wrong status, a field not named, or a field named with the wrong code; null when it is right */
function refusalFault(expected, seen, wantStatus) {
  if (seen.status !== wantStatus) return 'answered ' + seen.status + ', expected ' + wantStatus;
  const errors = (seen.body && seen.body.errors) || [];
  const missing = expected.fields.filter((name) => !errors.some((entry) => entry.field === name));
  if (missing.length) return 'did not name ' + missing.join(', ');
  const wrongCode = errors.filter((entry) => expected.fields.includes(entry.field) && entry.code !== expected.code);
  return wrongCode.length ? 'named it with code ' + wrongCode[0].code + ', expected ' + expected.code : null;
}

/** run one case against the route's middleware; returns the sentence that failed, or null */
function judge(item, check) {
  const wantStatus = (check.schemaOptions && check.schemaOptions.status) || 422;
  const seen = runCheck(check, requestOf(item.valid, item.place, item.value));
  if (item.expect === 'accept') return seen.accepted ? null : 'was refused (' + seen.status + ') but should pass';
  return seen.accepted ? 'was let through but should be refused' : refusalFault(item.expect, seen, wantStatus);
}

/** every route whose stack holds schemaValidate: { 'METHOD path': check function } (the loader walks the real app, offline) */
function schemaRoutes(root) {
  const loader = require('./load-app.cjs');
  loader.stubDatabase(root);
  const app = loader.loadApp(root);
  const found = {};
  loader.leavesOf(app, true).forEach((leaf) => {
    const check = leaf.fns.find((fn) => fn && fn.schemaOperation);
    if (check) found[leaf.method + ' ' + leaf.path] = check;
  });
  return found;
}

/** the result row of one route, and the sentences for its failed cases */
function runRoute(key, check) {
  const cases = casesFor(check.schemaOperation);
  const failed = cases.map((item) => ({ item, why: judge(item, check) })).filter((outcome) => outcome.why);
  const inputCases = (failure) => failure.item.name.startsWith(NOTHING_SENT) || failure.item.name.includes('left out');
  const row = { cases: cases.length, failed: failed.length, missing_input_ok: !failed.some(inputCases), statuses: [(check.schemaOptions && check.schemaOptions.status) || 422] };
  return { row, sentences: failed.map((failure) => key + ': ' + failure.item.name + ' ' + failure.why) };
}

/** run all generated cases: { results: {key: row}, failures: [sentence] } */
function runAll(routes) {
  const results = {};
  const failures = [];
  Object.keys(routes)
    .sort()
    .forEach((key) => {
      const done = runRoute(key, routes[key]);
      results[key] = done.row;
      failures.push(...done.sentences);
    });
  return { results, failures };
}

const ABOUT = 'generated by node tools/api-contract-tests.cjs --write: the schema-level contract cases of every route that validates its input against its own schema (API-STANDARD S18)';
const textOf = (results) => JSON.stringify({ version: 1, about: ABOUT, routes: results }, null, 1) + '\n';

/** command line: run, compare with the committed file, print the one "<n> passed, <m> failed" line */
function main(argv) {
  const { results, failures } = runAll(schemaRoutes(ROOT));
  const total = Object.keys(results).reduce((sum, key) => sum + results[key].cases, 0);
  const onDisk = fs.existsSync(RESULTS_FILE) ? fs.readFileSync(RESULTS_FILE, 'utf8') : '';
  if (argv.includes('--write') && !failures.length) fs.writeFileSync(RESULTS_FILE, textOf(results));
  else if (onDisk !== textOf(results)) failures.push('docs/contracts/api-contract-results.json differs from what the cases give: run node tools/api-contract-tests.cjs --write');
  failures.forEach((sentence) => console.log('  FAIL ' + sentence));
  console.log(Math.max(0, total - failures.length) + ' passed, ' + failures.length + ' failed');
  process.exitCode = failures.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2));
  process.exit(process.exitCode || 0);
}
module.exports = { casesFor, judge, runCheck, runAll, sampleOf, placesOf, schemaRoutes, textOf, RESULTS_FILE };

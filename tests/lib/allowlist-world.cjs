'use strict';
/*
 * OWNS      the one shared way an area sweep proves output_allowlist (API-STANDARD S34) from the 2xx answers its own scenes record: every route whose success schema is closed
 *           (additionalProperties false, derived by tools/api-allowlist.cjs into docs/contracts/api-output-shapes.json) has every recorded success answer fit that schema, and the
 *           allow-list filter drops nothing from it; plus reading and writing those rows of docs/contracts/api-hardening-evidence-areas.json.
 * CALLED BY the api-problem-<area> tests that record 2xx answers for a route file whose generated case cannot reach them on the stand-in database.
 * FLOW      recording { 'route|scene': { route, status, body } } + the area's contract OPERATIONS → checkAllowList → { route: { output_allowlist: true } } → writeEvidence (--write) / evidenceOf (check)
 * CARD      28-platform-and-operations/api-standard
 */
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..', '..');
const COLUMN = 'output_allowlist';

/** the first 2xx status an operation declares, and its JSON schema */
function successOf(operation) {
  const status = Object.keys(operation.responses).find((code) => code >= 200 && code < 300);
  const schema = (((operation.responses[status] || {}).content || {})['application/json'] || {}).schema;
  return { status, schema };
}

/** { route: { output_allowlist: true } } for each closed route whose recorded success answers all fit; `report(route, ok, detail)` says each judgement to the test's own check() */
function checkAllowList(recording, operations, report) {
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  const proved = {};
  Object.keys(operations).sort().forEach((route) => {
    const { status, schema } = successOf(operations[route]);
    if (!schema || schema.additionalProperties !== false) return;
    const answers = Object.values(recording).filter((one) => one.route === route && String(one.status) === status && one.body);
    const fits = engine.compile(schema);
    const held = answers.length > 0 && answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    report(route + ': every recorded ' + status + ' (' + answers.length + ') holds only the keys its operation lists (a closed schema the answers fit)', held, { answers: answers.length, errors: fits.errors });
    if (held) proved[route] = { [COLUMN]: true };
  });
  return proved;
}

/** the routes `mine(route)` names that the evidence file says output_allowlist for */
function evidenceOf(file, mine) {
  const routes = JSON.parse(fs.readFileSync(file, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => mine(route) && routes[route][COLUMN]).sort().map((route) => [route, { [COLUMN]: true }]));
}

/** this run's rows into the evidence file: the area's routes lose the column first, then take what held; other routes and other columns stay as they are */
function writeEvidence(file, mine, proved) {
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).filter(mine).forEach((route) => {
    delete routes[route][COLUMN];
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => (routes[route] = Object.assign(routes[route] || {}, proved[route])));
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

module.exports = { checkAllowList, evidenceOf, writeEvidence, COLUMN };

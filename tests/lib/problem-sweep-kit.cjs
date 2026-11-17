'use strict';
/**
 * problem-sweep-kit.cjs — the parts every API-4 sweep test shares: the checker, the HTTP call, the route list read from a router, the scenarios (route x world),
 * the Problem-body and frozen-legacy-key checks, and the freeze of a capture into docs/contracts/api-legacy.json.
 *
 * OWNS      the mechanics of "every refusal of an area's routes is a Problem AND still carries the keys it answered before" (docs/contracts/api-legacy.json).
 * CALLED BY tests/api-problem-governance.test.cjs (an area's own file supplies its stand-ins, worlds and extras; tests/api-problem-books.test.cjs predates this kit and holds its own copy).
 * FLOW      routesOf(router) x worlds → scenariosOf → send → checkProblemBody · checkLegacy → tested statuses → docs/contracts/api-error-tests.json
 * CARD      28-platform-and-operations/api-standard
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

const HERE = path.join(__dirname, '..', '..');
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const argv = process.argv.slice(2);
const flagValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const counts = { passed: 0, failed: 0 };
/** one check: counted, and printed when it fails (or always with --verbose) */
function check(label, condition, info) {
  if (condition) counts.passed++;
  else counts.failed++;
  if (!condition || argv.includes('--verbose')) console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
}
/** one HTTP call to the test server: { status, type, text, json }; status 0 is a hang */
function send(port, method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const options = { port, path: urlPath, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} };
    const request = http.request(options, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text, json: safeParse(text) }));
    });
    request.setTimeout(4000, () => {
      request.destroy();
      resolve({ status: 0, type: '', text: '', json: null });
    });
    request.on('error', () => {});
    if (data) request.write(data);
    request.end();
  });
}

/** { 'METHOD /full/path': template } for every route a router holds, read from the router itself */
function routesOf(router, mount) {
  const found = {};
  router.stack.filter((layer) => layer.route).forEach((layer) => Object.keys(layer.route.methods).forEach((method) => {
    found[method.toUpperCase() + ' ' + mount + layer.route.path] = mount + layer.route.path;
  }));
  return found;
}
/** a route template with its :arguments filled (a real-looking value, or "nope" for the bad-id world) */
const urlOf = (template, values, bad) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : values[name] || values.id));

/** every scenario as { id, route, url, body, setup, extra }: each route x each world, then the named extras that the router really holds */
function scenariosOf(routes, worlds, extras, values) {
  const generic = [];
  Object.keys(routes).sort().forEach((route) => {
    const method = route.split(' ')[0];
    worlds.forEach((one) => {
      if (one.badId && !routes[route].includes(':')) return;
      generic.push({ id: one.id, route, url: urlOf(routes[route], values, one.badId), body: BODY_METHODS.includes(method) ? {} : undefined, setup: one.setup });
    });
  });
  const named = extras.map((one) => Object.assign({}, one, { url: one.url || urlOf(routes[one.route] || '', values, false), extra: true }));
  return generic.concat(named.filter((one) => routes[one.route]));
}

const legacyOf = (key, scenario) => (JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

function checkProblemBody(label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
}

function checkLegacy(label, answer, frozen) {
  if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
  check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
  const missing = Object.keys(frozen.fixture).filter((name) => !sameValue(answer.json[name], frozen.fixture[name]));
  check(label + ': every frozen legacy key is still there, byte for byte', missing.length === 0, missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name])));
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

/**
 * a capture becomes frozen answers: { route: { answers: [{ scenario, status, body_keys, fixture }] } } (4xx and 5xx only, the sign-in middleware's 401 left out);
 * `mine(route)` says which routes this area owns
 */
function freeze(captureFile, mine) {
  const recording = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const file = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  Object.keys(recording).forEach((key) => {
    const one = recording[key];
    const scenario = key.split('|')[1];
    if (one.status < 400 || (one.status === 401 && scenario === 'signed-out') || !one.body || !mine(one.route)) return;
    const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
    if (!entry.answers.some((answer) => answer.scenario === scenario)) entry.answers.push({ scenario, status: one.status, body_keys: one.body, fixture: one.body });
  });
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(file, null, 1) + '\n');
  console.log('froze ' + Object.keys(file.routes).filter(mine).length + ' routes');
}

/** the rows of docs/contracts/api-error-tests.json this area owns: rewritten with --write, otherwise compared with what the scenarios covered */
function settleCoverage(tested, mine) {
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((first, second) => first - second)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const own = Object.fromEntries(Object.keys(onDisk).filter(mine).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover', sameValue(own, coverage), { onDisk: Object.keys(own).length, covered: Object.keys(coverage).length });
}

module.exports = { HERE, argv, flagValue, sameValue, counts, check, send, routesOf, urlOf, scenariosOf, legacyOf, checkProblemBody, checkLegacy, freeze, settleCoverage, BODY_METHODS };

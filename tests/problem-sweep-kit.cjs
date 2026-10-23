/*
 * OWNS      the parts of an API-4 sweep test that do not depend on the area: the HTTP call, the route list read from a router, the scenarios (every route x every world, then named extras),
 *           the Problem-body and frozen-legacy checks, and the freeze of a capture into docs/contracts/api-legacy.json.
 * CALLED BY tests/api-problem-marketing.test.cjs (the books sweep, api #349, holds its own copy of these: it moves here when it is next touched).
 * FLOW      routesOf(router, mount) → scenariosOf(routes, worlds, extras) → send() → checkProblemBody · checkLegacy · freeze
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const http = require('http');

const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
}

/** a counter of checks that prints each failure (and each pass with --verbose) */
function checker(argv) {
  const tally = { passed: 0, failed: 0 };
  const check = (label, condition, info) => {
    if (condition) tally.passed++;
    else tally.failed++;
    if (!condition || argv.includes('--verbose'))
      console.log(
        '  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500))
      );
  };
  return { check, tally };
}

/** one HTTP call to the test app: { status, type, text, json } (status 0 = it did not answer in 4 s) */
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

/** a router's own '/' is the mount itself, the way the register and the contract name it */
const fullPath = (mount, path) => mount + (path === '/' ? '' : path);

/** { 'METHOD /full/path': template } for every route a router holds, read from the router itself */
function routesOf(router, mount) {
  const found = {};
  router.stack
    .filter((layer) => layer.route)
    .forEach((layer) =>
      Object.keys(layer.route.methods).forEach(
        (method) => (found[method.toUpperCase() + ' ' + fullPath(mount, layer.route.path)] = fullPath(mount, layer.route.path))
      )
    );
  return found;
}
const urlOf = (template, bad, values) => template.replace(/:(\w+)/g, (all, name) => (bad ? 'nope' : (values || {})[name] || 'x'));

/** every route x world (a world that needs an id skips a route without one), then the extras that name a route the router holds */
function scenariosOf(routes, worlds, extras, values) {
  const generic = [];
  Object.keys(routes)
    .sort()
    .forEach((route) => {
      const method = route.split(' ')[0];
      worlds.forEach((one) => {
        if (one.badId && !routes[route].includes(':')) return;
        generic.push({
          id: one.id,
          route,
          url: urlOf(routes[route], one.badId, values),
          body: BODY_METHODS.includes(method) ? {} : undefined,
          setup: one.setup
        });
      });
    });
  const named = extras.map((one) => Object.assign({}, one, { url: one.url || urlOf(routes[one.route] || '', false, values), extra: true }));
  return generic.concat(named.filter((one) => routes[one.route]));
}

function checkProblemBody(check, label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
}

/** the frozen answer must still be there: same status, every frozen key equal byte for byte, no key beyond the frozen ones and the Problem fields */
function checkLegacy(check, label, answer, frozen) {
  if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
  check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
  const missing = Object.keys(frozen.fixture).filter((name) => !sameValue(answer.json[name], frozen.fixture[name]));
  check(
    label + ': every frozen legacy key is still there, byte for byte',
    missing.length === 0,
    missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name]))
  );
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

/** the frozen answer of one scenario of one route, or undefined */
const frozenOf = (legacyFile, route, scenario) =>
  (JSON.parse(fs.readFileSync(legacyFile, 'utf8')).routes[route] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

/** a capture (run on the code BEFORE the change) becomes frozen answers: 4xx and 5xx only, the sign-in middleware's own 401 left out, nothing already frozen overwritten */
function freeze(captureFile, legacyFile, isMine) {
  const recording = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const file = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  Object.keys(recording).forEach((key) => {
    const one = recording[key];
    const scenario = key.split('|')[1];
    if (one.status < 400 || (one.status === 401 && scenario === 'signed-out') || !one.body || !isMine(one.route)) return;
    const entry = (file.routes[one.route] = file.routes[one.route] || { answers: [] });
    if (!entry.answers.some((answer) => answer.scenario === scenario))
      entry.answers.push({ scenario, status: one.status, body_keys: one.body, fixture: one.body });
  });
  const before = Object.keys(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).routes);
  file.routes = Object.fromEntries(
    before
      .concat(
        Object.keys(file.routes)
          .filter((route) => !before.includes(route))
          .sort()
      )
      .map((route) => [route, file.routes[route]])
  ); /* the routes already frozen keep their places; new ones follow, sorted */
  fs.writeFileSync(legacyFile, JSON.stringify(file, null, 1) + '\n');
  return Object.keys(file.routes).filter(isMine).length;
}

module.exports = {
  PROBLEM_FIELDS,
  REQUIRED_FIELDS,
  BODY_METHODS,
  sameValue,
  checker,
  send,
  routesOf,
  urlOf,
  scenariosOf,
  checkProblemBody,
  checkLegacy,
  frozenOf,
  freeze
};

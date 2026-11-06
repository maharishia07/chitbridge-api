'use strict';
/*
 * OWNS      the "lower role asks" scene for bfla_role_check (OWASP API5, function level authorisation): one way to prove that a ROLE GATE (a function tagged `roleGate`)
 *           refuses a lower role with 403 and lets the role it needs through, and the one way a test writes that proof into docs/contracts/api-hardening-evidence-areas.json.
 * CALLED BY tests/api-reported.test.cjs
 * FLOW      a gate is mounted on a throw-away express app ──▶ asked as the lower role (must answer 403, handler not reached) ──▶ asked as the role it needs (handler reached)
 *           ──▶ { held } per gate ──▶ a route holds when EVERY role gate in its real stack holds ──▶ writeEvidence merges bfla_role_check into the evidence file.
 * CARD      28-platform-and-operations/api-standard
 * SLICE 1 proves the GATE a route carries, taken from the route's real stack; the whole request through the real route is the next slice.
 */
const fs = require('fs');
const http = require('http');
const express = require('express');

const COLUMN = 'bfla_role_check';
/** who asks: the lower role and the role the gate needs, per role tag of lib/owner.js and lib/access.js */
const PEOPLE = {
  owner: { lower: { identity_type: 'actor', parent_entity_id: 'parent-shop', access_level: 'editor' }, needed: { identity_type: 'entity' } },
  editor: { lower: { identity_type: 'actor', parent_entity_id: 'parent-shop', access_level: 'viewer' }, needed: { identity_type: 'actor', parent_entity_id: 'parent-shop', access_level: 'editor' } }
};

/** ask `gate` once as `identity`: the status it answered, and whether the handler behind it ran */
function ask(gate, identity) {
  const app = express();
  let reached = false;
  app.use((req, res, next) => {
    req.identity = identity;
    req.id = 'bfla-scene';
    next();
  });
  app.get('/scene', gate, (req, res) => {
    reached = true;
    res.json({ ok: true });
  });
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => { /* not app.listen: tools/load-app.cjs stubs it */
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/scene' }, (res) => {
        res.resume();
        res.on('end', () => server.close(() => resolve({ status: res.statusCode, reached })));
      }).on('error', reject);
    });
  });
}

/** the sentence that fails for one gate, or null when it holds */
async function gateCase(gate) {
  const people = PEOPLE[gate.roleGate];
  if (!people) return 'the role "' + gate.roleGate + '" has no scene in tests/lib/bfla-world.cjs';
  const lower = await ask(gate, people.lower);
  if (lower.status !== 403 || lower.reached) return 'the lower role was answered ' + lower.status + (lower.reached ? ' and reached the handler' : '') + ', not refused with 403';
  const needed = await ask(gate, people.needed);
  if (needed.status !== 200 || !needed.reached) return 'the role the gate needs was answered ' + needed.status + ': the scene proved nothing';
  return null;
}

/** merge this run into the evidence file: bfla_role_check is true on the routes in `proved`, and absent on every other route (a route that stops holding loses its evidence) */
function writeEvidence(file, proved) {
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).forEach((route) => {
    delete routes[route][COLUMN];
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => {
    routes[route] = Object.assign(routes[route] || {}, { [COLUMN]: true });
  });
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

/** the routes of the evidence file that say bfla_role_check is true, for the check that the committed file says what the run showed */
const evidenceOf = (file) => Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).routes || {}).filter(([, columns]) => columns[COLUMN]).map(([route]) => [route, true]));

module.exports = { ask, gateCase, writeEvidence, evidenceOf, COLUMN, PEOPLE };

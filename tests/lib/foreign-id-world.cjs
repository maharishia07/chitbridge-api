'use strict';
/*
 * OWNS      the "signed in as another shop" world (API-STANDARD S35, foreign_id_404): one shared way to prove that a route addressed by an id in its path answers
 *           ANOTHER shop's id exactly as it answers an id that does not exist (the same 404, the same body), never a 403 and never the record. Also the one
 *           way a test writes that proof into docs/contracts/api-hardening-evidence.json.
 * CALLED BY tests/api-problem-orders.test.cjs (repeat supply, work, counters) · every later sweep test that has a record addressed by an id in its path.
 * FLOW      the area's test plants a record for shop A (its stand-in db answers rows only to their owning entity, as RLS + `WHERE entity_id = $1` would)
 *           → play(shop B, route) with nothing planted (the unknown id) → play(shop B, route) with A's record planted (the foreign id) → play(shop A, route) (the own id)
 *           → compare status AND body byte for byte, request id aside → { pass, why } per route → writeEvidence merges the passes into the evidence file.
 * CARD      28-platform-and-operations/api-standard
 *
 * The comparison is the same one tools/api-contract-tests.cjs makes for its generated foreign_id_404 case (the same URL asked in two worlds, the own id first so
 * the 404 is about WHOSE id it is and not about the id missing everywhere); this file adds the part a generic case cannot do: the area's own rows and the area's own
 * route behind its own gates. The evidence format is the one api-hardening-evidence.json already has: routes['METHOD /path'] = { foreign_id_404: true }.
 */
const fs = require('fs');

const NOT_FOUND = 404;
const COLUMN = 'foreign_id_404';

/** an answer as it is compared: the status, the content type and the body, without the request id (it differs on every request) */
function comparable(answer) {
  const body = answer.json && typeof answer.json === 'object' ? Object.assign({}, answer.json, { request_id: null }) : answer.text;
  return JSON.stringify({ status: answer.status, type: answer.type, body });
}

/**
 * foreignIdCase(play) — one route: the sentence that fails, or null when it holds.
 * play(who) asks the route once as shop `who` ('stranger' or 'owner') in the world the area has set (the planting is play's own business: plant(false) → unknown,
 * plant(true) → foreign). The three asks are: the unknown id, the foreign id, the owner's own id (which must NOT be a 404, or the case proved nothing).
 */
async function foreignIdCase(play) {
  const unknown = await play('stranger', false);
  if (unknown.status !== NOT_FOUND) return 'an unknown id answered ' + unknown.status + ', not 404';
  const foreign = await play('stranger', true);
  if (foreign.status !== NOT_FOUND) return "another shop's id answered " + foreign.status + ', not 404';
  if (comparable(foreign) !== comparable(unknown)) return "another shop's id answered a different body from the unknown id";
  const own = await play('owner', true);
  if (own.status === NOT_FOUND) return "not reached: the owner's own id answered 404 too";
  return null;
}

/**
 * sameAsUnknownCase(play) — the weaker reading, for a read that answers a collection under the caller's OWN rows and never 404 (GET /api/products/:id/schedule: an empty list for an id the shop does
 * not hold). null when another shop's id answers byte for byte as an unknown id AND the owner's own id answers something else (so the planted row was really read); else the sentence.
 * It proves no oracle, not the S35 404; the handler's ownership filter is still the store's WHERE entity_id.
 */
async function sameAsUnknownCase(play) {
  const unknown = await play('stranger', false);
  if (unknown.status !== 200) return 'an unknown id answered ' + unknown.status + ', not 200';
  const foreign = await play('stranger', true);
  if (comparable(foreign) !== comparable(unknown)) return "another shop's id answered differently from the unknown id";
  const own = await play('owner', true);
  if (comparable(own) === comparable(unknown)) return "not reached: the owner's own id answered as an unknown id (the planted row was never read)";
  return null;
}

/** runCases(cases, record) — every case { route, play } in turn; record(route, held) is told each result. Returns the failing sentences. */
async function runCases(cases, record) {
  const failures = [];
  for (const item of cases) {
    const fault = await foreignIdCase(item.play);
    record(item.route, !fault);
    if (fault) failures.push(item.route + ': ' + fault);
  }
  return failures;
}

/** a recorder: record(route, held) keeps the worst result per route; proved() is what the run showed, { route: { foreign_id_404: true } } for the routes that held */
function recorder() {
  const seen = {};
  return {
    record: (route, held) => {
      seen[route] = seen[route] !== false && held;
    },
    proved: () => Object.fromEntries(Object.keys(seen).filter((route) => seen[route]).sort().map((route) => [route, { [COLUMN]: true }]))
  };
}

/**
 * writeEvidence(file, mine, proved) — merge this run into the evidence file: for the routes `mine(route)` names, foreign_id_404 is true when the run showed it and
 * absent when it did not (a route that stops holding loses its evidence); every other route and every other column is kept as it was, in its place.
 */
function writeEvidence(file, mine, proved) {
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).filter(mine).forEach((route) => {
    delete routes[route][COLUMN];
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => {
    routes[route] = Object.assign(routes[route] || {}, proved[route]);
  });
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

/** the routes of the evidence file that this run owns and shows true, for the check that the committed file says what the run showed */
function evidenceOf(file, mine) {
  const routes = JSON.parse(fs.readFileSync(file, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => mine(route) && routes[route][COLUMN]).sort().map((route) => [route, { [COLUMN]: true }]));
}

/** ownedBy(proved, mine) — the rows of a proved set whose route `mine(route)` names: a test's world may call another area's routes, but the evidence it writes and compares is its own */
function ownedBy(proved, mine) {
  return Object.fromEntries(Object.keys(proved).filter(mine).map((route) => [route, proved[route]]));
}

/**
 * weakened(play) — the same world with a store that reads by the id alone and ignores the owner: the stranger who asks for the planted id is answered as its owner is.
 * biteCase(play) — the BITE (critic 6 Nov, Finding A): a foreign-id case must be able to FAIL. null when the real world holds AND the weakened one is caught; else the sentence.
 */
const weakened = (play) => (who, planted) => play(planted ? 'owner' : who, planted);
async function biteCase(play, caseOf = foreignIdCase) {
  const real = await caseOf(play);
  if (real) return 'the real world already fails (' + real + '), so the bite is not measurable';
  return (await caseOf(weakened(play))) ? null : "cannot fail: a store that ignores the owner still passes the foreign-id case";
}

module.exports = { sameAsUnknownCase, weakened, biteCase, ownedBy, comparable, foreignIdCase, runCases, recorder, writeEvidence, evidenceOf, COLUMN };

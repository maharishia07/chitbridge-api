#!/usr/bin/env node
// @type: contract
/**
 * api-problem-bell.test.cjs — API-4 sweep, the bell: every answer of routes/events.js (the mailbox bell's ticket, live stream and platform counts) and routes/notifications.js (the Activity feed, its badge, seen, dismiss) — 6 routes.
 *
 * OWNS      the proof that each refusal of the six routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code before the sweep), that no
 *           success answer moved (--compare against a capture of the code before: the answers AND the SQL statements with their parameters), this file's rows of docs/contracts/api-error-tests.json,
 *           and the bell itself: the real stream opened with a one-time ticket in `?t=` and in `?ticket=` (both spellings), its frames (retry, hello, cb, ': ping' plus the named ping every 25 s), a ticket spent
 *           on first use and dead after 60 s, a shop screen hearing only 'the shop changed'. Also: no answer of ANY status (a 2xx included) carries the text of a thrown error, a 2xx is never a Problem,
 *           the frozen 5xx and 503 bodies are replayed word for word, no answer outside the statuses the contract declares (lib/bell-contract.js), and the POST /dismiss id surface (`log_ids`): notif_dismissed has
 *           NO foreign key, so another shop's log_id, an unknown one and a made-up one all answer the same 200 (no existence oracle), and the shop is the session's, never the body's.
 *           No route has an id in its path (the 9th world, S35, has nothing to ask); none is a money write.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files and the real lib/events.js over a stand-in db and sign-in (tests/lib/problem-world.cjs, scenes in tests/lib/bell-scenes.cjs).
 * FLOW      route list (read from the two routers) x world (signed out, staff, another shop, a failing db, an empty db) + the named extras (tests/lib/bell-scenes.cjs) → real route →
 *           body → Problem fields present · frozen legacy keys equal · no leak · statuses tested → manifest; then the stream and the ids
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 *
 *   node tests/api-problem-bell.test.cjs                    check
 *   node tests/api-problem-bell.test.cjs --write            check, then record this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-bell.test.cjs --capture F        record every answer and every SQL statement (of the code as it stands) to F and F.sql
 *   node tests/api-problem-bell.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-bell.test.cjs --compare F        the answers and statements now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { harness, OWNER, STAFF, SECRET_SQL, SHOP, sameValue, raising, answering, firstOf, sqlError } = require('./lib/problem-world.cjs');
const scenes = require('./lib/bell-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.PLATFORM_ROOT_ENTITY = SHOP; /* the shop that signs in is the deployment's root: GET /stats lets it through (a scene swaps in a copy with no root) */
const EV = scenes.EV;
const NO = scenes.NO;
const ROUTE_FILES = { [EV]: 'routes/events.js', [NO]: 'routes/notifications.js' };
const ROUTE_COUNT = 6;
const SQL_FILE_SUFFIX = '.sql';
const sqlLog = {};
let sqlKey = null;
const lab = harness({
  here: HERE,
  mounts: [EV, NO],
  routeFiles: ROUTE_FILES,
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out',
  before: async (scenario) => {
    if (scenario.mint) scenario.url = scenario.url.replace('{TICKET}', require(path.join(HERE, 'lib', 'events')).ticketFor(SHOP, { screen: scenario.mint === 'screen' }).ticket);
    sqlKey = scenario.route + '|' + scenario.id;
    sqlLog[sqlKey] = [];
    const inner = lab.world.sqlRows;
    lab.world.sqlRows = (sql, params) => {
      sqlLog[sqlKey].push({ q: crypto.createHash('sha1').update(String(sql).replace(/\s+/g, ' ')).digest('hex').slice(0, 10), sql: String(sql), p: params });
      return inner ? inner(sql, params) : null;
    };
  }
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'stranger-asks', setup: { who: STRANGER } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const sources = () => ({ events: require(path.join(HERE, 'lib', 'events')), platform: require(path.join(HERE, 'lib', 'platformroot')) });
/** lib/bell-contract.js, or null on the code before the sweep (so the negative control FAILS cleanly instead of throwing) */
const contractModule = () => {
  try {
    return require(path.join(HERE, 'lib', 'bell-contract.js'));
  } catch (failure) {
    return null;
  }
};
const THROWN = /SELECT|vault|relation "|secret/;

/** lib/platformroot.js as a deployment with NO root configured: loaded fresh with the variable unset (it reads it once, when it loads), then the real one put back (the same few lines as tests/api-problem-entities.test.cjs: listed for cb-qa to share) */
function platformWithoutRoot() {
  const file = require.resolve(path.join(HERE, 'lib', 'platformroot'));
  require(file);
  const kept = require.cache[file];
  delete require.cache[file];
  const was = process.env.PLATFORM_ROOT_ENTITY;
  delete process.env.PLATFORM_ROOT_ENTITY;
  const copy = require(file);
  process.env.PLATFORM_ROOT_ENTITY = was;
  require.cache[file] = kept;
  return copy;
}
const NOBODY = platformWithoutRoot();
const noRoot = { platform: { refuseUnlessRoot: NOBODY.refuseUnlessRoot, configured: NOBODY.configured, isRoot: NOBODY.isRoot } };
const extrasList = () => scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf, sqlError, noRoot });

/** lib/bell-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords(contract) {
  console.log('\n-- lib/bell-contract.js: the refusals as a unit --');
  check('lib/bell-contract.js exists (the contract of the six routes)', !!contract);
  if (!contract) return;
  const { words, faultOf } = contract;
  const req = { id: 'r1' };
  const signedIn = words.signInRequired();
  check('signInRequired: the old body is { error: "Unauthorised" } and nothing else', sameValue(signedIn.legacy, { error: 'Unauthorised' }) && signedIn.code === 'EVENTS_NOT_SIGNED_IN', signedIn);
  const ticket = words.ticketRefused();
  check('ticketRefused: the old two keys, word for word', sameValue(ticket.legacy, { error: 'Unauthorised', message: 'ticket missing, spent or expired' }) && ticket.code === 'EVENTS_TICKET_REFUSED' && ticket.detail === 'ticket missing, spent or expired', ticket);
  const nothing = words.nothingToClear();
  check('nothingToClear: the old two keys, word for word', sameValue(nothing.legacy, { error: 'Nothing to clear', message: 'Send log_ids, or all:true.' }) && nothing.code === 'NOTIF_NOTHING_TO_CLEAR', nothing);
  const seen = words.seenNotMigrated();
  check('seenNotMigrated: Not migrated, b157, as before', sameValue(seen.legacy, { error: 'Not migrated', message: 'Clearing the badge needs b157 on this environment.' }) && seen.code === 'NOTIF_SEEN_NOT_MIGRATED', seen);
  const dismiss = words.dismissNotMigrated();
  check('dismissNotMigrated: Not migrated, b164, with its own code key, as before', sameValue(dismiss.legacy, { error: 'Not migrated', message: 'Clearing Activity needs b164 on this environment.', code: 'NOTIF_DISMISS_NOT_MIGRATED' }) && dismiss.code === 'NOTIF_DISMISS_NOT_MIGRATED', dismiss);
  const lost = faultOf(new Error(SECRET_SQL), req, 'Failed to get notifications');
  check('faultOf: the screen\'s own label and the safe sentence, never the cause', lost.status === 500 && sameValue(lost.legacy, { error: 'Failed to get notifications', message: 'Something went wrong — please try again.' }) && !THROWN.test(JSON.stringify(lost)), lost);
  const last = contract.lastResort(new Error(SECRET_SQL), req);
  check('lastResort: the last-resort body of server.js (Server error, Something went wrong) with code INTERNAL, never the cause', last.status === 500 && last.code === 'INTERNAL' && sameValue(last.legacy, { error: 'Server error', message: 'Something went wrong' }) && !THROWN.test(JSON.stringify(last)), last);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the bell routes answer under are in the register --');
  if (!contract) return check('the codes of lib/bell-contract.js are registered', false);
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.concat(['NO_PLATFORM_ROOT', 'NOT_PLATFORM_ROOT']).filter((code) => !known.has(code));
  check('every code the bell words (' + contract.CODES.length + ') and the root door answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the routers: every route has an operation and an operation a route; nothing here can be refused for its shape (the old code never did) */
function checkContractShape(contract, routes, routers) {
  console.log('\n-- the contract and the routers agree --');
  check('premise: the two routers hold ' + ROUTE_COUNT + ' routes (an empty list would pass every scan)', Object.keys(routes).length === ROUTE_COUNT, Object.keys(routes));
  if (!contract) return check('every route has an operation', false);
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the routers hold has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('each router publishes its operations (router.openapi) from the contract', routers.every((router, index) => !!(router.openapi && router.openapi.paths) && Object.keys(router.openapi.paths).length === (index === 0 ? 3 : 3)), routers.map((router) => !!router.openapi));
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('every write declares a body that may be an object or a list: the handlers read a list as no body', bodies.length === 3 && bodies.every((key) => sameValue(contract.OPERATIONS[key].requestBody.content['application/json'].schema.type, ['object', 'array'])), bodies);
  check('no body names a key as required and none is closed (an unknown key was dropped before, and still is: strict_input stays open)', bodies.every((key) => { const one = contract.OPERATIONS[key].requestBody.content['application/json'].schema; return !one.required && one.additionalProperties === undefined; }));
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  const stream = contract.OPERATIONS['GET ' + EV + '/stream'];
  check('the stream is declared as text/event-stream, public, with its two spellings of the ticket (t and ticket)', !!stream && !!stream.responses['200'].content['text/event-stream'] && sameValue(stream.security, []) && sameValue(stream.parameters.map((one) => one.name).sort(), ['t', 'ticket']), stream && stream.responses['200']);
  check('every query value is declared as anything: a repeated key or an odd limit was always taken, never refused', operations.every((key) => (contract.OPERATIONS[key].parameters || []).every((one) => sameValue(one.schema, {}))));
}

/** the frozen 5xx and 503 bodies of the untouched code, replayed: the same status and every old key, byte for byte and in order */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least ten 5xx answers (the 500 of each route, the two 503) were frozen and replayed (' + replayed + ')', replayed >= 10, replayed);
}

/** no answer of any status carries a thrown text; a 2xx is never a Problem */
function checkLeaks(recording) {
  console.log('\n-- no thrown text in any answer; a 2xx is never a Problem --');
  const asked = Object.keys(recording).filter((key) => /leaks-nothing$/.test(key));
  check('the scenes that make the database (or a library) THROW a string with SQL in it ran (' + asked.length + ' of 9)', asked.length === 9, asked);
  check('every one of them answered 500', asked.every((key) => recording[key].status === 500), asked.filter((key) => recording[key].status !== 500));
  check('no answer of ANY status (2xx, 4xx, 5xx) carries the thrown text', Object.keys(recording).every((key) => !THROWN.test(JSON.stringify(recording[key].body || recording[key].text || ''))), Object.keys(recording).filter((key) => THROWN.test(JSON.stringify(recording[key].body || ''))));
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  check('every 500 message a handler wrote is the one constant sentence (safeErr passes nothing of the error), and the last-resort handler answers its own fixed words', Object.keys(recording).filter((key) => recording[key].status === 500 && recording[key].body && recording[key].body.message).every((key) => recording[key].body.message === 'Something went wrong — please try again.' || recording[key].body.message === 'Something went wrong'), Object.keys(recording).filter((key) => recording[key].status === 500).map((key) => recording[key].body));
}

/** the six routes: no answer outside the statuses the contract declares, and the doors */
function checkDoors(recording) {
  console.log('\n-- the doors --');
  const signedOut = Object.keys(recording).filter((key) => key.endsWith('|signed-out'));
  check('a caller who is not signed in is refused with 401 on the five signed-in routes, and the stream (public) refuses a missing ticket the same way', signedOut.length === ROUTE_COUNT && signedOut.every((key) => recording[key].status === 401), signedOut.map((key) => recording[key].status));
  check('GET /stats: the platform root and its staff are answered, another shop is 403, a deployment with no root is 404', recording['GET ' + EV + '/stats|stats-root'].status === 200 && recording['GET ' + EV + '/stats|stats-staff-of-root'].status === 200 && recording['GET ' + EV + '/stats|stats-another-shop'].status === 403 && recording['GET ' + EV + '/stats|stats-no-root-configured'].status === 404);
  const refusals = Object.keys(recording).filter((key) => key.startsWith('GET ' + EV + '/stream|stream-') && recording[key].status === 401);
  check('every refused stream (' + refusals.length + ') says the same two old words and is a Problem', refusals.length === 6 && refusals.every((key) => /problem\+json/.test(recording[key].type) && recording[key].body.message === 'ticket missing, spent or expired' && recording[key].body.error === 'Unauthorised'), refusals.map((key) => recording[key].body));
  const opened = Object.keys(recording).filter((key) => key.startsWith('GET ' + EV + '/stream|') && recording[key].status === 200);
  check('every opened stream (' + opened.length + ') is text/event-stream, uncached and begins retry then hello', opened.length === 5 && opened.every((key) => /^text\/event-stream/.test(recording[key].type) && recording[key].cache === 'no-cache, no-transform' && /^retry: 5000\nevent: hello\ndata: \{"at":"STAMP"\}\n\n/.test(recording[key].text)), opened.map((key) => recording[key].text));
}

/** read a stream the way a browser does, never holding it open: the frames so far, a wait for a frame, a close */
function openStream(port, urlPath, headers) {
  return new Promise((resolve) => {
    const seen = { status: 0, headers: {}, text: '' };
    const waits = [];
    const request = http.get({ port, path: urlPath, headers: headers || {} }, (response) => {
      seen.status = response.statusCode;
      seen.headers = response.headers;
      response.setEncoding('utf8');
      response.on('data', (part) => {
        seen.text += part;
        waits.slice().forEach((one) => one.test());
      });
      resolve(handle);
    });
    request.on('error', () => undefined);
    const handle = {
      seen,
      /** resolves true once the text holds `needle`, false after `ms` */
      waitFor: (needle, ms) => new Promise((done) => {
        const one = { test: () => { if (seen.text.includes(needle)) { clearTimeout(timer); waits.splice(waits.indexOf(one), 1); done(true); } } };
        const timer = setTimeout(() => { waits.splice(waits.indexOf(one), 1); done(false); }, ms || 2000);
        waits.push(one);
        one.test();
      }),
      close: () => request.destroy()
    };
    setTimeout(() => resolve(handle), 3000);
  });
}

const ticketOf = async (port, headers) => (await lab.send(port, 'POST', EV + '/ticket', {}, undefined, headers)).json;

/** the bell itself, on the real lib/events.js: both spellings, one-time, 60 s, the frames, the heartbeat, a shop screen */
async function checkBell(port) {
  console.log('\n-- the bell: the real stream, opened with a ticket --');
  Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: null });
  const events = require(path.join(HERE, 'lib', 'events'));
  const minted = await ticketOf(port);
  check('POST /ticket answers { ticket, ttl_s: 60 } and nothing else', !!minted && typeof minted.ticket === 'string' && minted.ticket.length >= 30 && minted.ttl_s === 60 && sameValue(Object.keys(minted), ['ticket', 'ttl_s']), minted);

  /* ?t= — the app's spelling; the heartbeat is the real timer, captured here so the test does not wait 25 s */
  const beats = [];
  const realInterval = global.setInterval;
  global.setInterval = (run, ms) => { beats.push({ run, ms }); return realInterval(() => undefined, 2147483647).unref(); };
  const viaT = await openStream(port, EV + '/stream?t=' + minted.ticket);
  const hello = await viaT.waitFor('event: hello', 2000);
  global.setInterval = realInterval;
  check('?t=<ticket> opens the stream: 200, text/event-stream, no-cache, keep-alive, no proxy buffering', viaT.seen.status === 200 && /^text\/event-stream/.test(viaT.seen.headers['content-type']) && viaT.seen.headers['cache-control'] === 'no-cache, no-transform' && viaT.seen.headers.connection === 'keep-alive' && viaT.seen.headers['x-accel-buffering'] === 'no', [viaT.seen.status, viaT.seen.headers]);
  check('the first frames are retry: 5000 then hello with the time', hello && /^retry: 5000\nevent: hello\ndata: \{"at":"\d{4}-\d\d-\d\dT[\d:.]+Z"\}\n\n/.test(viaT.seen.text), viaT.seen.text);
  check('the heartbeat is set at 25 s', beats.length === 1 && beats[0].ms === 25000, beats.map((one) => one.ms));
  beats[0].run();
  check('a beat writes BOTH the comment (for proxies) and the named ping (the only one a counter can hear)', await viaT.waitFor('event: ping\ndata: {"t":', 1000) && viaT.seen.text.includes(': ping\n\n'), viaT.seen.text);
  events.emit([SHOP], { kind: 'chit', id: 'c-1', who: 'Corner Hardware' });
  check('an arrival for the shop is one cb frame: kind, id, who and the time', await viaT.waitFor('event: cb\ndata: {"at":', 1000) && /event: cb\ndata: \{"at":"[^"]+","kind":"chit","id":"c-1","who":"Corner Hardware"\}\n\n/.test(viaT.seen.text), viaT.seen.text);
  check('the ticket was spent on first use: the same ticket is refused (401, the old two words)', await (async () => { const again = await lab.send(port, 'GET', EV + '/stream?t=' + minted.ticket); return again.status === 401 && again.json.message === 'ticket missing, spent or expired'; })());
  viaT.close();

  /* ?ticket= — the counter's and the shop screen's spelling (found 2026-09-17: refused silently for weeks) */
  const second = await ticketOf(port);
  const viaTicket = await openStream(port, EV + '/stream?ticket=' + second.ticket);
  check('?ticket=<ticket> opens the stream too (the counter and the shop screen have always sent this spelling)', await viaTicket.waitFor('event: hello', 2000) && viaTicket.seen.status === 200, viaTicket.seen);
  viaTicket.close();

  /* a ticket is good for 60 s and no longer */
  const aging = await ticketOf(port);
  const realNow = Date.now;
  Date.now = () => realNow() + 61000;
  const late = await lab.send(port, 'GET', EV + '/stream?t=' + aging.ticket);
  Date.now = realNow;
  check('a ticket older than 60 s is refused', late.status === 401 && late.json.message === 'ticket missing, spent or expired', [late.status, late.text]);
  const young = await ticketOf(port);
  Date.now = () => realNow() + 59000;
  const almost = await openStream(port, EV + '/stream?t=' + young.ticket);
  const stillOpen = await almost.waitFor('event: hello', 2000);
  Date.now = realNow;
  almost.close();
  check('a ticket 59 s old still opens the stream', stillOpen && almost.seen.status === 200, almost.seen.status);

  /* a shop screen (a key whose scopes are exactly ['screen']) hears only that the SHOP changed */
  const screen = await ticketOf(port, { 'x-test-screen': '1' });
  const tv = await openStream(port, EV + '/stream?t=' + screen.ticket);
  await tv.waitFor('event: hello', 2000);
  events.emit([SHOP], { kind: 'chit', id: 'c-2', who: 'Corner Hardware' });
  events.emit([SHOP], { kind: 'shop', id: 'x', who: 'Somebody' });
  check('a screen ticket is marked: it hears { at, kind: "shop" } and nothing of a chit, an id or a name', await tv.waitFor('"kind":"shop"', 1000) && /event: cb\ndata: \{"at":"[^"]+","kind":"shop"\}\n\n/.test(tv.seen.text) && !/c-2|Corner Hardware|Somebody/.test(tv.seen.text), tv.seen.text);
  tv.close();
  check('the stats count what is open (entities, connections, tickets are numbers)', await (async () => { const counts = await lab.send(port, 'GET', EV + '/stats'); return counts.status === 200 && sameValue(Object.keys(counts.json), ['entities', 'connections', 'tickets']) && Object.values(counts.json).every((one) => Number.isInteger(one)); })());
}

const dismissed = (recording, id) => recording['POST ' + NO + '/dismiss|' + id];
const answerOf = (one) => JSON.stringify([one.status, one.type, one.body]);
const insertsOf = (key) => (sqlLog[key] || []).filter((one) => /INSERT INTO notif_dismissed/.test(one.sql));

/** POST /dismiss takes log_ids from the body: notif_dismissed has no foreign key to state_log, so ANY uuid inserts under the caller's shop (no existence oracle); the shop is the session's */
function checkDismissIds(recording) {
  console.log('\n-- POST /dismiss: the ids in the body (no foreign key on notif_dismissed) --');
  const unknown = dismissed(recording, 'dismiss-an-id-nobody-has');
  const foreign = dismissed(recording, 'dismiss-another-shops-id');
  check('another shop\'s log_id, an id nobody has and a made-up uuid answer the same 200 { ok: true, cleared: 1 } byte for byte: no foreign key, so no existence oracle across shops', answerOf(unknown) === answerOf(foreign) && unknown.status === 200 && sameValue(unknown.body, { ok: true, cleared: 1 }), [unknown.body, foreign.body]);
  check('the model of the table is the baseline: no FOREIGN KEY mentions notif_dismissed (migrations/000_baseline_2026-10-21.sql: primary key (entity_id, log_id) and the entity policy only)', (() => { const baseline = fs.readFileSync(path.join(HERE, 'migrations', '000_baseline_2026-10-21.sql'), 'utf8'); return !/ALTER TABLE ONLY public\.notif_dismissed\s+ADD CONSTRAINT \w+ FOREIGN KEY/.test(baseline) && /ALTER TABLE ONLY public\.notif_dismissed\s+ADD CONSTRAINT notif_dismissed_pkey PRIMARY KEY \(entity_id, log_id\)/.test(baseline); })());
  check('a repeated id counts once (ON CONFLICT DO NOTHING): two ids and a repeat clear 2', dismissed(recording, 'dismiss-two-and-a-repeat').body.cleared === 2, dismissed(recording, 'dismiss-two-and-a-repeat').body);
  check('a value that is not a uuid is Postgres 22P02 and the safe 500 (not a 400, not changed): the finding listed for API-4c', dismissed(recording, 'dismiss-not-a-uuid-is-a-500').status === 500 && dismissed(recording, 'dismiss-a-number-is-a-500').status === 500);
  const own = insertsOf('POST ' + NO + '/dismiss|dismiss-entity-in-the-body-is-never-read');
  check('the shop is the session\'s: a body entity_id reaches no statement; the INSERT\'s first parameter is the caller\'s shop', own.length === 1 && own[0].p[0] === SHOP && !JSON.stringify(own[0].p).includes(scenes.STRANGER_ID), own.map((one) => one.p));
  const staff = insertsOf('POST ' + NO + '/dismiss|dismiss-by-staff');
  check('a staff login dismisses under its shop (the parent entity), never under its own id', staff.length === 1 && staff[0].p[0] === SHOP, staff.map((one) => one.p));
  const all = insertsOf('POST ' + NO + '/dismiss|dismiss-all-wins-over-ids');
  check('{ all: true } resolves server-side from the shop\'s own state_log and ignores log_ids', all.length === 1 && /SELECT \$1, sl\.log_id FROM state_log sl\s+WHERE sl\.entity_id = \$1/.test(all[0].sql) && sameValue(all[0].p, [SHOP]), all.map((one) => one.p));
  const refused = ['dismiss-nothing-sent', 'dismiss-body-a-list', 'dismiss-log-ids-empty', 'dismiss-log-ids-not-a-list', 'dismiss-log-ids-all-empty-values', 'dismiss-all-is-the-text-true'];
  check('a body with no ids and no all:true writes nothing and answers 400 "Nothing to clear" (' + refused.length + ' bodies)', refused.every((id) => insertsOf('POST ' + NO + '/dismiss|' + id).length === 0 && dismissed(recording, id).status === 400));
  check('DISMISSED IS HIDDEN, NEVER DELETED: no statement of the six routes deletes from state_log', Object.keys(sqlLog).every((key) => sqlLog[key].every((one) => !/DELETE\s+FROM\s+state_log|UPDATE\s+state_log|TRUNCATE/i.test(one.sql))));
}

/** the feed: the caller's shop and identity lead the statements; the page size is the one pager's */
function checkFeed(recording) {
  console.log('\n-- GET /api/notifications: the shop, the caller, the page --');
  const feedOf = (id) => (sqlLog['GET ' + NO + '|' + id] || []).filter((one) => /SELECT \* FROM \(\s+SELECT DISTINCT ON/.test(one.sql));
  const limits = [['feed-listed', 30], ['feed-limit-5', 5], ['feed-limit-not-a-number', 30], ['feed-limit-too-big', 100]];
  check('the page size is the pager\'s: 30 by default, 5 as asked, 30 for text, never over 100', limits.every(([id, wanted]) => feedOf(id).length === 1 && feedOf(id)[0].p[3] === wanted && recording['GET ' + NO + '|' + id].body.limit === wanted), limits.map(([id]) => feedOf(id).map((one) => one.p)));
  const feed = feedOf('feed-listed')[0];
  check('the feed reads the caller\'s shop first and the caller second (F3: only the caller\'s own copy of the log)', !!feed && feed.p[0] === SHOP && feed.p[1] === OWNER.identity_id, feed && feed.p);
  const staff = feedOf('feed-of-staff')[0];
  check('a staff login reads its shop\'s feed as itself', !!staff && staff.p[0] === SHOP && staff.p[1] === STAFF.identity_id, staff && staff.p);
  const listed = recording['GET ' + NO + '|feed-listed'].body;
  check('the badge counts what arrived since the last look, messages not counted (2 rows newer than the watermark, one is a message)', listed.count === 1 && listed.total === 3 && listed.page === 1 && listed.seen_at === '2026-10-01T00:00:00.000Z', listed);
  check('before the first look every row but a message counts', recording['GET ' + NO + '|feed-before-the-first-look'].body.count === 2 && recording['GET ' + NO + '|feed-before-the-first-look'].body.seen_at === null);
  check('?count=1 answers the badge alone in one statement { count, total, seen_at }; any other value is the feed', sameValue(Object.keys(recording['GET ' + NO + '|badge-counted'].body), ['count', 'total', 'seen_at']) && 'notifications' in recording['GET ' + NO + '|badge-count-asked-twice-is-the-feed'].body && 'notifications' in recording['GET ' + NO + '|badge-count-2-is-the-feed'].body);
  check('a failed read of the watermark (before b157) is carried on without it: 200, seen_at null', recording['GET ' + NO + '|feed-seen-read-fails-carries-on'].status === 200 && recording['GET ' + NO + '|feed-seen-read-fails-carries-on'].body.seen_at === null);
}

/** the SQL statements of every scenario, against a capture of the code before: the same text and the same parameters */
function compareStatements(captureFile) {
  const before = JSON.parse(fs.readFileSync(captureFile + SQL_FILE_SUFFIX, 'utf8'));
  const keys = Object.keys(before);
  const different = keys.filter((key) => !sqlLog[key] || !sameValue(before[key], sqlLog[key].map((one) => ({ q: one.q, p: one.p }))));
  console.log('compared ' + keys.length + ' scenarios\' statements (text hash and parameters): ' + (keys.length - different.length) + ' identical, ' + different.length + ' different');
  different.forEach((key) => console.log('  ' + key));
}

/** the stand-in routers on one app, with the server's own last-resort error handler (server.js: fromError and the old two keys) so a throw in a handler without a catch is answered as it is in production */
function appWithBell(routers) {
  const express = require('express');
  const screenDoor = express.Router();
  screenDoor.use((req, res, next) => { if (req.headers['x-test-screen']) req.till = { key: { scopes: ['screen'] } }; next(); }); /* what the holder middleware sets for a screen key */
  const app = lab.appOf([{ mount: EV, router: screenDoor }, { mount: EV, router: routers.events }, { mount: NO, router: routers.notifications }]);
  const { fromError } = require(path.join(HERE, 'lib', 'problem'));
  app.use((err, req, res, next) => fromError(req, res, err, { error: 'Server error', message: 'Something went wrong' }));
  return app;
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const routers = { events: require(path.join(HERE, ROUTE_FILES[EV])), notifications: require(path.join(HERE, ROUTE_FILES[NO])) };
  const routes = Object.assign({}, lab.routesOf(routers.events, EV), lab.routesOf(routers.notifications, NO));
  const server = appWithBell(routers).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const contract = contractModule();
  const declared = capturing || !contract ? () => [] : contract.allowedStatuses();
  /* the ticket is random: a ticket answered in a generic world cannot be compared byte for byte, and the named scenes (a fixed ticket) cover each of those worlds */
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList()).filter((one) => one.extra || one.route !== 'POST ' + EV + '/ticket' || one.id === 'signed-out');
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, declared, sources);
  const statements = Object.fromEntries(Object.keys(sqlLog).map((key) => [key, sqlLog[key].map((one) => ({ q: one.q, p: one.p }))]));
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    fs.writeFileSync(lab.flagValue('--capture') + SQL_FILE_SUFFIX, JSON.stringify(statements, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes, and the statements of ' + Object.keys(statements).length + ' scenarios');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    lab.compare(lab.flagValue('--compare'), recording);
    compareStatements(lab.flagValue('--compare'));
    process.exit(0);
  }
  await checkBell(server.address().port);
  server.close();
  checkWords(contract);
  checkCodesRegistered(contract);
  checkContractShape(contract, routes, [routers.events, routers.notifications]);
  checkFrozen5xx(recording);
  checkLeaks(recording);
  checkDoors(recording);
  checkDismissIds(recording);
  checkFeed(recording);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 20, frozen);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the bell routes', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();

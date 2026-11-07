'use strict';
/**
 * OWNS      measuring LIVE database round trips (X-DB-Trips) for the registered routes whose trips line is still a placeholder (SPD-39); the reason per route it cannot reach.
 * CALLED BY a person: node tools/live-trips.cjs [--dry] [--only <regex>] [--retry-all] [--out <file>] | --seed | --check | --restore | --cleanup [--apply]. Tests/tooling only: no route handler is touched.
 * FLOW      docs/api-register.json (trips_budgeted false) + the routes' own OpenAPI schemas ──▶ a request per route ──▶ sit-in (the load shop only) ──▶ docs/speed/live-trips-results.json
 *           ──▶ tools/live-trips-writer.cjs (the safe writer) ──▶ round-trips.live.json + round-trips.budget.json (only the lines measured).
 * CARD      28-platform-and-operations/performance-and-round-trips
 *
 * TARGET: sit-in only (a TEST server, host fixed below; there is no flag for another). The load shop (cbt-in-load) is the only shop that sends X-DB-Trips.
 * SIGN-IN: once, with the daily tester code from ~/.cb-sit-users.json (never printed); the token is cached outside the repo (CB_LT_TOKEN_FILE, default the OS temp folder).
 * RULES: a route is fired once to warm up and 3 times after; the highest X-DB-Trips of the 2xx answers is the line. A 4xx for a valid-looking request is "did not reach its work"
 *        with the answer, never a measurement. Mutating routes act only on objects this tool created (name prefix lt-); nothing else of the load shop is changed or deleted.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const writer = require('./live-trips-writer.cjs');

const ROOT = path.resolve(__dirname, '..');
const HOSTS = ['https://129-225-85-65.sslip.io', 'https://staging.129-225-85-65.sslip.io']; /* sit-in, the same box under both names */
const HANDLE = 'cbt-in-load';
const PREFIX = 'lt-';
const BUDGET_FILE = path.join(ROOT, 'round-trips.budget.json');
const LIVE_FILE = path.join(ROOT, 'round-trips.live.json');
const RESULTS_FILE = path.join(ROOT, 'docs', 'speed', 'live-trips-results.json');
const REGISTER_FILE = path.join(ROOT, 'docs', 'api-register.json');
const TOKEN_FILE = process.env.CB_LT_TOKEN_FILE || path.join(os.tmpdir(), 'cb-live-trips-token.json');
const STATE_FILE = process.env.CB_LT_STATE_FILE || path.join(os.tmpdir(), 'cb-live-trips-state.json'); /* what the run changed on sit-in and must undo (--restore reads it) */
const PERSIST = ['registerOn', 'unclaimed', 'periods', 'counter', 'screens']; /* the seeds that are set-ups with a restore */
const GAP_MS = 300; /* at most ~3 requests a second */
const SAMPLE_UUID = '00000000-0000-4000-8000-000000000001';
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } };
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── routes the harness must not fire, each with the reason that goes in the results ── */
const DENY = {
  'PATCH /api/entities/:id/erase': ['destructive', 'platform role + destructive; needs a platform token and a throwaway identity (PR #844 makes it answer 404 on no match, which is a floor, not a cost)'],
  'POST /api/signin/ask': ['no-header', 'pre-sign-in door: no identity yet, so the server never sends X-DB-Trips (checked on ask: 200, RateLimit-Remaining 27 of 30, no X-DB-Trips); the 30 per 15 min per IP limiter is a second reason, and running from inside the VM would not add the header'],
  'POST /api/signin/verify': ['no-header', 'pre-sign-in door: no identity yet, so the server never sends X-DB-Trips (checked on ask: 200, RateLimit-Remaining 27 of 30, no X-DB-Trips); the 30 per 15 min per IP limiter is a second reason, and running from inside the VM would not add the header'],
  'POST /api/signin/pin': ['no-header', 'pre-sign-in door: no identity yet, so the server never sends X-DB-Trips (checked on ask: 200, RateLimit-Remaining 27 of 30, no X-DB-Trips); the 30 per 15 min per IP limiter is a second reason, and running from inside the VM would not add the header'],
  'POST /api/signin/renew': ['no-header', 'pre-sign-in door: no identity yet, so the server never sends X-DB-Trips (checked on ask: 200, RateLimit-Remaining 27 of 30, no X-DB-Trips); the 30 per 15 min per IP limiter is a second reason, and running from inside the VM would not add the header'],
  'POST /api/catalogue/photo-extract': ['external', 'calls the vision provider (paid, outside sit-in)'],
  'POST /api/identity/documents/:scheme/code': ['external', 'sends a code through an outside provider'],
  'POST /api/identity/documents/:scheme/verify': ['external', 'checks a code from an outside provider'],
  'POST /api/ctp/deliver': ['external', 'needs a signed envelope from another installation (CTP crossing)'],
  'POST /api/ctp/query': ['external', 'needs a signed envelope from another installation (CTP crossing)'],
  'GET /api/capture/webhook/whatsapp': ['external', 'the provider verification handshake (hub.verify_token), not a shop call'],
  'POST /api/simulator/lead': ['external', 'public lead door that may notify outside (e-mail)'],
  'POST /api/simulator/feedback': ['external', 'public feedback door that may notify outside (e-mail)']
};

/* ── what a person must say for routes the schema cannot: fixed path values and bodies ── */
const HINTS = require('./live-trips-hints.cjs');

/* ── HTTP, paced ── */
const state = { last: 0, n: 0, host: null, token: null, fives: 0 };
/** wait out the gap since the last request, then count this one */
async function pace() {
  const wait = GAP_MS - (Date.now() - state.last);
  if (wait > 0) await sleep(wait);
  state.last = Date.now();
  state.n += 1;
}
/** the request headers: json, the token once signed in, an Idempotency-Key on writes, then the caller's own extras */
function headersFor(method, extra) {
  const headers = { 'content-type': 'application/json', ...(state.token ? { authorization: 'Bearer ' + state.token } : {}), ...(extra || {}) };
  if (method !== 'GET' && method !== 'OPTIONS' && !headers['Idempotency-Key']) headers['Idempotency-Key'] = crypto.randomUUID();
  return headers;
}
const quietReasons = []; /* the reasons a failure was let pass on purpose (see quiet()), kept for the process so a debugger can read them */
/** note why a failure is let pass: the run goes on, the reason is kept */
const quiet = (reason) => { quietReasons.push(reason); };
/** the text as JSON, or null when it is not JSON (an HTML error page, an empty body) */
function parseJson(text) {
  try { return JSON.parse(text); } catch (notJson) { quiet('answer is not JSON'); return null; }
}
/** count the 5xx answers in a row; the 8th stops the whole run */
function countFives(status) {
  if (status >= 500) state.fives += 1; else state.fives = 0;
  if (state.fives >= 8) throw new Error('8 answers of 5xx in a row: stopping');
}
/** the answer standing in for a request that threw (status 0, the reason in words) */
function failedAnswer(error, startedAt) {
  const cause = error.cause ? ' ' + String(error.cause.code || error.cause.message).slice(0, 60) : '';
  return { status: 0, trips: null, ms: Date.now() - startedAt, body: null, text: String(error.message).slice(0, 100) + cause };
}
/** one paced request to the signed-in host; always an answer { status, trips, ms, body, text } (status 0 when nothing came back) */
async function call(method, url, body, extra) {
  await pace();
  const headers = headersFor(method, extra);
  const startedAt = Date.now();
  try {
    const res = await fetch(state.host + url, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    const parsed = parseJson(text);
    const tripsHeader = res.headers.get('x-db-trips');
    countFives(res.status);
    return { status: res.status, trips: tripsHeader === null ? null : Number(tripsHeader), ms: Date.now() - startedAt, body: parsed, text: parsed ? '' : text.slice(0, 120) };
  } catch (e) {
    if (/stopping/.test(String(e.message))) throw e;
    return failedAnswer(e, startedAt);
  }
}

/* ── sign-in, once ── */
/** the daily tester codes (today and yesterday, India time) built from the recipe in ~/.cb-sit-users.json */
function testerCodes() {
  const secret = readJson(path.join(os.homedir(), '.cb-sit-users.json'), null);
  const recipe = secret && secret.servers && secret.servers['sit-in'] && secret.servers['sit-in'].sign_in;
  if (!recipe) throw new Error('no sit-in sign-in recipe in ~/.cb-sit-users.json');
  /* the yymmdd of today plus offsetDays, India time */
  const shortDate = (offsetDays) => {
    const shifted = new Date(Date.now() + offsetDays * 864e5 + 5.5 * 36e5);
    return shifted.toISOString().slice(2, 10).replace(/-/g, '');
  };
  return [0, -1].map((offset) => recipe.tester_code_template.replace('{yymmdd}', shortDate(offset)).replace('{yyyymmdd}', '20' + shortDate(offset)));
}
/** sign in with the cached token when sit-in still accepts it; true when it does */
async function reuseCachedToken() {
  const cached = readJson(TOKEN_FILE, null);
  if (!(cached && cached.token && HOSTS.includes(cached.host))) return false;
  state.host = cached.host; state.token = cached.token;
  const mine = await call('GET', '/api/entities/me');
  if (mine.status === 200) return true;
  state.token = null;
  return false;
}
/** ask for a code on this host and try today's and yesterday's tester codes; true when a token came back (and is cached) */
async function verifyOnHost(host) {
  await call('POST', '/api/signin/ask', { user_id: HANDLE, mode: 'login' });
  for (const code of testerCodes()) {
    const verified = await call('POST', '/api/signin/verify', { user_id: HANDLE, mode: 'login', otp: code });
    if (verified.status === 200 && verified.body && verified.body.token) {
      state.token = verified.body.token;
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({ host, token: verified.body.token }), { mode: 0o600 });
      return true;
    }
  }
  return false;
}
/** sign in once: reuse the cached token when sit-in still accepts it, else sign in on the first host that answers /health */
async function signIn() {
  if (await reuseCachedToken()) return;
  for (const host of HOSTS) {
    state.host = host;
    const health = await call('GET', '/health');
    if (health.status !== 200) continue;
    if (await verifyOnHost(host)) return;
    throw new Error('sign-in refused on ' + host);
  }
  throw new Error('sit-in did not answer /health');
}

/** a token for another pool user (one sign-in each; the limiter is 30 per 15 min per IP) */
async function tokenFor(handle) {
  await call('POST', '/api/signin/ask', { user_id: handle, mode: 'login' }, { authorization: '' });
  for (const code of testerCodes()) {
    const verified = await call('POST', '/api/signin/verify', { user_id: handle, mode: 'login', otp: code }, { authorization: '' });
    if (verified.status === 200 && verified.body && verified.body.token) return verified.body.token;
  }
  throw new Error('sign-in refused for ' + handle);
}

/* ── a request from a schema: the smallest valid value of each needed field ── */
const unique = () => crypto.randomBytes(3).toString('hex');
/** the schema's own example, enum or default value as { value }, or null when it gives none */
function givenSample(spec) {
  if (Array.isArray(spec.examples) && spec.examples.length) return { value: spec.examples[0] };
  if (spec.example !== undefined) return { value: spec.example };
  if (spec.enum) return { value: spec.enum[0] };
  if (spec.default !== undefined && spec.type !== 'object') return { value: spec.default };
  return null;
}
/** the smallest number the schema allows */
function numberSample(spec) {
  if (spec.minimum !== undefined) return spec.minimum;
  return spec.exclusiveMinimum !== undefined ? spec.exclusiveMinimum + 1 : 1;
}
/** a sample for a string format the harness knows, or undefined for any other */
function formatSample(format) {
  if (format === 'date-time') return new Date().toISOString();
  if (format === 'date') return today();
  if (format === 'email') return PREFIX + unique() + '@test.chitbridge';
  if (format === 'uuid') return SAMPLE_UUID;
  return undefined;
}
/** an object sample: its required fields, each the smallest valid value */
function objectSample(spec) {
  const sample = {};
  (spec.required || []).forEach((field) => { sample[field] = sampleOf((spec.properties || {})[field], field); });
  return sample;
}
/** a sample for an object, array, number or boolean schema as { value }, or null for a string-like one */
function typedSample(spec, type, name) {
  if (type === 'object') return { value: objectSample(spec) };
  if (type === 'array') return { value: spec.minItems ? Array.from({ length: spec.minItems }, () => sampleOf(spec.items, name)) : [] };
  if (type === 'integer' || type === 'number') return { value: numberSample(spec) };
  if (type === 'boolean') return { value: true };
  return null;
}
/** the smallest valid value of a schema (an lt- text for a string, padded to its minLength) */
function sampleOf(schema, name) {
  const spec = schema || {};
  const given = givenSample(spec);
  if (given) return given.value;
  const typed = typedSample(spec, [].concat(spec.type || (spec.properties ? 'object' : 'string'))[0], name);
  if (typed) return typed.value;
  const formatted = formatSample(spec.format);
  if (formatted !== undefined) return formatted;
  const text = PREFIX + (name || 'x') + '-' + unique();
  return spec.minLength && text.length < spec.minLength ? text.padEnd(spec.minLength, 'x') : text;
}

/* ── ids: from objects this run created, else from the route's own list GET ── */
const made = {}; /* collection url -> id of an lt- object this run (or an earlier one) holds */
const lists = {}; /* list url -> parsed body, one read each */
/** the id (the wanted field, else id) of an answer body: itself, or the first object in its arrays, or an object it holds */
const findId = (body, want) => {
  const idOfObject = (value) => value && typeof value === 'object' && !Array.isArray(value) && (value[want] || value.id);
  if (!body) return null;
  if (idOfObject(body)) return String(idOfObject(body));
  const arrays = Array.isArray(body) ? [body] : Object.values(body).filter(Array.isArray);
  for (const list of arrays) { const found = list.find(idOfObject); if (found) return String(idOfObject(found)); }
  const inner = Object.values(body).find((value) => value && typeof value === 'object' && !Array.isArray(value) && idOfObject(value));
  return inner ? String(idOfObject(inner)) : null;
};
/** an item this tool made: it carries a string starting with the lt- prefix */
const ours = (item) => item && typeof item === 'object' && Object.values(item).some((value) => typeof value === 'string' && value.startsWith(PREFIX));
/** the id of an object under a collection url: one this run made, else (reads) the first of the list or (writes) the first lt- one */
async function idOf(prefixUrl, param, mutating, ctx) {
  if (made[prefixUrl]) return made[prefixUrl];
  if (!ctx.getKeys.has('GET ' + prefixUrl)) return null;
  if (!lists[prefixUrl]) lists[prefixUrl] = (await call('GET', prefixUrl)).body;
  const body = lists[prefixUrl];
  const arrays = Array.isArray(body) ? [body] : Object.values(body || {}).filter(Array.isArray);
  const pool = arrays.flat().filter((x) => x && typeof x === 'object' && (x[param] || x.id));
  const pick = mutating ? pool.find(ours) : pool[0];
  return pick ? String(pick[param] || pick.id) : null;
}
/** fill the placeholder at parts[position] in place (a fixed hint, else an id found under the path); null when filled, { reason } when no id can be found */
async function fillPart(parts, position, fixed, mutating, ctx) {
  const name = parts[position].slice(1);
  if (parts[position] === '*') { parts[position] = fixed['*'] || 'x'; return null; }
  if (fixed[name] !== undefined) { parts[position] = fixed[name]; return null; }
  const id = await idOf(parts.slice(0, position).join('/'), name, mutating, ctx);
  if (!id) return { reason: ['fixture', (mutating ? 'no lt- object to act on under ' : 'no object to read under ') + parts.slice(0, position).join('/') + ' for :' + name] };
  parts[position] = id;
  return null;
}
/** the url of a route with every :param filled; returns { url } or { reason } */
async function urlOf(key, route, ctx) {
  const parts = route.path.split('/');
  const fixed = (HINTS.params || {})[key] || {};
  const mutating = route.method !== 'GET';
  for (let position = 0; position < parts.length; position += 1) {
    if (parts[position][0] !== ':' && parts[position] !== '*') continue;
    const missing = await fillPart(parts, position, fixed, mutating, ctx);
    if (missing) return missing;
  }
  return { url: parts.join('/') };
}

/** the names of the first four fields an answer's errors blame, as "fields a,b" (empty when none) */
function fieldsOf(body) {
  const names = Array.isArray(body.errors) ? body.errors.map((entry) => entry.field).filter(Boolean).slice(0, 4).join(',') : '';
  return names ? 'fields ' + names : '';
}
/** the start of an answer's detail, else its message (empty when it has neither) */
function detailOf(body) {
  if (body.detail) return String(body.detail).slice(0, 90);
  return body.message ? String(body.message).slice(0, 90) : '';
}
/** the words an answer gave for itself: status, code, the fields it named, and the start of its detail or message */
function answerWords(res) {
  const body = res.body || {};
  const code = body.code || (body.error && body.error.code) || body.error || '';
  return [res.status, code && typeof code === 'string' ? code : '', fieldsOf(body), detailOf(body)].filter(Boolean).join(' · ');
}
/** the group a refused answer belongs to, from its status and words */
function groupOf(status, words) {
  if (status === 401 || status === 403) return 'role';
  if (status === 404) return 'fixture';
  if (status === 402 || /plan|upgrade|not enabled|disabled|not on|opt/i.test(words)) return 'precondition';
  if (status >= 500) return 'server-error';
  if (status === 0) return 'no-answer';
  return 'example-refused';
}
/** why a 4xx answer did not reach the route's work, in words the next person can act on */
function whyNot(res) {
  const words = answerWords(res);
  return [groupOf(res.status, words), words || String(res.status)];
}

/** the url of a route from a hint's make() answer: its params fill the path, the rest comes from urlOf */
async function urlFromMade(key, route, ctx, fixture) {
  const fixed = { ...((HINTS.params || {})[key] || {}), ...(fixture.params || {}) };
  const saved = HINTS.params; HINTS.params = { ...(saved || {}), [key]: fixed };
  try { return await urlOf(key, route, ctx); } finally { HINTS.params = saved; }
}
/** an unreached row from a [group, reason] pair */
const unreachedRow = (pair) => ({ state: 'unreached', group: pair[0], reason: pair[1] });
/** a hint's make() for one fire: { fixture, url } when it is made, { stop } (an unreached row) when it cannot be */
async function makeFixture(key, route, ctx, hint, round) {
  let fixture;
  try { fixture = await hint.make(API, round); } catch (e) { return { stop: unreachedRow([/429|Too many/.test(e.message) ? 'limiter' : 'fixture', 'the fixture could not be made: ' + e.message.slice(0, 200)]) }; }
  if (fixture && fixture.unreached) return { stop: unreachedRow(fixture.unreached) };
  const url = await urlFromMade(key, route, ctx, fixture || {});
  return url.reason ? { stop: unreachedRow(url.reason) } : { fixture, url };
}
/** body, query and headers of one fire: the sample's own, overridden by what the fixture made */
function requestOf(sample, fixture, round) {
  let body = round === 0 ? sample.body : (typeof sample.again === 'function' ? sample.again() : sample.body);
  let query = sample.query || '';
  let headers = sample.headers;
  if (fixture) { if (fixture.body !== undefined) body = fixture.body; if (fixture.query !== undefined) query = fixture.query; if (fixture.headers) headers = fixture.headers; }
  return { body, query, headers };
}
const FIRES = 4; /* 1 warm-up + 3 measured */
/** the row of a route from the calls made: measured (the highest X-DB-Trips of the 2xx), or unreached with the group and reason */
function verdictOf(calls, last, url) {
  const good = calls.filter((attempt) => attempt.status >= 200 && attempt.status < 300 && typeof attempt.trips === 'number');
  if (!good.length) {
    if (calls.every((attempt) => attempt.status >= 200 && attempt.status < 300)) return { state: 'unreached', group: 'no-header', reason: 'answered ' + calls[0].status + ' with no X-DB-Trips header (static or pre-database answer): 0 database trips by construction, needs a hand note', url, calls };
    const [group, reason] = whyNot(last);
    return { state: 'unreached', group, reason, url, calls };
  }
  return { state: 'measured', trips: Math.max(...good.map((attempt) => attempt.trips)), status: good[0].status, url, calls };
}
const isOk = (answer) => answer.status >= 200 && answer.status < 300;
/** one fire of a route: the call, keeping the first 2xx body so the ids in it can be found */
async function fireOnce(route, url, request) {
  const answer = await call(route.method, url + request.query, route.method === 'GET' || route.method === 'DELETE' ? undefined : request.body, request.headers);
  if (isOk(answer) && !lastBody) lastBody = answer.body;
  return answer;
}
/** the four fires of one route; the highest X-DB-Trips among the 2xx answers is its count */
async function measure(key, route, ctx, sample, hint) {
  lastBody = null;
  const make = hint && hint.make;
  let url = make ? { url: null } : await urlOf(key, route, ctx);
  if (url.reason) return unreachedRow(url.reason);
  const calls = [];
  let last = null;
  let fixture = null;
  for (let round = 0; round < FIRES; round += 1) {
    if (make && (round === 0 || hint.fresh)) {
      const prepared = await makeFixture(key, route, ctx, hint, round);
      if (prepared.stop) return prepared.stop;
      ({ fixture, url } = prepared);
    }
    const request = requestOf(sample, fixture, round);
    last = await fireOnce(route, url.url, request);
    calls.push({ status: last.status, trips: last.trips });
    if (!isOk(last)) break; /* it did not reach its work: stop firing a refused request */
  }
  return verdictOf(calls, last, url.url);
}

/* ── the run ── */
/** the registered routes whose trips line is still a placeholder (not yet fired in the budget) */
function failingRoutes(register, budget) {
  return register.routes.filter((route) => route.columns.trips_budgeted === false && !(budget.routes[route.key] && budget.routes[route.key].fired === true));
}
const ORDER = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4, OPTIONS: 5 };
/** the offline operations (schemas) of the real app, as the register reads them */
function operations() {
  const loader = require('./load-app.cjs');
  loader.stubDatabase(ROOT);
  loader.loadApp(ROOT);
  return require('./api-register.cjs').operationsOfApp();
}
/** the request a route starts from: the hint's body, query and headers, else the smallest valid body its schema allows */
function sampleFor(key, operation, hint) {
  const validate = require('../middleware/validate');
  const schema = operation && validate.bodySchemaOf(operation);
  const again = hint && hint.body ? () => (typeof hint.body === 'function' ? hint.body() : hint.body) : () => (schema ? sampleOf(schema) : {});
  return { body: again(), again, headers: hint && hint.headers, query: (hint && hint.query) || '' };
}

/** run the work, then ALWAYS the restore; the work's results come back */
async function runGuarded(opts) {
  const results = await guarded(() => runInner(opts), () => restoreAll(API));
  return results;
}
/** one printed line per route: MEASURED with its count, or unreached with the group and reason */
function printRow(key, out) {
  const measured = out.state === 'measured';
  console.log((measured ? 'MEASURED ' + String(out.trips).padStart(3) : 'unreached   ') + '  ' + key.padEnd(62) + (measured ? '' : out.group + ' · ' + out.reason));
}
/** every hint's seed(api) once per process; a failing seed is told and the run goes on */
async function seedHints() {
  for (const hint of Object.values(HINTS.routes || {})) {
    if (typeof hint.seed !== 'function' || hint.seeded) continue;
    hint.seeded = true;
    try { await hint.seed(API); } catch (e) { console.log('seed failed: ' + e.message.slice(0, 120)); }
  }
}
/** the driven network scenario (eight write routes), unless it was asked to skip or an earlier run already measured all of them; its rows go into results */
async function driveNetworkRoutes(opts, previous, results, drivenKeys) {
  const networkKeys = ['approve', 'decline', 'disconnect', 'resume', 'suspend'].map((action) => 'POST /api/network/connections/:id/' + action).concat(['POST /api/network/connections', 'POST /api/network/entities']);
  const alreadyDriven = !opts.retryAll && networkKeys.every((routeKey) => previous.routes[routeKey] && previous.routes[routeKey].state === 'measured');
  if ((opts.only && !/network/.test(opts.only)) || alreadyDriven) return;
  const driven = await require('./live-trips-network.cjs').run({ call, tokenFor, unique });
  Object.keys(driven).forEach((routeKey) => { results[routeKey] = driven[routeKey]; drivenKeys.add(routeKey); printRow(routeKey, driven[routeKey]); });
}
/** the row of one route: denied, skipped by its hint, the CORS preflight, or measured */
async function outcomeOf(route, hint, ctx, routeOps) {
  if (DENY[route.key]) return unreachedRow(DENY[route.key]);
  if (hint && hint.skip) return unreachedRow(hint.skip);
  if (route.key === 'OPTIONS *') return unreachedRow(['no-header', 'the CORS preflight is answered by middleware before any database work; no X-DB-Trips header on it']);
  return measure(route.key, route, ctx, sampleFor(route.key, routeOps[route.key], hint), hint);
}
/** the routes still to try: failing, matching --only, not yet measured (unless --retry-all), GET first */
function routesToTry(opts, register, budget, previous) {
  return failingRoutes(register, budget)
    .filter((route) => !opts.only || new RegExp(opts.only).test(route.key))
    .filter((route) => opts.retryAll || !(previous.routes[route.key] && previous.routes[route.key].state === 'measured'))
    .sort((first, second) => (ORDER[first.method] - ORDER[second.method]) || first.key.localeCompare(second.key));
}
/** a measured POST of a collection url made an object: remember its id so the routes under it can act on it */
function rememberCreated(route, out) {
  if (out.state !== 'measured' || route.method !== 'POST' || route.path.includes(':')) return;
  const created = findId(lastBody, 'id');
  if (created) made[route.path] = created;
}
/** a re-run that found no measurement where an earlier run had one */
const usedUp = (out, earlier) => out.state !== 'measured' && !!earlier && earlier.state === 'measured';
/** fire every route to try and return { route key: row }; a re-run whose fixture is used up keeps the earlier measurement */
async function runInner(opts) {
  const budget = readJson(BUDGET_FILE, { routes: {} });
  const register = readJson(REGISTER_FILE, { routes: [] });
  const previous = readJson(RESULTS_FILE, { routes: {} });
  const routeOps = operations();
  const ctx = { getKeys: new Set(register.routes.filter((route) => route.method === 'GET').map((route) => route.key)) };
  const todo = routesToTry(opts, register, budget, previous);
  console.log('routes to try: ' + todo.length + ' (failing trips_budgeted, not yet measured)');
  await signIn();
  console.log('signed in on ' + state.host);
  await seedHints();
  const results = { ...previous.routes };
  const drivenKeys = new Set();
  await driveNetworkRoutes(opts, previous, results, drivenKeys);
  for (const route of todo) {
    if (drivenKeys.has(route.key)) continue; /* the driven network scenario already answered it */
    const out = await outcomeOf(route, (HINTS.routes || {})[route.key], ctx, routeOps);
    rememberCreated(route, out);
    if (usedUp(out, previous.routes[route.key])) { /* a re-run that finds its fixture used up (pool shops connected, period closed) keeps the earlier live number */
      console.log('kept earlier measurement  ' + route.key + ' (now: ' + out.group + ' · ' + out.reason.slice(0, 80) + ')');
      continue;
    }
    results[route.key] = out;
    printRow(route.key, out);
  }
  return results;
}
let lastBody = null;

/* ── what a hint's make()/seed() may use: the paced call, a unique word, today, and SQL on sit-in's own test database ── */
const SQL_SSH = ['-i', path.join(os.homedir(), '.ssh', 'sit_oracle'), '-o', 'BatchMode=yes', 'ubuntu@129.225.85.65', 'docker exec -i cbnet-db-1 psql -U postgres -d chitbridge -At'];
/** run SQL on sit-in's database (a TEST server) and return the rows as arrays of text; the SQL comes from the hints, never from outside */
function sql(text) {
  const result = require('child_process').spawnSync('ssh', SQL_SSH, { input: text, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error('sit-in sql failed: ' + String(result.stderr || '').slice(0, 200));
  return String(result.stdout).split('\n').filter(Boolean).map((row) => row.split('|'));
}
const API = {
  call, sql, unique, day: today, prefix: PREFIX, handle: HANDLE,
  /** first element of a list answer that carries the lt- prefix (idempotent seeding: look before create) */
  async firstOurs(url) { const answerBody = (await call('GET', url)).body; const arr = Array.isArray(answerBody) ? answerBody : Object.values(answerBody || {}).filter(Array.isArray).flat(); return arr.find(ours) || null; },
  seeds: {}, /* ids found or made by seed() hooks in this run */
  /** write the set-ups that need an undo to the state file (called BEFORE the change, so a crash still finds it) */
  save() { const out = {}; PERSIST.forEach((name) => { if (API.seeds[name] !== undefined) out[name] = API.seeds[name]; }); fs.writeFileSync(STATE_FILE, JSON.stringify(out), { mode: 0o600 }); },
  clearState() { try { fs.unlinkSync(STATE_FILE); } catch (noStateFile) { quiet('no state file: nothing was set up'); } },
  tokenFor
};

/** run the work, then ALWAYS the restore (a thrown error, a refusal or a Ctrl-C handler all pass through here); the work's own error is kept */
async function guarded(work, restore) {
  try { return await work(); } finally { await restore(); }
}
/** undo every set-up of the hints (register capability, claimed flag, locked periods, counter, screens); a failing step is told, never hides the error that caused the restore */
async function restoreAll(api, hints) {
  const hintSet = hints || HINTS;
  if (typeof hintSet.cleanup !== 'function') return;
  try { await hintSet.cleanup(api); } catch (e) { console.log('RESTORE FAILED (run: node tools/live-trips.cjs --restore): ' + String(e.message).slice(0, 160)); }
}
/** --restore: load the saved state file and undo it, also when the run died (idempotent: every step is conditional) */
async function restoreFromFile() {
  const saved = readJson(STATE_FILE, null);
  if (!saved) return console.log('nothing to restore (no ' + STATE_FILE + ')');
  Object.assign(API.seeds, saved);
  await signIn();
  await restoreAll(API);
  console.log('restored: ' + Object.keys(saved).join(', '));
}
/** --cleanup [--apply]: take back what the harness left by its lt- tag (see tools/live-trips-cleanup.cjs); the plan only, unless --apply */
async function cleanupMode(apply) {
  await signIn();
  const at = (readJson(RESULTS_FILE, {}) || {}).at;
  await guarded(() => require('./live-trips-cleanup.cjs').cleanup(API, { apply, at, day: today(), loadId: HINTS.LOAD_ID }), () => restoreAll(API));
}
/* a Ctrl-C or an uncaught error in a run: restore, then leave with a non-zero code */
function guardProcess() {
  const bail = (code) => (e) => { if (e) console.error('live-trips: ' + (e.message || e)); restoreAll(API).finally(() => process.exit(code)); };
  process.on('SIGINT', bail(130)); process.on('SIGTERM', bail(143));
  process.on('uncaughtException', bail(1)); process.on('unhandledRejection', bail(1));
}

module.exports = { sampleOf, whyNot, failingRoutes, guarded, restoreAll };
if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (flag) => { const position = args.indexOf(flag); return position >= 0 ? args[position + 1] : null; };
  main(args, opt).catch((e) => { console.error('live-trips: ' + e.message); process.exit(1); });
}

/** --seed: run every hint's seed(api) once (idempotent: each looks before it creates; objects are prefixed lt-); the ids stay in API.seeds for the same process only,
 *  so a plain run seeds again by itself (hints call API.seed(name, fn) which is cached per run) */
async function seedAll() {
  await signIn();
  for (const [routeKey, hint] of Object.entries(HINTS.routes || {})) {
    if (typeof hint.seed !== 'function') continue;
    try { const out = await hint.seed(API); console.log('seeded  ' + routeKey.padEnd(60) + JSON.stringify(out === undefined ? 'ok' : out).slice(0, 80)); } catch (e) { console.log('SEED FAILED ' + routeKey + ' ' + e.message.slice(0, 120)); }
  }
  console.log('requests ' + state.n);
}
/** --check: the writer must not lower or drop any line of the committed files */
function check() {
  const budget = readJson(BUDGET_FILE, null);
  const live = readJson(LIVE_FILE, null);
  const same = writer.applyMeasured(budget, live, [], today());
  const worse = writer.problems({ budget, live }, same);
  const lowered = writer.applyMeasured(budget, live, Object.keys(live.routes).map((routeKey) => ({ route: routeKey, trips: 0, status: 200 })), today());
  worse.push(...writer.problems({ budget, live }, lowered));
  if (writer.serialiseBudget(same.budget) !== fs.readFileSync(BUDGET_FILE, 'utf8')) worse.push('round-trips.budget.json would not stay byte-identical');
  if (writer.serialiseLive(same.live) !== fs.readFileSync(LIVE_FILE, 'utf8')) worse.push('round-trips.live.json would not stay byte-identical');
  if (worse.length) { console.log('live-trips --check FAILED\n  ' + worse.join('\n  ')); process.exit(1); }
  console.log('live-trips --check ok: an empty run leaves both files byte-identical and a zero-trip run lowers nothing');
}

/** --probe <method> <url> [json]: one call, printed (a debugging aid) */
async function probe(args) {
  await signIn();
  console.log('host', state.host);
  const position = args.indexOf('--probe');
  const reply = await call(args[position + 1], args[position + 2], args[position + 3] ? JSON.parse(args[position + 3]) : undefined);
  console.log(reply.status, 'trips', reply.trips, JSON.stringify(reply.body || reply.text).slice(0, +(process.env.PROBE_LEN || 700)));
}
/** the results file of a run */
function resultsDoc(results, summary) {
  return { about: 'SPD-39 live-trips results (tools/live-trips.cjs): per failing-trips route, measured (live X-DB-Trips, highest of 3 after 1 warm-up) or unreached with the group and the reason. Resumable: measured routes are skipped.', at: today(), server: 'sit-in', summary, routes: results };
}
/** write the measured rows into the budget and live files through the safe writer; refuses (throws) when the writer would make a file worse */
function writeMeasured(rows) {
  const budget = readJson(BUDGET_FILE, null);
  const live = readJson(LIVE_FILE, null);
  const next = writer.applyMeasured(budget, live, rows, today());
  const worse = writer.problems({ budget, live }, next);
  if (worse.length) throw new Error('the writer would make things worse (nothing written to the budget): ' + worse.join('; '));
  fs.writeFileSync(BUDGET_FILE, writer.serialiseBudget(next.budget));
  fs.writeFileSync(LIVE_FILE, writer.serialiseLive(next.live));
  console.log('lines written: ' + next.changed.length + ' · not accepted as measurements: ' + next.refused.length);
}
/** the command line: --check · --restore · --cleanup · --seed · --probe, else a run (--dry writes nothing to the budget) */
async function main(args, opt) {
  if (args.includes('--check')) return check();
  if (args.includes('--restore')) return restoreFromFile();
  if (args.includes('--cleanup')) return cleanupMode(args.includes('--apply'));
  guardProcess();
  if (args.includes('--seed')) return guarded(seedAll, () => restoreAll(API));
  if (args.includes('--probe')) return probe(args);
  const dryRun = args.includes('--dry');
  const results = await runGuarded({ only: opt('--only'), retryAll: args.includes('--retry-all') });
  const rows = Object.keys(results).filter((routeKey) => results[routeKey].state === 'measured').map((routeKey) => ({ route: routeKey, trips: results[routeKey].trips, status: results[routeKey].status }));
  const summary = { measured: rows.length, unreached: Object.keys(results).length - rows.length };
  const out = opt('--out') || (dryRun ? null : RESULTS_FILE);
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(resultsDoc(results, summary), null, 1) + '\n'); console.log('wrote ' + out); }
  if (!dryRun) writeMeasured(rows);
  console.log('measured ' + summary.measured + ' · unreached ' + summary.unreached + ' · requests ' + state.n);
}

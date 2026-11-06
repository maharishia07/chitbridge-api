'use strict';
/**
 * OWNS      measuring LIVE database round trips (X-DB-Trips) for the registered routes whose trips line is still a placeholder (SPD-39); the reason per route it cannot reach.
 * CALLED BY a person: node tools/live-trips.cjs [--dry] [--only <regex>] [--retry-all] [--out <file>] | --seed | --check | --restore | --cleanup [--apply]. Tests/tooling only: no route handler is touched.
 * FLOW      docs/api-register.json (trips_budgeted false) + the routes' own OpenAPI schemas ──▶ a request per route ──▶ sit-in (the load shop only) ──▶ docs/speed/live-trips-results.json
 *           ──▶ tools/live-trips-writer.cjs (the safe writer) ──▶ round-trips.live.json + round-trips.budget.json (only the lines measured).
 * CARD      speed · round trips
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
const ID0 = '00000000-0000-4000-8000-000000000001';
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } };
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function call(method, url, body, extra) {
  const wait = GAP_MS - (Date.now() - state.last);
  if (wait > 0) await sleep(wait);
  state.last = Date.now();
  state.n += 1;
  const headers = { 'content-type': 'application/json', ...(state.token ? { authorization: 'Bearer ' + state.token } : {}), ...(extra || {}) };
  if (method !== 'GET' && method !== 'OPTIONS' && !headers['Idempotency-Key']) headers['Idempotency-Key'] = crypto.randomUUID();
  const t0 = Date.now();
  try {
    const res = await fetch(state.host + url, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { /* not JSON */ }
    const h = res.headers.get('x-db-trips');
    if (res.status >= 500) state.fives += 1; else state.fives = 0;
    if (state.fives >= 8) throw new Error('8 answers of 5xx in a row: stopping');
    return { status: res.status, trips: h === null ? null : Number(h), ms: Date.now() - t0, body: parsed, text: parsed ? '' : text.slice(0, 120) };
  } catch (e) {
    if (/stopping/.test(String(e.message))) throw e;
    return { status: 0, trips: null, ms: Date.now() - t0, body: null, text: String(e.message).slice(0, 100) + (e.cause ? ' ' + String(e.cause.code || e.cause.message).slice(0, 60) : '') };
  }
}

/* ── sign-in, once ── */
function testerCodes() {
  const secret = readJson(path.join(os.homedir(), '.cb-sit-users.json'), null);
  const s = secret && secret.servers && secret.servers['sit-in'] && secret.servers['sit-in'].sign_in;
  if (!s) throw new Error('no sit-in sign-in recipe in ~/.cb-sit-users.json');
  const ymd = (off) => {
    const d = new Date(Date.now() + off * 864e5 + 5.5 * 36e5);
    return d.toISOString().slice(2, 10).replace(/-/g, '');
  };
  return [0, -1].map((o) => s.tester_code_template.replace('{yymmdd}', ymd(o)).replace('{yyyymmdd}', '20' + ymd(o)));
}
async function signIn() {
  const cached = readJson(TOKEN_FILE, null);
  if (cached && cached.token && HOSTS.includes(cached.host)) {
    state.host = cached.host; state.token = cached.token;
    const me = await call('GET', '/api/entities/me');
    if (me.status === 200) return;
    state.token = null;
  }
  for (const host of HOSTS) {
    state.host = host;
    const h = await call('GET', '/health');
    if (h.status !== 200) continue;
    await call('POST', '/api/signin/ask', { user_id: HANDLE, mode: 'login' });
    for (const code of testerCodes()) {
      const v = await call('POST', '/api/signin/verify', { user_id: HANDLE, mode: 'login', otp: code });
      if (v.status === 200 && v.body && v.body.token) {
        state.token = v.body.token;
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({ host, token: v.body.token }), { mode: 0o600 });
        return;
      }
    }
    throw new Error('sign-in refused on ' + host);
  }
  throw new Error('sit-in did not answer /health');
}

/** a token for another pool user (one sign-in each; the limiter is 30 per 15 min per IP) */
async function tokenFor(handle) {
  await call('POST', '/api/signin/ask', { user_id: handle, mode: 'login' }, { authorization: '' });
  for (const code of testerCodes()) {
    const v = await call('POST', '/api/signin/verify', { user_id: handle, mode: 'login', otp: code }, { authorization: '' });
    if (v.status === 200 && v.body && v.body.token) return v.body.token;
  }
  throw new Error('sign-in refused for ' + handle);
}

/* ── a request from a schema: the smallest valid value of each needed field ── */
const unique = () => crypto.randomBytes(3).toString('hex');
function sampleOf(schema, name) {
  const s = schema || {};
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.example !== undefined) return s.example;
  if (s.enum) return s.enum[0];
  if (s.default !== undefined && s.type !== 'object') return s.default;
  const type = [].concat(s.type || (s.properties ? 'object' : 'string'))[0];
  if (type === 'object') {
    const made = {};
    (s.required || []).forEach((k) => { made[k] = sampleOf((s.properties || {})[k], k); });
    return made;
  }
  if (type === 'array') return s.minItems ? Array.from({ length: s.minItems }, () => sampleOf(s.items, name)) : [];
  if (type === 'integer' || type === 'number') return s.minimum !== undefined ? s.minimum : (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 1);
  if (type === 'boolean') return true;
  if (s.format === 'date-time') return new Date().toISOString();
  if (s.format === 'date') return today();
  if (s.format === 'email') return PREFIX + unique() + '@test.chitbridge';
  if (s.format === 'uuid') return ID0;
  const text = PREFIX + (name || 'x') + '-' + unique();
  return s.minLength && text.length < s.minLength ? text.padEnd(s.minLength, 'x') : text;
}

/* ── ids: from objects this run created, else from the route's own list GET ── */
const made = {}; /* collection url -> id of an lt- object this run (or an earlier one) holds */
const lists = {}; /* list url -> parsed body, one read each */
const findId = (body, want) => {
  const hit = (o) => o && typeof o === 'object' && !Array.isArray(o) && (o[want] || o.id);
  if (!body) return null;
  if (hit(body)) return String(hit(body));
  const arrays = Array.isArray(body) ? [body] : Object.values(body).filter(Array.isArray);
  for (const a of arrays) { const x = a.find(hit); if (x) return String(hit(x)); }
  const inner = Object.values(body).find((v) => v && typeof v === 'object' && !Array.isArray(v) && hit(v));
  return inner ? String(hit(inner)) : null;
};
const ours = (item) => item && typeof item === 'object' && Object.values(item).some((v) => typeof v === 'string' && v.startsWith(PREFIX));
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
/** the url of a route with every :param filled; returns { url } or { reason } */
async function urlOf(key, route, ctx) {
  const parts = route.path.split('/');
  const fixed = (HINTS.params || {})[key] || {};
  const mutating = route.method !== 'GET';
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i][0] !== ':' && parts[i] !== '*') continue;
    const name = parts[i].slice(1);
    if (parts[i] === '*') { parts[i] = fixed['*'] || 'x'; continue; }
    if (fixed[name] !== undefined) { parts[i] = fixed[name]; continue; }
    const id = await idOf(parts.slice(0, i).join('/'), name, mutating, ctx);
    if (!id) return { reason: ['fixture', (mutating ? 'no lt- object to act on under ' : 'no object to read under ') + parts.slice(0, i).join('/') + ' for :' + name] };
    parts[i] = id;
  }
  return { url: parts.join('/') };
}

/** why a 4xx answer did not reach the route's work, in words the next person can act on */
function whyNot(res) {
  const b = res.body || {};
  const code = b.code || (b.error && b.error.code) || b.error || '';
  const fields = Array.isArray(b.errors) ? b.errors.map((e) => e.field).filter(Boolean).slice(0, 4).join(',') : '';
  const said = [res.status, code && typeof code === 'string' ? code : '', fields ? 'fields ' + fields : '', b.detail ? String(b.detail).slice(0, 90) : (b.message ? String(b.message).slice(0, 90) : '')].filter(Boolean).join(' · ');
  let group = 'example-refused';
  if (res.status === 401 || res.status === 403) group = 'role';
  else if (res.status === 404) group = 'fixture';
  else if (res.status === 402 || /plan|upgrade|not enabled|disabled|not on|opt/i.test(said)) group = 'precondition';
  else if (res.status >= 500) group = 'server-error';
  else if (res.status === 0) group = 'no-answer';
  return [group, said || String(res.status)];
}

/** the four fires of one route; the highest X-DB-Trips among the 2xx answers is its count */
/** the url of a route from a hint's make() answer: its params fill the path, the rest comes from urlOf */
async function urlFromMade(key, route, ctx, made) {
  const fixed = { ...((HINTS.params || {})[key] || {}), ...(made.params || {}) };
  const saved = HINTS.params; HINTS.params = { ...(saved || {}), [key]: fixed };
  try { return await urlOf(key, route, ctx); } finally { HINTS.params = saved; }
}
async function measure(key, route, ctx, sample, hint) {
  lastBody = null;
  const make = hint && hint.make;
  let url = make ? { url: null } : await urlOf(key, route, ctx);
  if (url.reason) return { state: 'unreached', group: url.reason[0], reason: url.reason[1] };
  const calls = [];
  let last = null;
  let made = null;
  for (let i = 0; i < 4; i += 1) {
    let body = i === 0 ? sample.body : (typeof sample.again === 'function' ? sample.again() : sample.body);
    let query = sample.query || '';
    let headers = sample.headers;
    if (make && (i === 0 || hint.fresh)) {
      try { made = await make(API, i); } catch (e) { return { state: 'unreached', group: /429|Too many/.test(e.message) ? 'limiter' : 'fixture', reason: 'the fixture could not be made: ' + e.message.slice(0, 200) }; }
      if (made && made.unreached) return { state: 'unreached', group: made.unreached[0], reason: made.unreached[1] };
      url = await urlFromMade(key, route, ctx, made || {});
      if (url.reason) return { state: 'unreached', group: url.reason[0], reason: url.reason[1] };
    }
    if (made) { if (made.body !== undefined) body = made.body; if (made.query !== undefined) query = made.query; if (made.headers) headers = made.headers; }
    last = await call(route.method, url.url + query, route.method === 'GET' || route.method === 'DELETE' ? undefined : body, headers);
    calls.push({ status: last.status, trips: last.trips });
    if (last.status >= 200 && last.status < 300 && !lastBody) lastBody = last.body;
    if (last.status < 200 || last.status >= 300) break; /* it did not reach its work: stop firing a refused request */
  }
  const good = calls.filter((c) => c.status >= 200 && c.status < 300 && typeof c.trips === 'number');
  if (!good.length) {
    if (calls.every((c) => c.status >= 200 && c.status < 300)) return { state: 'unreached', group: 'no-header', reason: 'answered ' + calls[0].status + ' with no X-DB-Trips header (static or pre-database answer): 0 database trips by construction, needs a hand note', url: url.url, calls };
    const [group, reason] = whyNot(last);
    return { state: 'unreached', group, reason, url: url.url, calls };
  }
  return { state: 'measured', trips: Math.max(...good.map((c) => c.trips)), status: good[0].status, url: url.url, calls };
}

/* ── the run ── */
function failingRoutes(register, budget) {
  return register.routes.filter((r) => r.columns.trips_budgeted === false && !(budget.routes[r.key] && budget.routes[r.key].fired === true));
}
const ORDER = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4, OPTIONS: 5 };
/** the offline operations (schemas) of the real app, as the register reads them */
function operations() {
  const loader = require('./load-app.cjs');
  loader.stubDatabase(ROOT);
  loader.loadApp(ROOT);
  return require('./api-register.cjs').operationsOfApp();
}
function sampleFor(key, op, hint) {
  const v = require('../middleware/validate');
  const schema = op && v.bodySchemaOf(op);
  const again = hint && hint.body ? () => (typeof hint.body === 'function' ? hint.body() : hint.body) : () => (schema ? sampleOf(schema) : {});
  return { body: again(), again, headers: hint && hint.headers, query: (hint && hint.query) || '' };
}

async function run(opts) {
  const results = await guarded(() => runInner(opts), () => restoreAll(API));
  return results;
}
async function runInner(opts) {
  const budget = readJson(BUDGET_FILE, { routes: {} });
  const register = readJson(REGISTER_FILE, { routes: [] });
  const previous = readJson(RESULTS_FILE, { routes: {} });
  const ops = operations();
  const getKeys = new Set(register.routes.filter((r) => r.method === 'GET').map((r) => r.key));
  const ctx = { getKeys };
  const todo = failingRoutes(register, budget)
    .filter((r) => !opts.only || new RegExp(opts.only).test(r.key))
    .filter((r) => opts.retryAll || !(previous.routes[r.key] && previous.routes[r.key].state === 'measured'))
    .sort((a, b) => (ORDER[a.method] - ORDER[b.method]) || a.key.localeCompare(b.key));
  console.log('routes to try: ' + todo.length + ' (failing trips_budgeted, not yet measured)');
  await signIn();
  console.log('signed in on ' + state.host);
  for (const h of Object.values(HINTS.routes || {})) { if (typeof h.seed === 'function' && !h.seeded) { h.seeded = true; try { await h.seed(API); } catch (e) { console.log('seed failed: ' + e.message.slice(0, 120)); } } }
  const results = { ...previous.routes };
  const drivenKeys = new Set();
  const driven0 = ['approve', 'decline', 'disconnect', 'resume', 'suspend'].map((a) => 'POST /api/network/connections/:id/' + a).concat(['POST /api/network/connections', 'POST /api/network/entities']);
  const alreadyDriven = !opts.retryAll && driven0.every((k) => previous.routes[k] && previous.routes[k].state === 'measured');
  if ((!opts.only || /network/.test(opts.only)) && !alreadyDriven) {
    const driven = await require('./live-trips-network.cjs').run({ call, tokenFor, unique });
    Object.keys(driven).forEach((k) => { results[k] = driven[k]; drivenKeys.add(k); console.log((driven[k].state === 'measured' ? 'MEASURED ' + String(driven[k].trips).padStart(3) : 'unreached   ') + '  ' + k.padEnd(62) + (driven[k].state === 'measured' ? '' : driven[k].group + ' · ' + driven[k].reason)); });
  }
  for (const r of todo) {
    if (drivenKeys.has(r.key)) continue; /* the driven network scenario already answered it */
    const hint = (HINTS.routes || {})[r.key];
    let out;
    if (DENY[r.key]) out = { state: 'unreached', group: DENY[r.key][0], reason: DENY[r.key][1] };
    else if (hint && hint.skip) out = { state: 'unreached', group: hint.skip[0], reason: hint.skip[1] };
    else if (r.key === 'OPTIONS *') out = { state: 'unreached', group: 'no-header', reason: 'the CORS preflight is answered by middleware before any database work; no X-DB-Trips header on it' };
    else out = await measure(r.key, r, ctx, sampleFor(r.key, ops[r.key], hint), hint);
    if (out.state === 'measured' && r.method === 'POST' && !r.path.includes(':')) {
      const created = findId(lastBody, 'id');
      if (created) made[r.path] = created;
    }
    const earlier = previous.routes[r.key];
    if (out.state !== 'measured' && earlier && earlier.state === 'measured') { /* a re-run that finds its fixture used up (pool shops connected, period closed) keeps the earlier live number */
      console.log('kept earlier measurement  ' + r.key + ' (now: ' + out.group + ' · ' + out.reason.slice(0, 80) + ')');
      continue;
    }
    results[r.key] = out;
    console.log((out.state === 'measured' ? 'MEASURED ' + String(out.trips).padStart(3) : 'unreached   ') + '  ' + r.key.padEnd(62) + (out.state === 'measured' ? '' : out.group + ' · ' + out.reason));
  }
  return results;
}
let lastBody = null;

/* ── what a hint's make()/seed() may use: the paced call, a unique word, today, and SQL on sit-in's own test database ── */
const SQL_SSH = ['-i', path.join(os.homedir(), '.ssh', 'sit_oracle'), '-o', 'BatchMode=yes', 'ubuntu@129.225.85.65', 'docker exec -i cbnet-db-1 psql -U postgres -d chitbridge -At'];
/** run SQL on sit-in's database (a TEST server) and return the rows as arrays of text; the SQL comes from the hints, never from outside */
function sql(text) {
  const r = require('child_process').spawnSync('ssh', SQL_SSH, { input: text, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error('sit-in sql failed: ' + String(r.stderr || '').slice(0, 200));
  return String(r.stdout).split('\n').filter(Boolean).map((l) => l.split('|'));
}
const API = {
  call, sql, unique, day: today, prefix: PREFIX, handle: HANDLE,
  /** first element of a list answer that carries the lt- prefix (idempotent seeding: look before create) */
  async firstOurs(url) { const b = (await call('GET', url)).body; const arr = Array.isArray(b) ? b : Object.values(b || {}).filter(Array.isArray).flat(); return arr.find(ours) || null; },
  seeds: {}, /* ids found or made by seed() hooks in this run */
  /** write the set-ups that need an undo to the state file (called BEFORE the change, so a crash still finds it) */
  save() { const out = {}; PERSIST.forEach((k) => { if (API.seeds[k] !== undefined) out[k] = API.seeds[k]; }); fs.writeFileSync(STATE_FILE, JSON.stringify(out), { mode: 0o600 }); },
  clearState() { try { fs.unlinkSync(STATE_FILE); } catch (_) { /* no state file: nothing was set up */ } },
  tokenFor
};

/** run the work, then ALWAYS the restore (a thrown error, a refusal or a Ctrl-C handler all pass through here); the work's own error is kept */
async function guarded(work, restore) {
  try { return await work(); } finally { await restore(); }
}
/** undo every set-up of the hints (register capability, claimed flag, locked periods, counter, screens); a failing step is told, never hides the error that caused the restore */
async function restoreAll(api, hints) {
  const h = hints || HINTS;
  if (typeof h.cleanup !== 'function') return;
  try { await h.cleanup(api); } catch (e) { console.log('RESTORE FAILED (run: node tools/live-trips.cjs --restore): ' + String(e.message).slice(0, 160)); }
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
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  main(args, opt).catch((e) => { console.error('live-trips: ' + e.message); process.exit(1); });
}

/** --seed: run every hint's seed(api) once (idempotent: each looks before it creates; objects are prefixed lt-); the ids stay in API.seeds for the same process only,
 *  so a plain run seeds again by itself (hints call API.seed(name, fn) which is cached per run) */
async function seedAll() {
  await signIn();
  for (const [k, h] of Object.entries(HINTS.routes || {})) {
    if (typeof h.seed !== 'function') continue;
    try { const out = await h.seed(API); console.log('seeded  ' + k.padEnd(60) + JSON.stringify(out === undefined ? 'ok' : out).slice(0, 80)); } catch (e) { console.log('SEED FAILED ' + k + ' ' + e.message.slice(0, 120)); }
  }
  console.log('requests ' + state.n);
}
/** --check: the writer must not lower or drop any line of the committed files */
function check() {
  const budget = readJson(BUDGET_FILE, null);
  const live = readJson(LIVE_FILE, null);
  const same = writer.applyMeasured(budget, live, [], today());
  const bad = writer.problems({ budget, live }, same);
  const lowered = writer.applyMeasured(budget, live, Object.keys(live.routes).map((k) => ({ route: k, trips: 0, status: 200 })), today());
  bad.push(...writer.problems({ budget, live }, lowered));
  if (writer.serialiseBudget(same.budget) !== fs.readFileSync(BUDGET_FILE, 'utf8')) bad.push('round-trips.budget.json would not stay byte-identical');
  if (writer.serialiseLive(same.live) !== fs.readFileSync(LIVE_FILE, 'utf8')) bad.push('round-trips.live.json would not stay byte-identical');
  if (bad.length) { console.log('live-trips --check FAILED\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('live-trips --check ok: an empty run leaves both files byte-identical and a zero-trip run lowers nothing');
}

async function main(args, opt) {
  if (args.includes('--check')) return check();
  if (args.includes('--restore')) return restoreFromFile();
  if (args.includes('--cleanup')) return cleanupMode(args.includes('--apply'));
  guardProcess();
  if (args.includes('--seed')) return guarded(seedAll, () => restoreAll(API));
  if (args.includes('--probe')) { await signIn(); console.log('host', state.host); const i = args.indexOf('--probe'); const r = await call(args[i + 1], args[i + 2], args[i + 3] ? JSON.parse(args[i + 3]) : undefined); console.log(r.status, 'trips', r.trips, JSON.stringify(r.body || r.text).slice(0, +(process.env.PROBE_LEN || 700))); return; }
  const dry = args.includes('--dry');
  const results = await run({ only: opt('--only'), retryAll: args.includes('--retry-all') });
  const rows = Object.keys(results).filter((k) => results[k].state === 'measured').map((k) => ({ route: k, trips: results[k].trips, status: results[k].status }));
  const summary = { measured: rows.length, unreached: Object.keys(results).length - rows.length };
  const doc = { about: 'SPD-39 live-trips results (tools/live-trips.cjs): per failing-trips route, measured (live X-DB-Trips, highest of 3 after 1 warm-up) or unreached with the group and the reason. Resumable: measured routes are skipped.', at: today(), server: 'sit-in', summary, routes: results };
  const out = opt('--out') || (dry ? null : RESULTS_FILE);
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n'); console.log('wrote ' + out); }
  if (!dry) {
    const budget = readJson(BUDGET_FILE, null);
    const live = readJson(LIVE_FILE, null);
    const next = writer.applyMeasured(budget, live, rows, today());
    const bad = writer.problems({ budget, live }, next);
    if (bad.length) throw new Error('the writer would make things worse (nothing written to the budget): ' + bad.join('; '));
    fs.writeFileSync(BUDGET_FILE, writer.serialiseBudget(next.budget));
    fs.writeFileSync(LIVE_FILE, writer.serialiseLive(next.live));
    console.log('lines written: ' + next.changed.length + ' · not accepted as measurements: ' + next.refused.length);
  }
  console.log('measured ' + summary.measured + ' · unreached ' + summary.unreached + ' · requests ' + state.n);
}

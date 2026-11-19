/**
 * tools/sim-load-api.cjs — THE API THE LOADER DRIVES: started in this process on a free local port, called over fetch, its ledger hooks awaited.
 * OWNS      startApi (env the in-process api needs, server.js required, /health awaited), callApi · must (the one HTTP door and its stop-on-error), trackHooks · drain (every fire-and-forget ledger hook awaited before a day or month closes).
 * CALLED BY tools/sim-load.cjs (create(ctx) once, after the arguments are read and localOnly has passed).
 * FLOW      create({ API, API_DB, LOGIN_CODE, stopWith }) ──▶ startApi ──▶ callApi / must per request ──▶ drain before each close
 * OWNER     cb-qa
 * CARD      qa/sim-load
 * ⚠️ Local only: the host rule (localOnly) stays in sim-load.cjs and has already passed before create() is called; DATABASE_URL is set here from API_DB.
 */
'use strict';
const path = require('path');
const netModule = require('net');
/* SEC-113: a sign-in without a device id is refused NO_DEVICE. One id for the whole process (same maker, env key and shape as tests/lib/truth-harness.cjs and scripts/seed-local.cjs; the web sends it as X-Device-Id, public/app/device-id.js) */
const DEVICE = process.env.CB_TEST_DEVICE || (process.env.CB_TEST_DEVICE = 'truth-harness-' + require('crypto').randomUUID().slice(0, 12));

/** a free local port, found by listening on 0 and letting go */
const freePort = () =>
  new Promise((ok) => {
    const server = netModule.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => ok(port));
    });
  });

/** the in-process api's environment: its own role when --api-db is given, a dev OTP, the shop clock allowed, a rate limit that lets a year of bills through */
function apiEnv({ API_DB, LOGIN_CODE }) {
  process.env.DATABASE_URL = API_DB; /* the api's own role (cb_app, RLS enforced) when --api-db is given; else the loader's */
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET = 'sim-load-local-only-secret-' + 'x'.repeat(24);
  process.env.DEV_OTP = LOGIN_CODE;
  process.env.SHOP_CLOCK_ALLOW = '1';
  process.env.HOST = '127.0.0.1';
  process.env.RLS_GUARD = process.env.RLS_GUARD || 'off';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
  process.env.RATE_LIMIT_MAX =
    process.env.RATE_LIMIT_MAX || '10000000'; /* server.js's 15-minute window (500) would refuse a year of bills — this api serves one caller, on this PC */
}

/** ask /health up to 100 times (200 ms apart) until the in-process server answers; true when it did */
async function waitHealthy(base) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const reply = await fetch(base + '/health');
      if (reply.ok) return true;
    } catch (notUpYet) {
      require('../lib/logger').fellBack('sim-load: the server is not answering yet — asking again', notUpYet, 'debug');
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return false;
}

/** one request to the in-process api: { status, b } (b = the JSON body, {} when there is none) */
async function request(base, urlPath, options) {
  const opt = options || {};
  const reply = await fetch(base + urlPath, {
    method: opt.method || 'GET',
    headers: Object.assign({ 'content-type': 'application/json', 'x-device-id': DEVICE }, opt.token ? { authorization: 'Bearer ' + opt.token } : {}, opt.headers || {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  let body = null;
  try {
    body = await reply.json();
  } catch (noBody) {
    require('../lib/logger').fellBack('sim-load: the reply had no JSON body — read as empty', noBody, 'debug');
  }
  return { status: reply.status, b: body || {} };
}

/** a reply that is an error stops the loader, in words; otherwise the reply */
const must = (reply, what) => {
  if (reply.status >= 300) {
    console.error('\n  sim-load stopped at ' + what + ': HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 400) + '\n');
    process.exit(1);
  }
  return reply;
};

/** the ledger hook is fire-and-forget inside the route; wrap it so every call is kept in `pending` until it settles */
function trackHooks(API, pending) {
  const booksHooks = require(path.join(API, 'lib', 'books-hooks'));
  const orig = booksHooks.afterChit;
  booksHooks.afterChit = function () {
    const promise = Promise.resolve(orig.apply(this, arguments));
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  };
}

/** wait until every tracked hook has settled (before a day or a month closes) */
async function drainAll(pending) {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** the door: its functions share one base URL and one set of pending hooks */
function create({ API, API_DB, LOGIN_CODE, stopWith }) {
  let base = '';
  const pending = new Set();
  /** set the environment, pick a port, require server.js and wait for /health (the loader stops with words when it never answers) */
  async function startApi() {
    apiEnv({ API_DB, LOGIN_CODE });
    const port = await freePort();
    process.env.PORT = String(port);
    base = 'http://127.0.0.1:' + port;
    require(path.join(API, 'server.js'));
    if (!(await waitHealthy(base))) stopWith('the api did not answer /health on ' + base);
  }
  return {
    startApi,
    callApi: (urlPath, options) => request(base, urlPath, options),
    must,
    trackHooks: () => trackHooks(API, pending),
    drain: () => drainAll(pending),
    base: () => base
  };
}
module.exports = { create, must, request, waitHealthy, trackHooks, drainAll };

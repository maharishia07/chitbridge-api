/**
 * tools/sim-load-api.cjs — THE API THE LOADER DRIVES: started in this process on a free local port, called over fetch, its ledger hooks awaited.
 * OWNS      startApi (env the in-process api needs, server.js required, /health awaited), callApi · must (the one HTTP door and its stop-on-error), trackHooks · drain (every fire-and-forget ledger hook awaited before a day or month closes).
 * CALLED BY tools/sim-load.cjs (create(ctx) once, after the arguments are read and localOnly has passed).
 * FLOW      create({ API, API_DB, LOGIN_CODE, die }) ──▶ startApi ──▶ callApi / must per request ──▶ drain before each close
 * CARD      qa/sim-load
 * ⚠️ Local only: the host rule (localOnly) stays in sim-load.cjs and has already passed before create() is called; DATABASE_URL is set here from API_DB.
 */
'use strict';
const path = require('path');
const netModule = require('net');

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

function create({ API, API_DB, LOGIN_CODE, die }) {
  let base = '';
  async function startApi() {
    apiEnv({ API_DB, LOGIN_CODE });
    const port = await freePort();
    process.env.PORT = String(port);
    base = 'http://127.0.0.1:' + port;
    require(path.join(API, 'server.js'));
    for (let index = 0; index < 100; index++) {
      try {
        const reply = await fetch(base + '/health');
        if (reply.ok) return;
      } catch (notUpYet) {
        require('../lib/logger').fellBack('sim-load: the server is not answering yet — asking again', notUpYet, 'debug');
      }
      await new Promise((ok) => setTimeout(ok, 200));
    }
    die('the api did not answer /health on ' + base);
  }
  async function callApi(urlPath, options) {
    const opt = options || {};
    const reply = await fetch(base + urlPath, {
      method: opt.method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json' }, opt.token ? { authorization: 'Bearer ' + opt.token } : {}, opt.headers || {}),
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    let body = null;
    try {
      body = await reply.json();
    } catch (_) {
      /* no body */
    }
    return { status: reply.status, b: body || {} };
  }
  const must = (reply, what) => {
    if (reply.status >= 300) {
      console.error('\n  sim-load stopped at ' + what + ': HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 400) + '\n');
      process.exit(1);
    }
    return reply;
  };
  /* the ledger hook is fire-and-forget inside the route; here every one is awaited before a day or a month closes */
  const pending = new Set();
  function trackHooks() {
    const booksHooks = require(path.join(API, 'lib', 'books-hooks'));
    const orig = booksHooks.afterChit;
    booksHooks.afterChit = function () {
      const promise = Promise.resolve(orig.apply(this, arguments));
      pending.add(promise);
      promise.finally(() => pending.delete(promise));
      return promise;
    };
  }
  async function drain() {
    while (pending.size) await Promise.allSettled([...pending]);
  }
  return { startApi, callApi, must, trackHooks, drain, base: () => base };
}
module.exports = { create };

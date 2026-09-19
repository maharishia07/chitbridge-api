'use strict';
/**
 * write-limits.test.js — A DOOR THAT WRITES IN BULK IS RATE-LIMITED ([TILL-112]).
 *
 * Athi, 2026-09-19: *"how do we control spam… we may have to see how to control pollution."*
 *
 * ── ⚠️⚠️⚠️ THE GAP THIS EXISTS TO STOP REOPENING ─────────────────────────────────────────────────────────────
 *
 * `catalogueLimiter` (60 per 15 min) was mounted on /api/catalogue. The catalogue IMPORT lives at
 * /api/products, which had only the global limiter of **500 per 15 min** — and each of those requests may
 * write up to 2000 products. One key, one quarter of an hour, a million rows. /api/products was also the only
 * one of its siblings (offers · pricing · invoice · integrations · till) with no serviceLimiter at all.
 *
 * Nothing said so. That is the whole problem: a missing limiter is invisible, because the route works.
 *
 * ⭐ SO THE RULE IS ABOUT THE SHAPE, not about the two routes that were wrong today: **a route that can write
 * many records in one request must be behind a limiter of its own.** The next bulk door is caught the day it
 * is written. [[feedback-silence-is-the-bug]]
 *
 * ⚠️ IT IS DELIBERATELY NOT "every router must have a limiter". Most routers carry the global one and that is
 * a reasonable default for a route that writes one row; demanding more of all thirty would be ceremony, and a
 * guard that is mostly noise gets suppressed. Bulk is the line, because bulk is where the damage scales.
 *
 * Run: node tests/write-limits.test.js   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const server = fs.readFileSync(path.join(API, 'server.js'), 'utf8');

console.log('— a door that writes in bulk is limited —');

/**
 * ⚠️ THE BULK DOORS, DECLARED — and each one is a route that can write MANY records from ONE request. This is
 * a judgement (which doors are bulk) checked against a fact (are they limited), which is the shape this
 * codebase prefers to a list that claims both.
 */
const BULK = [
  { file: 'routes/products.js', route: "router.post('/import'", why: 'writes up to IMPORT_MAX_ROWS products from one file' },
  { file: 'routes/products.js', route: "router.post('/import/preflight'", why: 'parses a whole uploaded file, up to 4 MB' },
  { file: 'routes/products.js', route: "router.post('/bulk'", why: 'writes up to BULK_MAX products in one request' },
  { file: 'routes/till.js', route: "router.post('/catalogue'", why: 'mints a whole starter catalogue, or commits an uploaded list' },
];

/**
 * ⚠️⚠️ A ROUTER MOUNTED WITHOUT A LIMITER LEAVES ITS BULK DOORS ON THE GLOBAL 500/15min. That is what happened
 * to /api/products, so the mount is checked as well as the route.
 */
it('⚠️⚠️ every router holding a bulk door is mounted with a limiter', () => {
  const routers = [...new Set(BULK.map((b) => b.file.replace('routes/', '').replace('.js', '')))];
  for (const r of routers) {
    const re = new RegExp("app\\.use\\('/api/" + r + "',\\s*([A-Za-z]+)", '');
    const m = re.exec(server);
    assert.ok(m, '/api/' + r + ' is not mounted in server.js under that name');
    assert.ok(/Limiter|limiter/.test(m[1]),
      '/api/' + r + ' is mounted as `' + m[1] + '` with no limiter — its bulk routes fall back to the global '
      + '500 per 15 minutes, and each request there writes many rows');
  }
});

/** ⭐ and the expensive doors carry one of their own, tighter than the router's */
it('⚠️⚠️⚠️ each bulk door carries its own limiter', () => {
  const missing = [];
  for (const b of BULK) {
    const src = fs.readFileSync(path.join(API, b.file), 'utf8');
    const at = src.indexOf(b.route);
    assert.ok(at > 0, b.route + ' is gone from ' + b.file + ' — this guard is measuring nothing');
    /* the middleware list is everything up to the handler — one line is enough to see it */
    const line = src.slice(at, src.indexOf('\n', src.indexOf('=>', at)) + 1);
    if (!/[Ll]imiter/.test(line)) missing.push(b.file + ' ' + b.route + ' — ' + b.why);
  }
  assert.deepStrictEqual(missing, [],
    'these write many records per request and have no limiter of their own');
});

/**
 * ⚠️⚠️ KEYED BY THE API KEY, NOT THE IP, and that is not a detail. Several counters of one shop sit behind one
 * broadband line, and so do two unrelated shops in the same market. An IP-keyed limit either punishes a busy
 * shop for its own second counter, or lets one shop exhaust another's allowance.
 */
it('⚠️⚠️ the limits are keyed by the key, not by the address', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'products.js'), 'utf8');
  assert.ok(/keyGenerator/.test(src), 'the import limiters no longer say what they are keyed by');
  assert.ok(/x-api-key/.test(src), 'the import limiters are keyed by IP alone — one NAT is now one shop');
  /* the same choice the house already made for its service limiter */
  assert.ok(/x-api-key/.test(server), 'server.js serviceLimiter has stopped keying by the API key');
});

/** ⭐ and every limit is env-overridable, so a real shop that trips one is let through without a deploy */
it('⭐ the numbers can be raised without a deploy', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'products.js'), 'utf8');
  for (const v of ['IMPORT_PREFLIGHT_MAX', 'IMPORT_COMMIT_MAX'])
    assert.ok(src.indexOf(v) > 0, v + ' is not overridable — a shop that trips it needs a release');
});

console.log(pass + ' checks');

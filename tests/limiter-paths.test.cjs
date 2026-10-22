/**
 * tests/limiter-paths.test.cjs — M07 (IAM §35): EVERY PUBLIC DOOR HAS A LIMITER.
 *
 * An INVENTORY, not a spot check. The REAL server.js is loaded (database stubbed, listen() made a no-op), its Express router
 * stacks are walked, and every route reachable with NO credential middleware in front of it is listed. Each one must have
 * a rate limiter of its own in front of it. The blanket /api limiter (500 per 15 min) does NOT count: it is a floor for
 * the whole API, far too wide to blunt OTP / code guessing.
 *
 * "Public" here means: no auth middleware in the chain (middleware/auth, customerAuth, requireScope, admin, ...).
 * A route that authenticates INSIDE its handler (till pair/claim, ctp deliver) looks public from the outside — and is.
 *
 * Run: node tests/limiter-paths.test.cjs · no network, no DB.
 */
'use strict';
const path = require('path');
const assert = require('assert');
const Module = require('module');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-limiter-paths';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

/* ── database: nothing answers (the one stub, tools/load-app.cjs) ────────────────────────────────────────────── */
const { stubDatabase, loadApp, leavesOf } = require(path.join(API, 'tools', 'load-app.cjs'));
stubDatabase();

/* ── tag every limiter the code builds, so the walk can tell a limiter from any other middleware ─────────────── */
const rlPath = require.resolve('express-rate-limit', { paths: [API] });
const realRL = require(rlPath);
const factory = (realRL.rateLimit || realRL);
const tagged = function (opts) { const fn = factory(opts); fn.__limiter = opts || {}; return fn; };
Object.assign(tagged, realRL);
tagged.rateLimit = tagged; tagged.default = tagged;
require.cache[rlPath].exports = tagged;

/* ── server.js, without listening (tools/load-app.cjs) ───────────────────────────────────────────────────────── */
const app = loadApp();

const isGlobal = (fn) => !!fn.__limiter && /Please try again in 15 minutes/.test(JSON.stringify(fn.__limiter.message || ""));   // the blanket /api one
const GUARD_NAME = /^(auth|customerAuth|requireScope|admin|requireAdmin|authenticate|verifyToken|requireAuth|authed|requireRole)$/;
const guardish = (fn) => fn.__guard || GUARD_NAME.test(fn.name || '');

/** every leaf route, with the ordered middleware in front of it: [{method, path, chain:[fn...]}] (the walk is tools/load-app.cjs leavesOf) */
const leaves = leavesOf(app);

/* a chain entry is either a bare fn (route-level) or a {fn, mount} wrapper (use-level) */
const norm = (e) => (typeof e === 'function' ? { fn: e, always: true } : e);
const covers = (e, p) => e.always || e.layer.match(p.slice(e.prefix.length) || '/') === true;
function limitersFor(leaf) {
  return leaf.chain.map(norm).filter((e) => e.fn.__limiter && covers(e, leaf.path)).filter((e) => !isGlobal(e.fn));
}
function guardedBy(leaf) {
  return leaf.chain.map(norm).some((e) => guardish(e.fn) && covers(e, leaf.path));
}

/* ── the two doors that are public and deliberately without a limiter, each with its reason ───────────────────── */
const EXEMPT = {
  'OPTIONS *': 'the CORS preflight — carries no body and reaches no handler of ours',
  'GET /health': 'the platform health probe — throttling it would make a busy hour look like an outage',
};

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log("  FAIL " + what + " :: " + e.message); process.exitCode = 1; } };

const doors = leaves.filter((l) => !guardedBy(l));
const key = (l) => l.method + ' ' + l.path;
const maxOf = (l) => limitersFor(l).map((e) => e.fn.__limiter.max);
const find = (m, p) => leaves.find((l) => l.method === m && l.path === p);

console.log('— public doors (no credential middleware), and the limiter in front of each —');
doors.forEach((l) => console.log('   ' + key(l).padEnd(58) + (EXEMPT[key(l)] ? 'exempt' : 'limit ' + maxOf(l).join(' + '))));
console.log('   ' + doors.length + ' public doors of ' + leaves.length + ' routes');

it('the walk found the doors it must find (a walk that finds nothing would pass everything)', () => {
  assert.ok(leaves.length > 300, 'only ' + leaves.length + ' routes walked');
  ['POST /api/till/pair/claim', 'POST /api/signin/ask', 'POST /api/signin/verify', 'GET /api/actors/check-login',
   'POST /api/catalogue/:bridge_id/login/verify', 'POST /api/entities/register', 'POST /api/actors/login']
    .forEach((k) => assert.ok(doors.some((l) => key(l) === k), k + ' not found as a public door'));
});

it('every public door has a limiter of its own in front of it (the blanket /api one does not count)', () => {
  const bare = doors.filter((l) => !EXEMPT[key(l)] && !limitersFor(l).length).map(key);
  assert.deepStrictEqual(bare, [], 'public doors with no limiter: add one in server.js (auth-type: authLimiter; reads: publicLimiter)');
});

it('the exemptions are real doors (a stale exemption would quietly permit whatever takes that path next)', () => {
  Object.keys(EXEMPT).forEach((k) => assert.ok(doors.some((l) => key(l) === k), k + ' is no longer a public door'));
});

it('device pairing, key@Name lookup and storefront sign-in sit behind the STRICT auth budget (<= 30 per 15 min)', () => {
  ['POST /api/till/pair/claim', 'POST /api/catalogue/:bridge_id/login/verify',
   'POST /api/signin/ask', 'POST /api/signin/verify', 'POST /api/signin/pin', 'POST /api/entities/register',
   'POST /api/entities/verify', 'POST /api/actors/login', 'POST /api/actors/set-pin'].forEach((k) => {
    const [m, p] = [k.split(' ')[0], k.slice(k.indexOf(' ') + 1)];
    const l = find(m, p); assert.ok(l, k + ' not found');
    assert.ok(limitersFor(l).some((e) => e.fn.__limiter.max <= 30 && e.fn.__limiter.windowMs === 15 * 60 * 1000), k + ' has no strict limiter: ' + maxOf(l));
  });
});

it('check-login has its OWN 120 per 15 min limiter and is NOT on the shared auth budget', () => {
  const l = find('GET', '/api/actors/check-login'); assert.ok(l);
  const ls = limitersFor(l).map((e) => e.fn.__limiter);
  assert.strictEqual(ls.length, 1, 'expected exactly one limiter: ' + maxOf(l));
  assert.ok(ls[0].max === 120 && ls[0].windowMs === 900000);
  const ask = limitersFor(find('POST', '/api/signin/ask'))[0];
  assert.notStrictEqual(limitersFor(l)[0].fn, ask.fn, 'check-login shares the auth limiter instance');
});

it('limits that already existed are unchanged: auth 30/15min, catalogue 60/15min, assist 40/15min, services 240/min', () => {
  const lim = (m, p) => limitersFor(find(m, p)).map((e) => e.fn.__limiter);
  assert.ok(lim('POST', '/api/signin/ask').some((o) => o.max === 30 && o.windowMs === 900000));
  assert.ok(lim('POST', '/api/catalogue/:bridge_id/order/start').some((o) => o.max === 60 && o.windowMs === 900000));
  assert.ok(lim('POST', '/api/assist').some((o) => o.max === 40 && o.windowMs === 900000));
  assert.ok(lim('GET', '/api/offers/kinds').some((o) => o.max === 240 && o.windowMs === 60000));
  assert.ok(lim('POST', '/api/ctp/deliver').some((o) => o.max === 120 && o.windowMs === 60000));
});

it('signed-in traffic is not throttled by the new limiters: renew / logout / sessions stay outside the auth budget', () => {
  ['POST /api/signin/renew', 'POST /api/signin/logout'].forEach((k) => {
    const l = find(k.split(' ')[0], k.split(' ')[1]);
    if (l) assert.ok(!limitersFor(l).length, k + ' must not carry a limiter: ' + maxOf(l));
  });
  const OWN = ['/api/till', '/api/offers', '/api/pricing', '/api/invoice', '/api/integrations', '/api/products', '/api/ctp', '/api/assist', '/api/catalogue', '/deliver', '/query'];
  const guarded = leaves.filter((l) => guardedBy(l) && !OWN.some((p) => l.path === p || l.path.startsWith(p + '/')));
  const M06 = ['POST /api/signin/pin', 'POST /api/actors/set-pin'];   // signed-in but PIN-guessing doors: M06 put them in authLimiter on purpose
  const newlyLimited = guarded.filter((l) => !M06.includes(key(l))).filter((l) => limitersFor(l).some((e) => e.fn.__limiter.max <= 30 || /Too many attempts/.test(JSON.stringify(e.fn.__limiter.message || ''))));
  assert.deepStrictEqual(newlyLimited.map(key), [], 'a signed-in route sits behind a strict public limiter');
});

console.log('  ' + pass + ' checks');
process.exit(process.exitCode || 0);

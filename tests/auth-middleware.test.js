/**
 * ── tests/auth-middleware.test.js · THE FILE 35 OTHERS TRUST ──────────────────────────────────────────────────
 *
 * Athi, 2026-09-11: *"do we have test cases for middleware as well?"* — and then, on finding auth.js was the most
 * depended-upon file in the API with almost nothing checking it: *"write the guards for auth.js."*
 *
 * ⚠️⚠️ 35 FILES REQUIRE THIS ONE. Two guards mentioned it and both only read the key SCOPE MAP — nothing ever
 * exercised a token being refused, an expired session, or the actor→entity resolution that decides WHOSE DATA a
 * request touches. Every one of those is a silent failure: an auth bug does not crash, it lets somebody through.
 *
 * ── ⭐⭐ NO DATABASE. `../db` IS STUBBED BEFORE auth.js LOADS ─────────────────────────────────────────────────
 *
 * The middleware reads the database twice — to confirm an API key is still listed, and to re-read an actor's hat
 * on every request. Both are replaced here with a stub that records what was asked. That is not a compromise:
 * it lets the test assert things a live database cannot be made to do on demand, like "the hat comes from the
 * DATABASE and never from the token, so a demotion takes effect on the next request rather than at expiry".
 *
 * ⚠️ AND THE TEST SIGNS ITS OWN TOKENS with the real secret, so nothing here is a mock of the thing being tested
 * — jwt.verify is the real one, and a token this file forges wrongly is refused by the real code.
 *
 * Run: node tests/auth-middleware.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const jwt = require('jsonwebtoken');

/* a secret for this process only — the real one is never needed and is never read from the environment */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-guards';

/* ── the stub, installed BEFORE auth.js is required ──────────────────────────────────────────────────────── */
const asked = [];
let DB_ROWS = [];
const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async (sql, params) => { asked.push({ sql: String(sql), params }); return { rows: DB_ROWS, rowCount: DB_ROWS.length }; },
    withEntity: async (id, fn) => fn({ query: async () => ({ rows: DB_ROWS, rowCount: DB_ROWS.length }) }),
    withTransaction: async (fn) => fn({ query: async () => ({ rows: DB_ROWS }) }),
    readBatch: async () => ({}),
    trySavepoint: async (_d, fn) => fn(),
  },
};
/* lib/schema asks the database what columns exist — stub it the same way */
const schemaPath = require.resolve('../lib/schema');
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) } };
const auth = require('../middleware/auth');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const ita = (what, fn) => fn().then(() => { pass++; console.log('  ok  ' + what); },
  (e) => { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; });

/* a request/response pair that records what the middleware did to it */
function call(token, opts) {
  const o = opts || {};
  const req = { headers: {}, method: o.method || 'GET', originalUrl: o.url || '/api/chits', path: o.url || '/api/chits' };
  if (token) req.headers.authorization = 'Bearer ' + token;
  if (o.apiKeyHeader) { delete req.headers.authorization; req.headers['x-api-key'] = token; }
  const out = { status: null, body: null, nexted: false };
  const res = { status: (n) => { out.status = n; return res; }, json: (b) => { out.body = b; return res; } };
  return auth(req, res, () => { out.nexted = true; }).then(() => ({ req, out }));
}
const sign = (claims, opts) => jwt.sign(claims, process.env.JWT_SECRET, Object.assign({ algorithm: 'HS256' }, opts || {}));

(async () => {
  console.log('— a request that has not proved who it is —');

  await ita('⭐⭐ no token is 401, and it does not call next()', async () => {
    const { out } = await call(null);
    assert.strictEqual(out.status, 401, 'a request with no Authorization header was not refused');
    assert.strictEqual(out.nexted, false, '⚠️ it called next() anyway — the route would run unauthenticated');
  });

  await ita('⭐⭐⭐ a token signed with the WRONG secret is refused', async () => {
    /* ⚠️ The whole platform rests on this one line. If a forged token were accepted, every RLS boundary below
       would be enforcing isolation between identities an attacker chose. */
    const forged = jwt.sign({ identity_id: 'x', identity_type: 'entity' }, 'not-the-secret', { algorithm: 'HS256' });
    const { out } = await call(forged);
    assert.strictEqual(out.nexted, false, 'A FORGED TOKEN WAS ACCEPTED');
    assert.strictEqual(out.status, 401);
  });

  await ita('⭐⭐⭐ the algorithm is pinned — "alg: none" is not a way in', async () => {
    /**
     * ⚠️⚠️ ALGORITHM CONFUSION. A verifier that accepts whatever the token claims will accept a token with no
     * signature at all. The code pins HS256 on purpose; this is what keeps it pinned.
     */
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ identity_id: 'x', identity_type: 'entity' })).toString('base64url');
    const { out } = await call(header + '.' + body + '.');
    assert.strictEqual(out.nexted, false, 'AN UNSIGNED TOKEN WAS ACCEPTED');
    /**
     * ⚠⚠ AND THE BEHAVIOURAL CHECK ABOVE IS NOT ENOUGH — RED-CHECKED AND IT DID NOT CATCH.
     *
     * Removing the pin from auth.js produced ZERO failures, because jsonwebtoken v9 refuses alg:none by
     * DEFAULT. So the test above proves the library behaves, not that we asked it to. The day that default
     * changes, or the day somebody swaps the library, the pin is the only thing standing there — and nothing
     * would have noticed it was gone.
     * ⭐ So the intent is asserted in the SOURCE as well. A behavioural test proves the outcome today; this
     * protects the decision.
     */
    const src = require("fs").readFileSync(path.join(__dirname, "..", "middleware", "auth.js"), "utf8");
    assert.ok(/algorithms:\s*\[\'HS256\'\]/.test(src),
      "the algorithm pin is gone from auth.js — the verifier now accepts whatever the token claims");
  });

  await ita('⚠️ an EXPIRED token is refused, and says so as its own case', async () => {
    /* ⚠️ An expired session and a bad one need different words: one means "sign in again", the other means
       "something is wrong". A single "Unauthorised" for both sends people to the wrong remedy. */
    const old = sign({ identity_id: 'e1', identity_type: 'entity' }, { expiresIn: '-1h' });
    const { out } = await call(old);
    assert.strictEqual(out.nexted, false, 'an expired token was accepted');
    assert.strictEqual(out.status, 401);
    assert.ok(out.body && /expir|sign in/i.test(JSON.stringify(out.body)),
      'an expired token is refused with no hint that signing in again is the fix: ' + JSON.stringify(out.body));
  });

  await ita('⚠️⚠️ a token that is not an IDENTITY token is refused', async () => {
    /**
     * ⚠️ A `sim_lead` marketing token happens to be signed with the same secret. Verifying the signature is not
     * enough — the payload has to BE an identity, or anything the platform ever signs becomes a login.
     */
    const other = sign({ lead_id: 'L1', kind: 'sim_lead' });
    const { out } = await call(other);
    assert.strictEqual(out.nexted, false, 'a NON-IDENTITY token signed with our secret was accepted as a login');
  });

  console.log('\n— whose data is this, which is the question the whole platform rests on —');

  it('⭐⭐⭐ entityOf() resolves an ACTOR to its parent, never to itself', () => {
    /**
     * ⚠️⚠️ GETTING THIS BACKWARDS gives a co-assist a private island of data inside a business — the difference
     * between an actor being STAFF and an actor being a TENANT. It had 47 copies before it lived here.
     */
    assert.strictEqual(
      auth.entityOf({ identity: { identity_id: 'actor-1', parent_entity_id: 'ent-9' } }), 'ent-9',
      'an actor resolved to ITSELF — its writes would land outside its employer');
    assert.strictEqual(
      auth.entityOf({ identity: { identity_id: 'ent-9', parent_entity_id: null } }), 'ent-9',
      'an entity did not resolve to itself');
  });

  console.log('\n— the hat comes from the DATABASE, never from the token —');

  await ita('⭐⭐⭐ an actor request re-reads the hat on EVERY request', async () => {
    /**
     * ⚠️⚠️ A HAT IN THE JWT WOULD MEAN an owner demoting somebody to view-only has NO EFFECT until that token
     * expires — the person keeps the access the owner just took away, for hours, with nothing to show it.
     * ⭐ So: the token may carry a hat and it must be IGNORED. This asserts the database was asked.
     */
    asked.length = 0;
    DB_ROWS = [{ identity_id: 'a1', hat: 'view_only', status: 'active', access_level: 'viewer' }];
    const t = sign({ identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1', hat: 'manager' });
    const { req } = await call(t);
    assert.ok(asked.length > 0, 'an actor request asked the database NOTHING — the hat came from the token');
    assert.notStrictEqual(req.identity && req.identity.hat, 'manager',
      'THE HAT CAME FROM THE TOKEN — a demotion would not take effect until the token expired');
  });

  await ita('⚠️ a REMOVED actor loses access on its next request, not at expiry', async () => {
    /* ⚠️ Stateless JWTs cannot be deleted server-side; re-reading the row IS the revocation. Without it, a
       dismissed co-assist keeps working for as long as their token lives. */
    asked.length = 0;
    DB_ROWS = [];                       // the actor's row is gone
    const t = sign({ identity_id: 'gone', identity_type: 'actor', parent_entity_id: 'e1' });
    const { out } = await call(t);
    assert.strictEqual(out.nexted, false, 'A REMOVED CO-ASSIST WAS STILL LET THROUGH');
  });

  console.log('\n— and the gate that runs INSIDE this file —');

  it('⭐⭐⭐ auth calls the hat gate itself — it is NOT mounted in server.js', () => {
    /**
     * ⚠️⚠️ I MISREAD THIS TODAY AND REPORTED IT AS DEAD CODE. `hat-gate.js` is required by no route and no
     * server file, so a grep of routes/ and server.js finds nothing — and it is called from HERE, line ~126,
     * inside auth. My search was narrower than the claim I made from it.
     *
     * ⭐ AND THE PLACEMENT IS THE DESIGN, not an accident: `app.use('/api', hatGate)` in server.js would do
     * NOTHING, because auth is applied per route and anything mounted at the app level runs before it, sees no
     * req.identity, and falls through. A permission gate that silently permits everything is the exact defect
     * it exists to close, one layer up.
     *
     * This guard exists so the next person to go looking finds the wiring instead of concluding what I did.
     */
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'middleware', 'auth.js'), 'utf8');
    assert.ok(/require\(['"]\.\/hat-gate['"]\)/.test(src),
      'auth no longer calls the hat gate — every authenticated write is now ungated');
    const gateSrc = require('fs').readFileSync(path.join(__dirname, '..', 'middleware', 'hat-gate.js'), 'utf8');
    assert.ok(/access\.canEdit\(req\.identity\)/.test(gateSrc),
      'the gate no longer asks lib/access what this identity may do');
    assert.ok(/MUTATING\.includes\(req\.method\)/.test(gateSrc),
      'the gate no longer limits itself to mutating methods');
  });

  it('⚠️ the gate FAILS CLOSED — an unknown route is refused for a restricted hat', () => {
    /* ⚠️ A route nobody thought about must REFUSE, not permit. A loud correctable failure beats a silent one,
       and failing open here costs a chit nobody meant to send. */
    const gateSrc = require('fs').readFileSync(path.join(__dirname, '..', 'middleware', 'hat-gate.js'), 'utf8');
    const tail = gateSrc.slice(gateSrc.indexOf('SELF_SCOPED_EXACT.some'));
    assert.ok(!/return next\(\)/.test(tail.slice(tail.indexOf('\n'))),
      'there is a next() after the allow-list — the gate now fails OPEN');
  });

  it('⚠️ the gate reads originalUrl, not path — it runs inside a mounted router', () => {
    /**
     * ⚠️⚠️ THIS ALMOST SHIPPED WRONG and the file says so: inside a mounted router `req.path` is relative to the
     * mount, so a PATCH to /api/entities/me/prefs arrives as /me/prefs and NONE of the full-path prefixes would
     * match. Because the gate fails closed, the symptom was a view-only co-assist unable to save their own
     * theme — correct-looking, unit-tested, and wrong in production only.
     */
    const gateSrc = require('fs').readFileSync(path.join(__dirname, '..', 'middleware', 'hat-gate.js'), 'utf8');
    assert.ok(/req\.originalUrl/.test(gateSrc), 'the gate reads req.path again — every self-scoped prefix will miss');
    assert.ok(/split\('\?'\)/.test(gateSrc), 'the query string is no longer stripped — /assist?x=1 will not match /assist');
  });

  console.log('\n  ' + pass + ' checks\n');
})();

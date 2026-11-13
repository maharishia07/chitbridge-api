/**
 * tests/ctr-245-ack-audience.test.cjs - CTR-245: the signed price ack (lib/price-moved) and a session token are NEVER interchangeable, both ways.
 *
 * OWNS      the proof that the ack carries aud 'cb-price-ack' and is read only with that audience, that a session token (no aud) and a token of the right kind but no aud are refused as an ack,
 *           and that an ack - even one that also carries a shop's identity claims, the worst case - is refused as a session by middleware/auth.js, middleware/customer-auth.js and
 *           middleware/idempotency.js (lib/jwt-verify refuses any token that names an audience when none is asked for). HS256 stays pinned (an HS384 ack is refused).
 * CALLED BY scripts/guards.cjs
 * FLOW      sign an ack with the real signAck -> verifyJwt with and without the audience -> each session door with a hybrid token -> 401 / null / throws
 * CARD      09-counter/README
 * MUTATION  checked: remove the audience from signAck, or the sessionOnly refusal from lib/jwt-verify -> the cross-use cases go red.
 * Run: node tests/ctr-245-ack-audience.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'ctr245-audience-secret';
const jsonWebToken = require('jsonwebtoken');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const moved = require(path.join(API, 'lib', 'price-moved'));
const { verifyJwt } = require(path.join(API, 'lib', 'jwt-verify'));
const found = { lines: [{ item_id: ITEM, kind: 'price_moved', changed_at: '2026-11-13T10:00:00.000Z' }] };
const ctx = { draft: 'D1', actor: SHOP };
const ack = moved.signAck(found, ctx);
const claimsOfAck = jsonWebToken.decode(ack);
const secret = process.env.JWT_SECRET;
const session = jsonWebToken.sign({ identity_id: SHOP, identity_type: 'entity', jti: 'j1' }, secret, { algorithm: 'HS256', expiresIn: 600 });
/* the worst case: an ack that ALSO carries a shop's identity, so the only thing left to refuse it is its audience */
const hybrid = jsonWebToken.sign({ kind: 'price_ack', identity_id: SHOP, identity_type: 'entity', parent_entity_id: SHOP }, secret, { algorithm: 'HS256', audience: moved.ACK_AUDIENCE, expiresIn: 300 });
const hybridCustomer = jsonWebToken.sign({ identity_id: SHOP, identity_type: 'customer' }, secret, { algorithm: 'HS256', audience: moved.ACK_AUDIENCE, expiresIn: 300 });

(async () => {
  ok('the real ack names its audience cb-price-ack and its kind', claimsOfAck.aud === 'cb-price-ack' && claimsOfAck.kind === 'price_ack' && claimsOfAck.draft === 'D1', JSON.stringify(claimsOfAck));
  ok('the ack verifies with its audience, and is a good ack for its draft and person', verifyJwt(ack, { audience: 'cb-price-ack' }).claims.actor === SHOP && moved.ackVerdict(ack, found, ctx).ok === true, '');
  ok('asked as a SESSION (no audience given) the ack is refused by the one verifier', !!throws(() => verifyJwt(ack)), '');
  ok('a session token is refused as an ack (no audience, wrong kind)', moved.ackVerdict(session, found, ctx).ok === false, '');
  const noAud = jsonWebToken.sign({ kind: 'price_ack', draft: 'D1', actor: SHOP, lines: [{ item_id: ITEM, changed_at: found.lines[0].changed_at }] }, secret, { algorithm: 'HS256', expiresIn: 300 });
  ok('a token of the right kind and claims but NO audience is refused as an ack', moved.ackVerdict(noAud, found, ctx).ok === false, '');
  const otherAud = jsonWebToken.sign({ kind: 'price_ack', draft: 'D1', actor: SHOP, lines: [{ item_id: ITEM, changed_at: found.lines[0].changed_at }] }, secret, { algorithm: 'HS256', audience: 'something-else', expiresIn: 300 });
  ok('a token for another audience is refused as an ack', moved.ackVerdict(otherAud, found, ctx).ok === false, '');
  const hs384 = jsonWebToken.sign({ kind: 'price_ack', draft: 'D1', actor: SHOP, lines: [{ item_id: ITEM, changed_at: found.lines[0].changed_at }] }, secret, { algorithm: 'HS384', audience: moved.ACK_AUDIENCE, expiresIn: 300 });
  ok('HS256 stays pinned: an HS384 ack is refused', moved.ackVerdict(hs384, found, ctx).ok === false, '');
  ok('a session token still verifies as a session (no change for sign-in)', verifyJwt(session).claims.identity_id === SHOP, '');

  /* the ack as a session, at each door */
  const authMiddleware = require(path.join(API, 'middleware', 'auth'));
  const answer = { locals: {}, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {}, set() {}, getHeader() {} };
  let nexted = false;
  await authMiddleware({ headers: { authorization: 'Bearer ' + hybrid }, method: 'GET', originalUrl: '/api/x', path: '/x', ip: '127.0.0.1', get() { return ''; } }, answer, () => { nexted = true; });
  ok('middleware/auth.js: an ack carrying identity claims is refused as a session (401, never passed on)', answer.code === 401 && !nexted, JSON.stringify([answer.code, nexted]));
  const customerOf = require(path.join(API, 'middleware', 'customer-auth')).customerOf;
  const asCustomer = typeof customerOf === 'function' ? throws(() => customerOf(hybridCustomer)) : null;
  const customerAnswer = { locals: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let customerNext = false;
  if (!asCustomer) await require(path.join(API, 'middleware', 'customer-auth'))({ headers: { authorization: 'Bearer ' + hybridCustomer } }, customerAnswer, () => { customerNext = true; });
  ok('middleware/customer-auth.js: an ack carrying customer claims is refused (throws or 401, never passed on)', (!!asCustomer || customerAnswer.code === 401) && !customerNext, JSON.stringify([!!asCustomer, customerAnswer.code, customerNext]));
  const scoped = require(path.join(API, 'middleware', 'idempotency'))._scope({ headers: { authorization: 'Bearer ' + hybrid } });
  ok('middleware/idempotency.js: an ack names no entity to scope a replay to', scoped === null || scoped === undefined, JSON.stringify(scoped));
  const sessionScoped = require(path.join(API, 'middleware', 'idempotency'))._scope({ headers: { authorization: 'Bearer ' + session } });
  ok('middleware/idempotency.js: a session still scopes to its entity', sessionScoped === SHOP, JSON.stringify(sessionScoped));

  console.log(`\n  ${pass} passed, ${fail} failed · ${pass + fail} checks\n`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('   FAIL the harness threw: ' + (e && e.stack)); process.exitCode = 1; });

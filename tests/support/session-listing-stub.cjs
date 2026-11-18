'use strict';
/*
 * SEC-113 test support (18 Nov 2026): a person's sign-in now OPENS a listed session (lib/person-session open) and every later call re-reads the listing (deviceListed).
 * The offline sign-in tests stub the database by SQL and were written before that, so their stub never answers the listing and the door answers 503 SESSION_NOT_LISTED.
 * This swaps ONLY those two functions for an in-memory list (same shape, same lifeOf/surfaceOf); the sign-in logic under test, the token and the middleware stay real.
 * The listing itself is proven where it lives: tests/person-session.test.cjs, tests/signin-sessions-routes.test.cjs. Needs no database. Load it before the first sign-in call.
 */
const crypto = require('crypto');
const S = require('../../lib/person-session');
const listed = new Map();
S.open = async (_withTransaction, shop, o) => {
  const surface = S.surfaceOf(o && o.surface), t = Math.floor(Date.now() / 1000);
  const session = { jti: crypto.randomUUID(), iat: t, exp: t + S.lifeOf(surface), surface, device_id: o.device_id };
  listed.set(session.jti, session);
  return session;
};
S.deviceListed = async (_query, _shop, _device, jti) => (listed.has(String(jti)) ? { ok: true, surface: listed.get(String(jti)).surface, counter: null } : { ok: false, code: 'SESSION_EXPIRED' });
module.exports = { listed };

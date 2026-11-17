// CALLED BY routes/catalogue.js, routes/privacy.js.
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * customer-auth.js — the STOREFRONT CUSTOMER's authenticated surface.
 *
 * Athi, 2026-07-30: "yes, customers should have an authenticated surface."
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────────────
 * `middleware/auth.js` fails closed on anything that is not `entity` or `actor` (S1 hardening, 2026-07-13). That is
 * correct for the business surface, and it left the storefront customer with NO authenticated route at all. The
 * security review found the consequence: a customer's per-copy document row — their own filed tax return — had no
 * reader and no delete path. Write-only orphaned PII, in a system whose stated principle is per-copy independence.
 *
 * ── WHY IT IS A SEPARATE MIDDLEWARE, NOT A WIDENING OF auth.js ───────────────────────────────────────────────
 * Widening auth.js would let a customer token reach EVERY business route by default, and each new route would have
 * to remember to exclude it. That is exactly backwards: this middleware accepts ONLY `identity_type === 'customer'`
 * and is mounted only on routes written for a customer. A customer token cannot reach a business route, and a
 * business token cannot reach a customer route — neither by accident nor by omission.
 *
 * ── WHAT A CUSTOMER MAY DO ───────────────────────────────────────────────────────────────────────────────────
 * Read their own orders, read their own copy of a document they submitted, and delete that copy. Nothing else.
 * Every read is scoped to `identity_id` (their own per-copy rows under RLS) — never to the shop's copies.
 */
const { verifyJwt } = require('../lib/jwt-verify'); // E10 — the ONE verifier

/** customerOf(token) → the customer a token proves ({ identity_id, bridge_id, shop_entity_id, display_name }), or null — the ONE reading of a customer token */
function customerOf(token) {
  const decoded = verifyJwt(token).claims;
  // FAIL CLOSED: this surface is for customers ONLY. An entity or actor token is rejected on purpose, so the two surfaces can never be confused for one another.
  if (!decoded.identity_id || decoded.identity_type !== 'customer') return null;
  return {
    identity_id: decoded.identity_id,
    bridge_id: decoded.bridge_id || null,
    // the SHOP this customer belongs to. Storefront identities are per-shop by design (crHandle), so this scopes every customer query to the one shop they transacted with.
    shop_entity_id: decoded.parent_entity_id || null,
    display_name: decoded.display_name || null
  };
}
/** express middleware: verifies the storefront customer bearer token and sets req.customer, else a 401 */
function customerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Unauthorised', message: 'Sign in to view this' });
  try {
    // Same algorithm pin as auth.js — never trust the token's own `alg`.
    const customer = customerOf(token);
    if (!customer) return res.status(401).json({ error: 'Unauthorised', message: 'Invalid token' });
    req.customer = customer;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Unauthorised', message: 'Invalid or expired token' });
  }
}
/** customerAuth.soft(req) → the signed-in customer, or null (a stranger) — never throws, never answers; a public door's way to serve a customer more (SEC-149: the one soft reader of a customer token) */
customerAuth.soft = (req) => {
  const header = (req && req.headers && req.headers.authorization) || '';
  try {
    return header.startsWith('Bearer ') ? customerOf(header.slice(7).trim()) : null;
  } catch (notOurToken) {
    require('../lib/logger').fellBack('customer-auth soft: the token did not verify — read as a stranger', notOurToken, 'debug'); /* a missing, bad or expired token is simply anonymous on a public read */
    return null;
  }
};
module.exports = customerAuth;

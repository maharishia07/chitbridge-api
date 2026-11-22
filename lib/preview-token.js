'use strict';
/**
 * lib/preview-token.js — THE OWNER'S PREVIEW TOKEN (CUSTOMER-DELINK 2, Athi 21 Nov 2026): a 15-minute key for ONE shop that opens ONE read, the shop's own preview.
 *
 * OWNER     cb-security
 * RISK      security
 * OWNS      mint(shopId) → { token, expires_in } · the claims' names (AUDIENCE, KIND, TTL_S) · claimsFit(claims, shopId) the reader's test
 * CALLED BY routes/entities.js (POST /me/preview-token mints) · middleware/auth.js (auth.previewIdentity reads: the ONE place a bearer is judged)
 * FLOW      the staff session asks → mint → the web hands ONLY this token to the customer page (cb_preview@<shop>) → GET /api/catalogue/:shop?preview=1 reads it → every other door refuses it
 * CARD      10-online-shop-and-storefront-orders/functions/the-online-shop-public-page
 *
 * ⚠️ WHY IT CANNOT OPEN ANOTHER DOOR: it carries aud 'cb-shop-preview', so lib/jwt-verify.js refuses it for every caller that does not name that audience (auth, customer-auth, idempotency:
 *    the same fence as the price ack, CTR-245), and it has no identity_id and no identity_type, so even a reader that skipped the audience would find no identity in it. The one reader that names
 *    the audience is auth.previewIdentity, and it answers a read of THIS shop's catalogue with ?preview=1, as a cost-blind owner view; nothing else.
 * ⚠️ It is a read key, never a session: no jti listing, no device. It lives TTL_S at most (the reader refuses a longer-lived one), and dies with the business (a closed or erased shop is a stranger to it).
 */
const jsonWebToken = require('jsonwebtoken');

const AUDIENCE = 'cb-shop-preview';
const KIND = 'shop_preview';
const TTL_S = 15 * 60;

/** mint(shopId) → the token for this shop's preview; shopId is the caller's own entity (auth.entityOf), never a body value */
function mint(shopId) {
  const token = jsonWebToken.sign({ kind: KIND, shop: String(shopId), jti: require('crypto').randomUUID() }, process.env.JWT_SECRET, { algorithm: 'HS256', audience: AUDIENCE, expiresIn: TTL_S });
  return { token, expires_in: TTL_S };
}

/** claimsFit(claims, shopId) → true only for a preview claim set made for THIS shop and short-lived (a longer-lived token is not one of ours) */
function claimsFit(claims, shopId) {
  return !!claims && claims.kind === KIND && !!shopId && String(claims.shop) === String(shopId) && Number(claims.exp) - Number(claims.iat) <= TTL_S;
}

module.exports = { mint, claimsFit, AUDIENCE, KIND, TTL_S };

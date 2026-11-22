/**
 * auth-preview.js — the owner's PREVIEW token read (a part of auth.js, split out to keep its size row)
 * OWNER     cb-security (sessions) with cb-network (the shop window preview)
 * RISK      security (a token that opens a shop read; any doubt must be a stranger)
 * OWNS      previewIdentity(req, entity): the bearer is a preview token made for THIS shop and the business is open → a cost-blind owner view, else null (never throws)
 * CALLED BY middleware/auth.js (auth.previewIdentity, read by routes/catalogue.js GET /:bridge?preview=1)
 * FLOW      catalogue read with ?preview=1 ──▶ the bearer audience and shop checked ──▶ the business open ──▶ the cost-blind identity
 * CARD      18-identity-sign-in-and-access/sessions-and-devices
 */
'use strict';
const { verifyJwt } = require('../lib/jwt-verify');
const { query } = require('../db');
const { businessEnded } = require('../lib/business-status');
/**
 * previewIdentity(req, entity) → the owner's PREVIEW of THIS shop, or null — CUSTOMER-DELINK 2 (lib/preview-token.js). For the one read that serves a shop's preview
 * (GET /api/catalogue/:bridge?preview=1) and nothing else: the bearer must be a preview token (aud cb-shop-preview, so `auth` and every other reader refuse it as a session),
 * made for THIS shop, unexpired, and the business must be open. The shape is a cost-blind owner view (can_see_costs false: a link handed to a customer page never carries the buying side).
 * Never throws; any doubt is a stranger.
 */
const isPreviewRead = (req, entity) => !!req && !!entity && req.method === 'GET' && !!req.query && req.query.preview === '1';
/** the bearer's preview claims when it is a preview token made for THIS shop, else null (a bad signature throws; the caller reads that as a stranger) */
function previewClaimsOf(req, entity) {
  const header = String((req.headers && req.headers.authorization) || '');
  if (!header.startsWith('Bearer ')) return null;
  const claims = verifyJwt(header.slice(7).trim(), { audience: require('../lib/preview-token').AUDIENCE }).claims;
  return require('../lib/preview-token').claimsFit(claims, entity.identity_id) ? claims : null;
}
const previewIdentity = async (req, entity) => {
  try {
    if (!isPreviewRead(req, entity) || !previewClaimsOf(req, entity)) return null;
    if (await businessEnded(entity.identity_id, query)) return null;
    return { identity_id: entity.identity_id, bridge_id: entity.bridge_id, identity_type: 'entity', parent_entity_id: null, can_see_costs: false, preview_token: true };
  } catch (e) {
    require('../lib/logger').fellBack('auth previewIdentity: the preview token did not prove — read as a stranger', e, 'debug');
    return null; /* expired, bad signature, another audience: a stranger, as the shop has always answered a bad token */
  }
};
module.exports = { previewIdentity };

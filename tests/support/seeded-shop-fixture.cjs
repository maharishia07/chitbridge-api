'use strict';
/**
 * tests/support/seeded-shop-fixture.cjs (QA-178) — what the two realstack proofs (mark-notices-bell, sold-one-rule) need, made from the CI stack
 * (scripts/seed-local.cjs --demo-month: the Mayur demo shop with a month of posted trade) instead of a hand-picked SIT shop.
 * OWNS: resolving the shop (env id, else the demo shop by name), making a scratch audit firm with an agency edge to it, and the auditor grant
 *       through lib/books-grant.give (the same door POST /api/books-grants uses). No hand SQL beyond the identity rows the bell test already inserted.
 * CALLED BY tests/mark-notices-bell.realstack.cjs and tests/sold-one-rule.realstack.cjs when BO_ENTITY / FIRM_ID are not given.
 * RUN  in CI after the seed step: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/sold-one-rule.realstack.cjs
 */
const path = require('path');
const API = path.join(__dirname, '..', '..');
const DEMO_SHOP_NAME = 'Mayur Restaurant';

async function resolveShop(query, given) {
  const row = (await query(given
    ? 'SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = $1'
    : "SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_type = 'entity' AND display_name = $1 ORDER BY created_at LIMIT 1", [given || DEMO_SHOP_NAME])).rows[0];
  if (!row) throw new Error('fixture: no shop ' + (given || DEMO_SHOP_NAME) + ' (run scripts/seed-local.cjs --demo-month first)');
  return row;
}

/** a scratch firm and one auditor person under it, the firm made the shop's agency parent (the edge isGrantParentSql accepts) */
async function makeFirm(query, shop, run) {
  const net = require(path.join(API, 'src', 'services', 'network'));
  const bridgeId = 'CB' + run + 'p';
  const { rows: [firm] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AE', 'AED', $3) RETURNING identity_id, display_name", [bridgeId, 'Firm ' + run, bridgeId.toLowerCase()]);
  const { rows: [aud] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'AE', 'AED', $4, 'commenter', true, true, 'act') RETURNING identity_id, display_name", [bridgeId + 'u', 'Auditor ' + run, firm.identity_id, (bridgeId + 'u').toLowerCase()]);
  const nodeFirm = await net.nodeOf(firm.identity_id, { ensure: true }), nodeShop = await net.nodeOf(shop.identity_id, { ensure: true });
  await query("INSERT INTO cb_edge (parent_id, child_id, type, state) VALUES ($1, $2, 'agency', 'active')", [nodeFirm.id, nodeShop.id]);
  return { firm, auditor: aud, bridgeId };
}

/** the shop gives the firm the auditor preset through the lib door (consent is the route's check, so say it here too) */
async function grantAudit(shop, firm) {
  const grants = require(path.join(API, 'lib', 'books-grant.js'));
  return grants.give(shop.identity_id, shop.identity_id, { grantee: firm.identity_id, preset: 'auditor', purpose: 'audit of the books', consent: true });
}

module.exports = { resolveShop, makeFirm, grantAudit, DEMO_SHOP_NAME };

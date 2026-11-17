'use strict';
/**
 * lib/network-design-stores.js — the stores in my network that I am allowed to see, resolved once (the search and the store list share it).
 * OWNS      MAX_STORES · visibleStores (no route, no state)
 * CALLED BY routes/network-design.js (GET /stores and the availability search)
 * FLOW      membership.treeAndClientsOf -> identities read (<= MAX_STORES) -> the catalogue visibility rule -> { members, visible, truncated }
 * CARD      04-network/network-design-builder
 */
const { query } = require('../db');
const visibilityCap = require('./visibility-cap');
const catalogueView = require('./catalogue-view'); // ONE visibility rule — stock follows the catalogue's
const membership = require('./network-membership'); // who is in the network — one reader, fails loudly (T2-HONEST)

const MAX_STORES = 40;

/**
 * The stores in MY network that I am allowed to see, resolved once.
 *
 * Shared by the availability search and the store list so the two can never disagree about who is in the network
 * or who may be looked at — two answers to "which stores?" is how one of them quietly becomes wrong.
 */
async function visibleStores(meRow) {
  /* ⭐ one tree reader (lib/network-membership.treeOf); a failed read throws NETWORK_READ_FAILED — never "not in a network" */
  const members = await membership.treeAndClientsOf(meRow.bridge_id); /* a firm's clients (agency edges) are listed to the firm only */
  if (!members.length) return { members: [], visible: [], truncated: null };

  const truncated = members.length > MAX_STORES ? { asked: MAX_STORES, of: members.length } : null;
  const shown = members.slice(0, MAX_STORES);

  const ents = (
    await query(
      `SELECT identity_id, bridge_id, display_name, purpose, city, lat, lng, currency_code, service_km,
            dispatch_days, ship_within_days, ship_beyond_days, sort_order,
            catalogue_visibility, plan, params_override, business_status
       FROM identities
      WHERE bridge_id = ANY($1) AND identity_type = 'entity' AND status = 'active'`,
      [shown]
    )
  ).rows;

  const visible = ents.filter((item) => {
    const chosen = item.catalogue_visibility;
    if (chosen !== 'public' && chosen !== 'network') return false;
    if (catalogueView.isClosed(item)) return false; // NET-53: a closed shop is not listed in its network either
    const cap = visibilityCap.capOf({ plan: item.plan, paramsOverride: item.params_override || {} });
    return visibilityCap.RANK[visibilityCap.effective(chosen, cap)] > 0;
  });
  return { members: shown, visible, truncated };
}

module.exports = { MAX_STORES, visibleStores };

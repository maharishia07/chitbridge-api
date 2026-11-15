#!/usr/bin/env node
/**
 * net-9-joined-store-reads-network-only.test.cjs — NET-9 (proof 2026-11-15): a joined store reads a brand's network-only catalogue; a stranger does not.
 * @type regression
 * OWNS      the proof of lib/catalogue-view.catalogueVisibility for a catalogue set to `network`: a viewer the network says is in the same network (one active edge read through
 *           lib/network-membership.sameNetwork) sees it as `public`; a viewer it says is not, the anonymous storefront, and any viewer of a CLOSED shop see `private`; the
 *           membership question is ONE read of cb_entity + cb_edge (root equality and the suspended-edge check), asked with the viewer's and the owner's bridge ids; a failed
 *           membership read answers private, never open.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real catalogue-view and network-membership over a stand-in query.
 * FLOW      identities row (visibility network) + membership answer → catalogueVisibility({ viewer }) → public | private
 * CARD      04-network/network-storefront-network-store
 *   node tests/net-9-joined-store-reads-network-only.test.cjs
 */
'use strict';
const path = require('path');
const { API, ok, done } = require('./lib/cat-proof-kit.cjs');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const view = require(path.join(API, 'lib', 'catalogue-view.js'));
const OWNER = 'CB-BRAND-0001', JOINED = 'CB-STORE-0002', STRANGER = 'CB-OTHER-0009';
const cap = { capOf: () => ({ max: 'public' }) }; // the plan allows public, so only the chosen tier decides
const world = { business_status: 'open', membership: {}, membershipFails: false };
const calls = [];
const query = async (sql, params) => {
  calls.push({ sql: String(sql), params });
  if (/FROM identities WHERE identity_id/.test(sql)) return { rows: [{ catalogue_visibility: 'network', plan: 'free', params_override: {}, bridge_id: OWNER, business_status: world.business_status }] };
  if (/FROM cb_entity a, cb_entity b/.test(sql)) {
    if (world.membershipFails) throw new Error('cb_entity unreachable');
    return { rows: [{ same: world.membership[params[0]] === true }] };
  }
  return { rows: [] };
};
const log = require(path.join(API, 'lib', 'logger.js'));
const realFell = log.fellBack; log.fellBack = () => undefined;
const asked = (viewer) => view.catalogueVisibility({ entity_id: 'E-BRAND', query, visibilityCap: cap, viewer });

(async () => {
  world.membership = { [JOINED]: true, [STRANGER]: false };
  calls.length = 0;
  const joined = await asked(JOINED);
  const membershipReads = calls.filter((c) => /cb_entity/.test(c.sql));
  const stranger = await asked(STRANGER);
  const anon = await asked(null);
  world.membershipFails = true;
  const failed = await asked(JOINED);
  world.membershipFails = false;
  world.business_status = 'closed';
  const closed = await asked(JOINED);
  log.fellBack = realFell;
  ok('a joined store (same network, standing) reads the network-only catalogue as public', joined === 'public', joined);
  ok('a business outside the network sees it as private', stranger === 'private', stranger);
  ok('the anonymous storefront sees it as private', anon === 'private', anon);
  ok('the membership question is ONE read, over cb_entity and the cb_edge suspended check, with the viewer then the owner bridge id', membershipReads.length === 1 && /cb_edge/.test(membershipReads[0].sql) && /suspended/.test(membershipReads[0].sql) && /subpath/.test(membershipReads[0].sql) && JSON.stringify(membershipReads[0].params) === JSON.stringify([JOINED, OWNER]), JSON.stringify(membershipReads));
  ok('a failed membership read answers private (never open)', failed === 'private', failed);
  ok('a closed shop is private even to its own network (the shutter is above the tier)', closed === 'private', closed);
  done();
})();

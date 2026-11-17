/**
 * tests/con-54-storefront-presence.test.cjs — CON-54 · the storefront "away" sentence is fed by the connector actor's last_seen (silent_minutes); the shop's declared Open/Closed is untouched.
 * OWNS      the proof that lib/catalogue-view.js buildPublicView answers shop.connector = { last_seen, silent_minutes } from the connector heartbeat and leaves business_status alone.
 * CALLED BY scripts/guards.cjs (P2 PROOF pass 2026-11-14)
 * FLOW      stand-in db (one public shop, a connector actor last seen N minutes ago) → real buildPublicView → shop.connector / shop.business_status
 * CARD      23-connectors-and-integrations
 * Hand-computed: last_seen 30 min ago → silent_minutes 30 · last_seen 3 min ago → 3 · no connector actor → connector null · no last_seen → silent_minutes null · business_status stays 'open' in all four.
 */
'use strict';
const path = require('path');
const kit = require('./lib/cat-proof-kit.cjs');
const { ok, done, API } = kit;
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP = '5e5e5e5e-0000-4000-8000-000000000001';
let presence = { last_seen: null, n: 0 };
const answer = (sql, p) => {
  const s = String(sql).replace(/\s+/g, ' ');
  if (/SELECT catalogue_visibility, plan, params_override, bridge_id, business_status FROM identities/.test(s)) return { rows: [{ catalogue_visibility: 'public', plan: 'free', params_override: {}, bridge_id: 'shop-1', business_status: 'open' }] };
  if (/FROM entity_schemas/.test(s)) return { rows: [{ schema_id: 's1', schema_name: 'Default' }] };
  if (/SELECT item_id, item_data, created_at FROM catalogue_items WHERE entity_id = \$1/.test(s)) return { rows: [{ item_id: 'i1', item_data: { name: 'Tea', price: 50 }, created_at: '2026-10-01' }] };
  if (/SELECT storefront_access, policy_flags, country FROM identities/.test(s)) return { rows: [{ storefront_access: 'browse', policy_flags: {}, country: 'IN' }] };
  if (/MAX\(last_seen\) AS last_seen/.test(s)) return { rows: [presence] };
  return { rows: [], rowCount: 0 };
};
const { db, calls } = kit.standInDb(answer);
kit.mock('db', db);
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => true; sc.hasTable = async () => false;
const view = require(path.join(API, 'lib', 'catalogue-view.js'));
console.error = () => {};

const build = () => view.buildPublicView({
  entity: { identity_id: SHOP }, query: db.query, withEntity: db.withEntity, catalogueBuild: require(path.join(API, 'lib', 'catalogue-build')), orderInput: require(path.join(API, 'lib', 'order-input')),
  identity: require(path.join(API, 'lib', 'identity')), catalogueRead: require(path.join(API, 'lib', 'catalogue-read')),
  container: require(path.join(API, 'lib', 'container')), visibilityCap: require(path.join(API, 'lib', 'visibility-cap'))
});
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

(async () => {
  console.log('\nCON-54 · storefront presence from the connector heartbeat');
  presence = { last_seen: ago(30), n: 1 };
  let v = await build();
  ok('the view is available (the stand-in world is a public shop)', v.available !== false && !!v.shop, JSON.stringify(v).slice(0, 200));
  ok('connector last seen 30 min ago → silent_minutes 30', v.shop.connector && v.shop.connector.silent_minutes === 30, JSON.stringify(v.shop.connector));
  ok('declared Open/Closed is untouched by the silence: business_status stays "open"', v.shop.business_status === 'open', String(v.shop.business_status));
  presence = { last_seen: ago(3), n: 1 };
  v = await build();
  ok('connector last seen 3 min ago → silent_minutes 3 (a live kit)', v.shop.connector && v.shop.connector.silent_minutes === 3, JSON.stringify(v.shop.connector));
  presence = { last_seen: null, n: 0 };
  v = await build();
  ok('no connector actor → connector null (no away sentence is ever invented)', v.shop.connector === null, JSON.stringify(v.shop.connector));
  presence = { last_seen: null, n: 1 };
  v = await build();
  ok('a connector that never beat → silent_minutes null, business_status still "open"', v.shop.connector && v.shop.connector.silent_minutes === null && v.shop.business_status === 'open', JSON.stringify(v.shop.connector));
  ok('the presence read is the connector actors of THIS shop only (parent_entity_id = $1, connector_type set, active)', calls.some((c) => /parent_entity_id = \$1 AND identity_type = 'actor' AND connector_type IS NOT NULL AND break_status = 'active'/.test(c.sql.replace(/\s+/g, ' ')) && c.params[0] === SHOP));
  done();
})();

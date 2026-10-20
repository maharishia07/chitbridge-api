'use strict';
/**
 * lib/connector-rows.js — THE CONNECTORS THAT HAVE CHECKED IN, as one read (lifted from routes/integrations.js, SET-35 / T3-SETTINGS).
 * OWNS  the checked-in-connector statement (KIT_ROWS), its row shape (rowOut) and the one read (connectorsOf). CALLED BY routes/integrations.js (status · streams · paged list) and lib/home-facts.js (the Connectors card).
 * FLOW  entity id → KIT_ROWS (one query, newest check-in first) → rowOut per row (health from routes/connectors) → rows
 * CARD 28-platform-and-operations/home-facts
 *
 * A kit that runs beside Tally / Zoho / a folder of files is an ACTOR of the shop (identity_type 'actor', connector_type set); each heartbeat
 * stamps last_seen and connector_config. Two readers asked the same question of the same rows, and the Home card became the third, so the
 * statement and its row shape live here. The health rule is NOT here: routes/connectors.health stays the one (T2-HONEST).
 *   KIT_ROWS            the statement
 *   rowOut(row)         the shape every reader paints
 *   connectorsOf(id)    rows, most recently seen first (one query)
 */
const { query } = require('../db');
const { health } = require('../routes/connectors');

const KIT_ROWS = `SELECT identity_id, display_name, site, last_seen, connector_type, connector_config, status, created_at
                    FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL AND status = 'active'`;
/** the adapter a kit names, else its connector type ('erp' stays 'erp') */
const adapterOf = (actor, config) => config.adapter || actor.connector_type;
/** one identities row → the shape every reader paints */
function rowOut(actor) {
  const config = actor.connector_config || {};
  return {
    id: config.kit_id || actor.identity_id,
    actor_id: actor.identity_id,
    name: actor.display_name,
    adapter: adapterOf(actor, config),
    host: actor.site || '',
    version: config.version || '',
    key_jti: config.key_jti || null,
    last_seen: actor.last_seen,
    health: health(actor.last_seen),
    source: config.source || null,
    counters: config.counters || {},
    note: config.note || '',
    kit: !!config.kit,
    enrol: config.enrol || null
  };
}
async function connectorsOf(entity_id) {
  const found = await query(KIT_ROWS + ' ORDER BY last_seen DESC NULLS LAST', [entity_id]);
  return found.rows.map(rowOut);
}

module.exports = { KIT_ROWS, rowOut, connectorsOf };

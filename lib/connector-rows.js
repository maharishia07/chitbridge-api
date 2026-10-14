'use strict';
/**
 * lib/connector-rows.js — THE CONNECTORS THAT HAVE CHECKED IN, as one read (lifted from routes/integrations.js, T3-SETTINGS 2026-10-14).
 *
 * A kit that runs beside Tally / Zoho / a folder of files is an ACTOR of the shop (identity_type 'actor', connector_type set); each heartbeat
 * stamps last_seen and connector_config. Two places asked the same question of the same rows — GET /api/integrations/status and the streams
 * map — and the Home card for CB Settings › Connectors became the third, so the statement, its row shape and the one health rule live here
 * (the 14 Oct review: second call site → lift ONE helper and point both at it).
 *   health(last_seen)   live (< 3 min) · slow (< 15 min) · offline — "live" says the connector checked in, never that the other system answered
 *   rowOut(row)         the shape every reader paints: id · actor_id · name · adapter · host · version · key_jti · last_seen · health · source · counters · note · kit · enrol
 *   connectorsOf(entity_id) → rows, most recently seen first (one query)
 */
const { query } = require('../db');

function health(last_seen) { if (!last_seen) return 'offline'; const age = Date.now() - new Date(last_seen).getTime(); return age > 15 * 60 * 1000 ? 'offline' : (age > 3 * 60 * 1000 ? 'slow' : 'live'); }
const KIT_ROWS = `SELECT identity_id, display_name, site, last_seen, connector_type, connector_config, status, created_at
                    FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL AND status = 'active'`;
function rowOut(a) { const c = a.connector_config || {}; return { id: c.kit_id || a.identity_id, actor_id: a.identity_id, name: a.display_name, adapter: c.adapter || (a.connector_type === 'erp' ? 'erp' : a.connector_type), host: a.site || '', version: c.version || '',
  key_jti: c.key_jti || null, last_seen: a.last_seen, health: health(a.last_seen), source: c.source || null, counters: c.counters || {}, note: c.note || '', kit: !!c.kit, enrol: c.enrol || null }; }
async function connectorsOf(entity_id) {
  const r = await query(KIT_ROWS + ' ORDER BY last_seen DESC NULLS LAST', [entity_id]);
  return r.rows.map(rowOut);
}

module.exports = { health, KIT_ROWS, rowOut, connectorsOf };

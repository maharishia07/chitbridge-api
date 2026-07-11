// lib/source.js — SOURCE-ENTITY operations (increment 2). A source (standard/brand) is a SEALED entity that gives its
// typed content a STABLE identity_id + a MUTABLE display_name. "Register + upload + stamp" in one transactional call.
// Renaming a source = one field (display_name) → the loose-coupling #1 fix ([[feedback-loose-until-stamped]]).
const { query, withTransaction } = require('../db');
const genBridge = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = 'CB'; for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };

// registerSource({source_key, title, facet, kind, template}) → { source_key, kind, facet, entity:{identity_id,bridge_id,display_name} }
// Idempotent by source_key (deterministic .local email). kind 'standard' writes/updates the typed standard_source.
async function registerSource({ source_key, title, facet, kind, template }) {
  if (!source_key) { const e = new Error('source_key required'); e.status = 400; throw e; }
  const email = 'src.' + source_key + '@chitbridge.local';
  kind = kind || 'standard';
  return withTransaction(async (c) => {
    // the sealed SOURCE-ENTITY — stable identity + mutable name
    let ent = await c.query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE email = $1`, [email]);
    if (!ent.rows.length) {
      ent = await c.query(
        `INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed, owner_scope)
         VALUES ($1,$2,$3,'entity','active',true,'platform') RETURNING identity_id, bridge_id, display_name`,
        [genBridge(), title || source_key, email]);
    } else if (title && title !== ent.rows[0].display_name) {
      await c.query(`UPDATE identities SET display_name = $1 WHERE email = $2`, [title, email]);   // rename = 1 field
      ent.rows[0].display_name = title;
    }
    const owner = ent.rows[0].identity_id;
    if (kind === 'standard') {
      await c.query(
        `INSERT INTO standard_source (standard_key, version, title, facet, template, owner_entity_id)
         VALUES ($1,'v1',$2,$3,$4::jsonb,$5)
         ON CONFLICT (standard_key, version) DO UPDATE SET title = EXCLUDED.title, facet = EXCLUDED.facet,
           template = EXCLUDED.template, owner_entity_id = EXCLUDED.owner_entity_id`,
        [source_key, title || source_key, facet || 'standard', JSON.stringify(template || {}), owner]);
    }
    return { source_key, kind, facet: facet || null,
      entity: { identity_id: owner, bridge_id: ent.rows[0].bridge_id, display_name: ent.rows[0].display_name } };
  });
}

// resolveSourceEntity(source_key) → the standard content + its owning source-entity (stable key/id + mutable name)
async function resolveSourceEntity(source_key) {
  try {
    const r = await query(
      `SELECT s.standard_key, s.version, s.facet, s.title, s.template,
              i.identity_id, i.bridge_id, i.display_name
         FROM standard_source s LEFT JOIN identities i ON i.identity_id = s.owner_entity_id
        WHERE s.standard_key = $1 AND s.active = true ORDER BY s.version DESC LIMIT 1`, [source_key]);
    return r.rows[0] || null;
  } catch (_) { return null; }
}

module.exports = { registerSource, resolveSourceEntity };

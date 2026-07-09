// lib/workpattern.js — the RESOLUTION SEAM.
// "Resolve-before-act, every time": a mode calls resolveWorkPattern() FIRST to get its effective config, then acts on
// the result. SEALED values are frozen defaults here; OPEN knobs are resolved LIVE and cascaded (device → connector →
// entity setting) — most-specific wins. Behaviour = f(resolved config). Build once; every mode calls it.
// See C:\dev\ARCHITECTURE-GOVERNANCE-MATRIX.md.
const { query } = require('../db');

// Blueprint defaults per work pattern — the single source (mirrors the frontend WORK_PATTERNS registry) for the
// SEALED defaults + the OPEN-knob defaults. Sealed = frozen; open = overridable by settings.
const BLUEPRINTS = {
  'iot-signal': {
    // SEALED includes the LIFECYCLE — the chain of next actions this work pattern expects. Stamped onto the chit so
    // the chit itself knows "what comes next" (acknowledge → resolve → close). This is the "work = chained modes".
    sealed: { copy: 'both', isolation: 'per-copy', lifecycle: ['acknowledge', 'resolve', 'close'] },
    open:   { folder: null, counterparty: null, default_assignee: null, notify_email: null, alert_cadence: 60 },
  },
};

// Read the MINTED blueprint governance from the b60 catalogue (source→template→blueprint, versioned + provenanced).
// Self-healing: if the catalogue/row/column isn't there yet (pre-b70), fall back to the code default — never breaks.
async function mintedBlueprint(id) {
  try {
    const r = await query(`SELECT version, governance FROM blueprints WHERE blueprint_key = $1 AND active = true LIMIT 1`, [id]);
    const row = r.rows[0];
    if (row && row.governance && (row.governance.sealed || row.governance.open)) {
      return { sealed: row.governance.sealed || {}, open: row.governance.open || {}, version: row.version || 'v1' };
    }
  } catch (_) { /* catalogue not present yet → code fallback */ }
  return null;
}

// resolveWorkPattern(id, ctx) → the effective config. ctx: { entity_id, connectorConfig, connection }.
async function resolveWorkPattern(id, ctx) {
  const minted = await mintedBlueprint(id);          // STATIC: the minted, shared, version-frozen blueprint
  const bp = minted || BLUEPRINTS[id];               // fallback: the code default (pre-mint)
  if (!bp) return null;
  const cfg = Object.assign({}, bp.sealed, bp.open);
  cfg._blueprint = id + '@' + (minted ? minted.version : 'code');   // the version-frozen reference for the audit stamp
  ctx = ctx || {};
  if (id === 'iot-signal') {
    const dev = (ctx.connection && ctx.connection.conn_config) || {};   // device-level (most specific)
    const con = ctx.connectorConfig || {};                              // connector-level
    // OPEN knobs — cascade device → connector → (entity setting for the assignee); most-specific wins.
    cfg.folder       = dev.folder || con.folder || cfg.folder;
    cfg.counterparty = (ctx.connection && ctx.connection.counterparty_entity_id) || con.counterparty_entity_id || cfg.counterparty;
    cfg.notify_email = dev.notify_email || con.notify_email || cfg.notify_email;   // external notice (off-rail email)
    let da = dev.default_assignee || con.default_assignee || null;
    if (!da && ctx.entity_id) {
      try {
        const r = await query(`SELECT default_assignee_actor_id FROM entity_actor_settings WHERE entity_id = $1`, [ctx.entity_id]);
        da = (r.rows[0] && r.rows[0].default_assignee_actor_id) || null;
      } catch (_) { /* no settings row — leave null */ }
    }
    cfg.default_assignee = da;
  }
  return cfg;
}

module.exports = { resolveWorkPattern, BLUEPRINTS };

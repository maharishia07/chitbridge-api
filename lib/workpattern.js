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

// resolveWorkPattern(id, ctx) → the effective config. ctx: { entity_id, connectorConfig, connection }.
async function resolveWorkPattern(id, ctx) {
  const bp = BLUEPRINTS[id];
  if (!bp) return null;
  const cfg = Object.assign({}, bp.sealed, bp.open);
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

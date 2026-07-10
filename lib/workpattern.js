// lib/workpattern.js — the RESOLUTION SEAM.
// "Resolve-before-act, every time": a mode calls resolveWorkPattern() FIRST to get its effective config, then acts on
// the result. SEALED values are frozen defaults here; OPEN knobs are resolved LIVE and cascaded (device → connector →
// entity setting) — most-specific wins. Behaviour = f(resolved config). Build once; every mode calls it.
// See C:\dev\ARCHITECTURE-GOVERNANCE-MATRIX.md.
const { query, withEntity } = require('../db');

// Blueprint defaults per work pattern — the single source (mirrors the frontend WORK_PATTERNS registry) for the
// SEALED defaults + the OPEN-knob defaults. Sealed = frozen; open = overridable by settings.
const BLUEPRINTS = {
  'iot-signal': {
    // SEALED includes the LIFECYCLE — the chain of next actions this work pattern expects. Stamped onto the chit so
    // the chit itself knows "what comes next" (acknowledge → resolve → close). This is the "work = chained modes".
    sealed: { copy: 'both', isolation: 'per-copy', lifecycle: ['acknowledge', 'resolve', 'close'] },
    open:   { folder: null, counterparty: null, default_assignee: null, notify_email: null, alert_cadence: 60 },
  },
  'send-chit': {
    sealed: { isolation: 'per-copy', copy: 'both', lifecycle: ['open', 'act', 'close'] },
    open:   { retention_days: null },
  },
};

// The applicable CANONICAL standard for this run → `standard@version`. A SHARED source (grounded ONCE, industry-agnostic
// — ISO 9000, EXIM...) read from standard_source (shared-reference, WITHOUT RLS, b85). Self-healing to a code seed.
// (Later: a per-entity / vertical binding picks WHICH standard applies; for now resolve the default active one.)
const STANDARD_SEED = { key: 'iso-9000', version: 'v1' };
async function resolveStandardRef(_ctx) {
  try {
    const r = await query(`SELECT standard_key AS key, version FROM standard_source WHERE active = true ORDER BY (standard_key = 'iso-9000') DESC, minted_at DESC LIMIT 1`);
    const row = r.rows[0]; if (row && row.key) return row.key + '@' + (row.version || 'v1');
  } catch (_) { /* standard_source not present yet → code seed */ }
  return STANDARD_SEED.key + '@' + STANDARD_SEED.version;
}

// Read the MINTED blueprint governance from the work_pattern catalogue (b70 — versioned + provenanced).
// Self-healing: if the catalogue/row isn't there yet (pre-b70), fall back to the code default — never breaks.
async function mintedBlueprint(id) {
  try {
    const r = await query(`SELECT version, governance FROM work_pattern WHERE pattern_key = $1 AND active = true LIMIT 1`, [id]);
    const row = r.rows[0];
    if (row && row.governance && (row.governance.sealed || row.governance.open)) {
      return { sealed: row.governance.sealed || {}, open: row.governance.open || {}, version: row.version || 'v1' };
    }
  } catch (_) { /* catalogue not present yet → code fallback */ }
  return null;
}

// The PARENT capability a work pattern belongs to → `capability@version` (the middle rung). Separate best-effort read
// so a missing capability catalogue/column (pre-b71) can NEVER regress the work_pattern stamp.
async function mintedCapabilityFor(patternId) {
  try {
    const r = await query(
      `SELECT wp.capability_key AS key, c.version AS cver
         FROM work_pattern wp JOIN capability c ON c.capability_key = wp.capability_key AND c.active = true
        WHERE wp.pattern_key = $1 AND wp.active = true LIMIT 1`, [patternId]);
    const row = r.rows[0];
    if (row && row.key) return row.key + '@' + (row.cver || 'v1');
  } catch (_) { /* capability catalogue / parent column not present yet */ }
  return null;
}

// The ENTITY'S OWN minted constitution stamp (its vertical) → `constitution@version`. Per-entity, WITH RLS → read
// inside withEntity(entity). Best-effort / self-healing (table absent pre-b73).
async function entityConstitution(entity_id) {
  if (!entity_id) return null;
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT constitution_key AS key, constitution_version AS ver FROM entity_governance WHERE entity_id = $1 LIMIT 1`, [entity_id]));
    const row = r.rows[0];
    if (row && row.key) return row.key + '@' + (row.ver || 'v1');
  } catch (_) { /* entity_governance not present / no stamp */ }
  return null;
}

// Resolve the governing constitution for this run: the ENTITY'S own stamp first (its vertical), else the DEFAULT
// constitution, else any active. Self-healing across b72/b73.
async function resolveConstitutionRef(entity_id) {
  const es = await entityConstitution(entity_id);
  if (es) return es;
  try {
    const r = await query(`SELECT constitution_key AS key, version FROM constitution WHERE active = true ORDER BY (is_default IS TRUE) DESC, minted_at DESC LIMIT 1`);
    const row = r.rows[0]; if (row && row.key) return row.key + '@' + (row.version || 'v1');
  } catch (_) {
    try { const r2 = await query(`SELECT constitution_key AS key, version FROM constitution WHERE active = true ORDER BY minted_at DESC LIMIT 1`);
      const row2 = r2.rows[0]; if (row2 && row2.key) return row2.key + '@' + (row2.version || 'v1'); } catch (_2) {}
  }
  return null;
}

// resolveWorkPattern(id, ctx) → the effective config. ctx: { entity_id, connectorConfig, connection }.
async function resolveWorkPattern(id, ctx) {
  const minted = await mintedBlueprint(id);          // STATIC: the minted, shared, version-frozen blueprint
  const bp = minted || BLUEPRINTS[id];               // fallback: the code default (pre-mint)
  if (!bp) return null;
  const cfg = Object.assign({}, bp.sealed, bp.open);
  ctx = ctx || {};
  cfg._blueprint = id + '@' + (minted ? minted.version : 'code');   // the version-frozen reference for the audit stamp
  cfg._capability = await mintedCapabilityFor(id);                  // the parent capability@version (middle rung)
  cfg._constitution = await resolveConstitutionRef(ctx.entity_id);  // the ENTITY'S own constitution (its vertical), else default
  cfg._standard = await resolveStandardRef(ctx);                    // canonical SHARED source (ISO 9000...) assimilated into the boilerplate
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

'use strict';
// routes/governance.js — GOV-01 protected entity / constitution / governed inheritance.
// Adapted to this codebase: Express router + query/withTransaction from ../db, identity_id PK,
// parameterized SQL only (closes TD-006 for this surface), default-deny, read view leaks no PII.
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { query, withTransaction } = require('../db');
const auth = require('../middleware/auth');

const { resolve, driftStatus } = require('../governance/resolver');
const { mintEntity, reattest } = require('../governance/mint');
const { planFor, checkCount, checkRate, checkCapability } = require('../governance/entitlements');

const genBridge = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CB';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

// ── load the active constitution (shaped for the resolver) ──
async function loadActiveConstitution() {
  const { rows } = await query(
    `SELECT pc.version, pc.params, pc.plan_menu, pc.root_id
       FROM platform_constitution pc
       JOIN platform_root pr ON pr.root_id = pc.root_id
      WHERE pc.is_active LIMIT 1`);
  if (!rows.length) return null;                  // no-orphan: caller must reject
  const r = rows[0];
  return { version: r.version, root_id: r.root_id, plan_menu: r.plan_menu, ...r.params };
}

async function countEntities(rootId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM identities WHERE governed_by = $1`, [rootId]);
  return rows[0].n;
}
async function countChitsToday(entityId) {
  // UTC-day window (absolute-time invariant)
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM chit_header
      WHERE sender_entity_id = $1
        AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`, [entityId]);
  return rows[0].n;
}

// ── GET /api/governance/entities/:id — read-only view, no PII ──
router.get('/entities/:id', auth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT constitution_version, params_override, plan
         FROM identities WHERE governed_by IS NOT NULL AND identity_id = $1`,
      [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'entity not found or not governed' });
    const ent = rows[0];

    const active = await loadActiveConstitution();
    if (!active) return res.status(503).json({ error: 'no active constitution' });

    const { effective, exceptions } = resolve(active, ent.params_override || {});
    res.json({
      minted_version: ent.constitution_version,
      active_version: active.version,
      drift: driftStatus(ent.constitution_version, active.version),
      plan: ent.plan,
      effective,
      exceptions,
    });
  } catch (err) {
    res.status(500).json({ error: 'governance view failed', message: safeErr(err) });
  }
});

// ── POST /api/governance/entities — governed create (platform-scope only) ──
// Transactional: the identity row + its Class-C exceptions commit together.
router.post('/entities', auth, async (req, res) => {
  if (req.identity.owner_scope !== 'platform')
    return res.status(403).json({ error: 'Forbidden', message: 'Governed create is platform-scope only' });

  const override     = (req.body && req.body.params_override) || {};
  const plan         = (req.body && req.body.plan) || 'free';
  const display_name = ((req.body && req.body.display_name) || '').trim();
  const email        = ((req.body && req.body.email) || '').trim().toLowerCase();
  if (!display_name || !email)
    return res.status(400).json({ error: 'display_name and email required' });

  try {
    const active = await loadActiveConstitution();
    if (!active) return res.status(503).json({ error: 'no active constitution (default-deny)' });

    // entitlement: entity-count quota for the installation's plan
    const used = await countEntities(active.root_id);
    const q = checkCount(planFor(active, plan), 'max_entities', used);
    if (!q.ok) return res.status(409).json({ error: 'entity quota reached', quota: q.info });

    // conformance: resolve + stamp (throws GovernanceError on Class A/B)
    let stamp;
    try { stamp = mintEntity(active, active.root_id, override); }
    catch (e) { return res.status(422).json({ error: 'conformance', code: e.code, detail: e.message }); }

    const out = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO identities
           (bridge_id, display_name, email, identity_type, status,
            governed_by, constitution_version, params_override, plan)
         VALUES ($1,$2,$3,'entity','active',$4,$5,$6,$7)
         RETURNING identity_id`,
        [genBridge(), display_name, email,
         stamp.governed_by, stamp.constitution_version, JSON.stringify(stamp.params_override), plan]);
      const newId = ins.rows[0].identity_id;
      for (const ex of stamp.exceptions) {
        await client.query(
          `INSERT INTO governance_exceptions (entity_id, klass, key, detail) VALUES ($1,$2,$3,$4)`,
          [newId, ex.klass, ex.key, ex.detail]);
      }
      return { id: newId };
    });

    res.status(201).json({ id: out.id, effective: stamp.effective, exceptions: stamp.exceptions });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'email already exists' });
    res.status(500).json({ error: 'governed create failed', message: safeErr(err) });
  }
});

// ── POST /api/governance/entities/:id/reattest — re-stamp to active version (clears drift) ──
// Forward-only: an entity's NEW chits then resolve under the active constitution;
// chits already sent stay frozen at their original version (handled at send/freeze time).
router.post('/entities/:id/reattest', auth, async (req, res) => {
  if (req.identity.owner_scope !== 'platform')
    return res.status(403).json({ error: 'Forbidden', message: 'Re-attest is platform-scope only' });
  try {
    const { rows } = await query(
      `SELECT params_override FROM identities WHERE governed_by IS NOT NULL AND identity_id = $1`,
      [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'entity not found or not governed' });

    const active = await loadActiveConstitution();
    if (!active) return res.status(503).json({ error: 'no active constitution' });

    let ra;
    try { ra = reattest(active, rows[0].params_override || {}); }
    catch (e) { return res.status(422).json({ error: 'conformance', code: e.code, detail: e.message }); }

    await query(
      `UPDATE identities SET constitution_version = $1 WHERE identity_id = $2`,
      [ra.constitution_version, req.params.id]);
    res.json({ message: 'Re-attested', constitution_version: ra.constitution_version,
               drift: false, effective: ra.effective, exceptions: ra.exceptions });
  } catch (err) {
    res.status(500).json({ error: 'reattest failed', message: safeErr(err) });
  }
});

// ── Guards to call from core flows WHEN enforcement is enabled (not wired yet) ──
async function assertChitAllowed(entityId, plan) {
  const active = await loadActiveConstitution();
  if (!active) { const e = new Error('no active constitution'); e.status = 503; throw e; }
  const used = await countChitsToday(entityId);
  const r = checkRate(planFor(active, plan), 'chits_per_day', used);
  if (!r.ok) { const e = new Error('daily chit limit reached'); e.status = 429; e.quota = r.info; throw e; }
}
function assertPublicAllowed(active, plan) {
  const c = checkCapability(planFor(active, plan), 'public_facing');
  if (!c.ok) { const e = new Error('public catalogue not available on this plan'); e.status = 403; throw e; }
}

module.exports = router;
module.exports.assertChitAllowed = assertChitAllowed;
module.exports.assertPublicAllowed = assertPublicAllowed;
module.exports.loadActiveConstitution = loadActiveConstitution;

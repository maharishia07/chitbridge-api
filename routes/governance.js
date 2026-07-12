'use strict';
// routes/governance.js — GOV-01 protected entity / constitution / governed inheritance.
// Adapted to this codebase: Express router + query/withTransaction from ../db, identity_id PK,
// parameterized SQL only (closes TD-006 for this surface), default-deny, read view leaks no PII.
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { query, withTransaction, withEntity } = require('../db');
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
  // UTC-day window (absolute-time invariant). B1 RLS: an entity's own sent chits -> withEntity(entity). (Dormant
  // guard — call it OUTSIDE any open entity transaction to avoid nesting when it's eventually wired.)
  const { rows } = await withEntity(entityId, (c) => c.query(
    `SELECT count(*)::int AS n FROM chit_header
      WHERE sender_entity_id = $1
        AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`, [entityId]));
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

// POST /api/governance/conformance — ADVISORY: check a process/chit's data against the ACTIVE canonical standards
// (ISO 9000 quality + EXIM trade + …) assimilated into the boilerplate, and report contradictions (missing required
// items). Read-only: computes a verdict, never mutates or blocks anything. This is the runtime "the standard actually
// governs" surface — the light, deterministic form; an AI co-assist adds semantic judgement on top later.
router.post('/conformance', auth, async (req, res) => {
  try {
    const data = (req.body && typeof req.body.data === 'object' && req.body.data) ? req.body.data : (req.body || {});
    const scope = (req.body && typeof req.body.scope === 'string') ? req.body.scope : 'chit';
    const verdict = await require('../lib/conformance').checkConformance(data, scope);
    res.json(verdict);
  } catch (err) {
    res.status(500).json({ error: 'Conformance check failed', message: safeErr(err) });
  }
});

// GET /api/governance/boilerplate/:key — read the sealed MOULD: its DECLARED sources + bound locale ("see the mould").
router.get('/boilerplate/:key', auth, async (req, res) => {
  try {
    const bp = await require('../lib/boilerplate').resolveBoilerplate(req.params.key);
    if (!bp) return res.status(404).json({ error: 'Not found', message: 'No such boilerplate' });
    res.json(bp);
  } catch (err) { res.status(500).json({ error: 'Boilerplate read failed', message: safeErr(err) }); }
});

// POST /api/governance/boilerplate/:key/adopt — the minted-path binding: stamp the caller's entity with this mould so
// it resolves the mould's DECLARED sources (bounded, not global). Upsert; preserves any existing constitution.
router.post('/boilerplate/:key/adopt', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const bp = await require('../lib/boilerplate').resolveBoilerplate(req.params.key);
    if (!bp) return res.status(404).json({ error: 'Not found', message: 'No such boilerplate' });
    await withEntity(entity_id, (c) => c.query(
      `INSERT INTO entity_governance (entity_id, constitution_key, boilerplate_key)
       VALUES ($1, COALESCE((SELECT constitution_key FROM constitution WHERE active = true AND is_default = true LIMIT 1), 'trade'), $2)
       ON CONFLICT (entity_id) DO UPDATE SET boilerplate_key = EXCLUDED.boilerplate_key`,
      [entity_id, bp.key]));
    require('../lib/workpattern').invalidateWorkPattern(entity_id);   // re-stamp → next resolve re-derives
    res.json({ message: 'Minted from boilerplate', boilerplate: bp.key + '@' + bp.version, standards: bp.standards, locale: bp.locale });
  } catch (err) { res.status(500).json({ error: 'Adopt failed', message: safeErr(err) }); }
});

// POST /api/governance/source — REGISTER a source as a sealed SOURCE-ENTITY + upload its typed content + stamp it.
// One call = the runbook's "register entity → upload standard → stamp as source". Idempotent by source_key.
// (Demo: auth-gated; production would gate this to a platform / source-authority scope.)
router.post('/source', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const out = await require('../lib/source').registerSource({
      source_key: (b.source_key || '').trim(), title: b.title, facet: b.facet, kind: b.kind, template: b.template });
    res.json({ message: 'Source registered & stamped', source: out });
  } catch (err) { res.status(err.status || 500).json({ error: 'Register source failed', message: safeErr(err) }); }
});

// GET /api/governance/source/:key — view a source: its typed content + its owning source-entity (stable id + mutable name).
router.get('/source/:key', auth, async (req, res) => {
  try {
    const s = await require('../lib/source').resolveSourceEntity(req.params.key);
    if (!s) return res.status(404).json({ error: 'Not found', message: 'No such source' });
    res.json(s);
  } catch (err) { res.status(500).json({ error: 'Source read failed', message: safeErr(err) }); }
});

// GET /api/governance/readiness — the CALLER's own trade readiness. ?destination=EU&vertical=paint → resolved FOR that
// destination (spin the globe), with guidance on each gap; otherwise the entity's own standards.
router.get('/readiness', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const R = require('../lib/readiness');
    const out = req.query.destination
      ? await R.resolveForDestination(entity_id, String(req.query.destination), req.query.vertical, req.query.origin)
      : await R.resolveReadiness(entity_id);
    res.json(out);
  } catch (err) { res.status(500).json({ error: 'Readiness failed', message: safeErr(err) }); }
});

// GET /api/governance/lanes?vertical=paint — the CALLER's market-readiness MATRIX (readiness % per destination + gaps).
router.get('/lanes', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    res.json(await require('../lib/readiness').resolveLaneMatrix(entity_id, req.query.vertical, req.query.origin));
  } catch (err) { res.status(500).json({ error: 'Lanes failed', message: safeErr(err) }); }
});

// GET /api/governance/track-record — the CALLER's SELF-PROVING REFERENCE (relationship rung of the trust ladder):
// counterparties / settled dealings / dispute health, DERIVED from its own real chit copies. Aggregate counts only.
// Self-view: exposing a track record to a buyer is a separate opt-in decision (see SPEC-commercial-attestation.md).
router.get('/track-record', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    res.json(await require('../lib/reference').resolveTrackRecord(entity_id));
  } catch (err) { res.status(500).json({ error: 'Track record failed', message: safeErr(err) }); }
});

// ── COMMERCE LAYER — the commercial-instrument cluster + the end-to-end settlement chain (derive-not-enumerate). ──
// GET /api/governance/instruments?incoterm=CIF&cross_border=1 — the cluster of EXIM instruments grouped by RISK covered.
router.get('/instruments', auth, async (req, res) => {
  try {
    const cross_border = req.query.cross_border == null ? true : !['0', 'false', 'no'].includes(String(req.query.cross_border));
    res.json(require('../lib/instruments').resolveInstruments({ cross_border, incoterm: req.query.incoterm }));
  } catch (err) { res.status(500).json({ error: 'Instruments failed', message: safeErr(err) }); }
});
// GET /api/governance/journey?incoterm=CIF&cross_border=1 — the ordered end-to-end settlement chain (partner + cover per stage).
router.get('/journey', auth, async (req, res) => {
  try {
    const cross_border = req.query.cross_border == null ? true : !['0', 'false', 'no'].includes(String(req.query.cross_border));
    res.json(require('../lib/instruments').resolveJourney({ cross_border, incoterm: req.query.incoterm }));
  } catch (err) { res.status(500).json({ error: 'Journey failed', message: safeErr(err) }); }
});
// GET /api/governance/commerce-standards — the commerce standards (Incoterms/UCP/FRM) as governed source-entities (b93).
router.get('/commerce-standards', auth, async (req, res) => {
  try {
    res.json(await require('../lib/instruments').commerceStandards());
  } catch (err) { res.status(500).json({ error: 'Commerce standards failed', message: safeErr(err) }); }
});

// ── ENTITY TRADE PROFILE — individual-specific: trade mode + markets + sectors + adopted certs (b96). ──
router.get('/profile', auth, async (req, res) => {
  try { const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    res.json(await require('../lib/profile').getProfile(entity_id));
  } catch (err) { res.status(500).json({ error: 'Profile failed', message: safeErr(err) }); }
});
router.put('/profile', auth, async (req, res) => {
  try { const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    res.json(await require('../lib/profile').saveProfile(entity_id, req.body || {}));
  } catch (err) { res.status(err.status || 500).json({ error: 'Save profile failed', message: safeErr(err) }); }
});
// TRADE DOCUMENTS VAULT — recurring inputs (identity·signatory·registrations·banking·logistics) that pre-fill forms.
// GET the schema (what to ask); PUT saves the vault (whitelisted in lib/profile). Vault values also ride in GET /profile.
router.get('/vault-schema', auth, async (req, res) => {
  try { res.json({ schema: require('../lib/profile').VAULT_SCHEMA }); }
  catch (err) { res.status(500).json({ error: 'Vault schema failed', message: safeErr(err) }); }
});
router.put('/profile/vault', auth, async (req, res) => {
  try { const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const b = req.body || {};
    res.json(await require('../lib/profile').saveVault(entity_id, b.vault || b));
  } catch (err) { res.status(err.status || 500).json({ error: 'Save vault failed', message: (err.status && err.status < 500) ? (err.message || safeErr(err)) : safeErr(err) }); }
});
// the entity's OWN required set (mandatory ∪ adopted) resolved from its profile
router.get('/profile/readiness', auth, async (req, res) => {
  try { const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    res.json(await require('../lib/profile').resolveProfileReadiness(entity_id));
  } catch (err) { res.status(500).json({ error: 'Profile readiness failed', message: safeErr(err) }); }
});
// the forward roadmap — which markets you could reach next and what to add
router.get('/profile/path', auth, async (req, res) => {
  try { const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    res.json(await require('../lib/profile').resolvePath(entity_id));
  } catch (err) { res.status(500).json({ error: 'Path failed', message: safeErr(err) }); }
});

// ── AI CO-ASSIST — INVOKED (never autonomous). Drafts a clearance document from the order/product context; returns a
// draft for the human to confirm (not evidence until accepted). Meters per-entity usage (b99). ──
router.post('/ai-draft', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const b = req.body || {};
    res.json(await require('../lib/ai').invokeSkill(entity_id, b.skill_id || b.doc_type, b.context || {}));
  } catch (err) {
    // 4xx are intentional, client-safe reasons (gate 402/429 · unknown skill 400 · not-connected 503) → show them;
    // 5xx keep the generic message (no internal/DB text leaks).
    const st = err.status || 500;
    res.status(st).json({ error: 'AI draft failed', message: st < 500 ? (err.message || safeErr(err)) : safeErr(err) });
  }
});
// per-entity AI spend (metering / charge-back)
router.get('/ai-usage', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    res.json(await require('../lib/ai').usageSummary(entity_id));
  } catch (err) { res.status(500).json({ error: 'AI usage failed', message: safeErr(err) }); }
});
// the AI skill INVENTORY — what the one co-assist can be invoked to do (id · category · kind · gate · label). The UI
// reads this to place "✨ Draft with AI" wherever a skill's category applies. Single source of truth: lib/ai.js SKILLS.
router.get('/ai-skills', auth, async (req, res) => {
  try { res.json({ skills: require('../lib/ai').listSkills() }); }
  catch (err) { res.status(500).json({ error: 'AI skills failed', message: safeErr(err) }); }
});

// GET /api/governance/readiness/:bridge_id — a COUNTERPARTY's shareable readiness passport (feeds the buyer "trade
// confidence" view). Status + validity only — never raw evidence contents. (Demo: any authed entity; prod may gate to
// a connection.)
router.get('/readiness/:bridge_id', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT identity_id, display_name, bridge_id FROM identities WHERE bridge_id = $1 AND identity_type = 'entity' LIMIT 1`,
      [req.params.bridge_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No such entity' });
    const rd = await require('../lib/readiness').resolveReadiness(r.rows[0].identity_id);
    res.json({ supplier: { bridge_id: r.rows[0].bridge_id, display_name: r.rows[0].display_name }, ...rd });
  } catch (err) { res.status(500).json({ error: 'Readiness failed', message: safeErr(err) }); }
});

// POST /api/governance/compliance — GATHER a clearance for the acting entity (the supplier records a document).
router.post('/compliance', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const b = req.body || {};
    await require('../lib/readiness').gatherDocument(entity_id, {
      standard_key: b.standard_key, doc_key: b.doc_key, evidence_ref: b.evidence_ref, valid_until: b.valid_until, status: b.status, verification: b.verification });
    res.json({ message: 'Clearance gathered', ...(await require('../lib/readiness').resolveReadiness(entity_id)).summary });
  } catch (err) { res.status(err.status || 500).json({ error: 'Gather failed', message: safeErr(err) }); }
});

// POST /api/governance/verify — MACHINE-VERIFY a registry ID (IEC/GSTN/PAN) → the "verified" rung. Un-fakeable once the
// Registry verify: confirms the ID against a KYB provider when one is connected (→ VERIFIED); otherwise records it as a
// format-checked claim (→ NOT verified, honest). A malformed ID or a registry "not-active" is refused with 422.
router.post('/verify', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const b = req.body || {};
    const v = await require('../lib/verify').verifyRegistry(b.id_type, b.id_value);
    if (!v.ok) return res.status(422).json({ error: 'Verification failed', message: v.note, verdict: v });
    await require('../lib/readiness').gatherDocument(entity_id, {
      standard_key: b.standard_key, doc_key: b.doc_key, evidence_ref: v.value, valid_until: b.valid_until,
      status: 'gathered', verification: { method: v.method, id_type: v.id_type, checked: v.checked, provider: v.provider || null,
        registry: v.registry || null, note: v.note, verified_at: new Date().toISOString() } });
    const msg = v.method === 'registry' ? 'Verified against the registry' : 'Format valid — not registry-confirmed (no provider connected)';
    res.json({ message: msg, verdict: v, ...(await require('../lib/readiness').resolveReadiness(entity_id)).summary });
  } catch (err) { res.status(err.status || 500).json({ error: 'Verify failed', message: safeErr(err) }); }
});

module.exports = router;
module.exports.assertChitAllowed = assertChitAllowed;
module.exports.assertPublicAllowed = assertPublicAllowed;
module.exports.loadActiveConstitution = loadActiveConstitution;

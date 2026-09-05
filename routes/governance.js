'use strict';
// routes/governance.js — GOV-01 protected entity / constitution / governed inheritance.
// Adapted to this codebase: Express router + query/withTransaction from ../db, identity_id PK,
// parameterized SQL only (closes TD-006 for this surface), default-deny, read view leaks no PII.
const express = require('express');
const router  = express.Router();
const { safeErr } = require('../lib/respond');
const { query, withTransaction, withEntity } = require('../db');
const auth = require('../middleware/auth');
const { memo } = require('../lib/confcache');   // the active constitution is read once a minute, not once a call

const { resolve, driftStatus } = require('../governance/resolver');
const { mintEntity, reattest } = require('../governance/mint');
const { planFor, checkCount, checkRate, checkCapability } = require('../governance/entitlements');

// ⚠️ ONE generator (lib/bridgeid.js) — this was one of six copies, on the weak-PRNG side of the split.
const genBridge = require('../lib/bridgeid').generateBridgeId;

// ── load the active constitution (shaped for the resolver) ──
/**
 * ⭐ CACHED — see lib/confcache.js. This runs on EVERY profile paint (routes/entities.js reads plan_menu twice,
 * network-design once) plus four times in this file, and `platform_constitution` has no writer anywhere in the
 * API: it is migration-only. That was a round trip per call against a table that changes when a migration says so.
 *
 * ⚠️ THE RETURNED OBJECT IS NOW SHARED BETWEEN CALLERS AND MUST NOT BE MUTATED. Checked when this changed:
 * `resolver.resolve()` reads and `.slice()`s, `entitlements.planFor()` hands `plan_menu[name]` by reference to
 * `checkCount`/`checkRate`/`checkCapability` which only read, and the three `plan_menu` readers outside this
 * file only read. Nothing assigns into either. If that ever changes, copy at the read rather than here.
 *
 * ⚠️ A THROW IS NOT CACHED (memo stores only a resolved value), so a database blip cannot become a full minute
 * of "no active constitution" — which every caller in this file turns into a 503.
 */
async function loadActiveConstitution() {
  return memo('platform_constitution:active', async () => {
    const { rows } = await query(
      `SELECT pc.version, pc.params, pc.plan_menu, pc.root_id
         FROM platform_constitution pc
         JOIN platform_root pr ON pr.root_id = pc.root_id
        WHERE pc.is_active LIMIT 1`);
    if (!rows.length) return null;                  // no-orphan: caller must reject
    const r = rows[0];
    return { version: r.version, root_id: r.root_id, plan_menu: r.plan_menu, ...r.params };
  });
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
/**
 * ── SUPERSEDED 2026-08-06 · use lib/visibility-cap.js ──────────────────────────────────────────────────────────
 *
 * This was the catalogue-visibility guard, exported with zero callers and a note saying "not wired yet". Athi asked
 * for it to be wired. Wiring it EXACTLY as written took the platform down for a minute: the live constitution
 * declares `free: { public_facing: false }`, every entity is on `free`, and publishing is the product — so every
 * shop was refused with "a public catalogue is not available on the free plan".
 *
 * What replaced it does three things this could not:
 *   · the OPERATOR who provisioned an entity outranks the plan (Athi's actual question — the network case)
 *   · an ABSENT declaration does not deny, and SAYS it is not enforcing rather than pretending
 *   · the plan half is opt-in (`enforcePlan`), because charging for a public catalogue is a commercial decision
 *
 * Kept only as a signpost. A zero-caller function that LOOKS like the guard is worse than no function: the next
 * person wires it and repeats the outage. Delete this stub once nothing references the name.
 */
function assertPublicAllowed() {
  throw new Error('assertPublicAllowed is superseded — use lib/visibility-cap.js (capOf + check), wired in routes/entities.js PATCH /profile');
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
    const entity_id = auth.entityOf(req);
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
    const entity_id = auth.entityOf(req);
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
    const entity_id = auth.entityOf(req);
    res.json(await require('../lib/readiness').resolveLaneMatrix(entity_id, req.query.vertical, req.query.origin));
  } catch (err) { res.status(500).json({ error: 'Lanes failed', message: safeErr(err) }); }
});

// GET /api/governance/track-record — the CALLER's SELF-PROVING REFERENCE (relationship rung of the trust ladder):
// counterparties / settled dealings / dispute health, DERIVED from its own real chit copies. Aggregate counts only.
// Self-view: exposing a track record to a buyer is a separate opt-in decision (see SPEC-commercial-attestation.md).
router.get('/track-record', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
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
  try { const entity_id = auth.entityOf(req);
    res.json(await require('../lib/profile').getProfile(entity_id));
  } catch (err) { res.status(500).json({ error: 'Profile failed', message: safeErr(err) }); }
});
router.put('/profile', auth, async (req, res) => {
  try { const entity_id = auth.entityOf(req);
    res.json(await require('../lib/profile').saveProfile(entity_id, req.body || {}));
  } catch (err) { res.status(err.status || 500).json({ error: 'Save profile failed', message: safeErr(err) }); }
});
// TRADE DOCUMENTS VAULT — recurring inputs that pre-fill forms. The vault is now repeatable SECTIONS of free
// rows (the user names their own details), so this endpoint offers the section TYPES rather than a field
// whitelist, plus the tags that can be checked at source. ⚠️ It describes what we OFFER, never what is allowed:
// a row with any name, and any tag or none, is stored regardless.
router.get('/vault-schema', auth, async (req, res) => {
  try { const p = require('../lib/profile');
    res.json({ section_types: p.SECTION_TYPES, verifiable_tags: p.VERIFIABLE_TAGS });
  } catch (err) { res.status(500).json({ error: 'Vault schema failed', message: safeErr(err) }); }
});
router.put('/profile/vault', auth, async (req, res) => {
  try { const entity_id = auth.entityOf(req);
    const b = req.body || {};
    res.json(await require('../lib/profile').saveVault(entity_id, b.vault || b));
  } catch (err) { res.status(err.status || 500).json({ error: 'Save vault failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});
// the entity's OWN required set (mandatory ∪ adopted) resolved from its profile
router.get('/profile/readiness', auth, async (req, res) => {
  try { const entity_id = auth.entityOf(req);
    res.json(await require('../lib/profile').resolveProfileReadiness(entity_id));
  } catch (err) { res.status(500).json({ error: 'Profile readiness failed', message: safeErr(err) }); }
});
// the forward roadmap — which markets you could reach next and what to add
router.get('/profile/path', auth, async (req, res) => {
  try { const entity_id = auth.entityOf(req);
    res.json(await require('../lib/profile').resolvePath(entity_id));
  } catch (err) { res.status(500).json({ error: 'Path failed', message: safeErr(err) }); }
});

// ── AI CO-ASSIST — INVOKED (never autonomous). Drafts a clearance document from the order/product context; returns a
// draft for the human to confirm (not evidence until accepted). Meters per-entity usage (b99). ──
router.post('/ai-draft', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
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
    const entity_id = auth.entityOf(req);
    res.json(await require('../lib/ai').usageSummary(entity_id));
  } catch (err) { res.status(500).json({ error: 'AI usage failed', message: safeErr(err) }); }
});
// the AI skill INVENTORY — what the one co-assist can be invoked to do (id · category · kind · gate · label). The UI
// reads this to place "✨ Draft with AI" wherever a skill's category applies. Single source of truth: the ai_skill TABLE
// (F5), self-healing to the lib/ai.js SEED until b110 is run.
router.get('/ai-skills', auth, async (req, res) => {
  try { res.json({ skills: await require('../lib/ai').listSkills() }); }
  catch (err) { res.status(500).json({ error: 'AI skills failed', message: safeErr(err) }); }
});

// GET /api/governance/readiness/:bridge_id — a COUNTERPARTY's shareable readiness passport (feeds the buyer "trade
// confidence" view). Status + validity only — never raw evidence contents. (Demo: any authed entity; prod may gate to
// a connection.)
router.get('/readiness/:bridge_id', auth, async (req, res) => {
  try {
    /**
     * ⚠️ ACCEPTS A user_id TOO — this is the SUPPLIER-FACING read ("how other suppliers will view this
     * person", Athi 2026-08-20), and a supplier holds a handle, not an internal key. Matching bridge_id alone
     * meant the one endpoint built for outsiders was the one that only took an insider's identifier.
     *
     * ⚠️ bridge_id FIRST: both are unique, but a user_id could equal another entity's key, and the key must
     * win or a business could shadow another's trade record by choosing the right handle. Same ordering as
     * resolveEntity in routes/catalogue.js — one rule, two places, deliberately identical.
     */
    const r = await query(
      `SELECT identity_id, display_name, bridge_id, user_id, gstn, country, policy_flags FROM identities
        WHERE (bridge_id = $1 OR LOWER(user_id) = LOWER($1)) AND identity_type = 'entity'
        ORDER BY (bridge_id = $1) DESC LIMIT 1`,
      [req.params.bridge_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found', message: 'No such entity' });
    const rd = await require('../lib/readiness').resolveReadiness(r.rows[0].identity_id);
    /* ⭐ user_id RIDES ALONG so the caller can DISPLAY a handle rather than a key — invariant 3. bridge_id
       stays because it is what the UI keys the row by. */
    /* ⭐ the public facts with their rung — what they gave, what their books say, what we checked (lib/public-facts.js) */
    let facts = null; try { facts = require('../lib/public-facts').factsOf(r.rows[0]); } catch (_) {}
    res.json({ supplier: { bridge_id: r.rows[0].bridge_id, user_id: r.rows[0].user_id, display_name: r.rows[0].display_name }, facts, ...rd });
  } catch (err) { res.status(500).json({ error: 'Readiness failed', message: safeErr(err) }); }
});

// POST /api/governance/compliance — GATHER a clearance for the acting entity (the supplier records a document).
router.post('/compliance', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    // T1 (reviewer 2026-07-13): a self-gathered document is at most `documented`/`declared`. The verification stamp is
    // the PLATFORM's own attestation and is NEVER accepted from the client here — only /verify may set it. Stripped.
    await require('../lib/readiness').gatherDocument(entity_id, {
      standard_key: b.standard_key, doc_key: b.doc_key, evidence_ref: b.evidence_ref, valid_until: b.valid_until, status: b.status });
    res.json({ message: 'Clearance gathered', ...(await require('../lib/readiness').resolveReadiness(entity_id)).summary });
  } catch (err) { res.status(err.status || 500).json({ error: 'Gather failed', message: safeErr(err) }); }
});

// POST /api/governance/verify — MACHINE-VERIFY a registry ID (IEC/GSTN/PAN) → the "verified" rung. Un-fakeable once the
// Registry verify: confirms the ID against a KYB provider when one is connected (→ VERIFIED); otherwise records it as a
// format-checked claim (→ NOT verified, honest). A malformed ID or a registry "not-active" is refused with 422.
router.post('/verify', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    const v = await require('../lib/verify').verifyRegistry(b.id_type, b.id_value);
    if (!v.ok) return res.status(422).json({ error: 'Verification failed', message: v.note, verdict: v });
    await require('../lib/readiness').gatherDocument(entity_id, {
      standard_key: b.standard_key, doc_key: b.doc_key, evidence_ref: v.value, valid_until: b.valid_until,
      status: 'gathered', trusted: true,   // T1 — ONLY this platform path may set a verification stamp
      verification: { method: v.method, id_type: v.id_type, checked: v.checked, provider: v.provider || null,
        registry: v.registry || null, note: v.note, verified_at: new Date().toISOString() } });
    const msg = v.method === 'registry' ? 'Verified against the registry' : 'Format valid — not registry-confirmed (no provider connected)';
    res.json({ message: msg, verdict: v, ...(await require('../lib/readiness').resolveReadiness(entity_id)).summary });
  } catch (err) { res.status(err.status || 500).json({ error: 'Verify failed', message: safeErr(err) }); }
});

module.exports = router;
module.exports.assertChitAllowed = assertChitAllowed;
module.exports.assertPublicAllowed = assertPublicAllowed;
module.exports.loadActiveConstitution = loadActiveConstitution;

/**
 * ── SUPPLIER READINESS ACCEPTANCE (b177) ────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-20: *"when supplier is selected, its trade ready can be showcased and ask for acceptance —
 * that is all, enough now."* The MECHANISM, deliberately without the rule: no requirement list, no matching,
 * no refusal. Show what they can prove; record that a named person looked and accepted.
 */

/** POST /api/governance/supplier-acceptance — record that this entity accepted a supplier's readiness. */
router.post('/supplier-acceptance', auth, async (req, res) => {
  try {
    if (!(await require('../lib/schema').hasTable('supplier_readiness_acceptance'))) {
      return res.status(503).json({ error: 'Not enabled', code: 'SRA_NOT_MIGRATED',
        message: 'Acceptance is not switched on yet.' });
    }
    const entity_id = auth.entityOf(req);
    const handle = String(req.body.supplier || '').trim();
    if (!handle) return res.status(400).json({ error: 'Bad request', message: 'Which supplier?' });

    /* ⭐ RESOLVED BY HANDLE OR KEY, key first — the same ordering as resolveEntity and the readiness read. */
    const s = await query(
      `SELECT identity_id FROM identities
        WHERE (bridge_id = $1 OR LOWER(user_id) = LOWER($1)) AND identity_type = 'entity'
        ORDER BY (bridge_id = $1) DESC LIMIT 1`, [handle]);
    if (!s.rows.length) return res.status(404).json({ error: 'Not found', message: 'No such supplier' });

    /**
     * ⚠️⚠️ THE SUMMARY IS TAKEN HERE, ON THE SERVER — NEVER ACCEPTED FROM THE CLIENT. A snapshot posted by the
     * browser is a claim about what someone saw, and the whole value of this row is that it is evidence. The
     * same reasoning that strips a client-supplied verification stamp in /compliance.
     */
    const rd = await require('../lib/readiness').resolveReadiness(s.rows[0].identity_id);
    const r = await withEntity(entity_id, (db) => db.query(
      `INSERT INTO supplier_readiness_acceptance (entity_id, supplier_id, summary, accepted_by, note)
            VALUES ($1,$2,$3,$4,$5)
       RETURNING acceptance_id, accepted_at`,
      [entity_id, s.rows[0].identity_id, JSON.stringify(rd.summary || {}),
       req.identity.identity_id, (req.body.note || '').trim() || null]));

    res.json({ message: 'Accepted', acceptance: r.rows[0], summary: rd.summary });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Acceptance failed', message: safeErr(err) });
  }
});

/** GET /api/governance/supplier-acceptance/:handle — the LATEST acceptance, if any. */
router.get('/supplier-acceptance/:handle', auth, async (req, res) => {
  try {
    if (!(await require('../lib/schema').hasTable('supplier_readiness_acceptance'))) {
      return res.json({ acceptance: null, applied: false });
    }
    const entity_id = auth.entityOf(req);
    const s = await query(
      `SELECT identity_id FROM identities
        WHERE (bridge_id = $1 OR LOWER(user_id) = LOWER($1)) AND identity_type = 'entity'
        ORDER BY (bridge_id = $1) DESC LIMIT 1`, [String(req.params.handle || '').trim()]);
    if (!s.rows.length) return res.json({ acceptance: null, applied: true });

    /* ⚠️ withEntity — WITH RLS, on the read as well as the write. Fixing one and not the other is
       indistinguishable from fixing neither; that cost most of an afternoon this morning. */
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT a.acceptance_id, a.summary, a.accepted_at, a.note, i.display_name AS accepted_by_name
         FROM supplier_readiness_acceptance a
         LEFT JOIN identities i ON i.identity_id = a.accepted_by
        WHERE a.entity_id = $1 AND a.supplier_id = $2
        ORDER BY a.accepted_at DESC LIMIT 1`,
      [entity_id, s.rows[0].identity_id]));

    res.json({ acceptance: r.rows[0] || null, applied: true });
  } catch (err) {
    res.status(500).json({ error: 'Read failed', message: safeErr(err) });
  }
});

'use strict';
/*
 * OWNS      protected entity, constitution, readiness passport and clearances.
 * CALLED BY web Standards · Trade readiness.
 * FLOW      auth → entity scope → readiness → answer without another shop's registry values
 * CARD      21-compliance-attestation-and-trade/governance
 */
const versionref = require('../lib/versionref');
const log = require('../lib/logger');
// routes/governance.js — GOV-01 protected entity / constitution / governed inheritance.
// Adapted to this codebase: Express router + query/withTransaction from ../db, identity_id PK,
// parameterized SQL only (closes TD-006 for this surface), default-deny, read view leaks no PII.
const express = require('express');
const router = express.Router();
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { said, faultOf, thrownAs, vaultFault, countrySetupFault, conformanceRefusal, contract } = require('../lib/governance-contract'); // each route's operation (S9) and the words of its refusals
const { query, withTransaction, withEntity } = require('../db');
const auth = require('../middleware/auth');
const { writeGate } = require('../lib/access'); /* TRADE-SRV1 G8: a trade write is the owner's or an editor's — the server says why not */
const { memo } = require('../lib/confcache'); // the active constitution is read once a minute, not once a call
const platformroot = require('../lib/platformroot'); /* W1-SET: the ONE platform-role door (create · re-attest · register a source) */
const checked = contract.checked; // the schema check of one route (its operation in lib/governance-contract.js), spread after its gates

/** the platform door as a gate: a shop's login is refused 403 NOT_PLATFORM before anything is read or checked */
function platformGate(req, res, next) {
  if (platformroot.refuseUnlessPlatform(req, res)) next();
}
/** Country setup is the OWNER's (not a key, not a co-assist): the server decides */
function ownerGate(req, res, next) {
  if (require('../lib/owner').isOwner(req)) return next();
  return problem(req, res, said({ status: 403, code: 'OWNER_ONLY' }, 'Only the owner may do this.', 'Only the owner may do this.'));
}

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
        WHERE pc.is_active LIMIT 1`
    );
    if (!rows.length) return null; // no-orphan: caller must reject
    const r = rows[0];
    return { version: r.version, root_id: r.root_id, plan_menu: r.plan_menu, ...r.params };
  });
}

async function countEntities(rootId) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM identities WHERE governed_by = $1`, [rootId]);
  return rows[0].n;
}
/** today's chits sent by one entity (UTC day) — also read by the Home Plan card, in its own batch (SET-35) */
const CHITS_TODAY_SQL = `SELECT count(*)::int AS n FROM chit_header
      WHERE sender_entity_id = $1
        AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
async function countChitsToday(entityId) {
  // UTC-day window (absolute-time invariant). B1 RLS: an entity's own sent chits -> withEntity(entity). (Dormant
  // guard — call it OUTSIDE any open entity transaction to avoid nesting when it's eventually wired.)
  const { rows } = await withEntity(entityId, (c) => c.query(CHITS_TODAY_SQL, [entityId]));
  return rows[0] ? rows[0].n : 0; /* no row is no chits, never a throw */
}

// ── GET /api/governance/entities/:id — read-only view, no PII ──
/* the one answer for an id this caller may not read and for an id that is not there: the door never says another shop exists */
const notGoverned = () => said({ status: 404, code: 'NOT_FOUND' }, 'entity not found or not governed');
router.get('/entities/:id', auth, ...checked('GET /entities/:id'), async (req, res) => {
  /* ⚠️ SEC (23 Oct, found by the generated foreign_id_404 case): a shop's plan, overrides and exceptions are ITS data. A shop reads
     its own; the platform reads any; another shop's id gets the unknown id's 404. Before, any signed-in shop could read any shop's. */
  if (String(req.params.id) !== String(auth.entityOf(req)) && !platformroot.isPlatform(req)) return problem(req, res, notGoverned());
  try {
    const { rows } = await query(
      `SELECT constitution_version, params_override, plan
         FROM identities WHERE governed_by IS NOT NULL AND identity_id = $1`,
      [req.params.id]
    );
    if (!rows.length) return problem(req, res, notGoverned());
    const ent = rows[0];

    const active = await loadActiveConstitution();
    if (!active) return problem(req, res, said({ status: 503, code: 'NO_CONSTITUTION' }, 'no active constitution'));

    const { effective, exceptions } = resolve(active, ent.params_override || {});
    res.json({
      minted_version: ent.constitution_version,
      active_version: active.version,
      drift: driftStatus(ent.constitution_version, active.version),
      plan: ent.plan,
      effective,
      exceptions
    });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'governance view failed'));
  }
});

/**
 * Write the Class-C exceptions a governed create stamped, under the NEW shop's own binding. governance_exceptions is RLS-scoped to one shop (b778),
 * and this request makes the shop it writes for, so the new id is bound for the rest of the transaction (the step routes/catalogue.js:1632 takes);
 * until b778 runs the binding changes nothing.
 */
async function writeMintExceptions(client, newId, exceptions) {
  await client.query(`SELECT set_config('app.current_entity', $1, true)`, [String(newId)]);
  for (const ex of exceptions) {
    await client.query(`INSERT INTO governance_exceptions (entity_id, klass, key, detail) VALUES ($1,$2,$3,$4)`, [newId, ex.klass, ex.key, ex.detail]);
  }
}

// ── POST /api/governance/entities — governed create (the platform role only: lib/platformroot.refuseUnlessPlatform) ──
// Transactional: the identity row + its Class-C exceptions commit together.
router.post('/entities', auth, platformGate, ...checked('POST /entities'), async (req, res) => {
  const override = (req.body && req.body.params_override) || {};
  const plan = (req.body && req.body.plan) || 'free';
  const display_name = ((req.body && req.body.display_name) || '').trim();
  const email = ((req.body && req.body.email) || '').trim().toLowerCase();
  if (!display_name || !email) return problem(req, res, said({ status: 400, code: 'GOV_BAD_REQUEST' }, 'display_name and email required'));

  try {
    const active = await loadActiveConstitution();
    if (!active) return problem(req, res, said({ status: 503, code: 'NO_CONSTITUTION' }, 'no active constitution (default-deny)'));

    // entitlement: entity-count quota for the installation's plan
    const used = await countEntities(active.root_id);
    const q = checkCount(planFor(active, plan), 'max_entities', used);
    if (!q.ok) return problem(req, res, said({ status: 409, code: 'ENTITY_QUOTA' }, 'entity quota reached', undefined, { quota: q.info }));

    // conformance: resolve + stamp (throws GovernanceError on Class A/B)
    let stamp;
    try {
      stamp = mintEntity(active, active.root_id, override);
    } catch (e) {
      return problem(req, res, conformanceRefusal(e));
    }

    const out = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO identities
           (bridge_id, display_name, email, identity_type, status,
            governed_by, constitution_version, params_override, plan, entity_kind, country)
         VALUES ($1,$2,$3,'entity','active',$4,$5,$6,$7,'customer',NULL)   -- GOV-AU1: nobody stated it — Country setup asks
         RETURNING identity_id`,
        [genBridge(), display_name, email, stamp.governed_by, stamp.constitution_version, JSON.stringify(stamp.params_override), plan]
      );
      const newId = ins.rows[0].identity_id;
      await writeMintExceptions(client, newId, stamp.exceptions);
      return { id: newId };
    });

    res.status(201).json({ id: out.id, effective: stamp.effective, exceptions: stamp.exceptions });
  } catch (err) {
    if (err.code === '23505') return problem(req, res, said({ status: 409, code: 'ENTITY_EMAIL_TAKEN' }, 'email already exists'));
    problem(req, res, faultOf(err, req, 'governed create failed'));
  }
});

// ── POST /api/governance/entities/:id/reattest — re-stamp to active version (clears drift) ──
// Forward-only: an entity's NEW chits then resolve under the active constitution;
// chits already sent stay frozen at their original version (handled at send/freeze time).
router.post('/entities/:id/reattest', auth, platformGate, ...checked('POST /entities/:id/reattest'), async (req, res) => {
  try {
    const { rows } = await query(`SELECT params_override FROM identities WHERE governed_by IS NOT NULL AND identity_id = $1`, [req.params.id]);
    if (!rows.length) return problem(req, res, notGoverned());

    const active = await loadActiveConstitution();
    if (!active) return problem(req, res, said({ status: 503, code: 'NO_CONSTITUTION' }, 'no active constitution'));

    let ra;
    try {
      ra = reattest(active, rows[0].params_override || {});
    } catch (e) {
      return problem(req, res, conformanceRefusal(e));
    }

    await query(`UPDATE identities SET constitution_version = $1 WHERE identity_id = $2`, [ra.constitution_version, req.params.id]);
    res.json({ message: 'Re-attested', constitution_version: ra.constitution_version, drift: false, effective: ra.effective, exceptions: ra.exceptions });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'reattest failed'));
  }
});

// ── Guards to call from core flows WHEN enforcement is enabled (not wired yet) ──
async function assertChitAllowed(entityId, plan) {
  const active = await loadActiveConstitution();
  if (!active) {
    const e = new Error('no active constitution');
    e.status = 503;
    throw e;
  }
  const used = await countChitsToday(entityId);
  const r = checkRate(planFor(active, plan), 'chits_per_day', used);
  if (!r.ok) {
    const e = new Error('daily chit limit reached');
    e.status = 429;
    e.quota = r.info;
    throw e;
  }
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
router.post('/conformance', auth, ...checked('POST /conformance'), async (req, res) => {
  try {
    const data = req.body && typeof req.body.data === 'object' && req.body.data ? req.body.data : req.body || {};
    const scope = req.body && typeof req.body.scope === 'string' ? req.body.scope : 'chit';
    const checkedAgainst = await require('../lib/conformance').checkConformance(data, scope);
    /* S34: the answer's six keys, all named (lib/conformance.js checkConformance) */
    res.json({ status: checkedAgainst.status, scope: checkedAgainst.scope, advisory: checkedAgainst.advisory, note: checkedAgainst.note, checked: checkedAgainst.checked, gaps: checkedAgainst.gaps });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Conformance check failed'));
  }
});

// GET /api/governance/boilerplate/:key — read the sealed MOULD: its DECLARED sources + bound locale ("see the mould").
router.get('/boilerplate/:key', auth, ...checked('GET /boilerplate/:key'), async (req, res) => {
  try {
    const bp = await require('../lib/boilerplate').resolveBoilerplate(req.params.key);
    if (!bp) return problem(req, res, said({ status: 404, code: 'NOT_FOUND' }, 'Not found', 'No such boilerplate'));
    /* S34: the mould's keys, all named; each declared source to the six columns its statement selects (lib/boilerplate.js resolveBoilerplate) */
    // prettier-ignore
    res.json({ key: bp.key, version: bp.version, label: bp.label, region_code: bp.region_code, locale: bp.locale, brand: bp.brand, standards: bp.standards, sources: bp.sources.map((x) => ({ source_key: x.source_key, source_kind: x.source_kind, facet: x.facet, source_entity_id: x.source_entity_id, source_bridge: x.source_bridge, source_name: x.source_name })) });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Boilerplate read failed'));
  }
});

// POST /api/governance/boilerplate/:key/adopt — the minted-path binding: stamp the caller's entity with this mould so
// it resolves the mould's DECLARED sources (bounded, not global). Upsert; preserves any existing constitution.
router.post('/boilerplate/:key/adopt', auth, ...checked('POST /boilerplate/:key/adopt'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const bp = await require('../lib/boilerplate').resolveBoilerplate(req.params.key);
    if (!bp) return problem(req, res, said({ status: 404, code: 'NOT_FOUND' }, 'Not found', 'No such boilerplate'));
    await withEntity(entity_id, (c) =>
      c.query(
        `INSERT INTO entity_governance (entity_id, constitution_key, boilerplate_key)
       VALUES ($1, COALESCE((SELECT constitution_key FROM constitution WHERE active = true AND is_default = true LIMIT 1), 'trade'), $2)
       ON CONFLICT (entity_id) DO UPDATE SET boilerplate_key = EXCLUDED.boilerplate_key`,
        [entity_id, bp.key]
      )
    );
    require('../lib/workpattern').invalidateWorkPattern(entity_id); // re-stamp → next resolve re-derives
    res.json({ message: 'Minted from boilerplate', boilerplate: versionref.format(bp.key, bp.version), standards: bp.standards, locale: bp.locale });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Adopt failed'));
  }
});

// POST /api/governance/source — REGISTER a source as a sealed SOURCE-ENTITY + upload its typed content + stamp it.
// One call = the runbook's "register entity → upload standard → stamp as source". Idempotent by source_key.
// ⚠️ W1-SET (GOV2): the platform role only — a source is a PLATFORM entity every shop's standards resolve against (lib/source.js
// mints it with owner_scope 'platform'), so a shop's login is refused BEFORE anything is read (403 NOT_PLATFORM, the sentence).
router.post('/source', auth, platformGate, ...checked('POST /source'), async (req, res) => {
  try {
    const b = req.body || {};
    const out = await require('../lib/source').registerSource({
      source_key: (b.source_key || '').trim(),
      title: b.title,
      facet: b.facet,
      kind: b.kind,
      template: b.template
    });
    const sourceEntity = out.entity;
    res.json({ message: 'Source registered & stamped', source: { source_key: out.source_key, kind: out.kind, facet: out.facet, entity: { identity_id: sourceEntity.identity_id, bridge_id: sourceEntity.bridge_id, display_name: sourceEntity.display_name } } });
  } catch (err) {
    problem(req, res, thrownAs(err, req, 'Register source failed'));
  }
});

// GET /api/governance/source/:key — view a source: its typed content + its owning source-entity (stable id + mutable name).
router.get('/source/:key', auth, ...checked('GET /source/:key'), async (req, res) => {
  try {
    const s = await require('../lib/source').resolveSourceEntity(req.params.key);
    if (!s) return problem(req, res, said({ status: 404, code: 'NOT_FOUND' }, 'Not found', 'No such source'));
    /* S34: the eight columns the statement selects (lib/source.js resolveSourceEntity) */
    // prettier-ignore
    res.json({ standard_key: s.standard_key, version: s.version, facet: s.facet, title: s.title, template: s.template, identity_id: s.identity_id, bridge_id: s.bridge_id, display_name: s.display_name });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Source read failed'));
  }
});

// GET /api/governance/readiness — the CALLER's own trade readiness. ?destination=EU&vertical=paint → resolved FOR that
// destination (spin the globe), with guidance on each gap; otherwise the entity's own standards.
router.get('/readiness', auth, ...checked('GET /readiness'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const R = require('../lib/readiness');
    const out = req.query.destination
      ? await R.resolveForDestination(entity_id, String(req.query.destination), req.query.vertical, req.query.origin)
      : await R.resolveReadiness(entity_id);
    /* G8: what this login may do here — the server answers, the screen greys a refused button WITH the sentence */
    const m = require('../lib/access').mayWrite(req);
    /* S34: every key either branch (the entity's own standards, or a destination) can carry is named; a key the branch does not carry is undefined, and JSON leaves it out */
    // prettier-ignore
    res.json({ origin: out.origin, vertical: out.vertical, destination: out.destination, dest_name: out.dest_name, domestic: out.domestic, asked: out.asked, code: out.code, why: out.why, standards: out.standards, clearances: out.clearances, summary: out.summary, may: { gather: m, verify: m } });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Readiness failed'));
  }
});

// GET /api/governance/lanes?vertical=paint — the CALLER's market-readiness MATRIX (readiness % per destination + gaps).
router.get('/lanes', auth, ...checked('GET /lanes'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const m = require('../lib/access').mayWrite(req); /* G8 */
    const matrix = await require('../lib/readiness').resolveLaneMatrix(entity_id, req.query.vertical, req.query.origin);
    res.json({ vertical: matrix.vertical, origin: matrix.origin, asked: matrix.asked, code: matrix.code, why: matrix.why, lanes: matrix.lanes, may: { gather: m, verify: m } });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Lanes failed'));
  }
});

// GET /api/governance/track-record — the CALLER's SELF-PROVING REFERENCE (relationship rung of the trust ladder):
// counterparties / settled dealings / dispute health, DERIVED from its own real chit copies. Aggregate counts only.
// Self-view: exposing a track record to a buyer is a separate opt-in decision (see SPEC-commercial-attestation.md).
router.get('/track-record', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const record = await require('../lib/reference').resolveTrackRecord(entity_id);
    /* S34: the reference's strength words, then its counts */
    // prettier-ignore
    res.json({ rung: record.rung, note: record.note, disputes_clean: record.disputes_clean, counterparties: record.counterparties, dealings: record.dealings, settled: record.settled, disputes_open: record.disputes_open, disputes_resolved: record.disputes_resolved, on_rail_since: record.on_rail_since, last_dealing: record.last_dealing });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Track record failed'));
  }
});

// ── COMMERCE LAYER — the commercial-instrument cluster + the end-to-end settlement chain (derive-not-enumerate). ──
// GET /api/governance/instruments?incoterm=CIF&cross_border=1 — the cluster of EXIM instruments grouped by RISK covered.
router.get('/instruments', auth, ...checked('GET /instruments'), async (req, res) => {
  try {
    const cross_border = req.query.cross_border == null ? true : !['0', 'false', 'no'].includes(String(req.query.cross_border));
    const cluster = require('../lib/instruments').resolveInstruments({ cross_border, incoterm: req.query.incoterm });
    res.json({ framework: cluster.framework, cross_border: cluster.cross_border, incoterm: cluster.incoterm, cargo_insured_by: cluster.cargo_insured_by, frm_classes: cluster.frm_classes, cluster: cluster.cluster });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Instruments failed'));
  }
});
// GET /api/governance/journey?incoterm=CIF&cross_border=1 — the ordered end-to-end settlement chain (partner + cover per stage).
router.get('/journey', auth, ...checked('GET /journey'), async (req, res) => {
  try {
    const cross_border = req.query.cross_border == null ? true : !['0', 'false', 'no'].includes(String(req.query.cross_border));
    const journey = require('../lib/instruments').resolveJourney({ cross_border, incoterm: req.query.incoterm });
    res.json({ cross_border: journey.cross_border, incoterm: journey.incoterm, chain: journey.chain });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Journey failed'));
  }
});
// GET /api/governance/commerce-standards — the commerce standards (Incoterms/UCP/FRM) as governed source-entities (b93).
router.get('/commerce-standards', auth, async (req, res) => {
  try {
    const standards = await require('../lib/instruments').commerceStandards();
    res.json({ framework: standards.framework, governed: standards.governed, sources: standards.sources });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Commerce standards failed'));
  }
});

// ── ENTITY TRADE PROFILE — individual-specific: trade mode + markets + sectors + adopted certs (b96). ──
router.get('/profile', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const held = await require('../lib/profile').getProfile(entity_id);
    /* S34: the trade profile and the vault beside it, every key named (the same eight keys PUT /profile answers) */
    // prettier-ignore
    res.json({ trade_mode: held.trade_mode, markets: held.markets, sectors: held.sectors, adopted: held.adopted, vault: held.vault, vault_version: held.vault_version, invoice_party: held.invoice_party, vault_encrypted: held.vault_encrypted });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Profile failed'));
  }
});
/**
 * ⚠️ THE PROFILE IS A SHELF EVERY SCREEN HOLDS A COPY OF — `UI._party` feeds the Invoice row, the UPI id and
 * the vault. It was the one piece of reference data that changed without telling anybody, so a tab open
 * elsewhere kept showing the old supplier block until it was reloaded.
 */
router.put('/profile', auth, writeGate, ...checked('PUT /profile'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const saved = await require('../lib/profile').saveProfile(entity_id, req.body || {});
    /* ⚠ AFTER the save, not before it. Announcing a change that has not happened yet is a lie every open tab
       acts on, and it would fire even when saveProfile throws. */
    try {
      require('../lib/shopchanged').shopChanged(entity_id, 'profile');
    } catch (e) {
      log.fellBack('governance PUT /profile: the signal was not sent — carried on without it', e);
    }
    /* S34: the same eight keys GET /profile answers (saveProfile answers the profile it just wrote) */
    // prettier-ignore
    res.json({ trade_mode: saved.trade_mode, markets: saved.markets, sectors: saved.sectors, adopted: saved.adopted, vault: saved.vault, vault_version: saved.vault_version, invoice_party: saved.invoice_party, vault_encrypted: saved.vault_encrypted });
  } catch (err) {
    problem(req, res, thrownAs(err, req, 'Save profile failed'));
  }
});
// TRADE DOCUMENTS VAULT — recurring inputs that pre-fill forms. The vault is now repeatable SECTIONS of free
// rows (the user names their own details), so this endpoint offers the section TYPES rather than a field
// whitelist, plus the tags that can be checked at source. ⚠️ It describes what we OFFER, never what is allowed:
// a row with any name, and any tag or none, is stored regardless.
router.get('/vault-schema', auth, async (req, res) => {
  try {
    const p = require('../lib/profile');
    res.json({ section_types: p.SECTION_TYPES, verifiable_tags: p.VERIFIABLE_TAGS });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Vault schema failed'));
  }
});
/** one PUT /profile/vault body: a patch, or a whole vault (a first fill — over an existing vault it must name the version); → { saved } or { refusal } */
async function writeVaultBody(entity_id, body) {
  const profile = require('../lib/profile');
  if (require('../lib/vault-patch').isPatchBody(body)) return { saved: await profile.patchVault(entity_id, body.patch, body.version) };
  const held = await profile.readVault(entity_id);
  if (held.version && body.version == null) {
    const words = 'This screen is older than the vault — reload it, then save.';
    return { refusal: words };
  }
  if (held.version && String(body.version) !== held.version) throw profile.vaultChanged();
  return { saved: await profile.saveVault(entity_id, body.vault || body, { expect: held.version }) };
}
/**
 * ⭐ SET-WALK1 · W25 (2026-10-15) — THE VAULT IS SAVED AS A MERGE-PATCH WITH A VERSION, NEVER REPLACED BLIND.
 *   PUT /api/governance/profile/vault  { version, patch: { sections: { '<type>|<label>': { label?, rows: { 't:<tag>' | 'n:<name>': { name, value, tag } | null } } | null } } }
 *     → { vault, version }.  RFC 7386 over the keyed view (lib/vault-patch): only what this screen changed travels; null removes.
 *     409 VAULT_CHANGED "Changed since you opened it — reload?" when `version` ≠ the server's (GET /profile answers `vault_version`).
 *   The old whole body { vault: { sections: [...] } } is still taken for a FIRST fill (no row yet); over an existing vault it needs the
 *     version too (409 VAULT_VERSION_REQUIRED otherwise) — a blind replace is exactly the lost update Athi saw.
 *   Who may: the owner or an editor (SEC-71: lib/access writeGate — a viewer/commenter gets 403 read_only/comment_only WITH the rail's sentence). Trips: 1 read + 1 conditional write (+ the mirror's).
 */
router.put('/profile/vault', auth, writeGate, ...checked('PUT /profile/vault'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    const written = await writeVaultBody(entity_id, b);
    if (written.refusal) return problem(req, res, said({ status: 409, code: 'VAULT_VERSION_REQUIRED' }, written.refusal, written.refusal, { code: 'VAULT_VERSION_REQUIRED' }));
    const saved = written.saved;
    /* ⭐ the Business identity rows are the counter's bill header (trade name, address, phone) — so open counters hear it */
    try {
      require('../lib/shopchanged').shopChanged(entity_id, 'profile');
    } catch (e) {
      log.fellBack('governance PUT /profile/vault: the signal was not sent — carried on without it', e);
    }
    res.json({ vault: saved.vault, version: saved.version }); /* S34: saveVault answers { vault, version } */
  } catch (err) {
    problem(req, res, vaultFault(err, req));
  }
});
// the entity's OWN required set (mandatory ∪ adopted) resolved from its profile
router.get('/profile/readiness', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const ownReadiness = await require('../lib/profile').resolveProfileReadiness(entity_id);
    res.json({ profile: ownReadiness.profile, asked: ownReadiness.asked, code: ownReadiness.code, why: ownReadiness.why, clearances: ownReadiness.clearances, summary: ownReadiness.summary });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Profile readiness failed'));
  }
});
// the forward roadmap — which markets you could reach next and what to add
router.get('/profile/path', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const road = await require('../lib/profile').resolvePath(entity_id);
    res.json({ profile: road.profile, sector: road.sector, origin: road.origin, asked: road.asked, code: road.code, why: road.why, lanes: road.lanes, adoptable: road.adoptable });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Path failed'));
  }
});

/**
 * ⭐ CS1 · COUNTRY SETUP (2026-10-12) — the entity's governance profile: country · currency · financial-year start · tax registration,
 * completed by the OWNER after registration, before the books open (lib/country-setup.js; DECISIONS 2026-10-03: no silent India).
 *   GET /api/governance/country-setup  — any signed-in login of the shop (the step paints; a co-assist reads it): the profile, with
 *                                        `required` (the step is still to be done), `pack` { books, code, why } — the ONE sentence for a
 *                                        pack-less country — and each field's `source`. 1 trip cold (+1 after b299), schema probe cached.
 *   PUT /api/governance/country-setup  — OWNER ONLY (no key, no co-assist; the server decides): { country, currency, fy_start_month,
 *                                        tax: { registered, number, scheme }, source: { field: words } } → the profile. One transaction.
 *                                        400 in words · 409 a different country (a new entity) · 503 COUNTRY_SETUP_NOT_MIGRATED before b299.
 * Trips: GET 2 (identities + entity_governance, inside one withEntity) · PUT 2 reads + 2 writes (+1 insert for a shop with no stamp row).
 */
router.get('/country-setup', auth, ...checked('GET /country-setup'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const CS = require('../lib/country-setup');
    const setup = await withEntity(entity_id, (h) => CS.profile(h, entity_id));
    /* S34: the profile's keys, all named (lib/country-setup.js profile) */
    // prettier-ignore
    res.json({ migrated: setup.migrated, done: setup.done, set_at: setup.set_at, required: setup.required, country: setup.country, currency: setup.currency, fy_start_month: setup.fy_start_month, tax: setup.tax, timezone: setup.timezone, zones: setup.zones, constituted: setup.constituted, constituted_by: setup.constituted_by, countries: setup.countries, source: setup.source, pack: setup.pack });
  } catch (err) {
    problem(req, res, countrySetupFault(err, req, 'Country setup could not be read', 500));
  }
});
router.put('/country-setup', auth, ownerGate, ...checked('PUT /country-setup'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const CS = require('../lib/country-setup');
    const out = await withEntity(entity_id, (h) =>
      CS.save(h, entity_id, req.body || {}, req.identity && req.identity.identity_id)
    ); /* CS2: who corrected the country is logged */
    /* the books gate's cached answer and the books-hooks switch cache both move with the country */
    try {
      require('../lib/books-hooks').forget(entity_id);
    } catch (e) {
      log.fellBack('governance PUT /country-setup: the helper failed — carried on without it', e);
    }
    try {
      require('../lib/shopchanged').shopChanged(entity_id, 'profile');
    } catch (e) {
      log.fellBack('governance PUT /country-setup: the signal was not sent — carried on without it', e);
    }
    /* S34: the profile's keys, all named as GET answers them, and `rederived` when the country was corrected (lib/country-setup.js save) */
    // prettier-ignore
    res.json({ migrated: out.migrated, done: out.done, set_at: out.set_at, required: out.required, country: out.country, currency: out.currency, fy_start_month: out.fy_start_month, tax: out.tax, timezone: out.timezone, zones: out.zones, constituted: out.constituted, constituted_by: out.constituted_by, countries: out.countries, source: out.source, pack: out.pack, rederived: out.rederived });
  } catch (err) {
    problem(req, res, countrySetupFault(err, req, 'Country setup could not be saved', 422));
  }
});

// ── AI CO-ASSIST — INVOKED (never autonomous). Drafts a clearance document from the order/product context; returns a
// draft for the human to confirm (not evidence until accepted). Meters per-entity usage (b99). ──
router.post('/ai-draft', auth, ...checked('POST /ai-draft'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    const drafted = await require('../lib/ai').invokeSkill(entity_id, b.skill_id || b.doc_type, b.context || {});
    /* S34: the draft's keys, all named (lib/ai.js invokeSkill: `data` only for a form-fill skill, `truncated` only when the reply was cut) */
    // prettier-ignore
    res.json({ skill: drafted.skill, kind: drafted.kind, gate: drafted.gate, draft: drafted.draft, data: drafted.data, model: drafted.model, truncated: drafted.truncated, usage: drafted.usage, note: drafted.note });
  } catch (err) {
    // 4xx are intentional, client-safe reasons (gate 402/429 · unknown skill 400) → show them;
    // 5xx keep the generic message (no internal/DB text leaks).
    problem(req, res, thrownAs(err, req, 'AI draft failed', true));
  }
});
// per-entity AI spend (metering / charge-back)
router.get('/ai-usage', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const spend = await require('../lib/ai').usageSummary(entity_id);
    /* S34: the metered answer, then the one a shop gets before b99 (calls · tokens · spent_usd · credits_usd · balance_usd · free_usd · budget_usd · remaining_usd are in both; rates and note in one each) */
    // prettier-ignore
    res.json({ calls: spend.calls, tokens: spend.tokens, spent_usd: spend.spent_usd, credits_usd: spend.credits_usd, balance_usd: spend.balance_usd, free_usd: spend.free_usd, budget_usd: spend.budget_usd, remaining_usd: spend.remaining_usd, rate_per_hour: spend.rate_per_hour, rate_per_day: spend.rate_per_day, note: spend.note });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'AI usage failed'));
  }
});
// the AI skill INVENTORY — what the one co-assist can be invoked to do (id · category · kind · gate · label). The UI
// reads this to place "✨ Draft with AI" wherever a skill's category applies. Single source of truth: the ai_skill TABLE
// (F5), self-healing to the lib/ai.js SEED until b110 is run.
router.get('/ai-skills', auth, async (req, res) => {
  try {
    res.json({ skills: await require('../lib/ai').listSkills() });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'AI skills failed'));
  }
});

/** may this caller read that entity's readiness passport — its own, or a party on the caller's customer or supplier list (lib/books-store partyOn, the one party test) */
async function mayReadPassport(req, entity_id) {
  const callerId = auth.entityOf(req);
  if (String(callerId) === String(entity_id)) return true;
  const on = await withEntity(callerId, (db) => require('../lib/books-store').partyOn(db, callerId, entity_id));
  return Boolean(on.customer || on.supplier);
}

// GET /api/governance/readiness/:bridge_id — a COUNTERPARTY's shareable readiness passport (feeds the buyer "trade
// confidence" view). Status + validity only — never raw evidence contents. SEC-92: only the owner or a shop that lists it as a party.
router.get('/readiness/:bridge_id', auth, ...checked('GET /readiness/:bridge_id'), async (req, res) => {
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
      [req.params.bridge_id]
    );
    /* SEC-92: a passport is shown to its owner and to a shop that has the owner on its customer or supplier list; every other id answers as an unknown one */
    if (!r.rows.length || !(await mayReadPassport(req, r.rows[0].identity_id))) return problem(req, res, said({ status: 404, code: 'NOT_FOUND' }, 'Not found', 'No such entity'));
    const rd = await require('../lib/readiness').resolveReadiness(r.rows[0].identity_id);
    /* ⭐ user_id RIDES ALONG so the caller can DISPLAY a handle rather than a key — invariant 3. bridge_id
       stays because it is what the UI keys the row by. */
    /* ⭐ the public facts with their rung — what they gave, what their books say, what we checked (lib/public-facts.js) */
    let facts = null;
    try {
      facts = require('../lib/public-facts').factsOf(r.rows[0]);
    } catch (e) {
      log.fellBack('governance GET /readiness/:bridge_id: the helper failed — carried on without it', e);
    }
    /* SEC-FIX3 S6: the registry value (PAN, IEC, GSTIN) rides in evidence_ref — it stays with its owner; a stranger sees status + rung only */
    const isOwnRow = String(auth.entityOf(req)) === String(r.rows[0].identity_id);
    const shown = isOwnRow
      ? rd
      : Object.assign({}, rd, { clearances: (rd.clearances || []).map((clearance) => Object.assign({}, clearance, { evidence_ref: null })) });
    /* S34: the passport is the entity's own readiness answer (standards · clearances · summary) beside the supplier and the facts */
    res.json({ supplier: { bridge_id: r.rows[0].bridge_id, user_id: r.rows[0].user_id, display_name: r.rows[0].display_name }, facts, standards: shown.standards, clearances: shown.clearances, summary: shown.summary });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Readiness failed'));
  }
});

// POST /api/governance/compliance — GATHER a clearance for the acting entity (the supplier records a document).
router.post('/compliance', auth, writeGate, ...checked('POST /compliance'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    // T1 (reviewer 2026-07-13): a self-gathered document is at most `documented`/`declared`. The verification stamp is
    // the PLATFORM's own attestation and is NEVER accepted from the client here — only /verify may set it. Stripped.
    await require('../lib/readiness').gatherDocument(entity_id, {
      standard_key: b.standard_key,
      doc_key: b.doc_key,
      evidence_ref: b.evidence_ref,
      valid_until: b.valid_until,
      status: b.status
    });
    const sum = (await require('../lib/readiness').resolveReadiness(entity_id)).summary;
    /* S34: the summary's ten keys, all named (lib/readiness.js summarize) */
    // prettier-ignore
    res.json({ message: 'Clearance gathered', total: sum.total, met: sum.met, pending: sum.pending, expiring: sum.expiring, expired: sum.expired, ready: sum.ready, percent: sum.percent, verified: sum.verified, attested: sum.attested, documented: sum.documented });
  } catch (err) {
    problem(req, res, thrownAs(err, req, 'Gather failed'));
  }
});

// POST /api/governance/verify — MACHINE-VERIFY a registry ID (IEC/GSTN/PAN) → the "verified" rung. Un-fakeable once the
// Registry verify: confirms the ID against a KYB provider when one is connected (→ VERIFIED); otherwise records it as a
// format-checked claim (→ NOT verified, honest). A malformed ID or a registry "not-active" is refused with 422.
router.post('/verify', auth, writeGate, ...checked('POST /verify'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const b = req.body || {};
    const node = await require('../lib/verify').verifyRegistry(b.id_type, b.id_value);
    if (!node.ok) return problem(req, res, said({ status: 422, code: 'VERIFICATION_FAILED' }, 'Verification failed', node.note, { verdict: node }));
    await require('../lib/readiness').gatherDocument(entity_id, {
      standard_key: b.standard_key,
      doc_key: b.doc_key,
      evidence_ref: node.value,
      valid_until: b.valid_until,
      status: 'gathered',
      trusted: true, // T1 — ONLY this platform path may set a verification stamp
      verification: {
        method: node.method,
        id_type: node.id_type,
        checked: node.checked,
        provider: node.provider || null,
        registry: node.registry || null,
        note: node.note,
        verified_at: new Date().toISOString()
      }
    });
    const msg = node.method === 'registry' ? 'Verified against the registry' : 'Format valid — not registry-confirmed (no provider connected)';
    const sum = (await require('../lib/readiness').resolveReadiness(entity_id)).summary;
    // prettier-ignore
    res.json({ message: msg, verdict: node, total: sum.total, met: sum.met, pending: sum.pending, expiring: sum.expiring, expired: sum.expired, ready: sum.ready, percent: sum.percent, verified: sum.verified, attested: sum.attested, documented: sum.documented });
  } catch (err) {
    problem(req, res, thrownAs(err, req, 'Verify failed'));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };
module.exports = router;
module.exports.assertChitAllowed = assertChitAllowed;
module.exports.assertPublicAllowed = assertPublicAllowed;
module.exports.loadActiveConstitution = loadActiveConstitution;
module.exports.CHITS_TODAY_SQL = CHITS_TODAY_SQL;
module.exports.countChitsToday = countChitsToday; /* SET-35: the Plan & usage card counts today's chits with the quota's own counter, never a second one */

/**
 * ── SUPPLIER READINESS ACCEPTANCE (b177) ────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-20: *"when supplier is selected, its trade ready can be showcased and ask for acceptance —
 * that is all, enough now."* The MECHANISM, deliberately without the rule: no requirement list, no matching,
 * no refusal. Show what they can prove; record that a named person looked and accepted.
 */

/** POST /api/governance/supplier-acceptance — record that this entity accepted a supplier's readiness. */
router.post('/supplier-acceptance', auth, writeGate, ...checked('POST /supplier-acceptance'), async (req, res) => {
  try {
    if (!(await require('../lib/schema').hasTable('supplier_readiness_acceptance'))) {
      return problem(req, res, said({ status: 503, code: 'SRA_NOT_MIGRATED' }, 'Not enabled', 'Acceptance is not switched on yet.', { code: 'SRA_NOT_MIGRATED' }));
    }
    const entity_id = auth.entityOf(req);
    const handle = String(req.body.supplier || '').trim();
    if (!handle) return problem(req, res, said({ status: 400, code: 'GOV_BAD_REQUEST' }, 'Bad request', 'Which supplier?'));

    /* ⭐ RESOLVED BY HANDLE OR KEY, key first — the same ordering as resolveEntity and the readiness read. */
    const s = await query(
      `SELECT identity_id FROM identities
        WHERE (bridge_id = $1 OR LOWER(user_id) = LOWER($1)) AND identity_type = 'entity'
        ORDER BY (bridge_id = $1) DESC LIMIT 1`,
      [handle]
    );
    if (!s.rows.length) return problem(req, res, said({ status: 404, code: 'NOT_FOUND' }, 'Not found', 'No such supplier'));

    /**
     * ⚠️⚠️ THE SUMMARY IS TAKEN HERE, ON THE SERVER — NEVER ACCEPTED FROM THE CLIENT. A snapshot posted by the
     * browser is a claim about what someone saw, and the whole value of this row is that it is evidence. The
     * same reasoning that strips a client-supplied verification stamp in /compliance.
     */
    const rd = await require('../lib/readiness').resolveReadiness(s.rows[0].identity_id);
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `INSERT INTO supplier_readiness_acceptance (entity_id, supplier_id, summary, accepted_by, note)
            VALUES ($1,$2,$3,$4,$5)
       RETURNING acceptance_id, accepted_at`,
        [entity_id, s.rows[0].identity_id, JSON.stringify(rd.summary || {}), req.identity.identity_id, (req.body.note || '').trim() || null]
      )
    );

    res.json({ message: 'Accepted', acceptance: { acceptance_id: r.rows[0].acceptance_id, accepted_at: r.rows[0].accepted_at }, summary: rd.summary }); /* S34: the two columns RETURNING selects */
  } catch (err) {
    problem(req, res, thrownAs(err, req, 'Acceptance failed'));
  }
});

/** GET /api/governance/supplier-acceptance/:handle — the LATEST acceptance, if any. */
router.get('/supplier-acceptance/:handle', auth, ...checked('GET /supplier-acceptance/:handle'), async (req, res) => {
  try {
    if (!(await require('../lib/schema').hasTable('supplier_readiness_acceptance'))) {
      return res.json({ acceptance: null, applied: false });
    }
    const entity_id = auth.entityOf(req);
    const s = await query(
      `SELECT identity_id FROM identities
        WHERE (bridge_id = $1 OR LOWER(user_id) = LOWER($1)) AND identity_type = 'entity'
        ORDER BY (bridge_id = $1) DESC LIMIT 1`,
      [String(req.params.handle || '').trim()]
    );
    if (!s.rows.length) return res.json({ acceptance: null, applied: true });

    /* ⚠️ withEntity — WITH RLS, on the read as well as the write. Fixing one and not the other is
       indistinguishable from fixing neither; that cost most of an afternoon this morning. */
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT a.acceptance_id, a.summary, a.accepted_at, a.note, i.display_name AS accepted_by_name
         FROM supplier_readiness_acceptance a
         LEFT JOIN identities i ON i.identity_id = a.accepted_by
        WHERE a.entity_id = $1 AND a.supplier_id = $2
        ORDER BY a.accepted_at DESC LIMIT 1`,
        [entity_id, s.rows[0].identity_id]
      )
    );

    const latest = r.rows[0];
    /* S34: the five columns the statement selects */
    // prettier-ignore
    res.json({ acceptance: latest ? { acceptance_id: latest.acceptance_id, summary: latest.summary, accepted_at: latest.accepted_at, note: latest.note, accepted_by_name: latest.accepted_by_name } : null, applied: true });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Read failed'));
  }
});

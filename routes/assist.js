/*
 * OWNS      the assistant proxy and the brand's catalogue-source authoring.
 * CALLED BY web assistant · Network brand screens.
 * FLOW      auth → ask / author source (owner or root only) → answer
 * CARD      28-platform-and-operations/assist
 */
// routes/assist.js — POST /api/assist — tier-1 assistant LLM proxy (STUB).
// The web client (app.html `askLLM`) calls THIS so the model API key NEVER lives in the browser.
// Contract (docs/AI-ASSISTANT.md):
//   Req:  { q, context, stage }            (+ optional `Authorization: Bearer` for post-auth grounding)
//   Res:  { answer, fit?, media? }          (shaped like an ASSIST_LIB entry)
//
// WIRED (T1-AI: through lib/ai.js invokeSkill — wallet, daily cap, usage ledger). With no provider/key configured we return a controlled non-200 so the
// CLIENT FALLS THROUGH to its own library floor (`matchLibrary`). The whole point of the design is that this
// endpoint can be missing, unconfigured, or failing and the assistant still answers — it just gets less smart.
const express = require('express');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const router = express.Router();
const jwt = require('jsonwebtoken');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const contract = require('../lib/assist-contract'); // the contract (each route's operation) and the words of a refusal
const { failed, FAULTS, words, PUBLISH_NO } = contract;
const log = require('../lib/logger');
const { query, withEntity, readBatch } = require('../db'); // DB access for the Q&A library (assist_qa) + entity-scoped writes
const auth = require('../middleware/auth'); // review endpoints are auth-gated (tighten to platform-scope later)
const ASSIST_KB = require('../lib/assist-kb'); // server-side grounding (cacheable, tamper-proof)
const compliance = require('../lib/compliance'); // deterministic conform-check engine (the `ai:conform-verdict@v1` slot floor)
const catalogueBuild = require('../lib/catalogue-build'); // the `ai:catalogue-structure@v1` slot — source → schema + coloured items
const container = require('../lib/container'); // CONTAINER MODEL (b80) — product pointer over immutable versions
const regional = require('../lib/regional'); // REGIONAL SCATTER (6a, b81) — resolve-and-seal per region
const money = require('../lib/money'); // adoption commercials are the SECOND price home — stamp them too

// The honest, no-oversell guardrail lives in lib/ai.js as the `assist-ask` skill (T1-AI) — server-side, never shipped to
// the client — so it runs through the one model caller with the wallet, the platform daily cap and the usage ledger.
const ai = require('../lib/ai');
const access = require('../lib/access'); // b173 viewer / commenter / editor: the one test of what a login may do
/* ⚠️ ASSIST_LLM_PROVIDER stays the ON-switch for CB Assist (dormant by default); the key and the model are the one
   caller's (ANTHROPIC_API_KEY · ai_skill.model / AI_MODEL). The entity is who pays: no signed-in entity → no model
   call, because a call that cannot be metered must not spend (lib/ai.js S1) — the caller's floor answers instead. */
const assistOn = () => process.env.ASSIST_LLM_PROVIDER === 'anthropic';
const payerOf = (identity) => (identity ? identity.parent_entity_id || identity.identity_id : null);

// Per-screen focus hints — turn the `context` the client sends (curScreen()) into a one-line steer so the model
// answers for the screen the user is actually on. Keep each TRUE and aligned with the KB.
const CONTEXT_HINTS = {
  coassists:
    "On the Co-assists screen: people (and, planned, systems) that act for the user within the entity's scope — push/pull/bulk assignment, shifts, breaks/leave returning work to the pool. (Per-actor scoping is planned, not yet enforced — a co-assist currently sees all of the entity's chits.)",
  schema:
    'Asking about schemas/blueprints: the configurable fields and rules a deal carries (configuration, not code). The container — record, privacy, audit — stays fixed.',
  compose:
    'On Compose: authoring a chit. Fields are schema-driven; line items come from the catalogue; sending creates a two-copy shared record (sent + received).',
  disputes: 'On Disputes: either side raises a disagreement; it is recorded, both sides see it, and it is resolved on the record.',
  network: "On Network: arranging the user's own branches/members as a tree under a top node; each node keeps its own record.",
  catalogue: 'On Catalogue: the public storefront the user can expose. Private by default; only what they mark public is visible.',
  suppliers: "On Suppliers: the user's supplier relationships, added by user id or email."
};

// Optional auth: if a valid Bearer token is present, attach a minimal identity so the real model can ground on
// the caller's own (tenant-scoped) context. Absent/invalid token → anonymous (the assistant is available
// pre-auth on welcome/login/register), grounded on the public KB only. Never throws.
function softIdentity(req) {
  try {
    const text = req.headers.authorization;
    if (!text || !text.startsWith('Bearer ')) return null;
    const d = require('../lib/jwt-verify').verifyJwt(text.split(' ')[1]).claims; // E10 — the ONE verifier
    // S1b (reviewer 2026-07-13) — a valid signature is not an identity. Reject any token that isn't a real entity/actor
    // (e.g. a sim_lead token). Return null → the caller treats it as anonymous (public-KB-only), never as an entity.
    if (!d.identity_id || !['entity', 'actor'].includes(d.identity_type)) return null;
    return { identity_id: d.identity_id, parent_entity_id: d.parent_entity_id || null, identity_type: d.identity_type, access_level: d.access_level }; // the level rides the token (identity-auth FX-L2C), so a draft that costs money can ask lib/access
  } catch (e) {
    log.fellBack('assist softIdentity: the helper failed — answered with nothing', e);
    return null;
  }
}

router.post('/', ...contract.checked('POST /'), async (req, res) => {
  try {
    const q = req.body && typeof req.body.q === 'string' ? req.body.q.trim() : '';
    const context = req.body && typeof req.body.context === 'string' ? req.body.context.slice(0, 64) : '';
    if (!q) return problem(req, res, { status: 422, ...words.askNothing() });
    if (q.length > 500) return problem(req, res, { status: 422, ...words.askTooLong() });

    const identity = softIdentity(req); // null pre-auth → public-KB-only grounding (P0 isolation: never cross entities)

    // ── The model call. It MUST:
    //    1) run under the `assist-ask` skill (the no-oversell guardrail, lib/ai.js) through invokeSkill;
    //    2) ground on the curated KB, and ONLY when `identity` is set add that caller's tenant-scoped live
    //       context (honour the P0 isolation invariant — never another entity's data);
    //    3) on ANY provider error/timeout return a non-200 so the client floor answers (do NOT 200 with junk).
    if (!assistOn()) {
      // Not configured (the default/held state). Expected, not an error — tell the client to use its floor.
      log.info('assist not configured — client falls through to library floor', { id: req.id, context, auth: !!identity });
      return problem(req, res, { status: 503, ...words.assistOff() });
    }
    if (!identity) {
      // Anonymous (welcome/login): nobody to meter the call to → the library floor answers (lib/ai.js S1).
      return problem(req, res, { status: 503, ...words.assistSignIn() });
    }

    try {
      // Only the public KB grounds the answer. A tenant-scoped block would be added ONLY for `identity` (P0 isolation).
      const out = await ai.invokeSkill(
        payerOf(identity),
        'assist-ask',
        { screen: context || 'unknown', ...(CONTEXT_HINTS[context] ? { screen_context: CONTEXT_HINTS[context] } : {}), question: q },
        { grounding: ASSIST_KB, max_tokens: 400, timeout_ms: 8000 }
      ); // bound output -> bound cost; KB prompt-cached
      const answer = String(out.draft || '').trim();
      if (!answer) {
        log.warn('assist: empty model answer', { id: req.id, model: out.model });
        return problem(req, res, { status: 502, ...words.assistEmpty() });
      }
      log.info('assist answered', { id: req.id, model: out.model, context, in: out.usage.input_tokens, out: out.usage.output_tokens });
      return res.json({ answer }); // shape: { answer } (fit/media can be added later); client wraps it like a lib entry
    } catch (mErr) {
      // Gate (402 wallet · 429 rate · 503 daily cap / not connected) or model failure -> non-200 so the web client
      // falls through to its deterministic library floor.
      log.error('assist: model call failed', { id: req.id, err: mErr.message, status: mErr.status });
      const gated = mErr.status === 402 || mErr.status === 429 || mErr.status === 503;
      return problem(req, res, gated ? { status: 503, ...words.assistGated() } : { status: 502, ...words.assistBusy() });
    }
  } catch (err) {
    problem(req, res, failed(err, req, FAULTS.assistant));
  }
});

// POST /api/assist/conform — FIRST LIGHT of AI-as-an-actor (bottom-up: the `ai:conform-verdict@v1` slot).
// Body: { standard, payload }. Runs the DETERMINISTIC conform-check (lib/compliance) FIRST — the verdict is a fact,
// not a model opinion. THEN, only if a model is configured, adds a rung-2 SUMMARISE narrative ("what's wrong + what
// to do"). Self-healing: no key / SDK / model failure → the deterministic verdict still returns (narrative: null).
// Returns the Crux-2 `acted_by` deputy stamp so a caller can carry it onto a chit on send (not persisted here yet).
router.post('/conform', ...contract.checked('POST /conform'), async (req, res) => {
  try {
    const standard = req.body && typeof req.body.standard === 'string' ? req.body.standard.trim() : '';
    const payload = req.body && req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    if (!standard) return problem(req, res, { status: 422, ...words.standardNeeded() });

    const tpl = compliance.getTemplate(standard);
    if (!tpl) return problem(req, res, { status: 404, ...words.unknownStandard(compliance.listTemplates()) });

    const verdict = compliance.evaluate(tpl, payload); // ← deterministic floor; ALWAYS the source of truth
    const identity = softIdentity(req);
    const principal = identity ? 'entity:' + (identity.parent_entity_id || identity.identity_id) : 'anon';

    // The Crux-2 deputy stamp. delegator = the invoking human (invoked mode); grant per-act; NOT confirmed here
    // (rung-2 recommend-only — a human ratifies before it's acted on). model filled iff the narrative ran.
    const acted_by = {
      deputy: 'ai:conform-verdict@v1',
      rung: 'summarise',
      tier: 'small',
      model: null,
      principal,
      delegator: identity ? { type: 'human', id: identity.identity_id } : null,
      confirmed_by: null,
      grant: 'per-act'
    };

    // Narrative layer — RUNG-2 SUMMARISE only. It explains the ALREADY-COMPUTED verdict; it never re-decides it.
    let narrative = null;
    if (assistOn() && identity) {
      try {
        const out = await ai.invokeSkill(
          payerOf(identity),
          'conform-narrative',
          { verdict_authoritative_do_not_contradict: verdict },
          { max_tokens: 250, timeout_ms: 8000 }
        );
        narrative = String(out.draft || '').trim() || null;
        if (narrative) acted_by.model = out.model;
        log.info('conform narrative added', { id: req.id, standard, compliant: verdict.compliant, model: out.model });
      } catch (mErr) {
        // Narrative is best-effort — a model or gate failure must NOT sink the deterministic verdict (narrative: null).
        log.warn('conform narrative skipped (model)', { id: req.id, err: mErr.message, status: mErr.status });
      }
    } else {
      log.info('conform (deterministic only — no model configured)', { id: req.id, standard, compliant: verdict.compliant });
    }

    res.json({ ok: true, ...verdict, narrative, acted_by });
  } catch (err) {
    log.error('assist/conform failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/standards — the conform-check standards available to check against (drives the UI picker).
router.get('/standards', (req, res) => res.json({ ok: true, data: compliance.listTemplates() }));

// GET /api/assist/catalogue-sources — the catalogue sources the handler can structure (drives the UI picker).
router.get('/catalogue-sources', async (req, res) => res.json({ ok: true, data: await catalogueBuild.listSources() }));

// POST /api/assist/catalogue-structure — the `ai:catalogue-structure@v1` slot. Body: { source }. Returns the
// DETERMINISTIC structured PROPOSAL (schema + coloured items — the AI handler's "interpret once" output), plus a
// model-drafted designer INTRO when configured (best-effort; degrades to no intro). Returns the `acted_by` deputy
// stamp. Does NOT persist to a catalogue yet — this is the draft the business confirms before publishing.
router.post('/catalogue-structure', ...contract.checked('POST /catalogue-structure'), async (req, res) => {
  try {
    const source = req.body && typeof req.body.source === 'string' ? req.body.source.trim() : 'beta-royale-play@v1';
    const built = await catalogueBuild.build(source);
    if (!built) return problem(req, res, { status: 404, ...words.unknownCatalogueSource(await catalogueBuild.listSources()) });

    const identity = softIdentity(req);
    const principal = identity ? 'entity:' + (identity.parent_entity_id || identity.identity_id) : 'anon';
    const acted_by = {
      deputy: 'ai:catalogue-structure@v1',
      rung: 'extract',
      tier: 'small',
      model: null,
      principal,
      delegator: identity ? { type: 'human', id: identity.identity_id } : null,
      confirmed_by: null,
      grant: 'per-act'
    };

    // Designer intro — model-drafted RUNG-summarise layer, best-effort. It describes the ALREADY-structured
    // collection; it never invents items. Absent a key, the structure still stands (intro: null).
    let intro = null;
    /* PPL-27 (Q42): a View-only or Comment-only login keeps the free draft but never spends the shop's AI money: it gets the anonymous answer. lib/access is the ONE level test. */
    if (assistOn() && identity && access.canEdit(identity)) {
      try {
        const out = await ai.invokeSkill(
          payerOf(identity),
          'catalogue-intro',
          { retailer: built.for_entity, collection: built.collection, names: built.items.map((item) => item.name) },
          { max_tokens: 180, timeout_ms: 8000 }
        );
        intro = String(out.draft || '').trim() || null;
        if (intro) acted_by.model = out.model;
      } catch (mErr) {
        log.warn('catalogue intro skipped (model)', { id: req.id, err: mErr.message, status: mErr.status });
      }
    } else {
      log.info('catalogue-structure (deterministic only — no model configured)', { id: req.id, source, finishes: built.counts.finishes });
    }

    // NB: the client `unwrap()` (core.js) auto-extracts a top-level `items` array and DROPS the rest — so expose the
    // finishes as `finishes` (not `items`) or the whole catalogue object gets stripped to just the array. See
    // reference-chitbridge-deploy. Same reason `resolved`/`catalogues` (nested) are safe.
    const { items: finishes, ...rest } = built;
    res.json({ ok: true, ...rest, finishes, intro, acted_by });
  } catch (err) {
    log.error('assist/catalogue-structure failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// POST /api/assist/catalogue-adopt — PERSIST the entity's adoption: a REFERENCE (source_key + version) + its
// COMMERCIALS overlay only (NO copy of design/colour). Per-entity, WITH RLS (b75 catalogue_adoption). This is the
// human CONFIRM/publish of the catalogue-structure slot. Self-healing: if b75 isn't applied, returns 503 (not 500).
/* ⭐ SEC-FIX2 M3: a WRITE runs the real sign-in (middleware/auth — removed/deactivated, revoked session, device binding, key scope and
   the View-only hat gate), not softIdentity, which checks only the signature. The entity is auth's (entityOf). */
router.post('/catalogue-adopt', auth, ...contract.checked('POST /catalogue-adopt'), async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    const source = req.body && typeof req.body.source === 'string' ? req.body.source.trim() : 'beta-royale-play@v1';
    const built = await catalogueBuild.build(source);
    if (!built) return problem(req, res, { status: 404, ...words.unknownCatalogueSource() });
    // STAMP the adoption's commercials. This is the SECOND price home — `{ "Tussar": { price, unit, … } }` — and the
    // one the seed scripts mostly use, so missing it would leave half the catalogue unstamped while looking done.
    let commercialsIn = req.body && req.body.commercials && typeof req.body.commercials === 'object' ? req.body.commercials : {};
    /* ⭐ a store following its brand's price keeps following while it saves that price; its own price ends it (network-catalogue) */
    try {
      const prev = await withEntity(entity, (db) =>
        db.query('SELECT commercials FROM catalogue_adoption WHERE entity_id = $1 AND source_key = $2', [entity, source])
      );
      commercialsIn = require('../lib/network-catalogue').keepFollow(commercialsIn, (prev.rows[0] && prev.rows[0].commercials) || {}, built.items);
    } catch (e) {
      log.fellBack('assist POST /catalogue-adopt: the read failed — carried on without it', e); /* first adoption, or b75 absent — nothing to keep */
    }
    const commercials = money.stampCommercials(commercialsIn, await regional.currencyFor(entity));
    const visible = !(req.body && req.body.visible === false);
    try {
      await withEntity(entity, (db) =>
        db.query(
          `INSERT INTO catalogue_adoption (entity_id, source_key, version, commercials, visible, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, now())
         ON CONFLICT (entity_id, source_key)
           DO UPDATE SET commercials = EXCLUDED.commercials, visible = EXCLUDED.visible, version = EXCLUDED.version, updated_at = now()`,
          [entity, source, catalogueBuild.VERSION, JSON.stringify(commercials), visible]
        )
      );
    } catch (dbErr) {
      log.warn('catalogue-adopt: store missing (run b75)', { id: req.id, err: dbErr.message });
      return problem(req, res, { status: 503, ...words.catalogueStoreMissing() });
    }
    log.info('catalogue adopted (reference + commercials)', { id: req.id, source, items_priced: Object.keys(commercials).length });
    /**
     * ⭐ ADOPTING A BRAND'S CATALOGUE ASKS TO JOIN ITS NETWORK — it does not join it (Athi, 2026-09-17: "the network has to
     * approve"). The request is the network's own (src/services/network — a `commercial` edge the brand approves); until then
     * the brand's products are not sold here (catalogue-build.resolve). A store already in, or already asking, is left alone.
     */
    try {
      const owner = (await query('SELECT owner_entity_id FROM catalogue_source WHERE source_key = $1', [source])).rows[0];
      if (owner && owner.owner_entity_id && String(owner.owner_entity_id) !== String(entity)) {
        const inside = await require('../lib/network-membership').brandsOf(entity, [owner.owner_entity_id]);
        if (!inside.has(String(owner.owner_entity_id))) {
          const netsvc = require('../src/services/network');
          const me = await netsvc.nodeOf(entity, { ensure: true });
          const brandNode = await netsvc.nodeOf(owner.owner_entity_id, { ensure: true });
          if (me && brandNode)
            await netsvc
              .requestConnect({ parentId: brandNode.id, childId: me.id, type: 'commercial' }, me)
              .catch(log.orElse("catalogue adopted, but the request to join the brand's network was not sent — the store can ask from Network"));
        }
      }
    } catch (e) {
      log.fellBack("catalogue adopted, but whether the store is in the brand's network was not read — no join request sent", e);
    }
    res.json({
      ok: true,
      persisted: true,
      source,
      resolved: await catalogueBuild.resolve(source, commercials),
      acted_by: {
        deputy: 'ai:catalogue-structure@v1',
        rung: 'extract',
        principal: 'entity:' + entity,
        delegator: { type: 'human', id: req.identity.identity_id },
        confirmed_by: { id: req.identity.identity_id },
        grant: 'per-act'
      }
    });
  } catch (err) {
    log.error('assist/catalogue-adopt failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/catalogue-mine — the entity's PERSISTED catalogue(s): its adoption rows (WITH RLS) RESOLVED against
// the shared source (design/colour by reference) + its commercials overlay. Self-healing (503 if b75 not applied).
router.get('/catalogue-mine', auth, ...contract.checked('GET /catalogue-mine'), async (req, res) => {
  /* M3: the same real sign-in as the write it mirrors */
  try {
    const entity = auth.entityOf(req);
    const pg = PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX);
    let rows = [];
    try {
      /* ⭐ ONE network round trip for the adoption rows (readBatch); the transaction path stays as the fallback. */
      let r;
      try {
        r = (
          await readBatch(entity, null, [
            {
              text: `SELECT source_key, version, commercials, visible, updated_at FROM catalogue_adoption WHERE entity_id = $1 ORDER BY updated_at DESC`,
              params: [entity]
            }
          ])
        )[0];
      } catch (_) {
        r = await withEntity(entity, (db) =>
          db.query(`SELECT source_key, version, commercials, visible, updated_at FROM catalogue_adoption WHERE entity_id = $1 ORDER BY updated_at DESC`, [
            entity
          ])
        );
      }
      rows = r.rows || [];
    } catch (dbErr) {
      return problem(req, res, { status: 503, ...words.catalogueStoreMissing() });
    }
    const catalogues = (
      await Promise.all(
        rows.map(async (row) => ({
          source: row.source_key,
          version: row.version,
          visible: row.visible,
          updated_at: row.updated_at,
          resolved: await catalogueBuild.resolve(row.source_key, row.commercials || {})
        }))
      )
    ).filter((item) => item.resolved);
    const answer = PL.pageOut('catalogues', catalogues, pg);
    /* S34: the pager's keys named (capped and cap_note only when it cut the list); `resolved` is lib/catalogue-build's own record and stays open */
    res.json({ ok: true, count: catalogues.length, catalogues: answer.catalogues, total: answer.total, page: answer.page, limit: answer.limit, capped: answer.capped, cap_note: answer.cap_note });
  } catch (err) {
    log.error('assist/catalogue-mine failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// PUT /api/assist/catalogue-source — SOURCE-AS-ENTITY: a brand entity AUTHORS/updates its OWN catalogue source
// (content + the customer-EXPERIENCE blueprint that cascades). Owner-only. catalogue_source is WITHOUT RLS, so
// ownership is enforced HERE (app-side) by owner_entity_id. Self-healing: 503 if b78 isn't applied yet.
/** the words of why this caller may not rewrite the source row (or null): owned by another brand; or an unowned platform seed and the caller is not the root (SEC-FIX3 S11) */
function sourceRefusal(row, owner) {
  if (!row) return null;
  if (row.owner_entity_id) return String(row.owner_entity_id) === String(owner) ? null : words.sourceOfAnother();
  return require('../lib/platformroot').isRoot(String(owner)) ? null : words.sourceOfThePlatform();
}

router.put('/catalogue-source', auth, ...contract.checked('PUT /catalogue-source'), async (req, res) => {
  try {
    const owner = auth.entityOf(req);
    const b = req.body || {};
    const source_key = typeof b.source_key === 'string' && b.source_key.trim() ? b.source_key.trim() : '';
    if (!source_key) return problem(req, res, { status: 422, ...words.sourceKeyNeeded() });
    let exists;
    try {
      exists = await query('SELECT owner_entity_id FROM catalogue_source WHERE source_key = $1', [source_key]);
    } catch (dbErr) {
      return problem(req, res, { status: 503, ...words.sourceStoreMissing() });
    }
    const refusal = sourceRefusal(exists.rows[0], owner);
    if (refusal) return problem(req, res, { status: 403, ...refusal });
    const schema = b.schema && typeof b.schema === 'object' ? b.schema : {};
    const items = Array.isArray(b.items) ? b.items : [];
    const commercials_fields = Array.isArray(b.commercials_fields) ? b.commercials_fields : [];
    const experience = b.experience && typeof b.experience === 'object' ? b.experience : {};
    const formatting = b.formatting && typeof b.formatting === 'object' ? b.formatting : {};
    try {
      await query(
        `INSERT INTO catalogue_source (source_key, version, for_vertical, title, collection, schema, items, commercials_fields, owner_entity_id, experience, formatting, active)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,true)
         ON CONFLICT (source_key) DO UPDATE SET
           version=EXCLUDED.version, for_vertical=EXCLUDED.for_vertical, title=EXCLUDED.title, collection=EXCLUDED.collection,
           schema=EXCLUDED.schema, items=EXCLUDED.items, commercials_fields=EXCLUDED.commercials_fields,
           owner_entity_id=COALESCE(catalogue_source.owner_entity_id, EXCLUDED.owner_entity_id),
           experience=EXCLUDED.experience, formatting=EXCLUDED.formatting`,
        [
          source_key,
          b.version || 'v1',
          b.for_vertical || null,
          b.title || null,
          b.collection || null,
          JSON.stringify(schema),
          JSON.stringify(items),
          JSON.stringify(commercials_fields),
          owner,
          JSON.stringify(experience),
          JSON.stringify(formatting)
        ]
      );
    } catch (dbErr) {
      return problem(req, res, { status: 503, ...words.sourceStoreMissing() });
    }
    // WIRING (stone 5): mirror each item to a CONTAINER (create/enhance, change-detected). Best-effort, self-healing.
    let containers = 0;
    try {
      containers = (await container.syncItemContainers(owner, source_key, items)).length;
    } catch (e) {
      log.fellBack('assist PUT /catalogue-source: failed — carried on without it', e); /* b80 absent → skip */
    }
    log.info('catalogue source authored', { id: req.id, source_key, owner: String(owner).slice(0, 8), items: items.length, containers });
    res.json({ ok: true, source_key, owner_entity_id: owner, authored: true, containers });
  } catch (err) {
    log.error('assist/catalogue-source PUT failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// PUT /api/assist/container — CONTAINER MODEL (stone 5): author (v1) or ENHANCE (mint the next IMMUTABLE version + move
// the pointer) a product container. Owner-only. An enhancement never mutates a version → past chits stay verifiable.
router.put('/container', auth, ...contract.checked('PUT /container'), async (req, res) => {
  try {
    const owner = auth.entityOf(req);
    const b = req.body || {};
    const container_id = typeof b.container_id === 'string' && b.container_id.trim() ? b.container_id.trim() : '';
    if (!container_id) return problem(req, res, { status: 422, ...words.containerIdNeeded() });
    let out;
    try {
      out = await container.authorContainer(owner, {
        container_id,
        name: b.name,
        source_key: b.source_key,
        content: b.content,
        schema: b.schema,
        schema_version: b.schema_version
      });
    } catch (e) {
      if (e.status === 403) return problem(req, res, { status: 403, ...words.ownedByAnother(e.message) }); /* lib/container.js:29 — a fixed sentence */
      return problem(req, res, { status: 503, ...words.containerStoreMissing() });
    }
    log.info('container authored', { id: req.id, container_id, version: out.version, is_new: out.is_new_container });
    res.json({ ok: true, ...out, owner_entity_id: owner });
  } catch (err) {
    log.error('assist/container PUT failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/container/:id — resolve the CURRENT version (the pointer, auto-latest) or ?version=N (the EXACT
// immutable version a chit pinned — verification). Public read (the catalogue/experience is shared reference).
router.get('/container/:id', ...contract.checked('GET /container/:id'), async (req, res) => {
  try {
    const r = await container.resolveContainer(req.params.id, req.query.version);
    if (!r) return problem(req, res, { status: 404, ...words.unknownContainerOrVersion() });
    res.json({ ok: true, ...r });
  } catch (err) {
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/erp-handoffs — 6b: the DISTRIBUTOR's ERP handoff receipts (refs + routing + hash — process-then-
// forget; the ERP consumes these and does the routing/fulfillment). Per-entity, WITH RLS (b82). Self-healing (503).
router.get('/erp-handoffs', auth, ...contract.checked('GET /erp-handoffs'), async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    const pg = PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX);
    let rows = [];
    try {
      const r = await withEntity(entity, (db) =>
        db.query(
          'SELECT handoff_id, chit_id, summary, payload_hash, status, created_at FROM erp_handoff WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 200',
          [entity]
        )
      );
      rows = r.rows || [];
    } catch (dbErr) {
      return problem(req, res, { status: 503, ...words.handoffStoreMissing() });
    }
    res.json(Object.assign({ ok: true, count: rows.length }, PL.pageOut('handoffs', rows, pg)));
  } catch (err) {
    log.error('assist/erp-handoffs failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// PUT /api/assist/region-override — 6a: the source authors a per-REGION override on its OWN container (owner-gated).
// Hybrid: most of "per region" auto-cascades (currency/units/language); this is the genuinely-local delta (colour
// names, compliance labels, regional combinations). Self-healing: 503 if b81 isn't applied.
router.put('/region-override', auth, ...contract.checked('PUT /region-override'), async (req, res) => {
  try {
    const owner = auth.entityOf(req);
    const b = req.body || {};
    const container_id = typeof b.container_id === 'string' && b.container_id.trim() ? b.container_id.trim() : '';
    const region = typeof b.region === 'string' && b.region.trim() ? b.region.trim() : '';
    if (!container_id || !region) return problem(req, res, { status: 422, ...words.containerAndRegionNeeded() });
    const overrides = b.overrides && typeof b.overrides === 'object' ? b.overrides : {};
    try {
      await regional.setRegionOverride(owner, container_id, region, overrides);
    } catch (e) {
      if (e.status === 403) return problem(req, res, { status: 403, ...words.ownedByAnother(e.message) }); /* lib/regional.js:39 — a fixed sentence */
      if (e.status === 404) return problem(req, res, { status: 404, ...words.noSuchContainer(e.message) }); /* lib/regional.js:34 — a fixed sentence */
      return problem(req, res, { status: 503, ...words.regionStoreMissing() });
    }
    res.json({ ok: true, container_id, region });
  } catch (err) {
    log.error('assist/region-override failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/regions — the region layers (currency/units/language/jurisdiction) for the spin-the-globe switcher.
router.get('/regions', async (req, res) => {
  try {
    let rows = [];
    try {
      const r = await query('SELECT region_code, currency, units, language, jurisdiction FROM region_layer ORDER BY region_code');
      rows = r.rows || [];
    } catch (e) {
      log.fellBack('assist GET /regions: the read failed — carried on without it', e); /* b81 absent */
    }
    /* S34: a region is the columns the statement selects (region_layer: migrations/000_baseline_2026-10-21.sql; jurisdiction is jsonb, any value) */
    res.json({ ok: true, regions: rows.map((x) => ({ region_code: x.region_code, currency: x.currency, units: x.units, language: x.language, jurisdiction: x.jurisdiction })) });
  } catch (err) {
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/resolve?container=&version=&region= — SPIN THE GLOBE: the product's presentation + governance
// RESOLVED for a region (global content + regional override + auto-cascaded basics), SEALED + cached. Public read.
router.get('/resolve', ...contract.checked('GET /resolve'), async (req, res) => {
  try {
    const region = (req.query.region && String(req.query.region).trim()) || null;
    /* T2-NATDEF: a product is resolved FOR a region the caller names — never India by default */
    if (!region) return problem(req, res, { status: 400, ...words.regionNeeded() });
    const r = await regional.resolveRegional(req.query.container, req.query.version, region);
    if (!r) return problem(req, res, { status: 404, ...words.unknownContainerOrVersion() });
    res.json({ ok: true, ...r });
  } catch (err) {
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/penetration — STONE 4: the BRAND's aggregated penetration for the sources IT owns (heatmap data).
// AGGREGATE-ONLY: order counts + distributor coverage by locality — NO per-customer PII (the ledger has no customer id).
// Owner-gated (only your own sources). Self-healing: 503 if b79 isn't applied.
router.get('/penetration', auth, ...contract.checked('GET /penetration'), async (req, res) => {
  try {
    const owner = auth.entityOf(req);
    let rows = [];
    try {
      const r = await query(
        `SELECT sp.source_key, sp.locality,
                count(*)::int AS orders,
                count(DISTINCT sp.distributor_entity_id)::int AS distributors
           FROM source_penetration sp
           JOIN catalogue_source cs ON cs.source_key = sp.source_key
          WHERE cs.owner_entity_id = $1 AND sp.locality IS NOT NULL AND sp.locality <> ''
          GROUP BY sp.source_key, sp.locality
          ORDER BY orders DESC, sp.locality ASC`,
        [owner]
      );
      rows = r.rows;
    } catch (dbErr) {
      return problem(req, res, { status: 503, ...words.penetrationStoreMissing() });
    }
    const total_orders = rows.reduce((total, x) => total + x.orders, 0);
    const localities = Array.from(new Set(rows.map((x) => x.locality)));
    /* S34: a locality is the four columns the statement selects (aggregates only: no customer, no distributor id) */
    res.json({ ok: true, total_orders, localities: localities.length, by_locality: rows.map((x) => ({ source_key: x.source_key, locality: x.locality, orders: x.orders, distributors: x.distributors })) });
  } catch (err) {
    log.error('assist/penetration failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/catalogue-source/:key — read a source (content + EXPERIENCE + formatting). `finishes` not `items`
// so the client unwrap() doesn't strip the object.
router.get('/catalogue-source/:key', ...contract.checked('GET /catalogue-source/:key'), async (req, res) => {
  try {
    const built = await catalogueBuild.build(req.params.key);
    if (!built) return problem(req, res, { status: 404, ...words.unknownSource() });
    const { items, ...rest } = built;
    res.json({ ok: true, ...rest, finishes: items });
  } catch (err) {
    problem(req, res, failed(err, req, FAULTS.plain));
  }
});

// GET /api/assist/questions?context=<screen> — the assistant Q&A library, served FROM THE DB (single source of
// truth; also the grounding feed for the model). PUBLIC (works pre-auth on welcome/login/register). Returns
// entries whose context matches the screen OR '*'; no context -> all active. Shape: {ok:true, data:[{id,q,a,...}]}.
router.get('/questions', ...contract.checked('GET /questions'), async (req, res) => {
  try {
    // context may be a CHAIN (comma-list: fine → parent → nav) so a sub-page ADDS its specific Q&A without losing the
    // broader curated set. Match if the entry's context array OVERLAPS any of them, or is universal ('*').
    const ctxRaw = req.query && typeof req.query.context === 'string' ? req.query.context.slice(0, 128).trim() : '';
    const ctxArr = ctxRaw
      ? ctxRaw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const params = [];
    let where = 'active = true';
    if (ctxArr.length) {
      params.push(ctxArr);
      where += ` AND (context && $1::text[] OR '*' = ANY(context))`;
    }
    const r = await query(
      `SELECT id, question AS q, answer AS a, topics, context, fit, media
         FROM assist_qa WHERE ${where} ORDER BY sort, id`,
      params
    );
    res.json(Object.assign({ ok: true }, PL.pageOut('data', r.rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))));
  } catch (err) {
    log.error('assist/questions failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.questions));
  }
});

// POST /api/assist/gap — DEPRECATED under B1 RLS (2026-07-04). It used to write a DRAFT into the HELP entity's
// catalogue (entity_id = help) from an outside/anonymous caller — a cross-entity write the owner-only rule now
// forbids ("nobody writes another entity's catalogue"). The sanctioned capture is a CHIT to the help desk: the web
// client's "Send to help desk" (askHelpDesk → POST /chits/send) lands the question in GOV-01-Help's Task inbox,
// where it is answered and Published to the KB. Kept as a no-op ack (so the old fire-and-forget caller doesn't
// error) that only LOGS the unanswered question as an analytics signal — it writes nothing.
router.post('/gap', ...contract.checked('POST /gap'), async (req, res) => {
  try {
    const question = req.body && typeof req.body.q === 'string' ? req.body.q.trim() : '';
    const context = req.body && typeof req.body.context === 'string' ? req.body.context.slice(0, 64) : '';
    if (!question || question.length < 3) return problem(req, res, { status: 422, ...words.questionNeeded() });
    if (question.length > 400) return problem(req, res, { status: 422, ...words.questionTooLong() });
    // No catalogue write. Real capture is the chit flow (Send to help desk → a chit in GOV-01-Help's Task inbox).
    log.info('assist gap (deprecated — capture is now the chit flow)', { id: req.id, context, len: question.length });
    res.json({ ok: true, noted: true, via: 'chit' });
  } catch (err) {
    log.error('assist/gap failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.gap));
  }
});

// POST /api/assist/publish — the help desk publishes a resolved Q&A to ITS catalogue => the projection trigger
// serves it live. Auth; the caller MUST be the Help entity itself (only it edits its own knowledge base).
router.post('/publish', auth, ...contract.checked('POST /publish'), async (req, res) => {
  try {
    const b = req.body || {};
    const question = typeof b.question === 'string' ? b.question.trim() : '';
    const answer = typeof b.answer === 'string' ? b.answer.trim() : '';
    if (!question || !answer) return problem(req, res, { status: 422, ...words.answerNeeded() });
    const context = Array.isArray(b.context) ? b.context.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];

    // Generalised (blueprint): the CALLER must be a helpdesk (carries the 'Assistant Q&A' schema); it publishes to
    // ITS OWN catalogue. GOV-01-Help carries that schema -> backward compatible.
    const sender = auth.entityOf(req);
    const hd = await query(`SELECT 1 FROM entity_schemas WHERE entity_id = $1 AND schema_name = 'Assistant Q&A' AND status = 'active' LIMIT 1`, [sender]);
    if (!hd.rows.length) return problem(req, res, { status: 403, ...words.notAHelpDesk() });
    const helpId = sender;

    // Refine an existing answer when qa_id is supplied and found; else publish new.
    const qaIn = typeof b.qa_id === 'string' && b.qa_id.trim() ? b.qa_id.trim() : '';
    if (qaIn) {
      // B1 RLS: a help desk publishes to ITS OWN catalogue -> withEntity(me).
      const upd = await withEntity(helpId, (db) =>
        require('../lib/catalogue-write').patchWhere(
          db /* CAT-W1: the one product writer */,
          { entity_id: helpId, field: 'qa_id', value: qaIn, activate: true },
          { question, answer, context, status: 'approved' }
        )
      );
      if (upd.rowCount) {
        log.info('assist updated', { id: req.id, qa_id: qaIn });
        return res.json({ ok: true, qa_id: qaIn, updated: true });
      }
    }
    const sch = await query(`SELECT schema_id FROM entity_schemas WHERE entity_id = $1 AND is_default = true LIMIT 1`, [helpId]);
    const schema_id = sch.rows[0] ? sch.rows[0].schema_id : null;
    const qaId = 'pub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const item_data = { qa_id: qaId, question, answer, context, topics: [], fit: null, media: null, status: 'approved' };
    await withEntity(helpId, (db) =>
      db.query(
        // B1 RLS: own catalogue -> withEntity(me)
        `INSERT INTO catalogue_items (entity_id, schema_id, item_data, is_active) VALUES ($1, $2, $3, true)`,
        [helpId, schema_id, JSON.stringify(item_data)]
      )
    );
    log.info('assist published', { id: req.id, qa_id: qaId, ctx: context.join(',') });
    res.json({ ok: true, qa_id: qaId });
  } catch (err) {
    log.error('assist/publish failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, FAULTS.publish));
  }
});

// ── Review / triage (#3) — auth-gated (TODO: tighten to owner_scope='platform' before production) ──

// GET /api/assist/gaps — DEPRECATED under B1 RLS. The gap-review flow is superseded by chit→Task: questions arrive
// as CHITS in GOV-01-Help's Task inbox (not as catalogue drafts), so there are no catalogue "gaps" to list. Returns
// empty and reads nothing (the cross-read of the help catalogue is no longer needed).
router.get('/gaps', auth, ...contract.checked('GET /gaps'), async (req, res) => {
  res.json({ ok: true, data: [], deprecated: true });
});

// POST /api/assist/resolve — DEPRECATED under B1 RLS. It updated the HELP entity's catalogue from an outside caller
// (a cross-entity write, now forbidden). Answering is done on the question's CHIT in GOV-01-Help's Task inbox, then
// Published via POST /api/assist/publish (own catalogue). This endpoint writes nothing.
router.post('/resolve', auth, ...contract.checked('POST /resolve'), async (req, res) => {
  problem(req, res, { status: 410, ...words.reviewRetired() });
});

// GET /api/assist/whoami — is the logged-in entity a helpdesk instance? Drives the helpdesk business-layer gate
// (generalises off the hardcoded 'GOV-01-Help' name). Never throws.
router.get('/whoami', auth, ...contract.checked('GET /whoami'), async (req, res) => {
  try {
    const entity = auth.entityOf(req);
    const r = await query(`SELECT 1 FROM entity_schemas WHERE entity_id = $1 AND schema_name = 'Assistant Q&A' AND status = 'active' LIMIT 1`, [entity]);
    const hd = r.rows.length > 0;
    /* T3-DISPUTES-ASSIST: may I publish an answer — the SAME test POST /publish refuses with (403 below), as a code the CB Assist screen greys on */
    res.json({ ok: true, is_helpdesk: hd, actions: { publish: hd ? { ok: true } : { ok: false, why: 'not_helpdesk', say: PUBLISH_NO } } });
  } catch (err) {
    log.warn('assist/whoami could not read the help-desk schema — answered as not a help desk', { id: req.id, err: err.message });
    res.json({ ok: true, is_helpdesk: false, actions: { publish: { ok: false, why: 'not_read', say: 'Could not check who may publish. Try again.' } } });
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;

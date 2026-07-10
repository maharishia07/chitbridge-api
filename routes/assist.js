// routes/assist.js — POST /api/assist — tier-1 assistant LLM proxy (STUB).
// The web client (app.html `askLLM`) calls THIS so the model API key NEVER lives in the browser.
// Contract (docs/AI-ASSISTANT.md):
//   Req:  { q, context, stage }            (+ optional `Authorization: Bearer` for post-auth grounding)
//   Res:  { answer, fit?, media? }          (shaped like an ASSIST_LIB entry)
//
// STUB STATE: no model is wired yet. With no provider/key configured we return a controlled non-200 so the
// CLIENT FALLS THROUGH to its own library floor (`matchLibrary`). The whole point of the design is that this
// endpoint can be missing, unconfigured, or failing and the assistant still answers — it just gets less smart.
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { safeErr } = require('../lib/respond');
const log     = require('../lib/logger');
const { query, withEntity } = require('../db');  // DB access for the Q&A library (assist_qa) + entity-scoped writes
const auth    = require('../middleware/auth');   // review endpoints are auth-gated (tighten to platform-scope later)
const ASSIST_KB = require('../lib/assist-kb');   // server-side grounding (cacheable, tamper-proof)
const compliance = require('../lib/compliance'); // deterministic conform-check engine (the `ai:conform-verdict@v1` slot floor)
const catalogueBuild = require('../lib/catalogue-build'); // the `ai:catalogue-structure@v1` slot — source → schema + coloured items
const container = require('../lib/container');            // CONTAINER MODEL (b80) — product pointer over immutable versions
const regional = require('../lib/regional');              // REGIONAL SCATTER (6a, b81) — resolve-and-seal per region

// The honest, no-oversell guardrail the REAL model must run under. Kept server-side (never shipped to the client)
// so it can't be inspected or bypassed. The real implementation injects this as the system prompt.
const SYSTEM_PROMPT = [
  'You are the Chit & Bridge assistant. Be honest, concise, and NEVER oversell.',
  'Ground every answer in the supplied knowledge base; if something is not covered, say you are not certain',
  'rather than guess. When asked about fit it is fine — encouraged — to say "this is probably not for you";',
  'qualifying out a bad fit builds trust. Never reveal another business\'s data: answer only from the public',
  'knowledge base plus any context explicitly provided for THIS caller.',
].join(' ');

// Per-screen focus hints — turn the `context` the client sends (curScreen()) into a one-line steer so the model
// answers for the screen the user is actually on. Keep each TRUE and aligned with the KB.
const CONTEXT_HINTS = {
  coassists: 'On the Co-assists screen: people (and, planned, systems) that act for the user within the entity\'s scope — push/pull/bulk assignment, shifts, breaks/leave returning work to the pool. (Per-actor scoping is planned, not yet enforced — a co-assist currently sees all of the entity\'s chits.)',
  schema:    'Asking about schemas/blueprints: the configurable fields and rules a deal carries (configuration, not code). The container — record, privacy, audit — stays fixed.',
  compose:   'On Compose: authoring a chit. Fields are schema-driven; line items come from the catalogue; sending creates a two-copy shared record (sent + received).',
  disputes:  'On Disputes: either side raises a disagreement; it is recorded, both sides see it, and it is resolved on the record.',
  network:   'On Network: arranging the user\'s own branches/members as a tree under a top node; each node keeps its own record.',
  catalogue: 'On Catalogue: the public storefront the user can expose. Private by default; only what they mark public is visible.',
  suppliers: 'On Suppliers: the user\'s supplier relationships, added by user id or email.',
};

// Optional auth: if a valid Bearer token is present, attach a minimal identity so the real model can ground on
// the caller's own (tenant-scoped) context. Absent/invalid token → anonymous (the assistant is available
// pre-auth on welcome/login/register), grounded on the public KB only. Never throws.
function softIdentity(req) {
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return null;
    const d = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return { identity_id: d.identity_id, parent_entity_id: d.parent_entity_id || null };
  } catch (_) { return null; }
}

router.post('/', async (req, res) => {
  try {
    const q       = (req.body && typeof req.body.q === 'string')       ? req.body.q.trim()             : '';
    const context = (req.body && typeof req.body.context === 'string') ? req.body.context.slice(0, 64) : '';
    if (!q)             return res.status(422).json({ error: 'Bad request', message: 'Ask a question.' });
    if (q.length > 500) return res.status(422).json({ error: 'Bad request', message: 'Question is too long.' });

    const identity = softIdentity(req);   // null pre-auth → public-KB-only grounding (P0 isolation: never cross entities)

    // ── The real model call goes HERE. It MUST:
    //    1) run under SYSTEM_PROMPT (the no-oversell guardrail);
    //    2) ground on the curated KB, and ONLY when `identity` is set add that caller's tenant-scoped live
    //       context (honour the P0 isolation invariant — never another entity's data);
    //    3) on ANY provider error/timeout return a non-200 so the client floor answers (do NOT 200 with junk).
    const provider = process.env.ASSIST_LLM_PROVIDER;   // e.g. 'anthropic'
    const apiKey   = process.env.ASSIST_LLM_API_KEY;    // server-only secret — never sent to the client

    if (!provider || !apiKey) {
      // Not configured (the default/held state). Expected, not an error — tell the client to use its floor.
      log.info('assist not configured — client falls through to library floor', { id: req.id, context, auth: !!identity });
      return res.status(503).json({ error: 'assist_unavailable', message: 'The assistant model is not configured yet.' });
    }

    if (provider !== 'anthropic') {
      log.warn('assist: unsupported provider', { id: req.id, provider });
      return res.status(501).json({ error: 'Not implemented', message: 'That assistant provider is not wired.' });
    }

    // Lazy-require the SDK so a missing dependency degrades gracefully (client floor) instead of crashing boot.
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); }
    catch (_) { log.error('assist: @anthropic-ai/sdk not installed', { id: req.id });
                return res.status(503).json({ error: 'assist_unavailable', message: 'The assistant is not available right now.' }); }

    const model = process.env.ASSIST_LLM_MODEL || 'claude-haiku-4-5-20251001';   // small/fast/cheap by default
    const client = new (Anthropic.Anthropic || Anthropic)({ apiKey, timeout: 8000, maxRetries: 1 });

    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 400,                                  // bound output -> bound cost
        system: [
          { type: 'text', text: SYSTEM_PROMPT },          // the no-oversell guardrail
          { type: 'text', text: ASSIST_KB, cache_control: { type: 'ephemeral' } },  // grounding — prompt-cached (repeated each call)
        ],
        // Only the public KB grounds anonymous callers. A tenant-scoped block would be added here ONLY when
        // `identity` is set (honour the P0 isolation invariant — never another entity's data). None yet.
        messages: [ { role: 'user', content:
          `Screen: ${context || 'unknown'}\n` +
          (CONTEXT_HINTS[context] ? `Screen context: ${CONTEXT_HINTS[context]}\n` : '') +
          `User question: ${q}` } ],
      });
      const answer = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (!answer) {
        log.warn('assist: empty model answer', { id: req.id, model });
        return res.status(502).json({ error: 'Assistant error', message: 'No answer produced — try again.' });
      }
      const u = msg.usage || {};
      log.info('assist answered', { id: req.id, model, context, auth: !!identity,
        in: u.input_tokens, out: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens });
      return res.json({ answer });   // shape: { answer } (fit/media can be added later); client wraps it like a lib entry
    } catch (mErr) {
      // Model/network failure -> non-200 so the web client falls through to its deterministic library floor.
      log.error('assist: model call failed', { id: req.id, model, err: mErr.message, status: mErr.status });
      return res.status(502).json({ error: 'Assistant upstream error', message: 'The assistant is busy — please try again.' });
    }

  } catch (err) {
    res.status(500).json({ error: 'Assistant error', message: safeErr(err) });
  }
});

// POST /api/assist/conform — FIRST LIGHT of AI-as-an-actor (bottom-up: the `ai:conform-verdict@v1` slot).
// Body: { standard, payload }. Runs the DETERMINISTIC conform-check (lib/compliance) FIRST — the verdict is a fact,
// not a model opinion. THEN, only if a model is configured, adds a rung-2 SUMMARISE narrative ("what's wrong + what
// to do"). Self-healing: no key / SDK / model failure → the deterministic verdict still returns (narrative: null).
// Returns the Crux-2 `acted_by` deputy stamp so a caller can carry it onto a chit on send (not persisted here yet).
router.post('/conform', async (req, res) => {
  try {
    const standard = (req.body && typeof req.body.standard === 'string') ? req.body.standard.trim() : '';
    const payload  = (req.body && req.body.payload && typeof req.body.payload === 'object') ? req.body.payload : {};
    if (!standard) return res.status(422).json({ ok: false, error: 'Name the standard to check against.' });

    const tpl = compliance.getTemplate(standard);
    if (!tpl) return res.status(404).json({ ok: false, error: 'Unknown standard.', available: compliance.listTemplates() });

    const verdict = compliance.evaluate(tpl, payload);   // ← deterministic floor; ALWAYS the source of truth
    const identity = softIdentity(req);
    const principal = identity ? ('entity:' + (identity.parent_entity_id || identity.identity_id)) : 'anon';

    // The Crux-2 deputy stamp. delegator = the invoking human (invoked mode); grant per-act; NOT confirmed here
    // (rung-2 recommend-only — a human ratifies before it's acted on). model filled iff the narrative ran.
    const acted_by = {
      deputy: 'ai:conform-verdict@v1', rung: 'summarise', tier: 'small', model: null,
      principal, delegator: identity ? { type: 'human', id: identity.identity_id } : null,
      confirmed_by: null, grant: 'per-act',
    };

    // Narrative layer — RUNG-2 SUMMARISE only. It explains the ALREADY-COMPUTED verdict; it never re-decides it.
    let narrative = null;
    const provider = process.env.ASSIST_LLM_PROVIDER, apiKey = process.env.ASSIST_LLM_API_KEY;
    if (provider === 'anthropic' && apiKey) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        const model = process.env.ASSIST_LLM_MODEL || 'claude-haiku-4-5-20251001';
        const client = new (Anthropic.Anthropic || Anthropic)({ apiKey, timeout: 8000, maxRetries: 1 });
        const sys = 'You are a compliance assistant. You are given a computed conformance verdict (the facts). Do NOT '
          + 're-decide compliance — explain the verdict plainly and list concrete remediation for each gap. Cite the '
          + 'standard version. Be brief, honest, never oversell. The entity remains responsible for actual compliance.';
        const msg = await client.messages.create({
          model, max_tokens: 250,
          system: [{ type: 'text', text: sys }],
          messages: [{ role: 'user', content: 'Verdict JSON (authoritative — do not contradict):\n' + JSON.stringify(verdict) }],
        });
        narrative = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || null;
        if (narrative) acted_by.model = model;
        log.info('conform narrative added', { id: req.id, standard, compliant: verdict.compliant, model });
      } catch (mErr) {
        // Narrative is best-effort — a model failure must NOT sink the deterministic verdict.
        log.warn('conform narrative skipped (model)', { id: req.id, err: mErr.message });
      }
    } else {
      log.info('conform (deterministic only — no model configured)', { id: req.id, standard, compliant: verdict.compliant });
    }

    res.json({ ok: true, ...verdict, narrative, acted_by });
  } catch (err) {
    log.error('assist/conform failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: safeErr(err) });
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
router.post('/catalogue-structure', async (req, res) => {
  try {
    const source = (req.body && typeof req.body.source === 'string') ? req.body.source.trim() : 'beta-royale-play@v1';
    const built = await catalogueBuild.build(source);
    if (!built) return res.status(404).json({ ok: false, error: 'Unknown catalogue source.', available: await catalogueBuild.listSources() });

    const identity = softIdentity(req);
    const principal = identity ? ('entity:' + (identity.parent_entity_id || identity.identity_id)) : 'anon';
    const acted_by = {
      deputy: 'ai:catalogue-structure@v1', rung: 'extract', tier: 'small', model: null,
      principal, delegator: identity ? { type: 'human', id: identity.identity_id } : null,
      confirmed_by: null, grant: 'per-act',
    };

    // Designer intro — model-drafted RUNG-summarise layer, best-effort. It describes the ALREADY-structured
    // collection; it never invents items. Absent a key, the structure still stands (intro: null).
    let intro = null;
    const provider = process.env.ASSIST_LLM_PROVIDER, apiKey = process.env.ASSIST_LLM_API_KEY;
    if (provider === 'anthropic' && apiKey) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        const model = process.env.ASSIST_LLM_MODEL || 'claude-haiku-4-5-20251001';
        const client = new (Anthropic.Anthropic || Anthropic)({ apiKey, timeout: 8000, maxRetries: 1 });
        const names = built.items.map(i => i.name).join(', ');
        const msg = await client.messages.create({
          model, max_tokens: 180,
          system: [{ type: 'text', text: 'You are a catalogue copywriter. Write ONE short, warm intro paragraph (<= 45 words) for a paint retailer\'s designer-finish collection. Do not invent finishes — only use the names given. Honest, no overselling.' }],
          messages: [{ role: 'user', content: 'Retailer: ' + built.for_entity + '. Collection: ' + built.collection + '. Finishes: ' + names + '.' }],
        });
        intro = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || null;
        if (intro) acted_by.model = model;
      } catch (mErr) { log.warn('catalogue intro skipped (model)', { id: req.id, err: mErr.message }); }
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
    res.status(500).json({ ok: false, error: safeErr(err) });
  }
});

// POST /api/assist/catalogue-adopt — PERSIST the entity's adoption: a REFERENCE (source_key + version) + its
// COMMERCIALS overlay only (NO copy of design/colour). Per-entity, WITH RLS (b75 catalogue_adoption). This is the
// human CONFIRM/publish of the catalogue-structure slot. Self-healing: if b75 isn't applied, returns 503 (not 500).
router.post('/catalogue-adopt', async (req, res) => {
  try {
    const identity = softIdentity(req);
    if (!identity) return res.status(401).json({ ok: false, error: 'Sign in to adopt a catalogue.' });
    const entity = identity.parent_entity_id || identity.identity_id;
    const source = (req.body && typeof req.body.source === 'string') ? req.body.source.trim() : 'beta-royale-play@v1';
    const built = await catalogueBuild.build(source);
    if (!built) return res.status(404).json({ ok: false, error: 'Unknown catalogue source.' });
    const commercials = (req.body && req.body.commercials && typeof req.body.commercials === 'object') ? req.body.commercials : {};
    const visible = !(req.body && req.body.visible === false);
    try {
      await withEntity(entity, (db) => db.query(
        `INSERT INTO catalogue_adoption (entity_id, source_key, version, commercials, visible, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, now())
         ON CONFLICT (entity_id, source_key)
           DO UPDATE SET commercials = EXCLUDED.commercials, visible = EXCLUDED.visible, version = EXCLUDED.version, updated_at = now()`,
        [entity, source, catalogueBuild.VERSION, JSON.stringify(commercials), visible]));
    } catch (dbErr) {
      log.warn('catalogue-adopt: store missing (run b75)', { id: req.id, err: dbErr.message });
      return res.status(503).json({ ok: false, code: 'CATALOGUE_STORE_MISSING', error: 'Catalogue persistence not enabled yet — apply migration b75.' });
    }
    log.info('catalogue adopted (reference + commercials)', { id: req.id, source, items_priced: Object.keys(commercials).length });
    res.json({ ok: true, persisted: true, source, resolved: await catalogueBuild.resolve(source, commercials),
      acted_by: { deputy: 'ai:catalogue-structure@v1', rung: 'extract', principal: 'entity:' + entity,
        delegator: { type: 'human', id: identity.identity_id }, confirmed_by: { id: identity.identity_id }, grant: 'per-act' } });
  } catch (err) {
    log.error('assist/catalogue-adopt failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: safeErr(err) });
  }
});

// GET /api/assist/catalogue-mine — the entity's PERSISTED catalogue(s): its adoption rows (WITH RLS) RESOLVED against
// the shared source (design/colour by reference) + its commercials overlay. Self-healing (503 if b75 not applied).
router.get('/catalogue-mine', async (req, res) => {
  try {
    const identity = softIdentity(req);
    if (!identity) return res.status(401).json({ ok: false, error: 'Sign in.' });
    const entity = identity.parent_entity_id || identity.identity_id;
    let rows = [];
    try {
      const r = await withEntity(entity, (db) => db.query(
        `SELECT source_key, version, commercials, visible, updated_at FROM catalogue_adoption WHERE entity_id = $1 ORDER BY updated_at DESC`, [entity]));
      rows = r.rows || [];
    } catch (dbErr) {
      return res.status(503).json({ ok: false, code: 'CATALOGUE_STORE_MISSING', error: 'Catalogue persistence not enabled yet — apply migration b75.' });
    }
    const catalogues = (await Promise.all(rows.map(async (row) => ({ source: row.source_key, version: row.version, visible: row.visible, updated_at: row.updated_at,
      resolved: await catalogueBuild.resolve(row.source_key, row.commercials || {}) })))).filter((c) => c.resolved);
    res.json({ ok: true, count: catalogues.length, catalogues });
  } catch (err) {
    log.error('assist/catalogue-mine failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: safeErr(err) });
  }
});

// PUT /api/assist/catalogue-source — SOURCE-AS-ENTITY: a brand entity AUTHORS/updates its OWN catalogue source
// (content + the customer-EXPERIENCE blueprint that cascades). Owner-only. catalogue_source is WITHOUT RLS, so
// ownership is enforced HERE (app-side) by owner_entity_id. Self-healing: 503 if b78 isn't applied yet.
router.put('/catalogue-source', auth, async (req, res) => {
  try {
    const owner = req.identity.parent_entity_id || req.identity.identity_id;
    const b = req.body || {};
    const source_key = (typeof b.source_key === 'string' && b.source_key.trim()) ? b.source_key.trim() : '';
    if (!source_key) return res.status(422).json({ ok: false, error: 'source_key is required (e.g. royale-play@v1)' });
    let exists;
    try { exists = await query('SELECT owner_entity_id FROM catalogue_source WHERE source_key = $1', [source_key]); }
    catch (dbErr) { return res.status(503).json({ ok: false, code: 'SOURCE_STORE_MISSING', error: 'Source authoring not enabled yet — apply migration b78.' }); }
    // Owner-only: if the source exists and is owned by someone else, refuse. (Unowned platform-seeds can be claimed.)
    if (exists.rows.length && exists.rows[0].owner_entity_id && String(exists.rows[0].owner_entity_id) !== String(owner))
      return res.status(403).json({ ok: false, error: 'This source is owned by another brand.' });
    const schema = (b.schema && typeof b.schema === 'object') ? b.schema : {};
    const items = Array.isArray(b.items) ? b.items : [];
    const commercials_fields = Array.isArray(b.commercials_fields) ? b.commercials_fields : [];
    const experience = (b.experience && typeof b.experience === 'object') ? b.experience : {};
    const formatting = (b.formatting && typeof b.formatting === 'object') ? b.formatting : {};
    try {
      await query(
        `INSERT INTO catalogue_source (source_key, version, for_vertical, title, collection, schema, items, commercials_fields, owner_entity_id, experience, formatting, active)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,true)
         ON CONFLICT (source_key) DO UPDATE SET
           version=EXCLUDED.version, for_vertical=EXCLUDED.for_vertical, title=EXCLUDED.title, collection=EXCLUDED.collection,
           schema=EXCLUDED.schema, items=EXCLUDED.items, commercials_fields=EXCLUDED.commercials_fields,
           owner_entity_id=COALESCE(catalogue_source.owner_entity_id, EXCLUDED.owner_entity_id),
           experience=EXCLUDED.experience, formatting=EXCLUDED.formatting`,
        [source_key, b.version || 'v1', b.for_vertical || null, b.title || null, b.collection || null,
         JSON.stringify(schema), JSON.stringify(items), JSON.stringify(commercials_fields),
         owner, JSON.stringify(experience), JSON.stringify(formatting)]);
    } catch (dbErr) { return res.status(503).json({ ok: false, code: 'SOURCE_STORE_MISSING', error: 'Source authoring not enabled yet — apply migration b78.' }); }
    // WIRING (stone 5): mirror each item to a CONTAINER (create/enhance, change-detected). Best-effort, self-healing.
    let containers = 0;
    try { containers = (await container.syncItemContainers(owner, source_key, items)).length; } catch (_) { /* b80 absent → skip */ }
    log.info('catalogue source authored', { id: req.id, source_key, owner: String(owner).slice(0, 8), items: items.length, containers });
    res.json({ ok: true, source_key, owner_entity_id: owner, authored: true, containers });
  } catch (err) {
    log.error('assist/catalogue-source PUT failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: safeErr(err) });
  }
});

// PUT /api/assist/container — CONTAINER MODEL (stone 5): author (v1) or ENHANCE (mint the next IMMUTABLE version + move
// the pointer) a product container. Owner-only. An enhancement never mutates a version → past chits stay verifiable.
router.put('/container', auth, async (req, res) => {
  try {
    const owner = req.identity.parent_entity_id || req.identity.identity_id;
    const b = req.body || {};
    const container_id = (typeof b.container_id === 'string' && b.container_id.trim()) ? b.container_id.trim() : '';
    if (!container_id) return res.status(422).json({ ok: false, error: 'container_id is required (e.g. royaleplay/tussar)' });
    let out;
    try { out = await container.authorContainer(owner, { container_id, name: b.name, source_key: b.source_key, content: b.content, schema: b.schema, schema_version: b.schema_version }); }
    catch (e) {
      if (e.status === 403) return res.status(403).json({ ok: false, error: e.message });
      return res.status(503).json({ ok: false, code: 'CONTAINER_STORE_MISSING', error: 'Container model not enabled yet — apply migration b80.' });
    }
    log.info('container authored', { id: req.id, container_id, version: out.version, is_new: out.is_new_container });
    res.json({ ok: true, ...out, owner_entity_id: owner });
  } catch (err) { log.error('assist/container PUT failed', { id: req.id, err: err.message }); res.status(500).json({ ok: false, error: safeErr(err) }); }
});

// GET /api/assist/container/:id — resolve the CURRENT version (the pointer, auto-latest) or ?version=N (the EXACT
// immutable version a chit pinned — verification). Public read (the catalogue/experience is shared reference).
router.get('/container/:id', async (req, res) => {
  try {
    const r = await container.resolveContainer(req.params.id, req.query.version);
    if (!r) return res.status(404).json({ ok: false, error: 'Unknown container or version.' });
    res.json({ ok: true, ...r });
  } catch (err) { res.status(500).json({ ok: false, error: safeErr(err) }); }
});

// PUT /api/assist/region-override — 6a: the source authors a per-REGION override on its OWN container (owner-gated).
// Hybrid: most of "per region" auto-cascades (currency/units/language); this is the genuinely-local delta (colour
// names, compliance labels, regional combinations). Self-healing: 503 if b81 isn't applied.
router.put('/region-override', auth, async (req, res) => {
  try {
    const owner = req.identity.parent_entity_id || req.identity.identity_id;
    const b = req.body || {};
    const container_id = (typeof b.container_id === 'string' && b.container_id.trim()) ? b.container_id.trim() : '';
    const region = (typeof b.region === 'string' && b.region.trim()) ? b.region.trim() : '';
    if (!container_id || !region) return res.status(422).json({ ok: false, error: 'container_id and region are required' });
    const overrides = (b.overrides && typeof b.overrides === 'object') ? b.overrides : {};
    try { await regional.setRegionOverride(owner, container_id, region, overrides); }
    catch (e) {
      if (e.status === 403) return res.status(403).json({ ok: false, error: e.message });
      if (e.status === 404) return res.status(404).json({ ok: false, error: e.message });
      return res.status(503).json({ ok: false, code: 'REGION_STORE_MISSING', error: 'Regional scatter not enabled yet — apply migration b81.' });
    }
    res.json({ ok: true, container_id, region });
  } catch (err) { log.error('assist/region-override failed', { id: req.id, err: err.message }); res.status(500).json({ ok: false, error: safeErr(err) }); }
});

// GET /api/assist/resolve?container=&version=&region= — SPIN THE GLOBE: the product's presentation + governance
// RESOLVED for a region (global content + regional override + auto-cascaded basics), SEALED + cached. Public read.
router.get('/resolve', async (req, res) => {
  try {
    const region = (req.query.region && String(req.query.region).trim()) || 'IN';
    const r = await regional.resolveRegional(req.query.container, req.query.version, region);
    if (!r) return res.status(404).json({ ok: false, error: 'Unknown container or version.' });
    res.json({ ok: true, ...r });
  } catch (err) { res.status(500).json({ ok: false, error: safeErr(err) }); }
});

// GET /api/assist/penetration — STONE 4: the BRAND's aggregated penetration for the sources IT owns (heatmap data).
// AGGREGATE-ONLY: order counts + distributor coverage by locality — NO per-customer PII (the ledger has no customer id).
// Owner-gated (only your own sources). Self-healing: 503 if b79 isn't applied.
router.get('/penetration', auth, async (req, res) => {
  try {
    const owner = req.identity.parent_entity_id || req.identity.identity_id;
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
          ORDER BY orders DESC, sp.locality ASC`, [owner]);
      rows = r.rows;
    } catch (dbErr) { return res.status(503).json({ ok: false, code: 'PENETRATION_STORE_MISSING', error: 'Penetration not enabled yet — apply migration b79.' }); }
    const total_orders = rows.reduce((s, x) => s + x.orders, 0);
    const localities = Array.from(new Set(rows.map((x) => x.locality)));
    res.json({ ok: true, total_orders, localities: localities.length, by_locality: rows });
  } catch (err) { log.error('assist/penetration failed', { id: req.id, err: err.message }); res.status(500).json({ ok: false, error: safeErr(err) }); }
});

// GET /api/assist/catalogue-source/:key — read a source (content + EXPERIENCE + formatting). `finishes` not `items`
// so the client unwrap() doesn't strip the object.
router.get('/catalogue-source/:key', async (req, res) => {
  try {
    const built = await catalogueBuild.build(req.params.key);
    if (!built) return res.status(404).json({ ok: false, error: 'Unknown source.' });
    const { items, ...rest } = built;
    res.json({ ok: true, ...rest, finishes: items });
  } catch (err) { res.status(500).json({ ok: false, error: safeErr(err) }); }
});

// GET /api/assist/questions?context=<screen> — the assistant Q&A library, served FROM THE DB (single source of
// truth; also the grounding feed for the model). PUBLIC (works pre-auth on welcome/login/register). Returns
// entries whose context matches the screen OR '*'; no context -> all active. Shape: {ok:true, data:[{id,q,a,...}]}.
router.get('/questions', async (req, res) => {
  try {
    // context may be a CHAIN (comma-list: fine → parent → nav) so a sub-page ADDS its specific Q&A without losing the
    // broader curated set. Match if the entry's context array OVERLAPS any of them, or is universal ('*').
    const ctxRaw = (req.query && typeof req.query.context === 'string') ? req.query.context.slice(0, 128).trim() : '';
    const ctxArr = ctxRaw ? ctxRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6) : [];
    const params = [];
    let where = 'active = true';
    if (ctxArr.length) { params.push(ctxArr); where += ` AND (context && $1::text[] OR '*' = ANY(context))`; }
    const r = await query(
      `SELECT id, question AS q, answer AS a, topics, context, fit, media
         FROM assist_qa WHERE ${where} ORDER BY sort, id`, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) {
    log.error('assist/questions failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: 'Could not load assistant questions.' });
  }
});

// POST /api/assist/gap — DEPRECATED under B1 RLS (2026-07-04). It used to write a DRAFT into the HELP entity's
// catalogue (entity_id = help) from an outside/anonymous caller — a cross-entity write the owner-only rule now
// forbids ("nobody writes another entity's catalogue"). The sanctioned capture is a CHIT to the help desk: the web
// client's "Send to help desk" (askHelpDesk → POST /chits/send) lands the question in GOV-01-Help's Task inbox,
// where it is answered and Published to the KB. Kept as a no-op ack (so the old fire-and-forget caller doesn't
// error) that only LOGS the unanswered question as an analytics signal — it writes nothing.
router.post('/gap', async (req, res) => {
  try {
    const question = (req.body && typeof req.body.q === 'string')       ? req.body.q.trim()             : '';
    const context  = (req.body && typeof req.body.context === 'string') ? req.body.context.slice(0, 64) : '';
    if (!question || question.length < 3) return res.status(422).json({ ok: false, error: 'Ask a question.' });
    if (question.length > 400)            return res.status(422).json({ ok: false, error: 'Question is too long.' });
    // No catalogue write. Real capture is the chit flow (Send to help desk → a chit in GOV-01-Help's Task inbox).
    log.info('assist gap (deprecated — capture is now the chit flow)', { id: req.id, context, len: question.length });
    res.json({ ok: true, noted: true, via: 'chit' });
  } catch (err) {
    log.error('assist/gap failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: 'Could not note the question.' });
  }
});

// POST /api/assist/publish — the help desk publishes a resolved Q&A to ITS catalogue => the projection trigger
// serves it live. Auth; the caller MUST be the Help entity itself (only it edits its own knowledge base).
router.post('/publish', auth, async (req, res) => {
  try {
    const b        = req.body || {};
    const question = (typeof b.question === 'string') ? b.question.trim() : '';
    const answer   = (typeof b.answer === 'string')   ? b.answer.trim()   : '';
    if (!question || !answer) return res.status(422).json({ ok: false, error: 'question and answer are required.' });
    const context  = Array.isArray(b.context) ? b.context.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];

    // Generalised (blueprint): the CALLER must be a helpdesk (carries the 'Assistant Q&A' schema); it publishes to
    // ITS OWN catalogue. GOV-01-Help carries that schema -> backward compatible.
    const sender = req.identity.parent_entity_id || req.identity.identity_id;
    const hd = await query(
      `SELECT 1 FROM entity_schemas WHERE entity_id = $1 AND schema_name = 'Assistant Q&A' AND status = 'active' LIMIT 1`, [sender]);
    if (!hd.rows.length) return res.status(403).json({ ok: false, error: 'Only a help desk can publish to its catalogue.' });
    const helpId = sender;

    // Refine an existing answer when qa_id is supplied and found; else publish new.
    const qaIn = (typeof b.qa_id === 'string' && b.qa_id.trim()) ? b.qa_id.trim() : '';
    if (qaIn) {
      // B1 RLS: a help desk publishes to ITS OWN catalogue -> withEntity(me).
      const upd = await withEntity(helpId, (db) => db.query(
        `UPDATE catalogue_items
            SET item_data = item_data || jsonb_build_object('question',$3::text,'answer',$4::text,'context',$5::jsonb,'status','approved'),
                is_active = true, updated_at = now()
          WHERE entity_id = $1 AND item_data->>'qa_id' = $2`,
        [helpId, qaIn, question, answer, JSON.stringify(context)]));
      if (upd.rowCount) { log.info('assist updated', { id: req.id, qa_id: qaIn }); return res.json({ ok: true, qa_id: qaIn, updated: true }); }
    }
    const sch = await query(`SELECT schema_id FROM entity_schemas WHERE entity_id = $1 AND is_default = true LIMIT 1`, [helpId]);
    const schema_id = sch.rows[0] ? sch.rows[0].schema_id : null;
    const qaId = 'pub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const item_data = { qa_id: qaId, question, answer, context, topics: [], fit: null, media: null, status: 'approved' };
    await withEntity(helpId, (db) => db.query(   // B1 RLS: own catalogue -> withEntity(me)
      `INSERT INTO catalogue_items (entity_id, schema_id, item_data, is_active) VALUES ($1, $2, $3, true)`,
      [helpId, schema_id, JSON.stringify(item_data)]));
    log.info('assist published', { id: req.id, qa_id: qaId, ctx: context.join(',') });
    res.json({ ok: true, qa_id: qaId });
  } catch (err) { log.error('assist/publish failed', { id: req.id, err: err.message }); res.status(500).json({ ok: false, error: 'Could not publish.' }); }
});

// ── Review / triage (#3) — auth-gated (TODO: tighten to owner_scope='platform' before production) ──

// GET /api/assist/gaps — DEPRECATED under B1 RLS. The gap-review flow is superseded by chit→Task: questions arrive
// as CHITS in GOV-01-Help's Task inbox (not as catalogue drafts), so there are no catalogue "gaps" to list. Returns
// empty and reads nothing (the cross-read of the help catalogue is no longer needed).
router.get('/gaps', auth, async (req, res) => {
  res.json({ ok: true, data: [], deprecated: true });
});

// POST /api/assist/resolve — DEPRECATED under B1 RLS. It updated the HELP entity's catalogue from an outside caller
// (a cross-entity write, now forbidden). Answering is done on the question's CHIT in GOV-01-Help's Task inbox, then
// Published via POST /api/assist/publish (own catalogue). This endpoint writes nothing.
router.post('/resolve', auth, async (req, res) => {
  res.status(410).json({ ok: false, deprecated: true,
    error: 'Gap review is superseded — answer the question on its chit (Task inbox), then Publish to the KB.' });
});

// GET /api/assist/whoami — is the logged-in entity a helpdesk instance? Drives the helpdesk business-layer gate
// (generalises off the hardcoded 'GOV-01-Help' name). Never throws.
router.get('/whoami', auth, async (req, res) => {
  try {
    const entity = req.identity.parent_entity_id || req.identity.identity_id;
    const r = await query(
      `SELECT 1 FROM entity_schemas WHERE entity_id = $1 AND schema_name = 'Assistant Q&A' AND status = 'active' LIMIT 1`, [entity]);
    res.json({ ok: true, is_helpdesk: r.rows.length > 0 });
  } catch (_) { res.json({ ok: true, is_helpdesk: false }); }
});

module.exports = router;

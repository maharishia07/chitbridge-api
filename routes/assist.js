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
const { query } = require('../db');              // DB access for the Q&A library (assist_qa)
const auth    = require('../middleware/auth');   // review endpoints are auth-gated (tighten to platform-scope later)
const ASSIST_KB = require('../lib/assist-kb');   // server-side grounding (cacheable, tamper-proof)

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

// GET /api/assist/questions?context=<screen> — the assistant Q&A library, served FROM THE DB (single source of
// truth; also the grounding feed for the model). PUBLIC (works pre-auth on welcome/login/register). Returns
// entries whose context matches the screen OR '*'; no context -> all active. Shape: {ok:true, data:[{id,q,a,...}]}.
router.get('/questions', async (req, res) => {
  try {
    const ctx = (req.query && typeof req.query.context === 'string') ? req.query.context.slice(0, 64).trim() : '';
    const params = [];
    let where = 'active = true';
    if (ctx) { params.push(ctx); where += ` AND ($1 = ANY(context) OR '*' = ANY(context))`; }
    const r = await query(
      `SELECT id, question AS q, answer AS a, topics, context, fit, media
         FROM assist_qa WHERE ${where} ORDER BY sort, id`, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) {
    log.error('assist/questions failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: 'Could not load assistant questions.' });
  }
});

// POST /api/assist/gap — capture a question the assistant could NOT answer, as a DRAFT under the Help entity.
// item_data.status='gap', is_active=false => the projection trigger keeps it OUT of serving until a human answers +
// approves it in review (#3). Public + rate-limited (assistLimiter on /api/assist). Deduped by normalised question.
router.post('/gap', async (req, res) => {
  try {
    const question = (req.body && typeof req.body.q === 'string')       ? req.body.q.trim()             : '';
    const context  = (req.body && typeof req.body.context === 'string') ? req.body.context.slice(0, 64) : '';
    if (!question || question.length < 3) return res.status(422).json({ ok: false, error: 'Ask a question.' });
    if (question.length > 400)            return res.status(422).json({ ok: false, error: 'Question is too long.' });

    const ent = await query(`SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system' LIMIT 1`);
    const entity_id = ent.rows[0] && ent.rows[0].identity_id;
    if (!entity_id) return res.status(503).json({ ok: false, error: 'Help entity not provisioned.' });
    const sch = await query(
      `SELECT schema_id FROM entity_schemas WHERE entity_id = $1 AND is_default = true LIMIT 1`, [entity_id]);
    const schema_id = sch.rows[0] ? sch.rows[0].schema_id : null;

    // dedup: same question already captured as a gap?
    const dup = await query(
      `SELECT 1 FROM catalogue_items
        WHERE entity_id = $1 AND item_data->>'status' = 'gap'
          AND lower(item_data->>'question') = lower($2) LIMIT 1`, [entity_id, question]);
    if (dup.rows.length) return res.json({ ok: true, deduped: true });

    const qaId = 'gap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const item_data = { qa_id: qaId, question, answer: '', context: context ? [context] : [], topics: [], fit: null, media: null, status: 'gap' };
    await query(
      `INSERT INTO catalogue_items (entity_id, schema_id, item_data, is_active) VALUES ($1, $2, $3, false)`,
      [entity_id, schema_id, JSON.stringify(item_data)]);
    log.info('assist gap captured', { id: req.id, context, len: question.length });
    res.json({ ok: true, captured: true });
  } catch (err) {
    log.error('assist/gap failed', { id: req.id, err: err.message });
    res.status(500).json({ ok: false, error: 'Could not capture the question.' });
  }
});

// ── Review / triage (#3) — auth-gated (TODO: tighten to owner_scope='platform' before production) ──

// GET /api/assist/gaps — captured gaps (draft questions) awaiting review, newest first.
router.get('/gaps', auth, async (req, res) => {
  try {
    const ent = await query(`SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system' LIMIT 1`);
    const entity_id = ent.rows[0] && ent.rows[0].identity_id;
    if (!entity_id) return res.json({ ok: true, data: [] });
    const r = await query(
      `SELECT item_data->>'qa_id' AS qa_id, item_data->>'question' AS question,
              item_data->'context' AS context, created_at
         FROM catalogue_items
        WHERE entity_id = $1 AND item_data->>'status' = 'gap'
        ORDER BY created_at DESC`, [entity_id]);
    res.json({ ok: true, data: r.rows });
  } catch (err) { log.error('assist/gaps failed', { id: req.id, err: err.message }); res.status(500).json({ ok: false, error: 'Could not list gaps.' }); }
});

// POST /api/assist/resolve — { qa_id, action:'approve'|'reject', answer?, context?[], topics?[] }.
// approve => writes the answer + status=approved + is_active=true => the projection trigger serves it live.
// reject  => status=rejected + is_active=false (kept for audit, never served).
router.post('/resolve', auth, async (req, res) => {
  try {
    const b      = req.body || {};
    const qa_id  = (typeof b.qa_id === 'string') ? b.qa_id.trim() : '';
    const action = (b.action === 'approve' || b.action === 'reject') ? b.action : '';
    if (!qa_id || !action) return res.status(422).json({ ok: false, error: 'qa_id and a valid action are required.' });

    const ent = await query(`SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system' LIMIT 1`);
    const entity_id = ent.rows[0] && ent.rows[0].identity_id;
    if (!entity_id) return res.status(503).json({ ok: false, error: 'Help entity not provisioned.' });

    if (action === 'reject') {
      const r = await query(
        `UPDATE catalogue_items SET item_data = jsonb_set(item_data, '{status}', '"rejected"'), is_active = false, updated_at = now()
          WHERE entity_id = $1 AND item_data->>'qa_id' = $2`, [entity_id, qa_id]);
      return res.json({ ok: true, action: 'reject', changed: r.rowCount });
    }

    const answer = (typeof b.answer === 'string') ? b.answer.trim() : '';
    if (!answer) return res.status(422).json({ ok: false, error: 'An answer is required to approve.' });
    const context = Array.isArray(b.context) ? b.context.filter(x => typeof x === 'string') : [];
    const topics  = Array.isArray(b.topics)  ? b.topics.filter(x => typeof x === 'string')  : [];
    const r = await query(
      `UPDATE catalogue_items
          SET item_data = item_data || jsonb_build_object('answer', $3::text, 'status', 'approved', 'context', $4::jsonb, 'topics', $5::jsonb),
              is_active = true, updated_at = now()
        WHERE entity_id = $1 AND item_data->>'qa_id' = $2`,
      [entity_id, qa_id, answer, JSON.stringify(context), JSON.stringify(topics)]);
    log.info('assist gap resolved', { id: req.id, qa_id, action, by: req.identity && req.identity.identity_id });
    res.json({ ok: true, action: 'approve', changed: r.rowCount });
  } catch (err) { log.error('assist/resolve failed', { id: req.id, err: err.message }); res.status(500).json({ ok: false, error: 'Could not resolve.' }); }
});

module.exports = router;

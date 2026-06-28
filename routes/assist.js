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
      return res.status(503).json({ error: 'Assistant unavailable', message: 'The assistant model is not configured yet.' });
    }

    if (provider !== 'anthropic') {
      log.warn('assist: unsupported provider', { id: req.id, provider });
      return res.status(501).json({ error: 'Not implemented', message: 'That assistant provider is not wired.' });
    }

    // Lazy-require the SDK so a missing dependency degrades gracefully (client floor) instead of crashing boot.
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); }
    catch (_) { log.error('assist: @anthropic-ai/sdk not installed', { id: req.id });
                return res.status(503).json({ error: 'Assistant unavailable', message: 'The assistant is not available right now.' }); }

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
        messages: [ { role: 'user', content: `Screen: ${context || 'unknown'}\nUser question: ${q}` } ],
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

module.exports = router;

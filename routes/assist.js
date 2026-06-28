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

    // TODO (real): call `provider` with SYSTEM_PROMPT + grounding + q; map the reply to { answer, fit?, media? }.
    // Until that SDK call lands, behave as not-yet-wired so the client keeps using its deterministic floor.
    void SYSTEM_PROMPT;
    log.warn('assist provider configured but model call not implemented', { id: req.id, provider });
    return res.status(501).json({ error: 'Not implemented', message: 'Assistant model call is not wired yet.' });

  } catch (err) {
    res.status(500).json({ error: 'Assistant error', message: safeErr(err) });
  }
});

module.exports = router;

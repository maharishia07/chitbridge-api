'use strict';
// CALLED BY lib/notify.js (mail), lib/whatsapp-out.js (WhatsApp), lib/ai.js (AI), routes/integrations.js (GET /status), routes/health.js (counts)
// @stage tested
// @stage-note ERR-8+7 (B5): the ONE registry of the outside services this api calls, each with a state and its register sentence.
/**
 * CARD 23-connectors-and-integrations/connector-actors
 * lib/connector-state.js — outside services (AI, e-mail, WhatsApp, speech): connected / not set up / down, and why the last send failed.
 * OWNER     cb-connect
 * RISK      plain
 * OWNS  REGISTRY (the list), stateOf / statesOf (one verdict each), note.failed / note.worked (the in-process outcome of the last call), counts() (what /health shows: numbers, never names)
 * FLOW  a sender calls note.failed(name, REASON) or note.worked(name) after each real attempt → stateOf reads env (set up?) and the outcome (down?) → the web greys an action with the register's sentence
 * STATES  connected (set up, last call worked or none yet) · not_set_up (no key on this server) · down (set up, and the last call failed within 15 minutes with no success since).
 * Each state names a register code in docs/ERROR-CODES.md (connected has none), so the sentence and hint are the register's, never a second wording. Nothing here sends, queues or retries: the queue is the
 * sender's own (channel_outbound for WhatsApp), and a failed send is recorded there with its named reason; this file only remembers the outcome so the state can be shown.
 * The reason is a CODE (MAIL_SEND_FAILED), never the provider's text (it can name an account); the provider's own text stays in the log.
 */
const registerRows = require('../docs/error-codes.json').codes;

const DOWN_WINDOW_MS = 15 * 60 * 1000;
const env = (name) => String(process.env[name] || '').trim();
const REGISTRY = {
  ai: { label: 'AI', set: () => !!env('ANTHROPIC_API_KEY'), unset_code: 'AI_NOT_CONNECTED' },
  mail: { label: 'E-mail', set: () => process.env.OTP_EMAIL_ENABLED === 'true' && !!env('RESEND_API_KEY'), unset_code: 'CONNECTOR_NOT_SET_UP' },
  whatsapp: { label: 'WhatsApp', set: () => !!env('WHATSAPP_TOKEN'), unset_code: 'CONNECTOR_NOT_SET_UP' },
  speech: { label: 'Speech and form reading', set: () => !!env('OPENAI_API_KEY'), unset_code: 'CONNECTOR_NOT_SET_UP' }
};

/** the last outcome per connector: { failed_at, reason, failures, worked_at } (this process only; a restart forgets, and "connected" is then the honest default) */
const last = {};
const slot = (name) => (last[name] = last[name] || { failures: 0, failed_at: 0, worked_at: 0, reason: null });
const note = {
  /** a real send failed: the named reason (a code), counted */
  failed(name, reason, now = Date.now()) {
    if (!REGISTRY[name]) return;
    const s = slot(name);
    s.failures++;
    s.failed_at = now;
    s.reason = String(reason || 'FAILED');
  },
  /** a real send worked: the connector is not down any more */
  worked(name, now = Date.now()) {
    if (REGISTRY[name]) slot(name).worked_at = now;
  },
  reset: () => Object.keys(last).forEach((name) => delete last[name])
};

const wordsOf = (code) => {
  const row = registerRows.find((r) => r.code === code);
  return row ? { code, sentence: row.shopkeeper, hint: row.hint } : { code, sentence: null, hint: null };
};

/** one connector → { name, label, state, code, sentence, hint, last_failure } ; code/sentence/hint are null when connected */
function stateOf(name, now = Date.now()) {
  const def = REGISTRY[name],
    s = last[name] || { failed_at: 0, worked_at: 0, reason: null };
  if (!def) return null;
  const down = def.set() && s.failed_at > s.worked_at && now - s.failed_at <= DOWN_WINDOW_MS;
  const state = !def.set() ? 'not_set_up' : down ? 'down' : 'connected';
  const words = state === 'connected' ? { code: null, sentence: null, hint: null } : wordsOf(state === 'not_set_up' ? def.unset_code : 'CONNECTOR_DOWN');
  return { name, label: def.label, state, ...words, last_failure: s.failed_at ? { at: new Date(s.failed_at).toISOString(), reason: s.reason } : null };
}
const statesOf = (now = Date.now()) => Object.keys(REGISTRY).map((name) => stateOf(name, now));

/** what the PUBLIC /health shows: counts only, no names */
function counts(now = Date.now()) {
  const states = statesOf(now);
  return { total: states.length, connected: states.filter((s) => s.state === 'connected').length, not_set_up: states.filter((s) => s.state === 'not_set_up').length, down: states.filter((s) => s.state === 'down').length };
}

module.exports = { REGISTRY, DOWN_WINDOW_MS, note, stateOf, statesOf, counts };

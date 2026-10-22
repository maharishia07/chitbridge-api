'use strict';
/**
 * lib/owner.js — IS THIS REQUEST THE BUSINESS'S OWNER? Not a key (a till or connector key lives on a shop PC), not a
 * co-assist (an actor has a parent entity). One test, read by every owner-only switch: the ledger's (routes/books.js)
 * and the folder inventory's (routes/folders.js).
 *
 * T3-SETTINGS (2026-10-14): the same test as ONE gate and ONE may/why. routes/counters.js had it inline on /assign only, so
 * every other counters write was open to a co-assist. `gate(message)` is the middleware; `may(req, message)` is what a screen
 * greys an action with ({ ok, code, why }) — the same sentence the gate refuses with, so the two cannot drift apart.
 
 * OWNS      the one owner test: isOwner(req), gate(message), may(req, message).
 * FLOW      request → isOwner → gate refuses with the may/why sentence (the refusal now answers through lib/problem.js, legacy keys frozen)
 * CARD      28-platform-and-operations/api-standard
 * CALLED BY lib/finance-terms.js, routes/books.js, routes/crm.js, routes/entities.js, routes/folders.js (+6 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
const { problem } = require('./problem');
const isOwner = (req) => !req.api_key && !(req.identity && req.identity.parent_entity_id);

const OWNER_ONLY = 'OWNER_ONLY';
const OWNER_ONLY_WORDS = 'Only the owner may do this.';

/**
 * ownerOnly(why?) — THE ONE owner gate for a route (SEC2). Refuses with 403 in words: { code:'OWNER_ONLY', may:false, why, message }
 * so a screen greys the action WITH the sentence and never parses prose. routes/signin.js, every people write in routes/actors.js
 * and every counters write (T3-SETTINGS, as `gate`) use it; `why` defaults to the general sentence.
 */
const ownerOnly = (why) => (req, res, next) => {
  if (isOwner(req)) return next();
  const msg = why || OWNER_ONLY_WORDS;
  /* API-STANDARD S1/S2: the Problem body, with the keys this gate always answered frozen beside it (the screen greys the action from may/why/code) */
  return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: msg, legacy: { error: 'Forbidden', code: OWNER_ONLY, may: false, why: msg, message: msg } });
};
/** may(req, why?) — the SAME test and sentence as the gate, as a read answer: { ok, code, why } (GET /api/counters may.manage · GET /entities/policy may[flag]) */
const may = (req, why) => (isOwner(req) ? { ok: true, code: null, why: null } : { ok: false, code: OWNER_ONLY, why: why || OWNER_ONLY_WORDS });
/* T3-SETTINGS named the gate `gate` — one function, two names (INT6c): a refusal and a grey state come from the same place */
const gate = ownerOnly;

module.exports = { isOwner, ownerOnly, gate, may, OWNER_ONLY, OWNER_ONLY_WORDS };

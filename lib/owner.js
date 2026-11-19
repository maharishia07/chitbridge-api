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

/** a gate says which role it needs (tools/api-reported.cjs reads the tag: bfla_role_check applies to a route that carries one); the tag changes nothing at run time */
const roleGate = (role, gateFn) => Object.assign(gateFn, { roleGate: role });

/**
 * ownerOnly(why?) — THE ONE owner gate for a route (SEC2). Refuses with 403 in words: { code:'OWNER_ONLY', may:false, why, message }
 * so a screen greys the action WITH the sentence and never parses prose. routes/signin.js, every people write in routes/actors.js
 * and every counters write (T3-SETTINGS, as `gate`) use it; `why` defaults to the general sentence.
 */
const ownerOnly = (why) => roleGate('owner', (req, res, next) => {
  if (isOwner(req)) return next();
  const msg = why || OWNER_ONLY_WORDS;
  /* API-STANDARD S1/S2: the Problem body, with the keys this gate always answered frozen beside it (the screen greys the action from may/why/code) */
  return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: msg, legacy: { error: 'Forbidden', code: OWNER_ONLY, may: false, why: msg, message: msg } });
});
/** may(req, why?) — the SAME test and sentence as the gate, as a read answer: { ok, code, why } (GET /api/counters may.manage · GET /entities/policy may[flag]) */
const mayAnswer = (req, why) => (isOwner(req) ? { ok: true, code: null, why: null } : { ok: false, code: OWNER_ONLY, why: why || OWNER_ONLY_WORDS });
/* T3-SETTINGS named the gate `gate` — one function, two names (INT6c): a refusal and a grey state come from the same place */
const gate = ownerOnly;

/**
 * ASSIGN-1 (W3): who may assign a piece of work that carries a register level (lib/assign-register may_assign: any | manager | owner).
 * 'manager' = the owner (the partner) or an actor whose OWN row says hat manager: never a key, never a grant-synthetic identity (acting_for_grant), and the hat is
 * read from req.identity as auth loaded it this request, never from the body, a header or the query. Named mayAt because may() above already answers the owner-only grey state.
 */
const MANAGER_ONLY_WORDS = 'Only the partner or a manager can assign clients.';
/** a firm actor whose OWN row says hat manager: never a key, never a grant-synthetic identity (ASSIGN-1: the partner's firm-wide view of clients extends to this hat, decided 2026-11-17 by leader practice) */
const isManager = (req) => { const id = req && req.identity; return !!req && !req.api_key && !!id && id.identity_type === 'actor' && !!id.parent_entity_id && id.hat === 'manager' && !id.acting_for_grant; };
const LEVELS = ['any', 'manager', 'owner'];
function mayAt(req, level) {
  if (level === 'any' || !LEVELS.includes(level)) return level === 'any' ? { ok: true, code: null, why: null } : { ok: false, code: 'CHIT_NOT_PERMITTED', why: MANAGER_ONLY_WORDS };
  const id = req && req.identity;
  const owner = isOwner(req);
  const manager = isManager(req);
  const ok = level === 'owner' ? owner : owner || manager;
  return ok ? { ok: true, code: null, why: null } : { ok: false, code: 'CHIT_NOT_PERMITTED', why: MANAGER_ONLY_WORDS };
}
/** the route gate for work that needs the partner or a manager: 403 CHIT_NOT_PERMITTED in the Problem shape, nothing else read first */
const managerGate = () => roleGate('manager', (req, res, next) => {
  const verdict = mayAt(req, 'manager');
  if (verdict.ok) return next();
  return problem(req, res, { status: 403, code: 'CHIT_NOT_PERMITTED', detail: verdict.why });
});

module.exports = { isOwner, isManager, ownerOnly, roleGate, gate, may: mayAnswer, mayAt, managerGate, MANAGER_ONLY_WORDS, OWNER_ONLY, OWNER_ONLY_WORDS };

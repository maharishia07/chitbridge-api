'use strict';
/**
 * lib/owner.js — IS THIS REQUEST THE BUSINESS'S OWNER? Not a key (a till or connector key lives on a shop PC), not a
 * co-assist (an actor has a parent entity). One test, read by every owner-only switch: the ledger's (routes/books.js)
 * and the folder inventory's (routes/folders.js).
 *
 * T3-SETTINGS (2026-10-14): the same test as ONE gate and ONE may/why. routes/counters.js had it inline on /assign only, so
 * every other counters write was open to a co-assist. `gate(message)` is the middleware; `may(req, message)` is what a screen
 * greys an action with ({ ok, code, why }) — the same sentence the gate refuses with, so the two cannot drift apart.
 */
const isOwner = (req) => !req.api_key && !(req.identity && req.identity.parent_entity_id);
const OWNER_ONLY = 'OWNER_ONLY';
const may = (req, message) => (isOwner(req) ? { ok: true, code: null, why: null } : { ok: false, code: OWNER_ONLY, why: message || 'Only the owner can do this.' });
const gate = (message) => (req, res, next) => {
  if (isOwner(req)) return next();
  res.status(403).json({ error: 'Forbidden', code: OWNER_ONLY, message: message || 'Only the owner can do this.' });
};
module.exports = { isOwner, may, gate, OWNER_ONLY };

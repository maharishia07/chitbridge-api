'use strict';
/**
 * lib/owner.js — IS THIS REQUEST THE BUSINESS'S OWNER? Not a key (a till or connector key lives on a shop PC), not a
 * co-assist (an actor has a parent entity). One test, read by every owner-only switch: the ledger's (routes/books.js)
 * and the folder inventory's (routes/folders.js).
 */
const isOwner = (req) => !req.api_key && !(req.identity && req.identity.parent_entity_id);

const OWNER_ONLY_WORDS = 'Only the owner may do this.';

/**
 * ownerOnly(why?) — THE ONE owner gate for a route (SEC2). Refuses with 403 in words: { code:'OWNER_ONLY', may:false, why }
 * so a screen greys the action WITH the sentence and never parses prose. routes/signin.js and every people write in
 * routes/actors.js use it; `why` defaults to the general sentence.
 */
const ownerOnly = (why) => (req, res, next) => {
  if (isOwner(req)) return next();
  const msg = why || OWNER_ONLY_WORDS;
  res.locals.code = 'OWNER_ONLY';
  return res.status(403).json({ error: 'Forbidden', code: 'OWNER_ONLY', may: false, why: msg, message: msg });
};

module.exports = { isOwner, ownerOnly, OWNER_ONLY_WORDS };

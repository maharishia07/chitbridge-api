'use strict';
/**
 * lib/owner.js — IS THIS REQUEST THE BUSINESS'S OWNER? Not a key (a till or connector key lives on a shop PC), not a
 * co-assist (an actor has a parent entity). One test, read by every owner-only switch: the ledger's (routes/books.js)
 * and the folder inventory's (routes/folders.js).
 */
const isOwner = (req) => !req.api_key && !(req.identity && req.identity.parent_entity_id);
module.exports = { isOwner };

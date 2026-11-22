/**
 * guards-list.cjs — THE OFFLINE GUARD LIST, joined (moved out of scripts/guards.cjs, 22 Nov 2026, filesize ratchet).
 *
 * OWNER     cb-qa
 * OWNS      GUARDS: the declared offline test files (no DB, no network, no server), in run order; the entries live in guards-list-1..3.cjs (each under 500 lines).
 * CALLED BY scripts/guards.cjs (the one entry that reads GUARDS).
 * FLOW      guards-list-1..3.cjs ──▶ concatenated in order ──▶ GUARDS ──▶ filtered by existence in scripts/guards.cjs
 * CARD      qa/offline-guards
 */
'use strict';
const GUARDS = [].concat(require('./guards-list-1.cjs').GUARDS_PART, require('./guards-list-2.cjs').GUARDS_PART, require('./guards-list-3.cjs').GUARDS_PART);
module.exports = { GUARDS };

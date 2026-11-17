#!/usr/bin/env node
/**
 * tools/ctp-return.cjs — the CTP return path's resend (RAIL-106), run on a timer (SIT: cron, every minute). Inside the api container:
 *   docker compose exec -T api node tools/ctp-return.cjs
 *
 * Sends every queued change (a status move, an external message) that is due to the party on the other installation: the oldest of each stream first, an accepted one lets the
 * next go at once, a refused or unreachable one is tried again later (30 s, doubling to 15 min, about ten hours in all, then the row says "failed" and stops).
 * A change is also tried once, in the background, the moment it is made; this is the safety net when the far side was down.
 *
 * Prints one JSON line (tried, accepted, still, failed). Exit 0 when nothing failed for good, 1 otherwise. Prints no secret.
 * OWNS: nothing (a caller of lib/ctpreturn.js). CALLED BY: cron on a SIT VM, like tools/network-sync.cjs. CARD 05-ctp-and-cross-installation/ctp-return-path
 */
'use strict';
// FLOW  cron → ctpreturn.drain (the oldest due change of each stream → signed event → the other installation's door) → one JSON line      CARD 05-ctp-and-cross-installation/ctp-return-path
const path = require('path');
const returnPath = require(path.join(__dirname, '..', 'lib', 'ctpreturn'));

(async () => {
  try {
    const out = await returnPath.drain({ limit: 100 });
    console.log(JSON.stringify(Object.assign({ at: new Date().toISOString(), ok: out.failed === 0 }, out)));
    process.exit(out.failed === 0 ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ at: new Date().toISOString(), ok: false, why: e.message }));
    process.exit(1);
  }
})();

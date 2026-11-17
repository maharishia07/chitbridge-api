#!/usr/bin/env node
/**
 * tools/ctp-repair-senders.cjs — RAIL-107: copies that arrived over CTP before the fix name their SENDER by an id from the sender's own database, so nothing here can answer them (a status
 * move queued nothing). This finds them and repoints each to a stub of the sender on THIS installation (the same one the door now makes). Dry run unless --apply. Idempotent.
 *   docker compose exec -T api node tools/ctp-repair-senders.cjs            # what it would do
 *   docker compose exec -T api node tools/ctp-repair-senders.cjs --apply    # do it
 * Prints one JSON object (found, repaired, refused, rows). Exit 0 unless a row was refused. OWNS: nothing (a caller of lib/ctp-repair.js).
 * FLOW  every local business → its headers with ctp_arrival and no local sender → stubFor → UPDATE chit_header (as that business)      CARD 05-ctp-and-cross-installation/ctp-return-path
 */
'use strict';
const path = require('path');
const { repairSenders } = require(path.join(__dirname, '..', 'lib', 'ctp-repair'));

(async () => {
  try {
    const report = await repairSenders(null, { apply: process.argv.includes('--apply') });
    console.log(JSON.stringify(report, null, 1));
    process.exit(report.refused ? 1 : 0);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, why: e.message }));
    process.exit(1);
  }
})();

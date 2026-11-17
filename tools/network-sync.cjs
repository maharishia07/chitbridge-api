#!/usr/bin/env node
/**
 * tools/network-sync.cjs — the network's pulls, run on a timer (SIT: cron, every minute). Inside the api container:
 *   docker compose exec -T api node tools/network-sync.cjs [member | master | auto | locate <bridge_id>]
 *
 *   member   fetch this installation's certificate and the signed directory from the PINNED master (peers, revoked serials)
 *   master   read every registered member's registry_change by sequence (ids and counts only)
 *   auto     (default) whichever this installation is: a member pulls from its master, a master pulls from its members
 *   locate   ask the master where a bridge id lives and verify each hint at the far domain
 *
 * Prints one JSON line (ok, what changed, why not). Exit 0 when everything asked succeeded, 1 otherwise. Prints no secret.
 * FLOW: argv mode → lib/netmember.roleOf → lib/netsync pullMaster | pullMember | locate → one JSON line, exit 0 when ok, else 1. Tested by tests/network-tools.test.cjs.
 * OWNS: nothing (a caller of lib/netsync.js). CALLED BY: cron on a SIT VM (deploy/sit/spin.sh installs the line). CARD 28-platform-and-operations/network-control-panel
 */
'use strict';
const path = require('path');
const sync = require(path.join(__dirname, '..', 'lib', 'netsync'));
const netmember = require(path.join(__dirname, '..', 'lib', 'netmember'));

(async () => {
  const [mode, arg] = process.argv.slice(2);
  try {
    const role = (await netmember.roleOf()).role;
    const which = !mode || mode === 'auto' ? (role === 'master' ? 'master' : 'member') : mode;
    const out = which === 'master' ? await sync.pullMaster() : which === 'locate' ? await sync.locate(arg) : await sync.pullMember();
    console.log(JSON.stringify(Object.assign({ at: new Date().toISOString(), role, ran: which }, out)));
    process.exit(out.ok ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ at: new Date().toISOString(), ok: false, why: e.message }));
    process.exit(1);
  }
})();

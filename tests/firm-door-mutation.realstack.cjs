'use strict';
/**
 * tests/firm-door-mutation.realstack.cjs — break the firm door two ways and tests/firm-door.realstack.cjs MUST go red each time (ledger 14 Nov: a fixed item without a mutation-red test cannot be credited).
 *   1. the owner gate removed from the ask (firm staff and keys could ask)
 *   2. the audit write removed from the routes (no access_events row for ask, approve, decline, end)
 * A broken copy of the routes is written beside the real file, the realstack is run against it with FIRMDOOR_ROUTES, the copy is deleted.
 * CALLED BY the same box run as the realstack. Same environment (DATABASE_URL on an fd_ throwaway database, FIRMDOOR_ADMIN_URL optional).
 * CARD      04-network/connections-and-invitations
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const ROUTES = 'src/routes/network.js';
const MUTANT = 'src/routes/_mutant-network.js';

function wentRed(edit) {
  const source = fs.readFileSync(path.join(ROOT, ROUTES), 'utf8');
  const broken = edit(source);
  if (broken === source) return null;
  fs.writeFileSync(path.join(ROOT, MUTANT), broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, 'firm-door.realstack.cjs')], { env: { ...process.env, FIRMDOOR_ROUTES: MUTANT }, encoding: 'utf8' });
    return ran.status === 1 && /FAIL /.test(ran.stdout);
  } finally { fs.unlinkSync(path.join(ROOT, MUTANT)); }
}
const cases = [
  ['the owner gate removed from the ask', wentRed((src) => src.replace('  ownerAsks,\n  askLimiter,', '  askLimiter,'))],
  ['the audit write removed (every step goes unrecorded)', wentRed((src) => src.replace('await edgeAudit.recordEdgeEvent(step, edge, req.identity && req.identity.identity_id);', 'void edgeAudit;'))]
];
let bad = 0;
cases.forEach(([label, red]) => { if (red !== true) bad++; console.log((red === true ? 'ok   ' : 'FAIL ') + label + (red === null ? ' (the mutation did not apply)' : ' makes firm-door.realstack.cjs go red')); });
process.exit(bad ? 1 : 0);

'use strict';
/* PROOF WRAPPER (1118 payentry, not for the batch): truth-harness family on sit-realstack: seed the demo month on the api at API_BASE, then run the two QA-178 tests on the same cb_local */
const { spawnSync } = require('child_process');
let bad = 0;
for (const argv of [['scripts/seed-local.cjs', '--demo-month'], ['tests/mark-notices-bell.realstack.cjs'], ['tests/sold-one-rule.realstack.cjs']]) {
  const r = spawnSync('node', argv, { stdio: 'inherit', env: process.env });
  console.log('>> ' + argv.join(' ') + ' exit ' + r.status);
  if (r.status) bad++;
}
process.exit(bad ? 1 : 0);

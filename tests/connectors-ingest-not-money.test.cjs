#!/usr/bin/env node
// @type: contract
/**
 * connectors-ingest-not-money.test.cjs — POST /api/connectors/ingest is a device reading, not a money write (Athi 12 Nov 2026, DECISIONS.md).
 *
 * OWNS      the proof that docs/contracts/api-hardening-scope.json lists the route in money_reviewed_not (with its reason) and not in money_writes, so S36 idempotent_money_write does not apply to it.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: reads one JSON file and the route file.
 * FLOW      scope file → money_writes lacks the route · money_reviewed_not holds it · its reason is written · the chit it mints carries total_value 0
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/connectors-ingest-not-money.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ROUTE = 'POST /api/connectors/ingest';
const scope = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'contracts', 'api-hardening-scope.json'), 'utf8'));
let failed = 0;
const check = (label, ok) => {
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) failed++;
};
check(ROUTE + ' is in money_reviewed_not', scope.money_reviewed_not.includes(ROUTE));
check(ROUTE + ' is not in money_writes', !scope.money_writes.includes(ROUTE));
check('its reason is written (a device reading, total_value 0)', /total_value 0/.test((scope.money_reviewed_not_about || {})[ROUTE] || ''));
check('the chit the route mints carries total_value 0', /total_value:\s*0/.test(fs.readFileSync(path.join(ROOT, 'routes', 'connectors.js'), 'utf8')));
console.log('\n  ' + failed + ' failed');
process.exit(failed ? 1 : 0);

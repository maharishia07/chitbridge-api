#!/usr/bin/env node
/**
 * sec102-readiness-evidence.test.cjs — SEC-102: a clearance's evidence chit counts only when the ownership check RAN and found THIS shop's copy.
 * @type: contract
 *
 * OWNS      the unit proof of lib/readiness.js gatherDocument's evidence_ref check: an owned chit keeps the ref; no owned chit, or a check that FAILED (a database error),
 *           stores NULL, so rungOf() reads "declared", never "documented"; the check names the shop in the query (chit_id AND entity_id), not only through row security.
 * CALLED BY scripts/guards.cjs.
 * FLOW      stand-in db (require cache: ../db withEntity) → gatherDocument(...) → the parameters of the INSERT into entity_compliance → rungOf on what was stored
 * CARD      21-compliance-attestation-and-trade/functions/readiness
 *
 *   node tests/sec102-readiness-evidence.test.cjs
 */
'use strict';
const path = require('path');

const HERE = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP = '11111111-1111-4111-8111-111111111111';
const OWNED_CHIT = '22222222-2222-4222-8222-222222222222';
const FOREIGN_CHIT = '33333333-3333-4333-8333-333333333333';
const FAILING_CHIT = '44444444-4444-4444-8444-444444444444';

/* the stand-in: the ownership check finds only OWNED_CHIT for SHOP, throws for FAILING_CHIT; the INSERT is recorded */
const seen = { checks: [], inserts: [] };
const client = {
  async query(text, params) {
    if (/FROM chit_status/.test(text)) {
      seen.checks.push({ text, params });
      if (params[0] === FAILING_CHIT) throw new Error('connection reset');
      const owned = params[0] === OWNED_CHIT && params[1] === SHOP && /entity_id = \$2/.test(text);
      return { rows: owned ? [{ '?column?': 1 }] : [] };
    }
    if (/INSERT INTO entity_compliance/.test(text)) {
      seen.inserts.push(params);
      return { rows: [{}] };
    }
    return { rows: [] };
  }
};
const dbPath = require.resolve(path.join(HERE, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (_e, fn) => fn(client), query: async () => ({ rows: [] }) } };

const readiness = require(path.join(HERE, 'lib', 'readiness'));

let checks = 0;
let failed = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || detail === undefined ? '' : '\n         ' + JSON.stringify(detail)));
}

/** what gatherDocument stored as evidence_ref (the 5th INSERT parameter) */
async function storedRef(ref) {
  seen.inserts.length = 0;
  await readiness.gatherDocument(SHOP, { standard_key: 'S', doc_key: 'D', evidence_ref: ref });
  return seen.inserts[0] ? seen.inserts[0][4] : 'no insert';
}

(async () => {
  console.log('-- SEC-102: the evidence chit of a clearance --');
  check('premise: gatherDocument is exported', typeof readiness.gatherDocument === 'function');

  check('an owned chit keeps the ref (documented)', (await storedRef(OWNED_CHIT)) === OWNED_CHIT);
  check('a chit this shop does not hold stores NULL (declared)', (await storedRef(FOREIGN_CHIT)) === null);
  check('a check that FAILED stores NULL: fail closed, never "documented" on a check that did not run', (await storedRef(FAILING_CHIT)) === null);
  check('the check names the shop in the query (chit_id AND entity_id), with the shop as $2', seen.checks.every((one) => /chit_id = \$1 AND entity_id = \$2/.test(one.text) && one.params[1] === SHOP), seen.checks.map((one) => one.text));
  check('a ref that is not a chit id is kept as text and never looked up (a paper reference, declared)', (await storedRef('INV-2026-001')) === 'INV-2026-001');

  const rung = (ref) => readiness.rungOf ? readiness.rungOf({ evidence_ref: ref, verification: {} }) : null;
  if (readiness.rungOf) {
    check('rungOf: the NULL stored after a failed check reads "declared"', rung(null) === 'declared');
    check('rungOf: an owned chit reads "documented"', rung(OWNED_CHIT) === 'documented');
  }

  console.log('\n  ' + checks + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('  test crashed:', e);
  process.exit(1);
});

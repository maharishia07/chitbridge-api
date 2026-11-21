'use strict';
/**
 * supplier-added-retry-1128.test.cjs — WALK J J-F-07: adding the supplier a waiting bill names posts that bill at once (it stayed parked until the manual retry or the nightly sweep).
 * Offline: afterSupplierAdded never rejects whatever the books say (no database here = the failure path), and BOTH doors of POST /suppliers call it after the list row is committed.
 * The posting itself is retryOutbox's (unchanged); the live proof is the SIT walk J-F-07 step: add the supplier, GET /books/outbox shows the bill posted without POST /outbox/retry.
 */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const H = require('../lib/books-hooks');
let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
(async () => {
  await it('afterSupplierAdded resolves (never rejects) when the books cannot be read', async () => {
    const out = await H.afterSupplierAdded('00000000-0000-4000-8000-000000000000');
    assert.ok(out && (out.failed || out.off || out.tried !== undefined), JSON.stringify(out));
  });
  await it('both doors of POST /suppliers (a name, a ChitBridge business) call it after the list row is written', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'routes', 'relationships.js'), 'utf8');
    assert.strictEqual((text.match(/afterSupplierAdded\(owner\)/g) || []).length, 2);
  });
  console.log(pass + ' checks');
  process.exit(process.exitCode || 0);
})();

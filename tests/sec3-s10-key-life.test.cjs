#!/usr/bin/env node
// @type: unit
/**
 * sec3-s10-key-life.test.cjs — S10 (VERIFY-EL-SECURITY): an API key could be minted for 10 years.
 * ATTACK    an owner session (or a script holding one) mints a 3650-day key that outlives every rotation, and sits unnoticed on a shop PC.
 * RULE      the longest life is 365 days (the default); an owner who asks for fewer days gets exactly that; a request for more is cut to 365.
 * RUN       node tests/sec3-s10-key-life.test.cjs        STANDARD  OWASP ASVS 4.0.3 V3.5 / V2.10 (service credentials rotate) · NIST 800-53 IA-5
 * CARD      23-connectors-and-integrations
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sec3-s10';
process.env.NODE_ENV = 'test';
const say = process.stdout.write.bind(process.stdout);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const PP = require('./support/policy-patch.cjs');
const flags = {};
const q = async (sql, params) => {
  const s = String(sql);
  if (PP.isPatch(s)) return PP.apply(s, params, flags);
  if (/SELECT policy_flags FROM identities/.test(s)) return { rows: [{ policy_flags: flags }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(__dirname, '..', 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (i, f) => f({ query: q }), withTransaction: async (f) => f({ query: q }) } };
const keys = require('../lib/api-keys');
let bad = 0;
const t = (n, ok, x) => { say((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + (x || '')) + '\n'); if (!ok) bad++; };
const E = '55555555-5555-4555-8555-555555555555';
const days = (k) => Math.round((Date.parse(k.expires_at) - Date.now()) / 86400e3);
(async () => {
  t('3650 days asked → 365', days(await keys.mint(E, null, { name: 'a', scopes: ['offers'], days: 3650 })) === 365);
  t('no days asked → 365 (unchanged)', days(await keys.mint(E, null, { name: 'b', scopes: ['offers'] })) === 365);
  t('the owner asks for 30 → 30 (less is honoured)', days(await keys.mint(E, null, { name: 'c', scopes: ['offers'], days: 30 })) === 30);
  process.exit(bad ? 1 : 0);
})();

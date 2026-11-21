#!/usr/bin/env node
'use strict';
/**
 * walkk-readiness-home-country.test.cjs — WALK K K-F-06 (21 Nov 2026): an AU shop's own readiness lists the standards of ITS country, never the UAE's.
 *   Before: with no boilerplate the roll-up read EVERY active standard (and the floor read every one again), so ae-export-declaration (origin AE) showed for an Australian shop.
 *   Now: the home rule of a standard (applicability.origin: empty or 'any' = everyone, else the shop's country must be listed) narrows both reads, through the ONE reader readiness.homeRuleHolds.
 *   Hand fixture: iso-9001 (any), au-export-declaration (AU), ae-export-declaration (AE), exim-policy (IN). AU shop → 2 standards [au, iso]; AE shop → [ae, iso]; a shop that stated no country → all 4, as before.
 * Run: node tests/walkk-readiness-home-country.test.cjs · no DB, no network.
 */
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n      ' + String(info).slice(0, 300) : '')); } };
const STANDARDS = [
  { standard_key: 'iso-9001', applicability: {} },
  { standard_key: 'au-export-declaration', applicability: { origin: ['AU'], cross_border: true } },
  { standard_key: 'ae-export-declaration', applicability: { origin: ['AE'], cross_border: true } },
  { standard_key: 'exim-policy', applicability: { origin: ['IN'], cross_border: true } }
];
const DOCS = STANDARDS.map((s, i) => ({ standard_key: s.standard_key, doc_key: 'd' + i, title: s.standard_key, scope: 'entity', frequency: 'once', display_order: 1 }));
let ID = null, GOV = null;
function answer(sql, params) {
  const t = String(sql);
  if (/information_schema/.test(t)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
  if (/country-setup \*\/ country, currency_code/.test(t)) return { rows: ID ? [ID] : [], rowCount: ID ? 1 : 0 };
  if (/FROM entity_governance/.test(t)) return { rows: GOV ? [GOV] : [], rowCount: GOV ? 1 : 0 };
  if (/FROM standard_source/.test(t)) return { rows: STANDARDS, rowCount: STANDARDS.length };
  if (/FROM standard_document/.test(t)) { const k = params[0] || []; const r = DOCS.filter((d) => k.indexOf(d.standard_key) >= 0); return { rows: r, rowCount: r.length }; }
  return { rows: [], rowCount: 0 };
}
const H = { query: async (sql, params) => answer(sql, params || []) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => answer(sql, params || []), withEntity: async (e, fn) => fn(H), onEntity: async (e, fn) => fn(H), withTransaction: async (fn) => fn(H),
  readBatch: async (e, x, qs) => qs.map((q) => answer(q.text, q.params)), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } }
} };
const R = require(path.join(API, 'lib', 'readiness'));
const CS = require(path.join(API, 'lib', 'country-setup'));
const SHOP = '11111111-1111-4111-8111-111111111111';
const keysOf = async (country) => {
  ID = country ? { country, currency_code: country === 'AU' ? 'AUD' : 'AED', gstn: null, timezone: null, policy_flags: {} } : null;
  GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: new Date() }; CS._reset();
  const out = await R.resolveReadiness(SHOP);
  return (out.standards || []).slice().sort();
};
(async () => {
  console.log('\nWALK K K-F-06: readiness lists the shop\'s own country\n');
  ok('the home rule is exported as the one reader', typeof R.homeRuleHolds === 'function');
  ok('homeRuleHolds: empty and any hold for everyone; a listed country holds only for itself; unstated is not narrowed',
    R.homeRuleHolds({ applicability: {} }, 'AU') && R.homeRuleHolds({ applicability: { origin: ['any'] } }, 'AU') && R.homeRuleHolds({ applicability: { origin: ['AE'] } }, 'AE') && !R.homeRuleHolds({ applicability: { origin: ['AE'] } }, 'AU') && R.homeRuleHolds({ applicability: { origin: ['AE'] } }, null));
  const au = await keysOf('AU');
  ok('an AU shop reads 2 standards: au-export-declaration and iso-9001', JSON.stringify(au) === JSON.stringify(['au-export-declaration', 'iso-9001']), JSON.stringify(au));
  ok('...and no ae-export-declaration', au.indexOf('ae-export-declaration') < 0);
  const ae = await keysOf('AE');
  ok('an AE shop reads 2 standards: ae-export-declaration and iso-9001', JSON.stringify(ae) === JSON.stringify(['ae-export-declaration', 'iso-9001']), JSON.stringify(ae));
  const none = await keysOf(null);
  ok('a shop that stated no country reads all 4, as before', none.length === 4, JSON.stringify(none));
  console.log('\n' + pass + ' ok, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack || e)); process.exit(1); });

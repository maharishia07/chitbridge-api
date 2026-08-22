'use strict';
/** @covers FR-K5 — the CURRENCY leg only — denomination comes from the governance layer, not a literal */
/**
 * governed-currency.test.js — the network/B2B order path must denominate from the GOVERNANCE LAYER, never a literal.
 *
 * The bug: `deliverEdge` minted every chit with a hard-coded 'INR' (summary_json, header, subject '₹', response), so
 * a cross-border supplier order was stamped INR whatever either party had configured. The storefront path was already
 * correct, so the two disagreed. These tests pin the resolver's precedence AND assert the literals are gone, because
 * a unit test of the resolver alone would still pass with the route ignoring it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};
const ta = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

/** Load lib/regional.js with a stubbed ../db so no database is needed. */
function loadRegional(rows) {
  const dbPath = require.resolve('../db');
  const regPath = require.resolve('../lib/regional');
  const contPath = require.resolve('../lib/container');
  const prevDb = require.cache[dbPath], prevReg = require.cache[regPath];
  const calls = [];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async (sql, params) => { calls.push({ sql, params }); return rows(sql, params); },
    withEntity: async () => ({ rows: [] }), withTransaction: async () => ({ rows: [] }),
  } };
  if (!require.cache[contPath]) { try { require('../lib/container'); } catch (_) { /* not needed */ } }
  delete require.cache[regPath];
  const regional = require('../lib/regional');
  delete require.cache[regPath];
  if (prevDb) require.cache[dbPath] = prevDb; else delete require.cache[dbPath];
  if (prevReg) require.cache[regPath] = prevReg;
  return { regional, calls };
}

(async () => {
console.log('\ngoverned-currency');

// ── the resolver's precedence ───────────────────────────────────────────────────────────────────────────────
await ta('1. the entity\'s own currency_code wins', async () => {
  const { regional } = loadRegional((sql) => /FROM identities/.test(sql) ? { rows: [{ currency_code: 'AED', country: 'AE' }] } : { rows: [] });
  assert.strictEqual(await regional.currencyFor('e1'), 'AED');
});

await ta('2. falls back to the REGIONAL LAYER when the entity has none', async () => {
  const { regional } = loadRegional((sql) =>
    /FROM identities/.test(sql)  ? { rows: [{ currency_code: null, country: 'AE' }] } :
    /FROM region_layer/.test(sql) ? { rows: [{ region_code: 'AE', currency: 'AED' }] } : { rows: [] });
  assert.strictEqual(await regional.currencyFor('e1'), 'AED');
});

await ta('3. falls back to the NAMED constant only when both are absent', async () => {
  const { regional } = loadRegional(() => ({ rows: [] }));
  assert.strictEqual(await regional.currencyFor('e1'), regional.FALLBACK_CURRENCY);
});

await ta('4. an unknown entity never reaches the database', async () => {
  const { regional, calls } = loadRegional(() => ({ rows: [] }));
  assert.strictEqual(await regional.currencyFor(null), regional.FALLBACK_CURRENCY);
  assert.strictEqual(calls.length, 0, `expected no queries, got ${calls.length}`);
});

await ta('5. a thrown query degrades to the fallback rather than breaking a mint', async () => {
  const { regional } = loadRegional(() => { throw new Error('relation "identities" does not exist'); });
  assert.strictEqual(await regional.currencyFor('e1'), regional.FALLBACK_CURRENCY);
});

await ta('6. the code is normalised — trimmed and upper-cased', async () => {
  const { regional } = loadRegional((sql) => /FROM identities/.test(sql) ? { rows: [{ currency_code: ' aed ', country: null }] } : { rows: [] });
  assert.strictEqual(await regional.currencyFor('e1'), 'AED');
});

await ta('7. it NEVER converts — no FX symbol anywhere in the resolver', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'regional.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function currencyFor'), src.indexOf('module.exports'));
  assert.ok(!/\*\s*rate|convert|fx|exchange/i.test(fn), 'currencyFor must label, never convert');
});

// ── the route actually uses it (a resolver nobody calls fixes nothing) ──────────────────────────────────────
const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'catalogue.js'), 'utf8');

t('8. no hard-coded \'INR\' remains on the network path', () => {
  const edge = route.slice(route.indexOf('async function deliverEdge'), route.indexOf('router.post(\'/network-store'));
  assert.ok(!/'INR'/.test(edge), 'deliverEdge still contains a literal \'INR\'');
});

t('9. the ₹ symbol appears in no minted STRING (prose about it is fine)', () => {
  // Checking the raw file would fail on the comment explaining the fix, so judge each occurrence by position:
  // a ₹ that sits after a `//` on its line is commentary; anywhere else it is a literal that would ship.
  const offenders = route.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes('₹'))
    .filter(({ line }) => { const c = line.indexOf('//'); return c === -1 || line.indexOf('₹') < c; });
  assert.strictEqual(offenders.length, 0,
    `a currency SYMBOL is unrenderable for other currencies — mint the CODE. Line(s): ${offenders.map((o) => o.n).join(', ')}`);
});

t('10. deliverEdge accepts a currency and both call sites pass one', () => {
  assert.ok(/async function deliverEdge\(\{[^}]*currency[^}]*\}\)/.test(route), 'deliverEdge does not take a currency');
  // Brace-balanced extraction — the call bodies contain nested objects, so a regex cannot find their ends.
  const sites = [];
  let from = 0, at;
  while ((at = route.indexOf('await deliverEdge({', from)) !== -1 ? route.indexOf('await deliverEdge({', from) : -1, at !== -1) {
    let depth = 0, i = route.indexOf('{', at);
    const start = i;
    for (; i < route.length; i++) {
      if (route[i] === '{') depth++;
      else if (route[i] === '}') { depth--; if (depth === 0) break; }
    }
    sites.push(route.slice(start, i + 1));
    from = i + 1;
  }
  assert.strictEqual(sites.length, 2, `expected 2 call sites, found ${sites.length}`);
  sites.forEach((s, i) => assert.ok(/\bcurrency\b/.test(s), `call site ${i + 1} does not pass a currency`));
});

t('11. the order and its fragments resolve the currency ONCE', () => {
  const block = route.slice(route.indexOf('router.post(\'/network-store'));
  const resolves = block.match(/regional\.currencyFor\(/g) || [];
  assert.strictEqual(resolves.length, 1, `resolved ${resolves.length} times — the order and fragments must not drift`);
});

t('12. the storefront currency is governed AND conditional on the pipeline', () => {
  // Previously asserted the bare `currency_code: entity.currency_code || 'INR'`. That was correct as far as it went,
  // but it stamped a currency on help-desk and form chits too. A chit with no currency now MEANS something — it is
  // not about money — so the storefront must withhold one rather than default it.
  assert.match(route, /currency_code: monetary \? \(entity\.currency_code \|\| 'INR'\) : null/,
    'a non-monetary chit must carry NO currency, and a monetary one must take the entity\'s');
});

t('13. the three states are distinguishable on a chit', () => {
  // currency + value → agreed · currency + null → offer · no currency → activity.
  assert.match(route, /const monetary = oi\.pipeline === 'commerce'/, 'monetary is DERIVED from the pipeline, not a new flag to keep in sync');
  assert.ok(!/currency_code: entity\.currency_code \|\| 'INR',/.test(route), 'the unconditional stamp must be gone');
});

t('14. deliverEdge no longer claims every network order is worth zero', () => {
  const edge = route.slice(route.indexOf('async function deliverEdge'), route.indexOf("router.post('/network-store"));
  assert.ok(!/total_value: 0/.test(edge), 'a hard-coded 0 is a claim, and it was false on every network order');
  assert.match(edge, /total_value: value/, 'both the summary and the header must carry the resolved value');
});

t('15. a fragment carries ITS OWN subtotal, not the order total', () => {
  const block = route.slice(route.indexOf("router.post('/network-store"));
  assert.match(block, /total_value: money\.round2\(sitems\.reduce/,
    'stamping the order total on each fragment multiplies the network\'s apparent value by the store count');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
})();

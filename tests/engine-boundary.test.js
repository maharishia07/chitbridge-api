'use strict';
/**
 * engine-boundary.test.js — the ENGINE CORE is a rule, not a habit.
 *
 * Athi, 2026-08-04: *"we are slowly transforming from engine to adoption layers… we need to have the engine core
 * protected. Do we have a clear mechanism of separation so we don't need to worry about it?"*
 *
 * The worry was well-placed but the diagnosis needed one correction. The engine is not dissolving — three of its
 * modules are already perfectly clean. The problem is that they are clean **by good practice, not by rule**: nothing
 * stopped the next commit from adding `require('../db')` to `order-input.js` and quietly ending its portability,
 * with no test failing and nobody noticing for months.
 *
 * This file is that missing rule. It is deliberately blunt and deliberately hard to satisfy accidentally.
 *
 * ── THE THREE TIERS ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   TIER A · PURE       zero dependencies. Liftable as FILES into any Node project, today, with no untangling.
 *                       This is the part every adoption layer touches — Beckn and Medusa both map INTO it — so it
 *                       is also the part that must never acquire a dependency.
 *
 *   TIER B · BOUND      CB's logic, but needs a database handle. Portable with an adapter, not as a file.
 *
 *   TIER C · SUBSTRATE  Postgres artifacts: chit_deliver + the RLS policies. NOT portable, and that is fine —
 *                       it is also the hardest part for anyone else to copy. What it needs is not portability but
 *                       an assertion that the guarantee is uniformly applied.
 *
 * DIRECTION OF DEPENDENCY IS THE WHOLE RULE: adoption may import engine. Engine may NEVER import adoption.
 * The day that reverses, the engine has stopped being a thing you can point at — which is the actual risk, rather
 * than the imagined one of CB "disappearing" into the layers it adopts.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(API, p), 'utf8');
const requiresIn = (src) => [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

/** TIER A — must stay at ZERO dependencies, forever. Adding one is a breaking change to CB's identity. */
const TIER_A = [
  'lib/order-input.js',      // the declaration: 7 presets, schema fragment, documents, sources
  'lib/form-handshake.js',   // document → field, with provenance; coverage() at design time
  'lib/money.js',            // { amount, currency }; never converts
];

/** TIER B — CB logic, allowed a database handle and other ENGINE modules. Nothing else. */
const TIER_B = [
  'lib/regional.js',         // governed currency: entity → region → named fallback
  'lib/reporting.js',        // the network reporting LENS; structurally un-mintable output
];

/** Everything an engine module is permitted to reach for. Deliberately tiny. */
const ALLOWED_FOR_ENGINE = new Set(['../db', './money', './regional', './container', 'crypto']);

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

console.log('\nengine-boundary');

// ── TIER A · purity ─────────────────────────────────────────────────────────────────────────────────────────
for (const f of TIER_A) {
  t(`TIER A · ${path.basename(f)} has ZERO dependencies`, () => {
    const deps = requiresIn(read(f));
    assert.deepStrictEqual(deps, [],
      `${f} acquired ${JSON.stringify(deps)}. This is not a lint failure — it is a change to what CB can hand ` +
      `someone. If the dependency is genuinely necessary, move the file to TIER B and say so out loud.`);
  });
}

t('TIER A is liftable: every file exists and parses standalone', () => {
  for (const f of TIER_A) {
    const m = require(path.join(API, f));
    assert.ok(m && Object.keys(m).length > 0, `${f} exports nothing`);
  }
});

// ── TIER B · bounded ────────────────────────────────────────────────────────────────────────────────────────
for (const f of TIER_B) {
  t(`TIER B · ${path.basename(f)} reaches only for what engine may reach for`, () => {
    const bad = requiresIn(read(f)).filter((d) => !ALLOWED_FOR_ENGINE.has(d));
    assert.deepStrictEqual(bad, [], `${f} imports ${JSON.stringify(bad)} — outside the engine's allowance`);
  });
}

// ── THE DIRECTION RULE ──────────────────────────────────────────────────────────────────────────────────────
t('no engine module imports a ROUTE — adoption may import engine, never the reverse', () => {
  for (const f of [...TIER_A, ...TIER_B]) {
    const routeward = requiresIn(read(f)).filter((d) => /routes?\//.test(d));
    assert.deepStrictEqual(routeward, [],
      `${f} imports ${JSON.stringify(routeward)}. Routes are ADOPTION — storefront, catalogue, Beckn. The moment ` +
      `engine depends on them, the engine can no longer be lifted out or pointed at.`);
  }
});

t('no engine module imports an adoption-layer library', () => {
  // Named explicitly rather than pattern-matched, so adding a new adoption lib is a deliberate act.
  const ADOPTION = ['catalogue-build', 'catalogue-view', 'capture', 'erp-handoff', 'connector', 'assist-kb', 'ai'];
  // Match the module BASENAME, never a substring. The first cut used `d.includes(a)` and reported `./container`
  // as adoption code — because "cont-AI-ner" contains "ai". A false finding from a sloppy check is worse than no
  // check: it trains you to ignore the output.
  const base = (d) => d.replace(/^.*\//, '').replace(/\.js$/, '');
  for (const f of [...TIER_A, ...TIER_B]) {
    const bad = requiresIn(read(f)).filter((d) => ADOPTION.includes(base(d)));
    assert.deepStrictEqual(bad, [], `${f} imports adoption code ${JSON.stringify(bad)}`);
  }
});

// ── TIER C · the substrate guarantee is UNIFORM ─────────────────────────────────────────────────────────────
// Not portable, and not trying to be. What matters is that the isolation guarantee has no gaps — a table with
// ENABLE but not FORCE still lets the TABLE OWNER read every row, so the two must always come as a pair.
function rlsTables() {
  const dirs = [path.join(API, 'migrations'), path.join(API, 'db')];
  const enabled = new Set(), forced = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of sql.matchAll(/ALTER\s+TABLE\s+([a-z_]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) enabled.add(m[1].toLowerCase());
      for (const m of sql.matchAll(/ALTER\s+TABLE\s+([a-z_]+)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi))  forced.add(m[1].toLowerCase());
    }
  }
  return { enabled, forced };
}

t('TIER C · every RLS table is both ENABLED and FORCED — no half-protected table', () => {
  const { enabled, forced } = rlsTables();
  assert.ok(enabled.size >= 24, `expected at least 24 RLS tables, found ${enabled.size}`);
  const halfDone = [...enabled].filter((x) => !forced.has(x));
  assert.deepStrictEqual(halfDone, [],
    `ENABLE without FORCE means the TABLE OWNER still reads every row. Half-protected: ${halfDone.join(', ')}`);
});

t('TIER C · nothing is FORCED without being ENABLED', () => {
  const { enabled, forced } = rlsTables();
  const orphan = [...forced].filter((x) => !enabled.has(x));
  assert.deepStrictEqual(orphan, [], `FORCE without ENABLE does nothing: ${orphan.join(', ')}`);
});

t('TIER C · the per-copy delivery function is where the manifest says it is', () => {
  const p = path.join(API, 'migrations', 'migration_b50_rls_delivery_functions.sql');
  assert.ok(fs.existsSync(p), 'chit_deliver migration is missing — per-copy settlement has no definition');
  assert.match(fs.readFileSync(p, 'utf8'), /FUNCTION\s+chit_deliver/i);
});

// ── the manifest must not go stale ──────────────────────────────────────────────────────────────────────────
t('every TIER A and TIER B file named here still exists', () => {
  for (const f of [...TIER_A, ...TIER_B]) assert.ok(fs.existsSync(path.join(API, f)), `${f} is named in the manifest but gone`);
});

t('the resume document exists and names this test', () => {
  // If the doc and the test drift apart, the doc becomes a story rather than a record.
  const doc = path.join(API, '..', 'ENGINE-CORE.md');
  if (!fs.existsSync(doc)) { console.log('        (ENGINE-CORE.md not found beside the repo — skipped, not failed)'); return; }
  assert.match(fs.readFileSync(doc, 'utf8'), /engine-boundary\.test\.js/,
    'ENGINE-CORE.md must point at the test that enforces it');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

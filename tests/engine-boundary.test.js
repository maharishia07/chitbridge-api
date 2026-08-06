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

/**
 * EVERY lib/ file must be classified. This was the first version's real hole: it named 6 files and said NOTHING
 * about the other 30 — so `lib/forms.js`, which carries a seal hash, sat outside the manifest entirely. A boundary
 * that only covers what you remembered to list is not a boundary.
 *
 * PENDING is deliberate and allowed: an honest "not yet decided" is worth more than a confident wrong taxonomy.
 * The test PRINTS the pending count every run, so it is visible debt rather than silence.
 */
const ADOPTION_LIBS = [   // could be someone else's — see ENGINE-CORE.md "What is NOT engine"
  'ai.js', 'assist-kb.js', 'capture.js', 'catalogue-build.js', 'catalogue-view.js', 'compliance.js',
  'conformance.js', 'instruments.js', 'kyb.js', 'readiness.js', 'reference.js', 'verify.js', 'profile.js',
  'boilerplate.js', 'plans.js', 'forms.js',
  // Beckn is a WIRE PROTOCOL — adoption by definition. Classified BEFORE it was written, so the guard existed
  // before the thing it guards. The engine may never import it; vocabulary drift is how a distinct thing becomes
  // a client of someone else's model.
  'beckn-map.js',
  // ADOPTION, not engine: "what a gold catalogue records" is the bullion trade's convention, not CB's idea. A
  // vertical could be added, replaced or wholly deleted and nothing about what ChitBridge IS would change. The
  // ENGINE part of the same question — that a field says WHERE its value comes from (the four legs), and that a
  // `customer` field is not a product column — is a rule, and it lives in csv-preflight/the schema, not here.
  'starter-fields.js',
];
const INFRA_LIBS = [      // plumbing: neither identity nor adoption. Replaceable without changing what CB is.
  'logger.js', 'notify.js', 'respond.js', 'storage.js', 'schema-bootstrap.js', 'otp.js', 'dev-otp.js',
  'vaultcrypto.js', 'retention.js',
];
const ENGINE_OTHER = [    // CB identity, beyond the tiers above. Classified, not yet tier-graded.
  'csv.js',               // catalogue CSV round-trip — zero-dependency, a STANDARD (RFC 4180) we implement
  'visibility-cap.js',    // ENGINE: the CAP/CHOICE split — what an operator permits vs what an entity picks. Who
                          // may expose a catalogue to the world is governance, not a storefront preference.
  'catalogue-read.js',    // ENGINE: it decides WHO MAY CHANGE WHAT — owned is editable, referenced is not, per
                          // FIELD. That is the ownership rule the per-copy model rests on, not a display concern.
                          // (catalogue-view.js is adoption: it shapes a payload. This decides authority.)
  'identity.js',          // ENGINE: "which line is this, and which product does it belong to" is the question the
                          // per-copy record is keyed on. A partial identity being NO identity, and a variant being a
                          // line rather than a child row, are CB rules — not a trade's convention.
  'csv-preflight.js',     // ENGINE, not adoption: it decides what a file may NOT set (mode, currency, ids). The
                          // synonym table is throwaway; the refusal is CB's. Zero-dependency, proposes never decides.
  'gs1.js',               // GS1 keys — zero-dependency, but a STANDARD we implement rather than our own idea
  'trace.js',             // the doubly-linked, co-held, FROZEN handoff edge — settlement's sibling
  'container.js',         // the container model: blueprint + version
  'source.js',            // source-entity: a sealed entity that governs downstream
  'workpattern.js',       // the resolution seam — resolve-before-act
  'govresolve.js',        // governance resolution
];
/** Not yet classified. Keep this SMALL and shrinking. Empty is the goal, not the requirement. */
const PENDING_LIBS = [];

/**
 * Engine modules that are BUILT AND TESTED but not yet called by any route.
 *
 * Naming them is the point. A tested module that nothing calls looks like shipped capability in a status report and
 * is not — that is exactly the drift that let BACKLOG-review-2026-07-29.md claim "nothing is fixed" for a week after
 * everything was fixed. The test below asserts this list is ACCURATE in both directions, so it cannot quietly rot.
 */
const UNWIRED = [
  'lib/reporting.js',
  // ⚠ FOUND BY THIS TEST, 2026-08-04, and it corrected a claim already written down.
  //
  // form-handshake.js is required by `scripts/` and by its own test — and by NO ROUTE. The engine that maps a
  // document onto a form is therefore NOT in the serving path. What IS live is `orderInput.validateDocuments()`
  // (magic bytes, caps, sha256, sealed onto the chit) and the extraction logic in `chitbridge-web/public/shop.html`
  // (`_VALUE_RE`, `_readDocument`, `_applyRead`), which RE-IMPLEMENTS the label-anchored read client-side.
  //
  // Two consequences, both real:
  //   1. `coverage()` — "fills 12 of 17 before any file is opened" — is NOT shipped. No route calls it and no UI
  //      surfaces it. The reviewer update claimed a catalogue owner sees this while building. They do not.
  //   2. There are TWO extraction implementations and nothing asserts they agree. The tested one (17 assertions)
  //      is the one nobody calls; the untested one is the one that runs in production.
  //
  // Do not remove this entry by wiring a route without also making the two implementations verifiably agree.
  'lib/form-handshake.js',
];

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

// ── COVERAGE · nothing may be silently unclassified ─────────────────────────────────────────────────────────
t('every lib/ file is classified — engine, adoption, infra, or explicitly pending', () => {
  const all = fs.readdirSync(path.join(API, 'lib')).filter((f) => f.endsWith('.js'));
  const known = new Set([
    ...TIER_A.map((f) => path.basename(f)), ...TIER_B.map((f) => path.basename(f)),
    ...ENGINE_OTHER, ...ADOPTION_LIBS, ...INFRA_LIBS, ...PENDING_LIBS,
  ]);
  const unclassified = all.filter((f) => !known.has(f));
  assert.deepStrictEqual(unclassified, [],
    `${unclassified.length} lib file(s) belong to no bucket: ${unclassified.join(', ')}. A new module must be ` +
    `declared engine or not-engine when it is written — deciding later means never deciding. Add it to a list ` +
    `above, or to PENDING_LIBS if it genuinely needs thought.`);
  if (PENDING_LIBS.length) console.log(`        ⚠ ${PENDING_LIBS.length} pending classification: ${PENDING_LIBS.join(', ')}`);
});

t('no file is claimed by two buckets', () => {
  const lists = { TIER_A: TIER_A.map((f) => path.basename(f)), TIER_B: TIER_B.map((f) => path.basename(f)),
    ENGINE_OTHER, ADOPTION_LIBS, INFRA_LIBS, PENDING_LIBS };
  const seen = new Map();
  for (const [name, list] of Object.entries(lists)) {
    for (const f of list) {
      if (seen.has(f)) assert.fail(`${f} is in both ${seen.get(f)} and ${name} — a file has one classification`);
      seen.set(f, name);
    }
  }
});

// ── STAGE · uncalled is a STAGE, not a defect — but it must be DECLARED ─────────────────────────────────────
//
// Athi, 2026-08-04: *"we are consistently doing experiments and that is how the engine is built — experiment, poc,
// then a test, then finally implement. If it is not called from the app it is not a crime, but we can have a list to
// know what those experiments are."*
//
// Exactly right, and it corrects how the first version of this file framed things: it treated "uncalled" as
// suspicious. It is not. What is suspicious is uncalled AND undeclared, because that is indistinguishable on a
// status report from shipped capability.
//
// So `live` is DERIVED — if a route requires it, it is live and needs no tag, which keeps 30 files free of churn.
// Anything a route does NOT reach must carry `@stage` in its header. A new uncalled module fails until someone says
// what it is. That is the whole mechanism.
const STAGES = ['experiment', 'poc', 'proven', 'tested', 'held'];

function libStages() {
  const libDir = path.join(API, 'lib');
  const routeSrc = fs.readdirSync(path.join(API, 'routes')).filter((f) => f.endsWith('.js'))
    .map((f) => read(path.join('routes', f))).join('\n');
  const files = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'));
  const srcs = Object.fromEntries(files.map((f) => [f, read(path.join('lib', f))]));
  const reqRe = (n) => new RegExp(`require\\(\\s*['"][^'"]*${n}['"]\\s*\\)`);

  return files.map((f) => {
    const name = f.replace(/\.js$/, '');
    const re = reqRe(name);
    const viaRoute = re.test(routeSrc);
    const viaLib = Object.entries(srcs).some(([g, s]) => g !== f && re.test(s));
    const tag = (srcs[f].match(/@stage\s+([a-z-]+)/) || [])[1] || null;
    return { file: f, reachable: viaRoute || viaLib, viaRoute, tag };
  });
}

t('anything a route cannot reach declares an @stage', () => {
  const undeclared = libStages().filter((m) => !m.reachable && !m.tag).map((m) => m.file);
  assert.deepStrictEqual(undeclared, [],
    `${undeclared.join(', ')} is called by nothing and declares no @stage. Add one of ${STAGES.join(' | ')} to the ` +
    `file header. Being uncalled is fine; being uncalled and unlabelled is not — that is how an experiment gets ` +
    `mistaken for a shipped feature.`);
});

t('every @stage is one of the known stages', () => {
  const bad = libStages().filter((m) => m.tag && !STAGES.includes(m.tag)).map((m) => `${m.file}:${m.tag}`);
  assert.deepStrictEqual(bad, [], `unknown stage(s): ${bad.join(', ')}. Known: ${STAGES.join(' | ')}`);
});

t('THE ROSTER — printed every run, so the list is never out of date', () => {
  const staged = libStages().filter((m) => m.tag).sort((a, b) => STAGES.indexOf(a.tag) - STAGES.indexOf(b.tag));
  const live = libStages().filter((m) => m.viaRoute).length;
  console.log(`        live (reachable from a route): ${live}`);
  for (const m of staged) {
    console.log(`        ${m.tag.padEnd(10)} ${m.file}${m.reachable ? '  (reached via another lib)' : ''}`);
  }
  assert.ok(live > 0, 'no module is reachable from a route — something is very wrong');
});

// ── HONESTY · "built and tested" is not "in service" ────────────────────────────────────────────────────────
t('the UNWIRED list is accurate — nothing claims to be in service that is not', () => {
  const searchIn = ['lib', 'routes'].flatMap((d) => {
    const p = path.join(API, d);
    return fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)) : [];
  });
  for (const mod of UNWIRED) {
    const name = path.basename(mod, '.js');
    const callers = searchIn.filter((f) => f !== mod && new RegExp(`require\\([^)]*${name}['"]`).test(read(f)));
    assert.deepStrictEqual(callers, [],
      `${mod} is listed UNWIRED but ${callers.join(', ')} now requires it. Good — remove it from UNWIRED.`);
  }
});

t('nothing is quietly unwired without being declared', () => {
  const routeFiles = fs.existsSync(path.join(API, 'routes'))
    ? fs.readdirSync(path.join(API, 'routes')).filter((f) => f.endsWith('.js')).map((f) => path.join('routes', f)) : [];
  const libFiles = fs.readdirSync(path.join(API, 'lib')).filter((f) => f.endsWith('.js')).map((f) => path.join('lib', f));
  const corpus = [...routeFiles, ...libFiles].map((f) => ({ f, src: read(f) }));
  const engineFiles = [...TIER_A, ...TIER_B];
  const orphans = engineFiles.filter((mod) => {
    const name = path.basename(mod, '.js');
    return !corpus.some((c) => c.f !== mod && new RegExp(`require\\([^)]*${name}['"]`).test(c.src));
  });
  const undeclared = orphans.filter((o) => !UNWIRED.includes(o));
  assert.deepStrictEqual(undeclared, [],
    `${undeclared.join(', ')} is called by nothing and is not declared UNWIRED. Either wire it or say so — a ` +
    `tested module nobody calls reads as shipped capability and is not.`);
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

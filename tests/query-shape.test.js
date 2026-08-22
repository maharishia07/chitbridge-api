'use strict';
/**
 * query-shape.test.js — the SHAPE of a query is not a performance detail, it is a rule.
 *
 * Athi, 2026-08-08: *"this can be improved if we provide the right size server and index etc — I am not worried
 * about the speed now, but it has to be checked for every query, like resolution O(1) and are we using the right
 * index."*
 *
 * That distinction is the whole point of this file. A bigger server fixes CONSTANT cost. It cannot fix SHAPE:
 *
 *     await inside a loop  →  N round trips  →  still N round trips on a faster machine, just each one quicker
 *
 * Every latency problem found in this codebase has been shape, not speed. The availability search ran three
 * sequential queries per store and felt slow with ONE PRODUCT in each — there was no data to be slow about. The
 * import loop called validateItem() per row and fired 2000 identical reads for a rule set that cannot change
 * mid-import. Neither would have been helped by a bigger instance.
 *
 * ── A RATCHET, NOT A BAN ─────────────────────────────────────────────────────────────────────────────────────
 * Some per-item queries are legitimate: fanning a chit out to its recipients is a write per recipient, and RLS
 * genuinely forces one read per entity because each tenant's rows sit behind their own policy. So this does not
 * forbid them. It COUNTS them per file and fails when a count goes UP.
 *
 * That makes the rule cheap to live with and hard to erode: existing debt is recorded, and the next N+1 someone
 * adds has to be argued for by editing this list, in a diff, where it can be seen.
 *
 * Lower a number whenever you remove one. Never raise one without writing why.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');

/**
 * Known per-item queries, by file. Each is a deliberate cost someone has looked at.
 *
 * routes/chits.js        the send fan-out and its per-participant reads — a chit genuinely touches each party
 * routes/products.js     the CSV import path — per-row writes; the RULES are already read once (schemaFieldsOf)
 * routes/network-design.js  per-store reads behind per-tenant RLS, now bounded to 4 in flight (mapLimit)
 * routes/governance.js   one read per cascade level
 * lib/storage.js         per-file operations
 * src/services/*         the dormant cb_* model
 */
const BUDGET = {
  /**
   * ⚠️⚠️ THESE FIVE WERE RED FOR A WEEK AND NOBODY SAW IT. This test landed 2026-08-08; all five files were
   * changed between the 12th and the 15th, each adding one query inside a loop, and every one of those commits
   * would have failed it. Found on 2026-08-22 only because `C:\dev\suite.cjs` ran everything for the first time.
   *
   * ⚠️ RECORDED, NOT FIXED — AND THE DIFFERENCE MATTERS. `amend`, `assign` and `deliverline` are ENGINE files
   * and therefore LOCKED; changing how they query is Athi's call, not a test author's. Writing a budget here
   * does not make the shape good, it makes the shape KNOWN: the ratchet still refuses a SIXTH file and refuses
   * a second query in any of these five.
   *
   * ⭐ And at least one is inherent rather than accidental: `deliverline` calls the governed
   * `chit_line_deliver()` once per line because each line event IS its own governed record. A batch call would
   * be a different design decision about what a line event is, not an optimisation.
   */
  'lib/deliverline.js': 1,   // one governed chit_line_deliver() per line — the per-line event IS the record
  'lib/assign.js': 1,        // per-copy write per assignee: the per-copy model says each holder gets their own row
  'lib/amend.js': 1,         // ENGINE · locked. Needs Athi before the shape changes.
  'lib/cost.js': 1,          // not engine — a genuine candidate to batch. See BACKLOG.
  'lib/capture.js': 1,       // not engine — a genuine candidate to batch. See BACKLOG.
  'routes/chits.js': 9,
  'routes/governance.js': 1,
  'routes/network-design.js': 3,
  'routes/products.js': 4,
  'lib/storage.js': 2,
  'src/services/catalogue.js': 1,
  'src/services/chit.js': 2,
  'src/services/network.js': 1,
};

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

/** Every .js under the directories that talk to the database. */
function sourceFiles() {
  const out = [];
  ['routes', 'lib', 'src/routes', 'src/services'].forEach((d) => {
    const dir = path.join(API, d);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => out.push(d + '/' + f));
  });
  return out;
}

/**
 * Count `await …query(…)` occurring inside a loop body.
 *
 * Text analysis, not a parser: it will occasionally miscount, which is why the rule is a RATCHET on a number and
 * not a precise audit. A count that moves is the signal; the exact value only has to be stable.
 */
function loopQueries(rel) {
  const lines = fs.readFileSync(path.join(API, rel), 'utf8').split(/\r?\n/);
  let open = null, n = 0;
  lines.forEach((ln, i) => {
    if (/\b(for\s*\(|for\s+await|\.forEach\s*\()/.test(ln)) open = { line: i + 1, brace: 0 };
    if (!open) return;
    open.brace += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length;
    if (/await\s+(\w+\.)?(query|db\.query|withEntity)\s*\(/.test(ln) && i + 1 > open.line) { n++; open = null; return; }
    if (open.brace <= 0 && i > open.line + 1) open = null;
  });
  return n;
}

console.log('\nquery shape · a round trip per item is a SHAPE problem, not a speed one');

const found = {};
sourceFiles().forEach((f) => { const n = loopQueries(f); if (n) found[f.replace(/\\/g, '/')] = n; });

t('★★ no file has MORE per-item queries than it is budgeted', () => {
  const worse = Object.keys(found).filter((f) => found[f] > (BUDGET[f] || 0))
    .map((f) => `${f}: ${found[f]} (budget ${BUDGET[f] || 0})`);
  assert.deepStrictEqual(worse, [],
    'A new query inside a loop. If it is genuinely necessary — a per-tenant read behind RLS, a write per '
    + 'recipient — raise the budget in tests/query-shape.test.js AND say why. If it is an N+1, hoist it: read the '
    + 'set once, or batch with = ANY($1).');
});

t('★ the budget does not name files that no longer have any', () => {
  // A budget left behind after the debt is paid quietly re-permits it. Lower it when you fix one.
  const stale = Object.keys(BUDGET).filter((f) => !found[f]);
  assert.deepStrictEqual(stale, [], 'these files are clean now — remove them from BUDGET so it cannot creep back');
});

t('★ every budgeted file is at or under its number (report)', () => {
  Object.keys(BUDGET).sort().forEach((f) => {
    const n = found[f] || 0;
    if (n < BUDGET[f]) console.log(`        ↓ ${f}: ${n} of ${BUDGET[f]} — lower the budget`);
  });
  assert.ok(true);
});

/**
 * The other half of Athi's question: are we using the right index?
 *
 * A `LIKE '%x%'` cannot use a btree, and this is the one pattern that silently degrades from instant to a table
 * scan as data grows — the failure arrives long after the code is written, which is exactly when nobody is
 * looking at it.
 */
t('★★ every leading-wildcard LIKE has a trigram index to support it', () => {
  const offenders = [];
  sourceFiles().forEach((rel) => {
    const src = fs.readFileSync(path.join(API, rel), 'utf8');
    // A parameterised LIKE whose argument is built as '%' + term + '%'
    if (/LIKE\s+\$\d/.test(src) && /'%'\s*\+|\+\s*'%'|'%' \+ /.test(src)) offenders.push(rel.replace(/\\/g, '/'));
  });
  const migrations = fs.readdirSync(path.join(API, 'migrations')).map((f) =>
    fs.readFileSync(path.join(API, 'migrations', f), 'utf8')).join('\n');
  const hasTrgm = /gin_trgm_ops/.test(migrations);
  assert.ok(!offenders.length || hasTrgm,
    'substring search in ' + offenders.join(', ') + ' with no gin_trgm_ops index anywhere in migrations/. '
    + 'A leading wildcard cannot use a btree, so this is a scan that only shows up at volume.');
  if (offenders.length) console.log('        substring search in: ' + offenders.join(', ') + ' — b121 covers it');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

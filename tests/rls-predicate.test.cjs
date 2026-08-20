/**
 * tests/rls-predicate.test.cjs — every RLS policy must read a GUC that something actually sets.
 *
 * ⚠️⚠️ WHAT THIS CATCHES, AND WHAT IT COST. db/index.js sets exactly one setting for tenant isolation:
 *
 *     withEntity(entityId, fn)  →  set_config('app.current_entity', …)
 *
 * b172 and b174 both wrote policies reading `app.entity_id` — a name nothing anywhere sets. current_setting on
 * an unset GUC returns NULL, and `entity_id = NULL` is never true, so both policies denied everything to
 * everyone.
 *
 * On identity_documents that surfaced as a loud 42501 on write and — far worse — a SILENT empty result on read.
 * On access_events it was invisible in both directions: lib/access-events.js swallows every error by design, so
 * the audit trail reported success and stored nothing from the day b172 was applied until 2026-08-20, when a
 * live check showed an access change returning 200 and the event list returning [].
 *
 * ⭐ A NAME THAT IS MERELY PLAUSIBLE IS THE HARDEST KIND OF WRONG. `app.entity_id` reads correctly, reviews
 * correctly, and fails completely. Nothing but a check against the setter tells the two apart.
 *
 * ⚠️ GRADED, NOT UNIFORM — and the first version of this test was not. It failed on 15 pre-existing migrations
 * for a latent issue, burying the two files that were actually broken in a wall of noise. A check that cries
 * about everything is read as broken and then ignored, which is worse than not having it. FAIL is reserved for
 * the outage class; everything else reports as a warning and says why it is not a failure.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIG  = path.join(ROOT, 'migrations');

/* What the application actually sets — read from db/index.js, not hardcoded, so renaming the GUC updates this
   test rather than breaking it in the confusing direction. */
const dbSrc = fs.readFileSync(path.join(ROOT, 'db', 'index.js'), 'utf8');
const SET = new Set([...dbSrc.matchAll(/set_config\(\s*['"`]([a-z_.]+)['"`]/gi)].map(m => m[1]));
if (!SET.size) { console.error('✗ found no set_config call in db/index.js — fix this test before trusting it'); process.exit(1); }
const CANONICAL = [...SET][0];

const files = fs.readdirSync(MIG).filter(n => n.endsWith('.sql'));
const isComment = (l) => /^\s*(--|\*|\/\*)/.test(l);

/**
 * ⚠️⚠️ MIGRATIONS ARE APPLIED IN ORDER, SO ONLY THE LAST DEFINITION OF A POLICY IS REAL. The first version of
 * this check read every file as if all of them were simultaneously true, which would have kept failing on
 * b172 and b174 forever — even though b175 drops and recreates both policies correctly. A guard that cannot be
 * satisfied gets suppressed, and a suppressed guard protects nothing.
 *
 * So: walk the files in order, remember the LATEST predicate for each policy name, and judge that.
 */
files.sort();
const latest = new Map();        // policyname -> { file, line, guc, text }
const unsetValue = [], noNullif = [];

for (const f of files) {
  const lines = fs.readFileSync(path.join(MIG, f), 'utf8').split(/\r?\n/);
  let current = null;            // the policy whose predicate we are inside
  lines.forEach((line, i) => {
    if (isComment(line)) return;                       // b175's own header names the wrong GUC on purpose
    const cp = line.match(/CREATE\s+POLICY\s+([a-z0-9_]+)/i);
    if (cp) { current = cp[1]; return; }

    const m = line.match(/current_setting\(\s*'([a-z_.]+)'/i);
    if (!m) return;
    const guc = m[1];
    const where = `${f}:${i + 1}`;
    const inPolicy = /USING|WITH CHECK/i.test(line);

    if (inPolicy && current) latest.set(current, { where, guc, text: line.trim().slice(0, 80) });
    else if (!SET.has(guc))  unsetValue.push(`${where}  '${guc}'  ${line.trim().slice(0, 80)}`);

    if (/::uuid/.test(line) && !/NULLIF/i.test(line))  noNullif.push(`${where}  ${line.trim().slice(0, 80)}`);
  });
}

const brokenPolicy = [...latest.entries()]
  .filter(([, v]) => !SET.has(v.guc))
  .map(([name, v]) => `${v.where}  policy ${name} reads '${v.guc}'  ${v.text}`);

let fail = 0;

/* ── THE OUTAGE CLASS ─────────────────────────────────────────────────────────────────────────────────────── */
if (brokenPolicy.length) {
  fail++;
  console.error(`\n✗ FAIL — RLS policy reads a setting nothing sets (the app sets '${CANONICAL}'):\n`);
  brokenPolicy.forEach(b => console.error('   ' + b));
  console.error('\n  A policy on an unset GUC denies everything, always. On a writer that swallows errors it');
  console.error('  does so silently — which is how access_events stored nothing for weeks. See b175.\n');
} else {
  console.log(`✓ every RLS policy reads a GUC the app sets ('${CANONICAL}')`);
}

/* ── REAL, BUT NOT AN OUTAGE ──────────────────────────────────────────────────────────────────────────────── */
if (unsetValue.length) {
  console.log(`\n⚠ ${unsetValue.length} non-policy read(s) of an unset GUC — records NULL rather than failing:`);
  unsetValue.forEach(b => console.log('   ' + b));
  console.log('   e.g. b146 stamps "changed_by" from app.current_actor, which nothing sets — so the catalogue');
  console.log('   version history has no author on any row. A gap worth closing, not a broken query.');
}

/* ── LATENT ───────────────────────────────────────────────────────────────────────────────────────────────── */
if (noNullif.length) {
  console.log(`\n⚠ ${noNullif.length} current_setting(...)::uuid without NULLIF — latent, and the house pattern.`);
  console.log('   withEntity passes \'\' for a null entity and \'\'::uuid raises 22P02, so these would 500 rather');
  console.log('   than return empty IF a null entity ever reached them. The baseline guards it; b132 onward did');
  console.log('   not. Not failed here because it is pre-existing and uniform — fixing it is one deliberate');
  console.log('   sweep, not a surprise in whichever migration is edited next.');
}

/**
 * ── THE OTHER HALF: a WITH RLS table must be reached through withEntity, on READS TOO ──────────────────────
 *
 * ⚠️⚠️ THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE SECOND HALF OF THE SAME BUG. After b175 fixed the policies
 * and the audit WRITE was scoped, the trail still looked empty — because the READ used the plain helper. It
 * returned [] beside `applied: true`, which reads as "installed, nothing to show". Fixing the write and
 * leaving the read is indistinguishable, from outside, from not having fixed anything.
 *
 * The heuristic: find every table the migrations put under RLS, then find code that names it, and look back a
 * few lines for a scoping call. Imperfect by nature — it is a text search over SQL embedded in JS — so a hit
 * is reported as a WARNING to be looked at, not a failure. The point is that it is impossible to add an
 * unscoped statement and have nobody mention it.
 */
const rlsTables = new Set();
for (const f of files) {
  const src = fs.readFileSync(path.join(MIG, f), 'utf8');
  for (const m of src.matchAll(/ALTER TABLE\s+([a-z0-9_]+)\s+ENABLE ROW LEVEL SECURITY/gi)) rlsTables.add(m[1].toLowerCase());
}

const SCOPERS = /(withEntity|onEntity|withTransaction|crossing)\s*\(/;
const unscoped = [];
for (const dir of ['routes', 'lib']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter(n => n.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(d, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;   // prose mentioning a table is not a statement on it
      const m = line.match(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z0-9_]+)/i);
      if (!m) return;
      const t = m[1].toLowerCase();
      if (!rlsTables.has(t)) return;
      /**
       * ⚠️ SEARCH THE ENCLOSING HANDLER, NOT A FIXED WINDOW. A 12-line lookback produced 112 hits, nearly all
       * of them statements sitting inside a withEntity block that opened thirty lines earlier — the noisy
       * check this file's own header warns about, written by the person who wrote the warning. Walk back to
       * the start of the route handler or function and search that whole span instead.
       */
      /* ⚠️ STOP ONLY AT A ROUTE OR A TOP-LEVEL FUNCTION. Including `const x = (…)` in the stop pattern matched
         the INNER arrow — routes/actors.js shadows `const db = (t,p) => client.query(t,p)` immediately inside
         its withEntity callback — so the walk halted one line below the very call it was looking for and
         reported 51 false positives. The enclosing unit is the handler, not the nearest arrow. */
      let start = i;
      while (start > 0 && !/^\s*(router\.(get|post|put|patch|delete)\b|(async\s+)?function\s+\w)/.test(lines[start])) start--;
      const back = lines.slice(start, i + 1).join('\n');
      if (SCOPERS.test(back)) return;
      unscoped.push(`${dir}/${f}:${i + 1}  ${t}  ${line.trim().slice(0, 70)}`);
    });
  }
}

if (unscoped.length) {
  console.log(`\n⚠ ${unscoped.length} statement(s) on a WITH-RLS table with no scoping call in the enclosing handler:`);
  unscoped.slice(0, 20).forEach(b => console.log('   ' + b));
  if (unscoped.length > 20) console.log(`   … and ${unscoped.length - 20} more`);
  console.log('   A plain query sets no app.current_entity, so the policy matches nothing: writes raise 42501');
  console.log('   and READS SILENTLY RETURN []. Check each — a text search cannot prove the call is missing.');
} else if (rlsTables.size) {
  console.log(`✓ every statement naming one of the ${rlsTables.size} WITH-RLS tables is inside a scoping call`);
}

console.log(`\n══ ${fail ? 'FAILED' : 'PASSED'} · ${brokenPolicy.length} broken · ${unsetValue.length + noNullif.length + unscoped.length} warning(s) ══\n`);
process.exit(fail ? 1 : 0);

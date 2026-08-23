/**
 * tools/round-trips.cjs — how many database round trips each endpoint costs, ranked.
 *
 * Athi, 2026-08-21: *"in the code if we make multiple rounds of read, that has to be addressed — possibly each
 * API needs to be assessed how many can be changed from read to write, and any other optimisation technique."*
 *
 * ⭐⭐ THE COST MODEL IS NOT A GUESS, IT IS IN db/index.js. `withEntity()` wraps its callback in a transaction so
 * the RLS binding is `SET LOCAL` and cannot leak between requests — correct, and it stays. But that is FOUR
 * round trips every time: BEGIN · set_config · the query · COMMIT. A bare `query()` is one.
 *
 * So an endpoint calling withEntity seven times sequentially costs ~28 round trips, six of which do not depend
 * on each other. That is exactly what GET /chits/:id was measured doing — 2.8s to open a chit — and why
 * `onEntity(entity_id, db, fn)` exists: it runs on a client the caller already owns, turning N transactions
 * into one BEGIN, one set_config, N queries, one COMMIT.
 *
 * ⚠️ THE FIX IS NOT Promise.all, and this tool must not be read as suggesting it. The pool is max:10, so six
 * parallel transactions per request means two concurrent readers want twelve connections and the third queues.
 * That trades a slow page for connection timeouts — a worse failure, and far harder to diagnose.
 *
 * ⚠️ IT COUNTS STATIC CALL SITES, NOT EXECUTIONS. A call inside `if` may not run; a call inside a loop runs many
 * times — and a loop is the case this UNDER-counts, so a low score is weaker evidence than a high one. It ranks
 * where to look; it does not measure a request.
 *
 * Read-only.
 */
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
const R = path.join(API, 'routes');

const COST = { withEntity: 4, withTransaction: 3, onEntity: 1, query: 1 };

/**
 * ⚠️⚠️ THE FULL PATH, NOT THE ROUTER-RELATIVE ONE — without it this tool cannot be joined to anything. It used
 * to print `POST /` for attachments and `GET /` for notifications, so cross-referencing it against
 * endpoint-usage.cjs matched every root-mounted route to every other one (`''.endsWith('')` is true) and
 * labelled the attachments upload as `defAdd`. Two tools measuring the same endpoints in two different naming
 * schemes produce a join that is confidently wrong, which is worse than no join.
 */
const mounts = {};
try {
  const app = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  /* ⚠️ ONE LINE, NOT A WINDOW. A `[\s\S]{0,120}` window let a mount borrow the PATH from a nearby app.use —
     catalogue.js came out mounted at `/api/network` because that line sits above it. Mounts are one-liners in
     this file; anything else is better left unmatched than matched to the wrong base. */
  for (const line of app.split('\n')) {
    const m = line.match(/app\.use\(\s*['"]([^'"]+)['"].*require\(['"][^'"]*routes\/([A-Za-z0-9_-]+)['"]\)/);
    if (m && !mounts[m[2] + '.js']) mounts[m[2] + '.js'] = m[1];
  }
} catch (_) { /* no server.js — paths stay router-relative, and the join simply finds nothing */ }

const files = fs.readdirSync(R).filter((f) => f.endsWith('.js'));
const rows = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(R, f), 'utf8');
  /* every route declaration, and the span of its handler up to the next one */
  const decls = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g)];
  /**
   * ⚠️⚠️ THE HANDLER IS PAREN-MATCHED, NOT SLICED TO THE NEXT ROUTE. My first version took everything between
   * one `router.x(` and the next — which swallows any helper function declared between them. It reported
   * `GET /:chit_id` as opening FIVE transactions when the handler opens exactly one: that endpoint is the very
   * one `onEntity` was written to fix, measured at 2.8s and collapsed months ago.
   *
   * ⭐ A tool that misreports the one endpoint everyone knows was fixed is a tool nobody trusts twice — the
   * same failure as the staleness scanner flagging START-HERE.md. Walk to the matching close paren instead;
   * strings and comments are skipped so a `)` inside them cannot end the span early.
   */
  const handlerOf = (from) => {
    let i = src.indexOf('(', from), depth = 0, s = i;
    for (; i < src.length; i++) {
      const c = src[i], n = src[i + 1];
      if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
      if (c === '/' && n === '*') { i = src.indexOf('*/', i); if (i < 0) break; i++; continue; }
      if (c === "'" || c === '"' || c === '`') {
        const q = c; i++;
        for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; }
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return src.slice(s, i + 1); }
    }
    return src.slice(s, Math.min(src.length, s + 4000));
  };

  /**
   * ⚠️⚠️ COMMENTS ARE STRIPPED BEFORE COUNTING, AND IN THIS CODEBASE THAT IS NOT A DETAIL. The handlers explain
   * themselves at length and name the very functions being counted — `GET /:chit_id` mentions `withEntity(me)`
   * in a note and quotes "withEntity() wraps each call in its own transaction" in another. Counting prose
   * charged it five transactions when it makes two, and the second is a `if (!bundle)` fallback.
   *
   * ⭐ The endpoint whose comments explain the fix best is the one a naive counter punishes hardest.
   */
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((L) => {
      const i = L.indexOf('//');
      if (i < 0) return L;
      /* a // inside a string is not a comment — cheap check: an odd number of quotes before it */
      const before = L.slice(0, i);
      const odd = (q) => (before.split(q).length - 1) % 2 === 1;
      return (odd("'") || odd('"') || odd('`')) ? L : before;
    }).join('\n');

  decls.forEach((d) => {
    const body = strip(handlerOf(d.index));

    const n = (re) => (body.match(re) || []).length;
    const we = n(/\bwithEntity\s*\(/g);
    const wt = n(/\bwithTransaction\s*\(/g);
    const oe = n(/\bonEntity\s*\(/g);
    /* ⚠️ EXCLUDE the ones already counted — `withEntity(id, c => c.query(...))` would otherwise be
       double-charged for its inner query, which is the query the transaction was opened FOR. */
    const q  = n(/(?:^|[^.\w])query\s*\(/g) - we - wt;

    const trips = we * COST.withEntity + wt * COST.withTransaction + oe * COST.onEntity + Math.max(0, q) * COST.query;
    rows.push({
      /* ⚠️ no regex here on purpose — a trailing-slash strip written as a literal has now had its backslash
         eaten by a generated edit twice in this file alone. String work cannot be mis-escaped. */
      route: (() => {
        let p = (mounts[f] || '') + d[3];
        if (p.length > 1 && p[p.length - 1] === '/') p = p.slice(0, -1);
        return d[1].toUpperCase().padEnd(6) + (p || d[3]);
      })(),
      file: f, we, wt, oe, q: Math.max(0, q), trips,
      /* ⭐ THE ACTIONABLE SIGNAL: more than one transaction opened in one handler. One is unavoidable; the
         second onwards is the pattern onEntity exists to collapse. */
      collapsible: Math.max(0, (we + wt) - 1),
    });
  });
}

rows.sort((a, b) => b.trips - a.trips);

const total = rows.reduce((s, r) => s + r.trips, 0);
const worst = rows.filter((r) => r.collapsible > 0);

console.log('\n  ' + rows.length + ' endpoints in ' + files.length + ' route files · ~' + total + ' static round trips'
  + '\n  cost model (db/index.js): withEntity 4 · withTransaction 3 · onEntity 1 · query 1\n');

console.log('  WORST — more than one transaction opened in a single handler:\n');
console.log('    ' + 'trips'.padStart(6) + '  ' + 'extra tx'.padStart(8) + '  endpoint');
worst.slice(0, 20).forEach((r) => {
  console.log('    ' + String(r.trips).padStart(6) + '  ' + String(r.collapsible).padStart(8) + '  '
    + r.route.padEnd(46) + r.file);
});
if (worst.length > 20) console.log('    … and ' + (worst.length - 20) + ' more');

console.log('\n  ' + worst.length + ' of ' + rows.length + ' endpoints open more than one transaction.'
  + '\n  Collapsing every one of them would remove ~'
  + worst.reduce((s, r) => s + r.collapsible * 3, 0) + ' round trips'
  + ' (each extra transaction costs 3 beyond its query).\n');

if (process.argv.indexOf('--all') >= 0) {
  console.log('  EVERY ENDPOINT:\n');
  rows.forEach((r) => console.log('    ' + String(r.trips).padStart(4) + '  we=' + r.we + ' wt=' + r.wt
    + ' oe=' + r.oe + ' q=' + r.q + '   ' + r.route.padEnd(46) + r.file));
  console.log();
}

/**
 * ── THE RATCHET ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-23, after /entities/me was measured at 3.2 seconds: *"why are we writing round trips in the
 * first place? Can't we optimise in the first attempt itself? Speed and security should be the anthem of
 * coding."*
 *
 * ⭐⭐ HE IS RIGHT, AND GOOD INTENTIONS ARE NOT THE MECHANISM THAT DELIVERS IT. Nobody wrote thirteen round
 * trips into one handler; thirteen separate edits each wrote ONE, and every one of them was locally
 * reasonable. What was missing was not care — it was a NUMBER THAT FAILS. Contrast is measured, hierarchy is
 * measured, screen reads have been measured since yesterday. Round trips were computed by this very tool, and
 * nothing ever ran it.
 *
 * ⚠️ AND SPEED MUST NOT BE BOUGHT FROM SECURITY HERE. `withEntity` costs 4 trips BECAUSE of RLS: it opens a
 * transaction and sets the entity context so Postgres itself enforces isolation. Making an endpoint fast by
 * dropping it would trade the isolation guarantee for latency. The lever is FEWER TRANSACTIONS, never weaker
 * ones — which is why this budgets transactions and trips rather than telling anyone to avoid `withEntity`.
 *
 * ⭐ A ratchet, not a limit: it records today's cost and fails only when an endpoint gets WORSE. A hard
 * threshold would fail on the day it was written and be deleted by the afternoon.
 *
 *   node tools/round-trips.cjs --check     fail if any endpoint costs more than its budget
 *   node tools/round-trips.cjs --update    record today's costs as the budget
 */
{
  const fsB = require('fs');
  const pathB = require('path');
  const BUDGET = pathB.join(__dirname, 'round-trips.budget.json');
  const now = {};
  rows.forEach((r) => { now[r.route + '  ' + r.file] = r.trips; });

  if (process.argv.includes('--update')) {
    const old = fsB.existsSync(BUDGET) ? JSON.parse(fsB.readFileSync(BUDGET, 'utf8')) : {};
    const raised = [];
    const next = {};
    for (const [k, v] of Object.entries(now)) {
      if (old[k] != null && v > old[k] && !process.argv.includes('--allow-raise')) { raised.push(`${k}  ${old[k]} → ${v}`); next[k] = old[k]; }
      else next[k] = v;
    }
    if (raised.length) {
      console.error('\n  x refusing to raise a budget — that is the drift this exists to stop:');
      raised.forEach((r) => console.error('      ' + r));
      console.error('\n  Collapse the extra transaction, or re-run with --allow-raise if it is genuinely intended.\n');
      process.exit(1);
    }
    fsB.writeFileSync(BUDGET, JSON.stringify(next, null, 1));
    console.log(`  budget recorded — ${Object.keys(next).length} endpoints\n`);
    process.exit(0);
  }

  if (process.argv.includes('--check')) {
    if (!fsB.existsSync(BUDGET)) { console.error('\n  no budget yet — run: node tools/round-trips.cjs --update\n'); process.exit(1); }
    const budget = JSON.parse(fsB.readFileSync(BUDGET, 'utf8'));
    const over = [];
    const fresh = [];
    for (const [k, v] of Object.entries(now)) {
      if (budget[k] == null) { if (v > 8) fresh.push(`${k} = ${v}`); continue; }
      if (v > budget[k]) over.push(`${k}  ${budget[k]} → ${v}`);
    }
    console.log('\n── round trips per endpoint, against their budget ──');
    console.log(`  ${Object.keys(now).length} endpoints · ${Object.keys(budget).length} budgeted`);
    /* ⚠️ A NEW endpoint has no budget to exceed, so it gets one rule: 8 trips is two transactions plus change,
       and anything above that is a design decision someone should have to state out loud. */
    if (fresh.length) {
      console.error(`\n  x ${fresh.length} NEW endpoint(s) start above 8 trips:`);
      fresh.forEach((f) => console.error('      ' + f));
    }
    if (over.length) {
      console.error(`\n  x ${over.length} endpoint(s) now cost MORE than budgeted:`);
      over.forEach((o) => console.error('      ' + o));
      console.error('\n  Each extra transaction is ~3 trips, ~250ms each. Collapse it, or --update --allow-raise.\n');
    }
    if (!over.length && !fresh.length) console.log('  OK — no endpoint costs more than its budget\n');
    process.exit(over.length + fresh.length ? 1 : 0);
  }
}

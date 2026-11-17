'use strict';
/**
 * screen-reads.cjs — HOW MANY ROUND TRIPS DOES ONE SCREEN COST TO PAINT?
 *
 * Athi, 2026-08-20: *"Just to bring the profile, are we looping or does it all get in a single read? If
 * multiple reads that has to be optimised... we have to see how to reduce."*
 *
 * ⚠️⚠️ THE PROFILE HAD GROWN TO FIVE INDEPENDENT READS AND I WROTE FOUR OF THEM MYSELF, ONE PER FEATURE, IN A
 * SINGLE DAY. Each was individually reasonable — latched, additive, failing silently. Together they are the
 * round-trip problem this codebase already knows it has (~250 ms per statement Railway↔Supabase). **Nothing
 * measured it, so nothing objected.** That is the whole finding: the fault was not the fourth fetch, it was
 * that adding a fetch cost nobody anything.
 *
 * ⭐⭐ SO THIS IS A RATCHET, NOT A LIMIT. It records what each screen costs TODAY and fails only when a screen
 * gets WORSE. A hard threshold would fail on the day it was written and be deleted by the afternoon; a ratchet
 * is green from the first run, forbids the drift that actually happened, and tightens by itself every time a
 * screen is genuinely improved (`--update` refuses to raise a budget without `--allow-raise`).
 *
 * ⚠️⚠️ AND THE READS DO NOT FIRE WHERE ANYONE WOULD LOOK FOR THEM. Four of the profile’s five live in
 * `iamMeHTML()` and `iamSelfEmployeeHTML()` — functions that BUILD MARKUP and start network requests as a side
 * effect (latched, so they fire once). That is why walking from screen entry points found two: the entry point
 * is not where the cost is. So render functions are entries here too, which is the only reason the number is
 * about the real application rather than about its call graph.
 *
 * ⚠️ AND THE COUNT IS NEITHER A FLOOR NOR A CEILING — an earlier draft of this header claimed it was a floor,
 * which was simply wrong. Branches mean fewer reads may actually run; deeper chains mean more may. It is
 * "statically reachable within depth", and its value is entirely in COMPARING IT TO YESTERDAY, not in its
 * absolute size. Depth 3 was tried first and leaked through shared dispatchers into the whole app (26 reads
 * for the profile); depth 1 alone missed the render path. Both together are the honest middle.
 *
 * ⚠️ WHAT IT CANNOT SEE, STATED PLAINLY: this is static reachability over `function name(...)` bodies. It
 * follows named calls up to MAX_DEPTH and counts `api('key')` sites. It does not resolve dynamic dispatch,
 * callbacks passed as values, or anything behind `ensureCap`.
 *
 * Run:  node e2e/screen-reads.cjs                report + fail on any screen over budget
 *       node e2e/screen-reads.cjs --update       record today's counts as the budget
 *       node e2e/screen-reads.cjs --detail NAME  which api() calls one screen reaches, and via what
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const BUDGET = path.join(__dirname, 'screen-reads.json');
const MAX_DEPTH = 1;

/* ── gather every function body in the app, from the shell and the capabilities ─────────────────────────── */
const sources = [['app.html', fs.readFileSync(path.join(WEB, 'public', 'app.html'), 'utf8')]];
const appDir = path.join(WEB, 'public', 'app');
for (const f of fs.readdirSync(appDir).filter((x) => x.endsWith('.js'))) {
  sources.push([f, fs.readFileSync(path.join(appDir, f), 'utf8')]);
}

/**
 * Brace-matching from the function's opening `{`. Crude on purpose: a real parser would be correct about
 * strings and regex literals, and would also be a dependency this repo does not have. An over-long body only
 * ever makes the count too HIGH, which fails loud rather than passing quietly.
 */
const bodies = new Map();   // name -> body text
for (const [file, src] of sources) {
  for (const m of src.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = src.indexOf('{', m.index + m[0].length);
    if (open < 0) continue;
    let d = 0;
    let end = -1;
    for (let i = open; i < src.length && i < open + 60000; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (!d) { end = i; break; } }
    }
    if (end < 0) continue;
    if (!bodies.has(m[1])) bodies.set(m[1], { file, body: src.slice(open, end) });
  }
}

/**
 * ── ⚠️⚠️ AN onclick IS NOT A PAINT ────────────────────────────────────────────────────────────────────────
 *
 * This measures "reads reachable from one screen PAINT". A handler attribute is the opposite of that: it runs
 * only when a person presses something, and the read it makes is one they asked for.
 *
 * It reported `loadActorProfile: 1 → 2` as a REGRESSION. The second read was `changePin`, reached via
 * `saveActorPin` — which appears exactly once in that function, inside `onclick="saveActorPin()"` in an HTML
 * string. Painting the profile costs one read; pressing "Change PIN" costs the other, correctly.
 *
 * ⚠️ A FALSE ALARM IN A BUDGET GUARD IS WORSE THAN A QUIET ONE. It either sends somebody optimising a screen
 * that is already fine, or it teaches them to skim the reds — and this guard exists precisely because the
 * profile silently grew to five reads and nobody noticed.
 *
 * ⭐ Handler bodies are BLANKED, not stripped, so byte offsets and reported line numbers are unchanged.
 * Same treatment as the comment-blanking in token-check.cjs and modal-safe-repaint.cjs.
 */
const stripHandlers = (body) => body
  .replace(/\bon[a-z]+\s*=\s*"[^"]*"/gi, (h) => h.replace(/[^\n]/g, ' '))
  .replace(/\bon[a-z]+\s*=\s*'[^']*'/gi, (h) => h.replace(/[^\n]/g, ' '));

/** Every `api('key'…)` site in a body, by key. */
const apiCalls = (body) => [...stripHandlers(body).matchAll(/\bapi\(\s*['"]([A-Za-z][\w.]*)['"]/g)].map((x) => x[1]);
const namedCalls = (body) => [...stripHandlers(body).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((x) => x[1]);

/** Transitive, cycle-safe, depth-limited. Returns Map<apiKey, viaFunctionName>. */
function reads(entry) {
  const found = new Map();
  const seen = new Set();
  const walk = (name, depth) => {
    if (depth > MAX_DEPTH || seen.has(name)) return;
    seen.add(name);
    const fn = bodies.get(name);
    if (!fn) return;
    for (const k of apiCalls(fn.body)) if (!found.has(k)) found.set(k, name);
    for (const c of namedCalls(fn.body)) if (bodies.has(c) && c !== name) walk(c, depth + 1);
  };
  walk(entry, 0);
  return found;
}

/* ── the screens worth watching ─────────────────────────────────────────────────────────────────────────── */
const ENTRIES = [...bodies.keys()]
  .filter((n) => /Screen$/.test(n) || /^load[A-Z]/.test(n) || /HTML$/.test(n))
  .filter((n) => reads(n).size > 0)
  .sort();

const detail = process.argv.indexOf('--detail');
if (detail > -1 && process.argv[detail + 1]) {
  const n = process.argv[detail + 1];
  const r = reads(n);
  console.log(`\n  ${n} — ${r.size} read(s), depth ≤ ${MAX_DEPTH}\n`);
  [...r.entries()].sort().forEach(([k, via]) => console.log(`    ${k.padEnd(28)} via ${via}`));
  console.log('');
  process.exit(0);
}

const counts = {};
ENTRIES.forEach((n) => { counts[n] = reads(n).size; });

if (process.argv.includes('--update')) {
  const old = fs.existsSync(BUDGET) ? JSON.parse(fs.readFileSync(BUDGET, 'utf8')) : {};
  const raised = [];
  const next = {};
  for (const [n, c] of Object.entries(counts)) {
    if (old[n] != null && c > old[n] && !process.argv.includes('--allow-raise')) {
      raised.push(`${n} ${old[n]} → ${c}`);
      next[n] = old[n];
    } else next[n] = c;
  }
  if (raised.length) {
    console.error('\n  x refusing to raise a budget — that is the drift this guard exists to stop:');
    raised.forEach((r) => console.error('      ' + r));
    console.error('\n  Reduce the reads, or re-run with --allow-raise if the increase is genuinely intended.\n');
    process.exit(1);
  }
  fs.writeFileSync(BUDGET, JSON.stringify(next, null, 1));
  console.log(`\n  budget recorded — ${Object.keys(next).length} screens\n`);
  process.exit(0);
}

if (!fs.existsSync(BUDGET)) {
  console.error('\n  no budget yet — run: node e2e/screen-reads.cjs --update\n');
  process.exit(1);
}
const budget = JSON.parse(fs.readFileSync(BUDGET, 'utf8'));

const over = [];
const newly = [];
console.log('\n── reads reachable from one screen paint (statically reachable, depth ≤ ' + MAX_DEPTH + ') ──');
for (const n of ENTRIES) {
  const c = counts[n];
  const b = budget[n];
  if (b == null) { newly.push(`${n} = ${c}`); continue; }
  if (c > b) over.push(`${n}: ${b} → ${c}`);
}
const worst = ENTRIES.map((n) => [n, counts[n]]).sort((a, b) => b[1] - a[1]).slice(0, 8);
worst.forEach(([n, c]) => console.log(`  ${String(c).padStart(3)}  ${n}${budget[n] != null && c < budget[n] ? '   (improved from ' + budget[n] + ')' : ''}`));

if (newly.length) {
  console.log('\n  new screens, not yet budgeted: ' + newly.join(' · '));
  console.log('  record them with --update');
}
if (over.length) {
  console.error('\n  x ' + over.length + ' screen(s) now cost MORE reads than budgeted:');
  over.forEach((o) => console.error('      ' + o));
  console.error('\n  Each extra read is ~250ms the user waits. Gather them server-side, or derive at write time.\n');
  process.exit(1);
}
console.log('\n  OK — no screen reads more than its budget\n');

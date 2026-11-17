/**
 * e2e/session-keys.cjs — a SESSION property that is read but never written is silently always-undefined.
 *
 * ⚠️⚠️ WHY THIS EXISTS. cap-admin.js gated the entire employee profile on `SESSION.identity_type`, a property
 * NOTHING in this codebase assigns. It parsed, it ran, it threw nothing, and it returned false for every user
 * — so a screen that was built, reviewed, committed, deployed and served had never once rendered. Athi found
 * it by asking "is it reflecting in localhost? I am there as an employee." The honest answer was no.
 *
 * ⭐ THAT IS THE WHOLE CLASS: a helper written against a REMEMBERED name is not a crash, it is a silent
 * always-false. JavaScript will not tell you, a parse check will not tell you, and a code review will not
 * either — because the name reads perfectly plausibly. Only comparing readers against writers tells you.
 *
 * It immediately found a second, older one: cap-workforce.js read `SESSION.entity_id` (the real name is
 * `entityId`), so the AI-policy localStorage key silently collapsed to a shared 'cb_aipolicy_me' whenever
 * SESSION.name was absent — two businesses on one browser sharing one policy store.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const files = ['app.html', ...fs.readdirSync(path.join(ROOT, 'app')).filter(f => f.endsWith('.js')).map(f => 'app/' + f)];

/* ⚠️ COMMENTS ARE STRIPPED FIRST. The first run of this sweep flagged SESSION.identity_type again — from the
   comment I had just written explaining that SESSION.identity_type does not exist. A guard that reads prose as
   code reports the documentation of a bug as the bug. */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const reads = new Map(), writes = new Set();
for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const m of src.matchAll(/SESSION\.([A-Za-z_][A-Za-z0-9_]*)\s*=[^=]/g)) writes.add(m[1]);
  for (const m of src.matchAll(/SESSION\.([A-Za-z_][A-Za-z0-9_]*)/g)) if (!reads.has(m[1])) reads.set(m[1], f);
}

/* setSession spreads its argument, so any key handed to it at sign-in is also a write. */
const app = stripComments(fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8'));
for (const m of app.matchAll(/setSession\(\{([^}]*)\}/g))
  for (const k of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) writes.add(k[1]);
/* …and whatever is restored from storage on reload. */
for (const m of app.matchAll(/PERSIST[^=]*=\s*\[([^\]]*)\]/g))
  for (const k of m[1].matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)) writes.add(k[1]);

const orphan = [...reads.entries()].filter(([k]) => !writes.has(k));

let failed = 0;
if (orphan.length) {
  failed = 1;
  console.error('\n✗ SESSION property read but NEVER written — silently undefined at every call site:\n');
  orphan.forEach(([k, f]) => console.error(`   SESSION.${k}   first read in public/${f}`));
  console.error('\n  This is not a crash. It is a condition that is always false, or a fallback that never');
  console.error('  fires. Check the real name in app.html setSession().\n');
} else {
  console.log(`✓ SESSION keys — ${reads.size} read, every one of them written somewhere`);
}

/**
 * ── CALLED BUT NEVER DEFINED ──────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE A SCRIPTED DELETION ATE `loadActorProfile` AND NOTHING NOTICED. It removed
 * storefrontCardHTML and over-reached by one function. The file parsed. Every gate passed. render-smoke kept
 * reporting 9/9 — because it calls the RENDERERS directly and never goes through loadProfile, which is the
 * only thing that calls the function that vanished. The single symptom would have been an employee opening
 * Profile and getting a blank pane.
 *
 * ⭐ IT WAS FOUND BY dead-surface REPORTING THE ORPHAN COUNT GOING UP. A function with no callers is usually
 * dead code; twice in one day it instead meant that something which SHOULD call it had gone missing. This
 * checks the other direction — a CALL with no function — which is the half nothing was watching.
 *
 * ⚠️ HEAVILY WHITELISTED, ON PURPOSE. Browser built-ins, library globals and methods are not our functions,
 * and a check that reports `Math.round` as undefined would be switched off within a day.
 */
const defined = new Set();
/* ⚠️ WHERE each top-level name was declared, not just that it was — the shadowing check at the bottom needs
   the file, and `defined` is a flat Set that has thrown that away since the day it was written. */
const byName = new Map();
const called = new Map();
const BUILTIN = new Set(['if','for','while','switch','catch','return','function','typeof','new','do','else',
  'try','with','case','delete','void','in','of','await','yield','super','this','constructor']);

/**
 * ⚠️ THREE KINDS OF FALSE POSITIVE HAD TO GO FIRST, and finding them is why this is worth having rather than
 * a wall of noise:
 *   · `typeof X === 'function'` guards — the DELIBERATE optional-capability pattern. loadProducts,
 *     lazyFilter and disputeToggleHtml are all called that way on purpose; reporting them would teach the
 *     next reader to "fix" a design decision.
 *   · CALLBACK PARAMETERS — onOk, onDone. A parameter is defined, just not at file scope.
 *   · CSS AND BROWSER NAMES — translateX() inside a style string is not a call, and getComputedStyle is the
 *     browser's, not ours.
 */
const CSS_OR_BROWSER = new Set(['scalex','scaley','translatex','translatey','translate','rotate','matrix',
  'getcomputedstyle','requestanimationframe','cancelanimationframe','setinterval','clearinterval',
  'settimeout','cleartimeout','encodeuricomponent','decodeuricomponent','parsefloat','parseint','isnan',
  'structuredclone','queuemicrotask','fetch','alert','confirm','prompt']);

for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const m of src.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  /* ⚠️ THE SAME SCAN, ANCHORED TO COLUMN ZERO AND REMEMBERED PER FILE — the shadowing check at the bottom needs
     to know WHERE a name was declared, not only that it was. Indented declarations are nested and share no
     scope with another file's; only column zero enters the one global namespace these classic scripts share. */
  /**
   * ⚠️⚠️ AND A FILE WRAPPED IN AN IIFE SHARES NO NAMESPACE AT ALL (2026-09-16).
   *
   * The rule above says only column zero enters the one global namespace these classic scripts share. That is
   * true of the hand-written files — and false of every generated mirror, because the vendor pastes the master
   * at column zero INSIDE `(function (root) { … })(globalThis)`. So engine/tax.js and
   * app/tax-engine.js all appeared to declare `resolve`, `r2`, `slabOf` globally, and the guard reported
   * thirteen collisions between three files that cannot collide with anything. It had been saying so for days.
   *
   * ⭐ They publish ONE name each — `window.CBTax` — and that really can be contested; `e2e/dup-functions.cjs`
   * is the check that catches it, and it does. This one is about the shared global namespace, which a wrapped
   * file never enters.
   */
  const wrapped = /^\s*\(function\b/.test(src);
  if (!wrapped) for (const m of src.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) {
    if (!byName.has(m[1])) byName.set(m[1], new Set());
    byName.get(m[1]).add(f);
  }
  /**
   * ── ⚠️⚠️ THE FOURTH, FIFTH AND SIXTH FALSE POSITIVES (2026-09-16) ──────────────────────────────────────────
   *
   * This rule used to demand `= function` or `= (`, so it saw only two of the ways a name gets bound. Every
   * finding this guard reported was a false positive because of it, and it had been red for days — at which
   * point nobody reads it, which is the real cost. What it was missing:
   *
   *   · A PLAIN ALIAS.   `const kindWord = prodOrderKindWord;` then `kindWord(k)` two lines later (app.html).
   *   · A TERNARY.       `var taxOf = typeof o.taxOf === 'function' ? o.taxOf : function(){…}` (cart.js).
   *   · METHOD SHORTHAND. `getIdentifier() { return 'cb_system'; }` inside an object literal (tax-engine.js).
   *
   * ⭐ ANY INITIALISER NOW COUNTS, because the question is "would this line throw a ReferenceError?" and a name
   * bound to ANYTHING would not. Binding a number and then calling it is a different bug, and not this one's.
   */
  for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  /* ⭐ ASSIGNED NAMES (QA undecided-2, 13 Nov). A name given its function by plain assignment —
     "var a = 1, isoDate = function (x) {…}" (cap-books.js:2165), "selectedIf = function" in a var list
     (cap-repeat.js:410), "frameResay = function" (shell.js:1402), "isDue = (t) => …" (cap-period.js:601) — and a
     NAMED function expression "(function fromUrl() {…})()" (edition.js:49) are bound too. The old rules saw only
     column-zero "function x(" and "var x =", so every call to them was reported as a ReferenceError. */
  for (const m of src.matchAll(/(?:^|[\s,;(])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm)) defined.add(m[1]);
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
  /* destructured bindings — `const { slabOf, resolve } = CBTax.slab;` defines both of those names */
  for (const m of src.matchAll(/\b(?:var|let|const)\s*\{([^}]{1,400})\}\s*=/g)) {
    for (const p of m[1].split(',')) {
      const n = p.split(':').pop().trim().split(/[=\s]/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(n)) defined.add(n);
    }
  }
  /* object-literal method shorthand: preceded by { or , so a plain `if (x) {` cannot be mistaken for one */
  for (const m of src.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g)) defined.add(m[1]);
  /* a class method is a definition too */
  for (const m of src.matchAll(/^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) defined.add(m[1]);
  /* parameters count as defined — a callback is not a missing function */
  for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g))
    for (const p of m[1].split(',')) { const n = p.trim().split(/[=\s]/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(n)) defined.add(n); }
  /* every name that is ever `typeof`-guarded anywhere is optional by design */
  for (const m of src.matchAll(/typeof\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);

  /**
   * A bare call: not preceded by a dot (that is a method), not a keyword, and NOT INSIDE A STRING.
   * A ^ before the name is a regex literal (/^cb_nav(@|$)/), not a call (QA undecided-2, 13 Nov).
   *
   * ⚠️ THE STRING CHECK IS THE ONE THAT MATTERS. cap-legend.js documents the backend in prose —
   * "withEntity() sets app.current_entity" — and without this the guard reported the DOCUMENTATION of a
   * function as a call to a missing one. Counting unescaped quotes before the match is exact enough for this
   * codebase and needs no whitelist, which is the point: a whitelist would have to grow every time someone
   * writes a sentence.
   */
  src.split(/\r?\n/).forEach((line) => {
    for (const m of line.matchAll(/(^|[^.\w$'"`^])([a-z_$][\w$]{3,})\s*\(/g)) {
      const n = m[2];
      if (BUILTIN.has(n) || called.has(n) || CSS_OR_BROWSER.has(n.toLowerCase())) continue;
      const before = line.slice(0, m.index);
      const inString = ((before.match(/(?<!\\)'/g) || []).length % 2 === 1)
                    || ((before.match(/(?<!\\)"/g) || []).length % 2 === 1);
      if (inString) continue;
      called.set(n, f);
    }
  });
}
/* Only report names that LOOK like ours — camelCase app helpers — and are defined nowhere. */
const missing = [...called.entries()]
  .filter(([n]) => !defined.has(n))
  .filter(([n]) => /^[a-z]+[A-Z]/.test(n) || /^(load|save|render|iam|prof|ac|sf|cb|net|gov)[A-Z_]/.test(n))
  .filter(([n]) => !(typeof globalThis[n] === 'function'));

if (missing.length) {
  failed = 1;
  console.error('\n✗ CALLED but defined nowhere — a ReferenceError the moment that line runs:\n');
  missing.forEach(([n, f]) => console.error(`   ${n}()   called in public/${f}`));
  console.error('\n  Either it was deleted by mistake, or the name is wrong. Both are invisible to node --check.\n');
} else {
  console.log(`✓ Call graph — ${called.size} bare calls, every app-shaped name is defined somewhere`);
}

/**
 * ⭐⭐ AND THE OPPOSITE FAILURE — DEFINED TWICE. This guard has always asked "is every name defined
 * somewhere"; it never asked "is any name defined TWICE", and that is a different bug with worse symptoms.
 *
 * ⚠️⚠️ IT COST WEEKS ONCE ALREADY. `networkScreen` and `loadNetwork` were declared in BOTH app.html and
 * app/cap-network.js. The later script wins, so the design-first builder is what ran — but which one wins is a
 * coin toss decided by load order, and nothing failed, nothing warned, and `node --check` is perfectly happy
 * with two declarations of one name in two files. It was found by reading, not by any test, and only after the
 * static guard had been printing it as a WARNING that nobody acted on.
 *
 * ⚠️ THE SYMPTOM IS THE PROBLEM: the dead one is not dead, it is *shadowed* — reachable the instant load order
 * changes, or before the later file loads. Deleting the app.html pair was safe only because the router waits
 * for `_capLoading` to clear; without that it would have been a crash rather than a stale screen.
 *
 * ⚠️ TOP-LEVEL DECLARATIONS ONLY. A nested helper named the same as another file's nested helper is fine —
 * they never share a scope. Only `^function x(` at column zero enters the one global namespace these classic
 * scripts share.
 */
const dupes = [];
for (const [name, files] of byName.entries()) {
  if (files.size > 1) dupes.push([name, [...files]]);
}
if (dupes.length) {
  failed = 1;
  console.error('\n✗ DECLARED IN MORE THAN ONE FILE — the later script silently wins:\n');
  dupes.forEach(([n, fs_]) => console.error(`   ${n}()   ${fs_.join('  →  ')}`));
  console.error('\n  Both are live; which one runs depends on load order. Delete one, and check the router'
    + '\n  cannot reach the name before the surviving file loads.\n');
} else {
  console.log(`✓ No shadowing — no top-level name is declared in two files`);
}

process.exit(failed);

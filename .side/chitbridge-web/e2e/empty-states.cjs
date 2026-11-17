/**
 * e2e/empty-states.cjs — an empty screen is the FIRST screen, so there is one of them.
 *
 * ⚠️⚠️ THE HELPER EXISTED AND 22 SITES BYPASSED IT. helpers.js has had emptyState(icon,title,sub,act) and
 * scrErr(e,subject,retry) for weeks; the app kept hand-rolling `<div class="empty">…` anyway, because writing
 * the markup inline is always slightly easier than finding the function. Nothing forced them together, so they
 * drifted — three spellings of "Couldn't load", two different icons for the same absence, and one site
 * (cap-intake) that wore `class="empty"` while re-specifying every measurement inline, which reads as "uses
 * the shared empty state" to anyone scanning and is not.
 *
 * ⭐ WHAT THE HELPER BUYS IS NOT TIDINESS, IT IS THE ACTION. An empty screen is what a new user and every
 * prospect sees before there is any data. Ours NAMED the next step in prose — "or add a new one", "use Compose
 * to add your first chit" — and then made them go find the button. Naming an action without offering it is the
 * one thing an empty state must never do: it is the only moment where the app knows exactly what the person
 * should do next.
 *
 * ⚠️ THE RULE IS NOT "NEVER WRITE class=empty". Two states legitimately are not empty states, and pretending
 * otherwise would push someone into using the wrong primitive: the capability-loading placeholder in app.html
 * (a wait, not an absence) and the two primitives in helpers.js themselves.
 */
const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'public');

/**
 * ⚠️ EVERY EXEMPTION NAMES ITSELF AND SAYS WHY. An allowlist of file names would let a new hand-rolled state
 * hide inside an already-exempt file; matching on the surrounding text means each exemption covers exactly the
 * one place it was granted for.
 */
const ALLOWED = [
  { file: 'app.html',    contains: '_capLoading ?',   why: 'the capability-loading placeholder — a wait, not an absence' },
  { file: 'helpers.js',  contains: 'function scrErr', why: 'the error primitive itself' },
  { file: 'helpers.js',  contains: 'function emptyState', why: 'the empty-state primitive itself' },
];

const FILES = ['app.html', ...fs.readdirSync(path.join(W, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)];

let fail = 0;
const offenders = [];
let helperUses = 0, errUses = 0, withAction = 0;

for (const rel of FILES) {
  const full = path.join(W, rel);
  const src = fs.readFileSync(full, 'utf8');
  const base = path.basename(rel);
  const lines = src.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.indexOf('class="empty"') < 0) return;
    /* a comment ABOUT the rule is not a breach of it */
    const t = line.trim();
    if (t.indexOf('*') === 0 || t.indexOf('//') === 0 || t.indexOf('/*') === 0) return;
    /* ⚠️ A WINDOW, NOT THE LINE. The primitives' own markup sits INSIDE their function, so matching
       'function scrErr' against the same line exempted nothing and the guard reported its own helpers as
       offenders. Three lines back is enough to see the declaration that grants the exemption, and short
       enough that it cannot reach past the neighbouring function. */
    const around = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    const ok = ALLOWED.some((a) => a.file === base && around.indexOf(a.contains) >= 0);
    if (!ok) offenders.push({ key: rel + '  ' + t.slice(0, 88), show: rel + ':' + (i + 1) + '  ' + t.slice(0, 88) });
  });

  helperUses += (src.match(/emptyState\s*\(/g) || []).length;
  errUses    += (src.match(/scrErr\s*\(/g) || []).length;
  /* an emptyState call whose 4th argument is an object literal is one that OFFERS something */
  withAction += (src.match(/emptyState\s*\([^;]*\{\s*label\s*:/g) || []).length;
}

console.log('\n  emptyState() calls: ' + helperUses + '   scrErr() calls: ' + errUses
  + '   of those, offering an action: ' + withAction + '\n');

/* QA-154: known findings live in e2e/scanner-known.json; only a NEW one fails */
const R = require('./lib/known-findings.cjs').ratchet('empty-states', offenders, { owner: 'ux-locale' });
if (R.known) console.log(R.line + '\n');
if (R.fresh.length) {
  fail++;
  console.error('  ✗ ' + R.fresh.length + ' NEW hand-rolled empty state(s) — use emptyState() or scrErr():\n');
  R.fresh.forEach((o) => console.error('      ' + o.show));
  console.error('\n    emptyState(icon, title, sub, { label, onclick })   — nothing here yet');
  console.error('    scrErr(err, subject, retryCall)                    — it failed to load');
  console.error('    loader(label)                                      — it is still arriving');
}

/**
 * ⚠️ A SECOND CHECK, BECAUSE THE FIRST ONE IS SATISFIED BY A CALL THAT PROMISES NOTHING. Routing every site
 * through the helper and passing no `act` anywhere would pass the offender check and lose the entire point.
 * Not every state can offer an action — a "pick one from the list" prompt has nothing to offer, and neither
 * does an inbox nobody has written to — but if NONE of them do, the helper is being used as a formatter.
 */
if (helperUses > 6 && withAction === 0) {
  fail++;
  console.error('  ✗ ' + helperUses + ' emptyState() calls and not one offers an action.'
    + '\n    The action is the reason the helper exists — see the note above it in helpers.js.');
}

console.log('  ══ ' + (fail ? 'HAND-ROLLED' : 'one empty state, one error state, ' + withAction + ' offering the next step') + ' ══\n');
process.exit(fail ? 1 : 0);

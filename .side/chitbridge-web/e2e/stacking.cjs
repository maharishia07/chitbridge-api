'use strict';
/**
 * stacking.cjs — what is allowed to cover what.
 *
 * ── ⚠️⚠️ THE FAULT THIS EXISTS FOR, 2026-09-12 ───────────────────────────────────────────────────────────────
 *
 * Athi: *"when I click the information icon, the information has gone behind the current screen — it has to be
 * on top."*
 *
 * ⚠️ AND IT WAS NOT THAT ICON. `.mover` is the backdrop for EVERY modal in the app and sat at z-index 280,
 * while the test panel sits at 4000 and another overlay at 1400. So every dialog opened from a floating panel
 * rendered UNDERNEATH the thing that opened it. The modal was there and working; it was invisible.
 *
 * ⚠️⚠️ THE REAL FAULT IS THAT THE NUMBERS WERE NEVER A SCALE. 20, 280, 300, 1400, 4000, 9999 were each picked
 * to beat whatever was on screen that day, so "above" was decided by the order things were BUILT rather than
 * by what they ARE. Raising one number fixes today and guarantees that the next panel picks 5000.
 *
 * ⭐ SO THE ORDER IS DECLARED, AND THIS CHECKS IT. Four bands, and every band is a sentence about intent:
 *
 *     CHROME    < 1000   the app's own furniture: rails, bars, sticky headers
 *     PANELS    < 5000   things that float over the app but do not block it — the test lab, pickers
 *     MODALS    < 9000   blocking: it has the screen's whole attention until it is answered
 *     MESSAGES  ≥ 9000   a message ABOUT the thing in front of you — a toast, a busy overlay
 *
 * ⚠️ IT IS A BAND CHECK, NOT A LINT. It has no opinion about 4000 versus 4200 — only about a panel that has
 * climbed into the modal band, which is the one mistake that actually hurt.
 *
 * Run: node e2e/stacking.cjs
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

/** what each known layer IS — the part a number cannot say */
const DECLARED = {
  '.mover': 'modal',            /* the backdrop behind every modal */
  '#cbtestpanel': 'panel',      /* the test lab */
  '.toast': 'message',
  '.busyov': 'message',
  '#speccalls': 'message',
  /* ⚠ CHROME, not a panel — my first classification called it one and the guard rightly refused it. It is a
     small persistent affordance that belongs with the app's furniture, and it must stay BELOW a modal. The
     guard caught the label being wrong, which is the other thing a declared order is good for. */
  '.composepill': 'chrome',
};
const BAND = { chrome: [0, 999], panel: [1000, 4999], modal: [5000, 8999], message: [9000, 99999] };

const files = [];
['app.html', 'testing.html', 'till.html'].forEach((f) => {
  const p = path.join(PUB, f);
  if (fs.existsSync(p)) files.push(p);
});
fs.readdirSync(path.join(PUB, 'app')).filter((f) => f.endsWith('.js'))
  .forEach((f) => files.push(path.join(PUB, 'app', f)));

let pass = 0, fail = 0;
const found = [];

files.forEach((abs) => {
  const src = fs.readFileSync(abs, 'utf8');
  /* ⚠️ comments out first — this codebase EXPLAINS its z-indexes at length, and prose is not a declaration */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  Object.keys(DECLARED).forEach((sel) => {
    const esc = sel.replace(/[.#]/g, '\\$&');
    const re = new RegExp(esc + '[^{]*\\{[^}]*z-index:\\s*(\\d+)', 'g');
    let m;
    while ((m = re.exec(code))) found.push({ sel, z: Number(m[1]), file: path.basename(abs) });
    /* the inline form: id="cbtestpanel" … z-index:4000 in one style string */
    if (sel.indexOf('#') === 0) {
      const idRe = new RegExp("id=[\"']" + sel.slice(1) + "[\"'][\\s\\S]{0,900}?z-index:(\\d+)", 'g');
      while ((m = idRe.exec(code))) found.push({ sel, z: Number(m[1]), file: path.basename(abs) });
    }
  });
});

console.log('\n— what is allowed to cover what —\n');
const seen = {};
found.forEach((f) => { if (!seen[f.sel] || f.z > seen[f.sel].z) seen[f.sel] = f; });

Object.keys(DECLARED).forEach((sel) => {
  const role = DECLARED[sel];
  const band = BAND[role];
  const hit = seen[sel];
  if (!hit) { console.log('  ?   ' + (sel + '              ').slice(0, 16) + 'not found — check it still exists'); return; }
  const ok = hit.z >= band[0] && hit.z <= band[1];
  if (ok) pass++; else fail++;
  console.log('  ' + (ok ? '✓' : '✗') + '   ' + (sel + '              ').slice(0, 16)
    + (role + '        ').slice(0, 9) + String(hit.z).padStart(5)
    + (ok ? '' : '   ⚠ outside ' + role + ' (' + band[0] + '–' + band[1] + ')  ' + hit.file));
});

/**
 * ⭐ AND THE ONE THAT MATTERS MOST, stated as a relationship rather than a band: whatever the numbers are, a
 * modal must beat every panel. That is the check that would have caught Athi's guide.
 */
const modals = Object.keys(seen).filter((k) => DECLARED[k] === 'modal').map((k) => seen[k].z);
const panels = Object.keys(seen).filter((k) => DECLARED[k] === 'panel').map((k) => seen[k].z);
if (modals.length && panels.length) {
  const ok = Math.min.apply(null, modals) > Math.max.apply(null, panels);
  if (ok) pass++; else fail++;
  console.log('\n  ' + (ok ? '✓' : '✗') + '   every modal sits above every panel   modal '
    + Math.min.apply(null, modals) + ' vs panel ' + Math.max.apply(null, panels));
}

console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
process.exitCode = fail ? 1 : 0;

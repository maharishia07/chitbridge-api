/**
 * e2e/attach-gate.cjs — one place decides whether a file may be attached (M13).
 *
 * ⚠️⚠️ THE RULE WAS WRITTEN THREE TIMES and they had already drifted. `cbAttachStage` and the immediate upload
 * (both in attach-ui.js) refused an empty file; compose's `ccAddFiles` did not. A 0-byte photo picked in
 * compose was accepted, held, sent, and became an attachment row with no bytes behind it.
 *
 * ⭐ THAT IS WORSE THAN A REFUSAL, because it looks like evidence was sent. The chit says a photo is attached;
 * the photo opens to nothing; and the person who attached it has no reason to think anything went wrong.
 *
 * ⭐⭐ THE NUMBER HAD ALREADY BEEN SHARED AND IT WAS NOT ENOUGH. app.html carried a comment celebrating exactly
 * that — the 6 MB cap read from `CBATT.maxBytes` instead of a literal — while the DECISION built around the
 * number stayed local, and the decision is what diverged. **Sharing a constant is not sharing a rule.**
 *
 * ⚠️ AND A FALLBACK WOULD HAVE BEEN A FOURTH COPY. The tempting shape is
 * `typeof cbAttachAccept === 'function' ? cbAttachAccept(f) : f.size <= cap` — which reintroduces the bug for
 * the branch nobody can reach, and looks like defensiveness. attach-ui.js is a plain `<script src>` in
 * app.html, so it is always loaded; this checks that no such branch appears.
 */
const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(W, 'app.html'), 'utf8');
const att = fs.readFileSync(path.join(W, 'app', 'attach-ui.js'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

console.log('\n── the gate exists, and is the only one ──');
t('cbAttachAccept is defined once', (code(att).match(/function cbAttachAccept\s*\(/g) || []).length === 1);

/**
 * ⚠️ COUNT THE RULE, NOT THE CONSTANT. `CBATT.maxBytes` is READ in several honest places (a hint line, a
 * label); what must not recur is a size COMPARISON that decides acceptance, because that is the decision the
 * gate owns.
 */
const comparisons = [...code(att).matchAll(/\.size\s*>\s*[A-Za-z_.]*maxBytes|\.size\s*>\s*cap\b/g)].length
  + [...code(html).matchAll(/\.size\s*>\s*[A-Za-z_.]*maxBytes|\.size\s*>\s*cap\b/g)].length;
t('  …and the size decision is made in exactly one place', comparisons === 1, comparisons + ' comparison(s)');

/* the empty-file half is the one that had actually gone missing */
const emptyChecks = [...code(att).matchAll(/if\s*\(\s*!\s*file\.size\s*\)/g)].length
  + [...code(html).matchAll(/if\s*\(\s*!\s*f(ile)?\.size\s*\)/g)].length;
t('  …and so is the empty-file decision', emptyChecks === 1, emptyChecks + ' check(s)');

console.log('\n── every path asks it ──');
t('the staging path asks', /cbAttachStage[\s\S]{0,600}?cbAttachAccept\(/.test(code(att)));
t('compose asks', /function ccAddFiles[\s\S]{0,320}?cbAttachAccept\(/.test(code(html)));
/**
 * ⚠️ THE DEFINITION IS NOT A CALL SITE, and the first version of this line counted it as one — reporting four
 * callers where there are three, and failing a correct codebase. `function cbAttachAccept(` matches
 * `cbAttachAccept\(` just as happily as an invocation does.
 *
 * ⭐ A GUARD THAT MISCOUNTS IN THE STRICT DIRECTION IS STILL WRONG. It fails loudly rather than silently, which
 * is better, but the next person's move is to relax the number until it passes — and then it is measuring
 * nothing.
 */
const callsIn = (s) => (s.match(/(^|[^\w.])cbAttachAccept\(/gm) || [])
  .length - (s.match(/function\s+cbAttachAccept\(/g) || []).length;
const uses = callsIn(code(att)) + callsIn(code(html));
t('  …all three callers, and no more', uses === 3, uses + ' call site(s)');

/**
 * ⚠️ THE FALLBACK IS THE FOURTH COPY IN DISGUISE. If someone later guards the call with `typeof … === 'function'`
 * and supplies their own comparison behind it, the rule is duplicated again for a branch that cannot execute.
 */
console.log('\n── and nobody keeps a private copy "just in case" ──');
t('no typeof-guarded fallback around the gate',
  !/typeof\s+cbAttachAccept\s*[!=]==?\s*['"]function['"]/.test(code(html) + code(att)));

/**
 * ⭐ THE CAP ITSELF STILL COMES FROM ONE PLACE — that was the earlier half of this fix and it must not regress
 * to a literal, which is how the three-copy problem started.
 */
t('the cap is not re-literalised in compose',
  !/6\s*\*\s*1024\s*\*\s*1024/.test(code(html).slice(code(html).indexOf('function ccAddFiles'),
    code(html).indexOf('function ccAddFiles') + 400)));

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);

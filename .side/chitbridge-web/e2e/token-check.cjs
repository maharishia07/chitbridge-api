/**
 * token-check.cjs — every `var(--x)` must resolve to something.
 *
 * ⚠️ AN UNDEFINED TOKEN IS INVISIBLE TEXT, not a wrong colour. `color: var(--nope)` with no fallback makes the
 * declaration invalid, so the property falls back to INHERITED — which on a themed card is very often the same
 * colour as the ground. The text does not go grey; it goes away. And nothing throws, nothing logs, and the
 * contrast tool cannot see it, because it measures tokens that exist.
 *
 * ⚠️ A FALLBACK MAKES IT LEGAL: `var(--maybe, #333)` is fine by design and is how a theme-optional token is
 * meant to be written. So this only reports BARE uses of a token nothing defines.
 *
 * Run: node e2e/token-check.cjs        (exit 1 if any bare use of an undefined token exists)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const app = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)
);

/* Everything :root or a theme defines. ⚠️ Themes are read too — a token that only exists inside one theme is
   still "defined", but it is a different (and reportable) risk: it resolves to nothing in the other fourteen. */
const defined = new Set();
{
  const css = app.slice(0, app.indexOf('</style>'));
  let m; const re = /(--[a-z0-9-]+)\s*:/gi;
  while ((m = re.exec(css))) defined.add(m[1]);
  /* the themes are the engine's now (screen v1.15.0 APP_THEMES), no longer a literal in app.html */
  {
    const themes = fs.readFileSync(path.join(WEB, 'engine', 'screen.js'), 'utf8');
    let mm; const r2 = /'(--[a-z0-9-]+)'\s*:/g;
    while ((mm = r2.exec(themes))) defined.add(mm[1]);
  }
  /* Tokens written at runtime by the appearance module (the --fs scale) count as defined. */
  const fsb = /var FS_BASE = \{([^}]*)\}/.exec(fs.readFileSync(path.join(WEB, 'app', 'avatar.js'), 'utf8'));   /* FS_BASE moved to CBAvatar */
  if (fsb) { let mm; const r3 = /'(--[a-z0-9-]+)'/g; while ((mm = r3.exec(fsb[1]))) defined.add(mm[1]); }
}

/**
 * ⚠️ A TOKEN CAN BE DEFINED SOMEWHERE THIS TOOL DOES NOT LOOK, and my first run reported four false positives
 * for exactly that reason. Three are declared inside stylesheets a capability INJECTS at runtime
 * (`':root{--note:#5a7290}'` as a string in cap-catsetup.js), and one is set on a parent ELEMENT
 * (`style="--coltpl:${colTemplate()}"`) so its children inherit it. Both are correct CSS and neither appears
 * in app.html's <style>.
 *
 * A checker that reports correct code as broken is one people learn to ignore — and then it misses the real
 * one. So every file is scanned for a definition in any position, not just the main stylesheet.
 */
FILES.forEach((f) => {
  const src = fs.readFileSync(path.join(WEB, f), 'utf8');
  let m; const re = /(--[a-z0-9-]+)\s*:/g;
  while ((m = re.exec(src))) {
    /* Skip `var(--x)` itself — the colon there belongs to a fallback, not a definition. */
    const before = src.slice(Math.max(0, m.index - 5), m.index);
    if (/var\(\s*$/.test(before)) continue;
    defined.add(m[1]);
  }
});

const bare = {};      // token -> [file:line]
FILES.forEach((f) => {
  const src = fs.readFileSync(path.join(WEB, f), 'utf8');
  const re = /var\(\s*(--[a-z0-9-]+)\s*([,)])/g;
  let m;
  while ((m = re.exec(src))) {
    const tok = m[1], hasFallback = m[2] === ',';
    if (defined.has(tok) || hasFallback) continue;
    const line = src.slice(0, m.index).split('\n').length;
    (bare[tok] = bare[tok] || []).push(f + ':' + line);
  }
});

/**
 * ── ⭐⭐ THE STANDALONE PAGES GET THEIR OWN PASS ───────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ THIS GUARD MISSED A REAL FAULT AND I WROTE THE FAULT. testing.html is not part of the app: it carries
 * its OWN :root palette, so it was in neither list — not in FILES (which is app.html + app/*.js) and not in
 * the definition scan. I then wrote a new section of the Report in the APP's vocabulary (--disp, --ok-2,
 * --warn-2), three tokens that page had never defined, and every guard in the chain passed.
 *
 * ⚠️ An undefined custom property is invalid at computed-value time and says NOTHING: a `color` silently
 * falls back to inherited, and an SVG `fill` falls back to BLACK. This page has already been bitten once —
 * see the note at its chart palette, where --flat painted the largest slice of every chart black.
 *
 * ⭐ So each standalone page is checked against ITS OWN :root, in the same shape as the app pass above.
 * [[feedback-silence-is-the-bug]]
 */
/**
 * ⚠️ A TOKEN NAMED INSIDE A COMMENT IS NOT A REFERENCE — and this bit immediately. The very first run
 * reported `--flat` at testing.html, which is not a use at all: it is the note recording that --flat was
 * REMOVED because, being undefined, it painted the largest slice of every chart black. A guard that fails on
 * the comment describing an old fix teaches people to delete the comment.
 * ⭐ Comment BODIES are blanked, not stripped, so every byte offset — and therefore every reported line
 * number — stays exactly where it was.
 */
const maskComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

const SOLO = ['testing.html'];
SOLO.forEach((f) => {
  const raw = fs.readFileSync(path.join(WEB, f), 'utf8');
  const src = maskComments(raw);
  const css = src.slice(0, src.indexOf('</style>'));
  const own = new Set();
  let d; const dre = /(--[a-z0-9-]+)\s*:/gi;
  while ((d = dre.exec(css))) {
    const before = css.slice(Math.max(0, d.index - 5), d.index);
    if (/var\(\s*$/.test(before)) continue;   /* a fallback inside var(), not a definition */
    own.add(d[1]);
  }
  const re = /var\(\s*(--[a-z0-9-]+)\s*([,)])/g;
  let m;
  while ((m = re.exec(src))) {
    const tok = m[1], hasFallback = m[2] === ',';
    if (own.has(tok) || hasFallback) continue;
    /* ⚠ only real uses: a token named inside a comment is not a reference */
    const line = src.slice(0, m.index).split('\n').length;
    (bare[tok] = bare[tok] || []).push(f + ':' + line);
  }
});

/* QA-154: each (token, file) use is a finding; the known ones are in e2e/scanner-known.json and only a NEW one fails */
const items = [];
Object.keys(bare).forEach((t) => bare[t].forEach((w) => items.push({ key: t + '  ' + w.split(':')[0], show: t + '  ' + w })));
const RK = require('./lib/known-findings.cjs').ratchet('token-check', items, { owner: 'ux-locale' });
const names = [...new Set(RK.fresh.map((i) => i.show.split('  ')[0]))];
console.log('\n══ TOKEN CHECK ══');
console.log('  ' + defined.size + ' tokens defined · ' + Object.keys(bare).length + ' referenced bare and never defined (' + RK.fresh.length + ' new)');
console.log('  scanned: ' + FILES.length + ' app file(s) + ' + SOLO.length + ' standalone page(s)');
console.log(RK.line + '\n');
RK.fresh.forEach((i) => console.log('  ✗ NEW  ' + i.show));
if (!RK.fresh.length) console.log('  ✓ no new bare var(--x) without a defined token');
console.log('');
process.exit(RK.fresh.length ? 1 : 0);

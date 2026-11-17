/**
 * lab-thin.cjs — A LAB IS A THIN PAGE OVER THE REAL ENGINES (T2-LABS, 2026-10-14). Offline: no browser, no server.
 *
 * Athi: "our labs should not use a separate piece of code". The IP/labs audit found ~5,700 duplicated lines in two labs: the
 * Combo Lab was a whole copy of the Offer Lab, and the Offer Lab held the only offer-clash check and its own offer maths.
 * Both are gone (CBOffers.covers · clashes · compound, engines v1.46.0; the Combo Lab is offer-lab-next.html?mode=combo).
 * This keeps them gone. Three counts, each a RATCHET — it may only go down:
 *
 *   1 · NAMES  a lab's own top-level function whose NAME an engine publishes (a member of the CB… object public/engine/*.js
 *              hands out) or a production module declares (app.html · public/app/*.js, column 0 — the rule dup-functions uses).
 *              A lab that defines `clash` or `combo` is computing what the engine computes; one that defines `esc` or `go`
 *              shadows the app's. Code is read through the KG1 lexer (tools/graph/scan.cjs), so a name in a comment or a string
 *              never counts. Target ZERO for the labs this round made thin; the others hold today's number.
 *   2 · COPIES lines (trimmed, 12+ characters) a lab file carries that another lab file also carries — the copy-a-page smell.
 *   3 · ONE WINDOW  a lab page and the public/lab/*.js modules it loads declare no top-level function twice (dup-functions'
 *              hazard: the second silently replaces the first).
 *
 * Run: node e2e/lab-thin.cjs            exit 1 when a count rose above its ratchet
 *      node e2e/lab-thin.cjs --list     every name hit and the copy count per file
 *      node e2e/lab-thin.cjs --root DIR measure another checkout's public/ (the before number)
 */
'use strict';
const fs = require('fs'), path = require('path');
const { lex } = require('../tools/graph/scan.cjs');

const argRoot = process.argv.indexOf('--root');
const ROOT = argRoot > 0 ? path.resolve(process.argv[argRoot + 1]) : path.join(__dirname, '..', 'public');
const LIST = process.argv.includes('--list');

/* ⭐ THE RATCHET — measured 2026-10-14. Before this round (main): NAMES 17 · COPIES 3,528; after: 11 · 201. Lower a number when it goes down; never raise one. */
const NAMES_MAX = { 'offer-lab-next.html': 0, 'signin-lab.html': 0, 'combo-lab.html': 0, 'lab/combo-mode.js': 0,
  'conversion-lab.html': 2, 'country-lab.html': 0, 'product-lab.html': 1 };   /* lowered at INT6b (WEBPRIMS took the private esc/money copies) */   /* a lab not listed: 0 */
const COPIES_MAX = 493; /* ITER1 (MNT-4, Athi's one-time re-baseline of formatting-driven ratchets): Prettier puts one statement per line, so more ≥12-character lines are equal across the labs (184 → 517 with no logic copied). It may only go down from here. */
const COPIES_MAX_BEFORE_ITER1 = 184;   /* INT6b: 201 → 184 once a load-only <script src> line stopped counting as a copy */

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
/** column-0 function declarations in JS code, comments and strings blanked by the KG1 lexer */
const declsIn = (js) => lex(js).code.split('\n').map((l) => (DECL.exec(l) || [])[1]).filter(Boolean);
/** an HTML page: only its inline scripts (src= tags load other files, measured on their own) */
function scriptsOf(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc\s*=/.test(m[1])) out.push(m[2]);
  return out.join('\n');
}
const declsOf = (f) => declsIn(f.endsWith('.html') ? scriptsOf(read(f)) : read(f));

const labs = fs.readdirSync(ROOT).filter((f) => /lab.*\.html$/.test(f))
  .concat(fs.existsSync(path.join(ROOT, 'lab')) ? fs.readdirSync(path.join(ROOT, 'lab')).filter((f) => /\.js$/.test(f)).map((f) => 'lab/' + f) : []);
const labFilesForCopies = labs.concat(fs.existsSync(path.join(ROOT, 'lab')) ? fs.readdirSync(path.join(ROOT, 'lab')).filter((f) => /\.css$/.test(f)).map((f) => 'lab/' + f) : []);

/* what production and the engines define */
const owner = new Map();
for (const f of ['app.html'].concat(fs.readdirSync(path.join(ROOT, 'app')).filter((x) => x.endsWith('.js')).map((x) => 'app/' + x))) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  for (const n of declsOf(f)) if (!owner.has(n)) owner.set(n, f);
}
for (const f of fs.readdirSync(path.join(ROOT, 'engine')).filter((x) => x.endsWith('.js'))) {
  const code = lex(read('engine/' + f)).code;
  /* the published object: root.CBX = { name: …, … } — and CBX.name = function … */
  for (const m of code.matchAll(/\broot\.(CB\w+)\s*=\s*\{([\s\S]*?)\}\s*;/g)) for (const k of m[2].matchAll(/(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:/g)) if (!owner.has(k[1])) owner.set(k[1], 'engine/' + f + ' (' + m[1] + ')');
  for (const m of code.matchAll(/\b(CB\w+)\.([A-Za-z_$][\w$]*)\s*=\s*function\b/g)) if (!owner.has(m[2])) owner.set(m[2], 'engine/' + f + ' (' + m[1] + ')');
}

let bad = 0, namesTotal = 0;
const say = (ok, m) => { if (!ok) bad++; console.log((ok ? '  ok  ' : '  XX  ') + m); };
console.log('\n── 1 · NAMES: a lab defines nothing the engine or a production module defines ──');
for (const f of labs) {
  const hits = [...new Set(declsOf(f))].filter((n) => owner.has(n));
  namesTotal += hits.length;
  const max = NAMES_MAX[f] || 0;
  if (hits.length || LIST) say(hits.length <= max, f + ': ' + hits.length + ' (ratchet ' + max + ')' + (hits.length ? ' — ' + hits.map((n) => n + ' ← ' + owner.get(n)).join(' · ') : ''));
  if (hits.length < max) console.log('  ..  ' + f + ' went DOWN to ' + hits.length + ' — lower NAMES_MAX in this file');
}
say(true, 'names across the labs: ' + namesTotal);

console.log('\n── 2 · COPIES: lines one lab file carries that another lab file also carries ──');
const L = {}, sets = {};
/* INT6b: a line that only LOADS a shared file (`<script src="/app/helpers.js"></script>  <!-- … -->`) is the reuse this check asks for, not a
   copy — T2-WEBPRIMS put the one helpers.js load into every lab and the count rose 201 → 206 with no logic copied */
/* SHELL-ONE: a line that is only an HTML comment (the frame's one-line note above the frame's loads) is prose, not logic */
/* UX-90: a stylesheet LOAD (<link rel="stylesheet" href="/app/…">) is the same reuse as a script load */
const LOAD_ONLY = /^<script\s+src="[^"]+"\s*><\/script>\s*(<!--.*-->)?$|^<link\s+rel="stylesheet"\s+href="[^"]+">\s*(<!--.*-->)?$|^<!--.*-->$/;
for (const f of labFilesForCopies) { L[f] = read(f).split('\n').map((s) => s.trim()).filter((s) => s.length >= 12 && !LOAD_ONLY.test(s)); sets[f] = new Set(L[f]); }
let copies = 0; const per = {};
for (const f of labFilesForCopies) { per[f] = L[f].filter((l) => labFilesForCopies.some((g) => g !== f && sets[g].has(l))).length; copies += per[f]; }
if (LIST) Object.keys(per).forEach((f) => console.log('        ' + f + ': ' + per[f]));
say(copies <= COPIES_MAX, 'copied lines across the labs: ' + copies + ' (ratchet ' + COPIES_MAX + ')');
if (copies < COPIES_MAX) console.log('  ..  went DOWN — lower COPIES_MAX in this file');

console.log('\n── 3 · ONE WINDOW: a lab page and its lab modules declare nothing twice ──');
for (const f of labs.filter((x) => x.endsWith('.html'))) {
  const mods = [...read(f).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']\/?(lab\/[^"']+\.js)["']/gi)].map((m) => m[1]).filter((m) => fs.existsSync(path.join(ROOT, m)));
  if (!mods.length) continue;
  const seen = new Map(), dup = [];
  for (const src of [f].concat(mods)) for (const n of declsOf(src)) { if (seen.has(n) && seen.get(n) !== src) dup.push(n + ' (' + seen.get(n) + ' and ' + src + ')'); else if (seen.has(n)) dup.push(n + ' (twice in ' + src + ')'); seen.set(n, src); }
  say(!dup.length, f + ' + ' + mods.join(', ') + ': ' + (dup.length ? 'declared twice — ' + dup.join(' · ') : 'no name twice'));
}

console.log('\nlab-thin: ' + (bad ? bad + ' check(s) over the ratchet' : 'clean') + ' · names ' + namesTotal + ' · copies ' + copies);
process.exit(bad ? 1 : 0);

/* tests/font-faces-guard.test.cjs: a named web font must be one the product LOADS (Athi, 15 Nov walk: "letters look scattered"; computed font-family said IBM Plex, document.fonts held none, so the system font showed).
 * Rules (one way): (1) every quoted family named in a font-family / font: / --f-* / --font-* value under index.html + public/ is self-hosted (an @font-face in public/fonts/cb-fonts.css),
 * or a web font a page loads on purpose through its own Google link (ALLOW_LINKED below), or a system face (SYSTEM below);
 * (2) no page links Google for a self-hosted family; (3) a page that names a self-hosted family links /fonts/cb-fonts.css, or loads shell.js (addFonts adds it); (4) every @font-face file exists, the licence ships, a preload names a file that exists.
 * Runs in `npm run check` (check:fonts). Node only, no browser. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const SYSTEM = new Set(['consolas', 'courier new', 'segoe ui', 'helvetica neue', 'helvetica', 'arial', 'menlo', 'sfmono-regular', 'sf mono', 'roboto', 'blinkmacsystemfont', 'georgia', 'times new roman', 'noto sans', 'noto sans devanagari', 'noto sans tamil', 'dejavu sans mono', 'cascadia mono']);
const ALLOW_LINKED = new Set(['space grotesk', 'inter', 'space mono', 'noto serif tamil', 'ibm plex sans condensed']);
const SKIP_DIR = /^(vendor|docs|guides|node_modules|illustrations|pics|data|fonts)$/;
const relOf = (f) => path.relative(ROOT, f).split(path.sep).join('/');
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(path.join(dir, e.name), out); }
    else if (/\.(html|css|js)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
const sheet = fs.readFileSync(path.join(PUB, 'fonts', 'cb-fonts.css'), 'utf8');
const hosted = new Set([...sheet.matchAll(/font-family:'([^']+)'/g)].map((m) => m[1].toLowerCase()));
assert.ok(hosted.has('ibm plex sans') && hosted.has('ibm plex mono'), 'the shared sheet provides Plex');
for (const m of sheet.matchAll(/url\(([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(PUB, 'fonts', m[1])), 'font file missing: ' + m[1]);
assert.ok(fs.existsSync(path.join(PUB, 'fonts', 'OFL.txt')), 'the licence file ships with the fonts');

const files = [path.join(ROOT, 'index.html'), ...walk(PUB, [])];
const problems = [];
const namedBy = {}; /* file -> set of hosted families it names */
const QUOTED = /[\\]?'([A-Za-z][A-Za-z0-9 -]+)[\\]?'/g;
for (const f of files) {
  const rel = relOf(f), src = fs.readFileSync(f, 'utf8');
  const loaded = new Set();
  for (const m of src.matchAll(/fonts\.googleapis\.com\/css2\?([^"'>\s]+)/g)) for (const fm of m[1].matchAll(/family=([^:&]+)/g)) loaded.add(decodeURIComponent(fm[1].replace(/\+/g, ' ')).toLowerCase());
  for (const l of loaded) if (hosted.has(l)) problems.push(rel + ': Google link for the self-hosted "' + l + '" (use /fonts/cb-fonts.css)');
  const decl = f.endsWith('.js') ? /font-family\s*:\s*([^;}\n"<>]*)/g : f.endsWith('.css') ? /(?:font-family|font|--f-[a-z]+|--font-[a-z]+)\s*:\s*([^;}\n"<>]*)/g : /(?:font-family|--f-[a-z]+|--font-[a-z]+|font(?=\s*:\s*[0-9]))\s*:\s*([^;}\n"<>]*)/g;/* html: bare "font:" only as the shorthand (starts with a size) */
  for (const d of src.matchAll(decl)) {
    for (const m of d[1].matchAll(QUOTED)) {
      const name = m[1].toLowerCase();
      if (hosted.has(name)) { (namedBy[rel] = namedBy[rel] || new Set()).add(name); }
      else if (!SYSTEM.has(name) && !ALLOW_LINKED.has(name)) problems.push(rel + ': names "' + m[1] + '" but nothing loads it');
    }
  }
}
/* (3) per page: names a hosted family (itself or through a linked app css) -> links the sheet or loads the shell */
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const rel = relOf(f), src = fs.readFileSync(f, 'utf8');
  let names = !!namedBy[rel];
  for (const m of src.matchAll(/href="\/?(app\/[^"]+\.css)"/g)) if (namedBy['public/' + m[1]]) names = true;
  if (names && !(src.includes('/fonts/cb-fonts.css') || /app\/(shell|accounts-shell)\.js/.test(src))) problems.push(rel + ': names a Plex/Bricolage face but links no /fonts/cb-fonts.css');
  for (const m of src.matchAll(/rel="preload" href="\/fonts\/([^"]+)"/g)) if (!fs.existsSync(path.join(PUB, 'fonts', m[1]))) problems.push(rel + ': preload of a missing file ' + m[1]);
}
if (problems.length) { console.error('font-faces-guard FAIL:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('font-faces-guard ok: ' + files.length + ' files, ' + hosted.size + ' hosted families (' + [...hosted].join(', ') + ')');

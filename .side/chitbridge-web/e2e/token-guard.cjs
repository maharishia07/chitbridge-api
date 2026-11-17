/**
 * token-guard.cjs — NO NEW RAW COLOUR. A colour written as a literal is a colour the theme cannot reach.
 *
 * Athi, 2026-10-03: "if the avatar controls the colour, why does the drift happen?" Because a page that paints #fff, or reads a PRIVATE name
 * the avatar never sets, is invisible to the theme — and nothing counted it. crm-themes.cjs MEASURES what is on screen (a browser, Playwright);
 * this is the cheap half that runs anywhere (CI included): it counts the literals in the SOURCE and lets the count only go DOWN.
 *
 * WHAT COUNTS as a raw colour: #hex (3/4/6/8 digits), rgb()/rgba()/hsl()/hsla(), and a named colour (white, black, red …) after a colour property —
 * in every public/*.html, every public/app/*.js, every public/lab/*.js|css and the root index.html (CSS blocks, inline style strings, injected CSS, template strings).
 * WHAT DOES NOT (these ARE the theming):
 *   · a token DEFINITION      --name: #hex      (:root, [data-themed], [data-theme] blocks, and '--name': '#hex' theme data in JS)
 *   · a var() FALLBACK        var(--x, #hex)    (the value used when the token is not defined — the page's original)
 *   · a comment
 *
 * HOW IT GATES: e2e/token-guard.baseline.json holds the count per file. A file may have FEWER than its baseline (then lower the baseline:
 * `node e2e/token-guard.cjs --write`), never MORE; a file not in the baseline has a baseline of 0. A failure prints file:line of the hits in
 * the file that went up, so the new literal is the one you fix: move it into a token (a name in :root, re-pointed under [data-themed]).
 *
 * Run: node e2e/token-guard.cjs            exit 1 when any file has more raw colours than its baseline
 *      node e2e/token-guard.cjs --write    rewrite the baseline to today's counts (only ever do this after a count went DOWN)
 *      node e2e/token-guard.cjs --list     print every hit
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = process.env.TG_ROOT || path.join(__dirname, '..');
const BASE = path.join(__dirname, 'token-guard.baseline.json');
const FILES = [path.join(ROOT, 'index.html')]
  .concat(fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'public', f)))
  .concat(fs.readdirSync(path.join(ROOT, 'public', 'app')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'public', 'app', f)))
  /* T2-LABS: a lab's own module (public/lab/*.js · *.css — the Combo Lab moved there) is a page's code too; moving a colour must not hide it */
  .concat(fs.existsSync(path.join(ROOT, 'public', 'lab')) ? fs.readdirSync(path.join(ROOT, 'public', 'lab')).filter((f) => /\.(js|css)$/.test(f)).map((f) => path.join(ROOT, 'public', 'lab', f)) : []);

const NAMED = 'white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|navy|teal|silver|gold|maroon|lime|aqua|cyan|magenta|ivory|beige';
const PROP = '(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|color|inline|block)[a-z-]*)?|fill|stroke|outline(?:-color)?|box-shadow|text-shadow|caret-color|accent-color)';
/* blank a match but keep its newlines, so line numbers survive */
const blank = (m) => m.replace(/[^\n]/g, ' ');

function clean(src, isHtml) {
  let s = src;
  const blocks = (t) => t.replace(/\/\*[\s\S]*?\*\//g, blank);                  /* CSS and JS block comments */
  if (isHtml) {   /* HTML comments first (they may say "/api/crm/*"), then block comments only INSIDE <style> and <script> */
    s = s.replace(/<!--[\s\S]*?-->/g, blank);
    s = s.replace(/(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (m, o, t, body, c) => o + blocks(body) + c);
  } else s = blocks(s);
  s = s.replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, a) => a + blank(m.slice(a.length)));   /* line comments (not a URL's //) */
  s = s.replace(/--[\w-]+\s*:\s*[^;}\n'"]*/g, blank);                           /* a token definition: --name: value */
  s = s.replace(/['"]--[\w-]+['"]\s*:\s*['"][^'"]*['"]/g, blank);              /* theme data: '--paper':'#14181D' */
  s = s.replace(/var\(\s*--[\w-]+\s*,[^()]*(?:\([^()]*\)[^()]*)*\)/g, blank);   /* var(--x, fallback) */
  return s;
}
function hits(file) {
  const src = fs.readFileSync(file, 'utf8'), s = clean(src, file.endsWith('.html')), out = [];
  const lines = s.split('\n');
  const re = [/(^|[^\w&#"'=\/\\-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g, /\b(?:rgba?|hsla?)\(\s*[\d.]/g, new RegExp('\\b' + PROP + '\\s*:\\s*[^;"\'}\\n]*?(?<![-\\w])(?:' + NAMED + ')(?![-\\w(])', 'gi')];
  lines.forEach((ln, i) => { re.forEach((r) => { r.lastIndex = 0; let m; while ((m = r.exec(ln))) out.push({ line: i + 1, text: ln.trim().slice(0, 110) }); }); });
  return out;
}

const mode = process.argv[2] || '';
if (mode === '--clean') { process.stdout.write(clean(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'), process.argv[3].endsWith('.html'))); process.exit(0); }
const now = {}, all = {};
FILES.forEach((f) => { const h = hits(f); const rel = path.relative(ROOT, f).replace(/\\/g, '/'); if (h.length) { now[rel] = h.length; all[rel] = h; } });
const total = Object.values(now).reduce((a, b) => a + b, 0);

if (mode === '--write') {
  fs.writeFileSync(BASE, JSON.stringify(Object.keys(now).sort().reduce((o, k) => { o[k] = now[k]; return o; }, {}), null, 1) + '\n');
  console.log('token-guard: baseline written — ' + total + ' raw colours in ' + Object.keys(now).length + ' files');
  process.exit(0);
}
if (mode === '--list') { Object.keys(all).forEach((f) => all[f].forEach((h) => console.log(f + ':' + h.line + '  ' + h.text))); process.exit(0); }

const base = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {};
const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
let bad = 0;
Object.keys(now).forEach((f) => {
  const b = base[f] || 0;
  if (now[f] > b) {
    bad++; console.log('  XX  ' + f + ': ' + now[f] + ' raw colours, baseline ' + b + ' — +' + (now[f] - b) + ' new. Put the colour in a token (:root, re-pointed under [data-themed]). Hits:');
    all[f].slice(-Math.min(12, now[f] - b + 4)).forEach((h) => console.log('        ' + f + ':' + h.line + '  ' + h.text));
  }
});
const lower = Object.keys(base).filter((f) => (now[f] || 0) < base[f]);
if (lower.length) console.log('  ..  ' + lower.length + ' file(s) went DOWN — lower the baseline: node e2e/token-guard.cjs --write (' + lower.map((f) => f + ' ' + base[f] + '→' + (now[f] || 0)).join(', ') + ')');
console.log((bad ? '  XX  ' : '  ok  ') + 'no new raw colour: ' + total + ' in ' + Object.keys(now).length + ' files (baseline ' + baseTotal + ')');
console.log('\ntoken-guard: ' + (bad ? bad + ' file(s) over baseline' : 'clean'));
process.exit(bad ? 1 : 0);

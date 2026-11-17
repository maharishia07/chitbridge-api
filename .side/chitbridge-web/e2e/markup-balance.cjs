#!/usr/bin/env node
/**
 * ── ⚠️⚠️ UNBALANCED MARKUP IN A SCREEN BUILDER ────────────────────────────────────────────────────────────────
 *
 * 2026-09-14. The Platform screen opened a second flex `<div>` for its filter row and never closed the first.
 * innerHTML does not complain — the HTML parser simply keeps nesting — so `.detail` ended up INSIDE `.list`,
 * 7,455px down the page with zero height. The report, the entity card and the new scope table all rendered
 * correctly into a box nobody could see, and the only symptom was a blank half-screen in a screenshot.
 *
 * ⭐ A SCREEN BUILDER RETURNS A WHOLE PANEL, so its `<div>`s must balance inside the one function. That is the
 * narrow, checkable claim — helpers that emit half a tag are common and legitimate, screens are not.
 *
 * It counts `<div` against `</div>` in every `function …Screen(){ … }` in the page files. Void tags, other
 * elements and attribute soup are irrelevant: nesting is what breaks a two-pane layout, and `div` is what the
 * panes are made of.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const FILES = [path.join(ROOT, 'app.html'), ...fs.readdirSync(path.join(ROOT, 'app'))
  .filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'app', f))];

/* ⚠️ a brace-counting reader, not a regex: a screen builder is 60 lines of nested template soup and
   /function(.*?)}/s would stop at the first `}` inside it. Strings and comments are blanked first so a
   `}` inside 'style="…}"' or a `//` line cannot close the function early. */
function blank(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const n = e < 0 ? src.length : e; out += ' '.repeat(n - i); i = n; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const n = e < 0 ? src.length : e + 2; out += src.slice(i, n).replace(/[^\n]/g, ' '); i = n; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      /* ⭐ keep the string CONTENT — the tags we are counting live inside it — but neutralise its braces */
      out += src.slice(i, j + 1).replace(/[{}]/g, ' ');
      i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

function bodies(src) {
  const safe = blank(src), found = [];
  const re = /function\s+([A-Za-z0-9_$]*Screen)\s*\(/g;
  let m;
  while ((m = re.exec(safe))) {
    let i = safe.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0, j = i;
    for (; j < safe.length; j++) {
      if (safe[j] === '{') depth++;
      else if (safe[j] === '}' && --depth === 0) break;
    }
    found.push({ name: m[1], body: safe.slice(i, j + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return found;
}

let checks = 0, fails = 0, screens = 0;
console.log('\n══ MARKUP BALANCE IN SCREEN BUILDERS ══\n');

for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  for (const s of bodies(src)) {
    screens++; checks++;
    const open = (s.body.match(/<div\b/g) || []).length;
    const close = (s.body.match(/<\/div>/g) || []).length;
    if (open !== close) {
      fails++;
      console.log('  ✗ ' + s.name + '  (' + path.basename(f) + ':' + s.line + ')  '
        + open + ' <div> vs ' + close + ' </div>  — ' + (open > close ? (open - close) + ' never closed' : (close - open) + ' closed twice'));
      console.log('       a pane will nest inside its sibling and disappear; count the tags in the strip you last touched');
    }
  }
}

console.log(fails
  ? '\n✗ ' + fails + ' of ' + screens + ' screen builder(s) emit unbalanced <div>\n'
  : '  ✓ all ' + screens + ' screen builders balance their <div> tags\n');
process.exit(fails ? 1 : 0);

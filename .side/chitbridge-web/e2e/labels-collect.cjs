/**
 * labels-collect.cjs — every string now reachable by tx(), written out as the translator's worklist.
 *
 * This is the file a translator is handed. It contains LABELS ONLY: l3-wrap refuses sentences, so nothing here
 * is copy that might be deleted in the trim Athi described on 2026-08-19.
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const files = [path.join(PUB, 'app.html')];
for (const f of fs.readdirSync(path.join(PUB, 'app'))) {
  if (/\.js$/.test(f) && !/\.min\./.test(f)) files.push(path.join(PUB, 'app', f));
}

const RE = /\btx\('((?:[^'\\]|\\.)*)'\)/g;
const all = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(s))) {
    const k = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    all.set(k, (all.get(k) || 0) + 1);
  }
}

const keys = [...all.keys()].sort((a, b) => a.localeCompare(b));
console.log('\n  distinct labels reachable by tx() : ' + keys.length);
console.log('  total call sites                  : ' + [...all.values()].reduce((a, b) => a + b, 0));

const outPath = path.join(__dirname, 'labels.todo.json');
fs.writeFileSync(outPath, JSON.stringify(keys, null, 1));
console.log('  written -> e2e/labels.todo.json\n');

if (process.argv.includes('--list')) keys.forEach((k, i) => console.log('  ' + String(i + 1).padStart(4) + '  ' + k));

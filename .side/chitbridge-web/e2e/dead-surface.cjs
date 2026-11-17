/**
 * dead-surface.cjs — find top-level functions nothing calls.
 *
 * ⚠️ THE HARD PART IS NOT FINDING THEM, IT IS NOT LYING ABOUT THEM. In this codebase a function can be reached
 * four ways that a naive "is the name mentioned elsewhere" scan gets wrong in both directions:
 *
 *   · from an inline `onclick="foo()"` inside a STRING, which is the app's main event mechanism
 *   · from another lazily-loaded capability that this file never imports
 *   · by being ASSIGNED to a global (`window.foo = foo`) and called from a test or the console
 *   · by being the LAST of two same-named definitions, where the earlier one is the dead one
 *
 * So this reports CANDIDATES with their evidence, never a delete list. Anything it prints still has to be read
 * before it is removed — a false positive here deletes a working button, and the person who finds out is a user.
 *
 * Run: node e2e/dead-surface.cjs [--verbose]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f)
);

const sources = {};
FILES.forEach((f) => { sources[f] = fs.readFileSync(path.join(WEB, f), 'utf8'); });

/** Every top-level function declaration, with where it was declared. */
const declared = [];
FILES.forEach((f) => {
  const src = sources[f];
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    declared.push({ name: m[1], file: f, line: src.slice(0, m.index).split('\n').length });
  }
});

/* Names declared more than once — the earlier definition is shadowed at runtime. */
const counts = {};
declared.forEach((d) => { counts[d.name] = (counts[d.name] || 0) + 1; });

const ALL = FILES.map((f) => sources[f]).join('\n');
const specDir = path.join(__dirname, 'tests');
const specs = fs.existsSync(specDir)
  ? fs.readdirSync(specDir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(specDir, f), 'utf8')).join('\n')
  : '';

const candidates = [];
declared.forEach((d) => {
  /* Count every mention that is not the declaration itself. `name(` catches calls and onclick strings alike;
     `name` bare catches being passed as a callback or assigned to a global. */
  const callRe = new RegExp('(?<!function\\s)\\b' + d.name.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
  const bareRe = new RegExp('\\b' + d.name.replace(/\$/g, '\\$') + '\\b', 'g');
  const calls = (ALL.match(callRe) || []).length;
  const mentions = (ALL.match(bareRe) || []).length;
  const inSpecs = (specs.match(bareRe) || []).length;
  /* One mention = the declaration. Two = declaration + one other, which may still be a re-declaration. */
  if (calls === 0 && mentions <= counts[d.name] && inSpecs === 0) {
    candidates.push({ ...d, mentions, dup: counts[d.name] > 1 });
  }
});

console.log('\n══ DEAD-SURFACE CANDIDATES ══');
console.log('  ' + declared.length + ' top-level functions · ' + candidates.length + ' with no call anywhere\n');

const byFile = {};
candidates.forEach((c) => { (byFile[c.file] = byFile[c.file] || []).push(c); });
Object.keys(byFile).sort().forEach((f) => {
  console.log('  ' + f + '  (' + byFile[f].length + ')');
  byFile[f].forEach((c) => console.log('      ' + String(c.line).padStart(6) + '  ' + c.name + (c.dup ? '   ⚠️ also declared elsewhere' : '')));
});

/* ⚠️ Shadowed declarations are a different and more certain finding: two definitions of one name means the
   earlier one CANNOT run. That is dead by construction rather than by inference. */
const dups = Object.keys(counts).filter((n) => counts[n] > 1);
if (dups.length) {
  console.log('\n  ⚠️ DECLARED MORE THAN ONCE — the earlier definition can never run:');
  dups.forEach((n) => {
    const where = declared.filter((d) => d.name === n).map((d) => d.file + ':' + d.line).join('  →  ');
    console.log('      ' + n.padEnd(28) + where);
  });
}

console.log('\n  ⚠️ CANDIDATES, NOT A DELETE LIST. Read each one before removing it: an inline onclick inside a');
console.log('     template string is a real call site, and deleting one removes a working button.\n');

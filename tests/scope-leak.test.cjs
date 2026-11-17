/**
 * ── ⭐⭐ A NAME USED WHERE IT WAS NEVER DECLARED ─────────────────────────────────────────────────────────────────
 *
 * `node -c` parses; it does not resolve. So a `const pd` declared in one function and read in another sitting
 * beside it compiles perfectly and throws the first time a real ticket goes through — which in this codebase has
 * now happened three times in one day's work:
 *
 *   · `who` used outside the scope that had it
 *   · `req._support` set and never returned
 *   · `pd.source` read inside raise(), declared inside resolveDesk()  ← caught by writing this
 *
 * ⭐ THE CHEAP 90%: for each top-level function, take every `const`/`let` it declares and check that no OTHER
 * top-level function in the same file reads that name unless it is also declared there (or at module level).
 * That is not a scope analyser and does not pretend to be — it catches exactly the mistake above, which is the
 * one that keeps happening, and it costs one pass over a handful of files.
 *
 * ⚠️ FILES ARE NAMED, NOT GLOBBED. A guard that silently covers nothing when a path changes is worse than no
 * guard; this one fails loudly if a file it names has gone. [[feedback-silence-is-the-bug]]
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  'lib/raiseticket.js',
  'lib/workroute.js',
  'lib/supportcopy.js',
  'lib/platformroot.js',
];

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

console.log('\n══ NAMES USED OUTSIDE THE FUNCTION THAT DECLARES THEM ══\n');

/* strip comments and strings so a word inside prose or a message is never mistaken for code */
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

/** split a file into top-level `function name(...) { ... }` blocks by brace depth */
function topLevelFunctions(src) {
  const out = [];
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    let i = src.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    /* the parameter list too — everything between the `(` the match ends on and the body's first `{` */
    if (end > 0) out.push({ name: m[1], body: src.slice(i, end + 1),
                            params: src.slice(m.index + m[0].length, i).split(')')[0] });
  }
  return out;
}

const declaredIn = (body) => {
  const names = new Set();
  /* const x = / let x = / const { a, b } = / function args */
  let m;
  const simple = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=;]/g;
  while ((m = simple.exec(body))) names.add(m[1]);
  /* ⚠️ `for (const row of …)` declares too — missing this reported every loop variable as somebody else's */
  const forOf = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g;
  while ((m = forOf.exec(body))) names.add(m[1]);
  const destr = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
  while ((m = destr.exec(body))) {
    for (const piece of m[1].split(',')) {
      const t = piece.split(':').pop().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  const arr = /\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g;
  while ((m = arr.exec(body))) {
    for (const piece of m[1].split(',')) {
      const t = piece.split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  return names;
};

for (const rel of FILES) {
  const full = path.join(__dirname, '..', rel);
  if (!fs.existsSync(full)) { ok(rel + ' exists', false, 'the guard names a file that is not there'); continue; }
  const src = strip(fs.readFileSync(full, 'utf8'));
  const fns = topLevelFunctions(src);

  /* module-level declarations are fair game everywhere */
  let moduleLevel = src;
  for (const f of fns) moduleLevel = moduleLevel.split(f.body).join(' ');
  const global = declaredIn(moduleLevel);

  const leaks = [];
  for (const f of fns) {
    const mine = declaredIn(f.body);
    /* ⚠️ ITS OWN PARAMETERS. Without these, every argument name read as a variable belonging to some other
       function — `resolveDesk(from, t, root)` was reported as leaking `root` from raise(). */
    for (const p of String(f.params || '').split(',')) {
      const t = p.split('=')[0].replace(/[{}[\]]/g, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) mine.add(t);
    }
    for (const g of fns) {
      if (g.name === f.name) continue;
      const theirs = declaredIn(g.body);
      for (const n of theirs) {
        if (mine.has(n) || global.has(n) || n.length < 2) continue;
        /* ⚠️ not preceded by `.` or a word character (so not a property or a substring), and NOT followed by a
           colon — `folder: x` writes a key, it does not read a variable. That one produced three of the four
           false positives on the first run, and a guard that cries wolf is a guard somebody deletes. */
        const used = new RegExp('(?<![\\w$.])' + n.replace(/\$/g, '\\$') + '(?![\\w$])\\s*(?!:)');
        if (used.test(f.body)) leaks.push(f.name + '() reads `' + n + '`, declared only in ' + g.name + '()');
      }
    }
  }
  ok(rel, leaks.length === 0, leaks.slice(0, 6).join('\n          '));
}

/* ⚠️ AND THE GUARD IS PROVEN, not trusted: a known-bad shape must fail it, or a clean run means nothing. */
(() => {
  const bad = 'function a(){ const pd = 1; return pd; }\nfunction b(){ return pd.source; }\n';
  const fns = topLevelFunctions(strip(bad));
  let moduleLevel = strip(bad);
  for (const f of fns) moduleLevel = moduleLevel.split(f.body).join(' ');
  const global = declaredIn(moduleLevel);
  let caught = false;
  for (const f of fns) {
    const mine = declaredIn(f.body);
    for (const g of fns) {
      if (g.name === f.name) continue;
      for (const n of declaredIn(g.body)) {
        if (mine.has(n) || global.has(n) || n.length < 2) continue;
        if (new RegExp('(?<![\\w$.])' + n + '(?![\\w$])').test(f.body)) caught = true;
      }
    }
  }
  ok('the guard catches the shape it was written for', caught,
     'a check that cannot fail on its own example is decoration');
})();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);

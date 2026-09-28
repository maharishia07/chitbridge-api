'use strict';
// tdz-guard.test.js — a `const` read above its own declaration is a 500 that nothing in this repo could see.
//
// ── ⚠️⚠️ THE BUG THIS EXISTS FOR ────────────────────────────────────────────────────────────────────────────
//
// On 2026-09-11 a document-number check was added to routes/chits.js ABOVE the line declaring the variable it
// reads. A `const` sits in its TEMPORAL DEAD ZONE until its own declaration runs, so from that deploy onward
// EVERY `POST /api/chits/send` threw before doing anything:
//
//     ReferenceError: Cannot access 'client_ref' before initialization   at routes/chits.js:293
//
// Sending a chit, saving a draft, replaying a till bill — all of them, for a day, in production.
//
// ⚠️⚠️ NOTHING HERE COULD HAVE CAUGHT IT. `node -c` parses the file happily, because a TDZ violation is a
// RUNTIME error; there is no ESLint in this repo (it would have said no-use-before-define); and the route needs
// a database, so no unit test reaches the line. It was found by pressing a button and reading the network tab.
// A guard exists to replace that luck.
//
// ── ⚠️ THE FIRST VERSION OF THIS FILE WAS NOISE ─────────────────────────────────────────────────────────────
//
// It compared every declaration against every earlier line in the FILE and reported twelve "problems", all of
// them names declared in a different function. A guard that cries wolf twelve times teaches people to skip it,
// which is worse than not having it — so this one bounds every check to the FUNCTION BODY the declaration sits
// in, found by matching braces over source with strings and comments blanked out.
//
// ⚠️ It is still not a JavaScript parser and does not pretend to be: no scope analysis, no closures, no
// hoisting rules. It answers one narrow question — inside ONE function body, is a name used on a line above the
// `const`/`let` that declares it — which is exactly the shape that took the product down.
//
// Run: node tests/tdz-guard.test.js   · no network, no DB.
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  XX  ' + name + ' — ' + e.message); fail++; }
};

const API = path.join(__dirname, '..');

function files() {
  const out = [];
  ['routes', 'middleware', 'lib'].forEach((dir) => {
    const d = path.join(API, dir);
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).filter((f) => f.endsWith('.js')).forEach((f) => out.push(path.join(dir, f)));
  });
  return out;
}

/**
 * ⚠️ COMMENTS AND STRINGS ARE NOT CODE — this file's own header names `client_ref` a dozen times, and so does
 * the comment above the real declaration. Blanked rather than removed, so every line number still matches the
 * file a person will open. [[the same lesson as case-fields.test.js]]
 */
/** a '/' starts a regex when what came before cannot end an operand — the standard tokenizer rule */
function regexCanStart(out) {
  const t = out.replace(/\s+$/, '');
  if (!t) return true;
  if (/(^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(t)) return true;
  return /[(,=:[!&|?{};+\-*%<>~^]$/.test(t);
}
function blank(src) {
  let out = '';
  let i = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const seg = src.slice(i, end < 0 ? N : end + 2);
      out += seg.replace(/[^\n]/g, ' ');
      i += seg.length;
    } else if (c === '/' && d === '/') {
      let end = src.indexOf('\n', i);
      if (end < 0) end = N;
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === '/' && regexCanStart(out)) {
      /* ⭐ A REGEX LITERAL (2026-09-27). The blanker had no idea these existed, so a quote inside one — /['"]/ —
         opened a "string" that ran on for hundreds of lines, and from there comments read as code and code as
         strings: it flagged the word "told" INSIDE a message string in routes/testing.js as a use-before-declare.
         Skipped to its closing slash, honouring escapes and [...] classes (a / inside a class does not close it). */
      let j = i + 1, inClass = false;
      while (j < N && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      if (j < N && src[j] === '/') {
        const seg = src.slice(i, j + 1);
        out += '/' + seg.slice(1, -1).replace(/[^\n]/g, ' ') + '/';
        i = j + 1;
      } else { out += c; i++; }                       /* no closing slash on this line — it was division after all */
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < N && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const seg = src.slice(i, Math.min(j + 1, N));
      out += c + seg.slice(1).replace(/[^\n]/g, ' ');
      i += seg.length;
    } else { out += c; i++; }
  }
  return out;
}

/** ⭐ every function body as a [start, end] character range — the unit a TDZ question is actually asked in */
function bodies(src) {
  const out = [];
  const re = /(?:function\s*[A-Za-z_$\w]*\s*\([^)]*\)|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push([open, i]);
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

t('no const/let is read above the line that declares it, in the same function', () => {
  const bad = [];

  files().forEach((rel) => {
    const raw = fs.readFileSync(path.join(API, rel), 'utf8');
    const src = blank(raw);
    const fns = bodies(src);

    const declRe = /(?:^|[\n;{])\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g;
    let m;
    while ((m = declRe.exec(src))) {
      const name = m[1];
      if (name.length < 4) continue;                 /* a short loop name is noise, not a finding */
      const at = m.index + m[0].indexOf(name);

      /* ⭐ the SMALLEST function body containing this declaration — its actual scope, near enough */
      let body = null;
      fns.forEach((b) => {
        if (at > b[0] && at < b[1] && (!body || (b[1] - b[0]) < (body[1] - body[0]))) body = b;
      });
      if (!body) continue;

      /* is the same name declared again inside that body? then shadowing is in play — out of scope */
      const inBody = src.slice(body[0], body[1]);
      const dupes = (inBody.match(new RegExp('(?:const|let)\\s+' + name + '\\s*=', 'g')) || []).length;
      if (dupes !== 1) continue;

      const before = src.slice(body[0], at);
      const useRe = new RegExp('(^|[^\\w$.])' + name + '(?![\\w$\\s]*:)(?![\\w$])');
      if (!useRe.test(before)) continue;

      /**
       * ⚠️ A PARAMETER OF THE SAME NAME IS NOT A USE. `const decideVariant = (base, …) => …` declares `base`;
       * it does not read the outer one. Checked against the head of THIS body and of any nested one.
       */
      const head = src.slice(Math.max(0, body[0] - 220), body[0]);
      if (new RegExp('\\([^)]*\\b' + name + '\\b[^)]*\\)\\s*(?:=>)?\\s*$').test(head.replace(/\s+$/, ''))) continue;

      const useAt = body[0] + before.search(useRe);

      /**
       * ⭐⭐ A USE INSIDE A NESTED FUNCTION IS DEFERRED, NOT IMMEDIATE. `const f = () => use(x); … const x = 1;`
       * is legal and common — the closure body does not run until it is called, by which time the declaration
       * has. Only a use in the SAME body as the declaration runs in order, and only that one can hit the dead
       * zone. ⚠️ This is the rule that turns this guard from noise into something worth reading.
       */
      const nested = fns.some((b) => b !== body && useAt > b[0] && useAt < b[1] && b[0] > body[0] && b[1] < body[1]);
      if (nested) continue;

      /**
       * ⚠️ THE USE MIGHT BE A PARAMETER LIST — asked at the USE, not at the declaration's function head, which
       * is where the first version of this rule looked and why `const decideVariant = (base, …) => …` kept
       * being reported. A name between parentheses that are followed by `=>` or `{` is being DECLARED there.
       */
      const useLine = src.slice(src.lastIndexOf('\n', useAt) + 1, src.indexOf('\n', useAt));
      if (new RegExp('\\([^)]*\\b' + name + '\\b[^)]*\\)\\s*(?:=>|\\{)').test(useLine)) continue;

      /**
       * ⚠️ A MODULE-LEVEL NAME OF THE SAME SPELLING. `access` is required at the top of the file AND declared
       * as a local in one handler; a read in a different handler is the module one and is fine. Where both
       * exist this cannot tell them apart without real scope analysis, so it says nothing rather than
       * something wrong.
       */
      const moduleLevel = new RegExp('^(?:const|let|var)\\s+' + name + '\\s*=', 'm').test(src);
      if (moduleLevel) continue;
      bad.push(rel + ':' + lineOf(src, useAt) + ' reads `' + name + '`, declared at line ' + lineOf(src, at));
    }
  });

  if (bad.length) {
    throw new Error(bad.length + ' use(s) before declaration inside one function — each is a ReferenceError '
      + 'the moment that line runs:\n      ' + bad.slice(0, 10).join('\n      '));
  }
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
/* ⚠️ the gate (scripts/guards.cjs) reads "<n> checks" and counts a guard that reports none as a FAIL */
console.log('  ' + pass + ' checks');
process.exit(fail ? 1 : 0);

/**
 * pages-parse.test.js — EVERY INLINE SCRIPT IN EVERY SHIPPED PAGE MUST PARSE (2026-09-08).
 *
 * ⚠️⚠️ WHY THIS EXISTS. A commit added a sentence to the Counter door reading "this shop's counter". The apostrophe closed the JS
 * string, and a syntax error in app.html's main inline block means NOTHING runs — not the dialog, the whole application. It went
 * out and was live for about forty minutes. The check that would have caught it takes 40 ms and I had run it on the other file.
 *
 * ⚠️ A SYNTAX ERROR IN A ONE-FILE APP IS TOTAL. There is no module boundary to contain it: app.html, till.html and promo.html each
 * ship one big inline script, so any stray quote anywhere takes down everything. That is the trade we accepted for a page that
 * loads in one request, and this is the price of it — an automated check, every time, not a habit.
 *
 * ⚠️ It proves the pages PARSE. It says nothing about whether they work. That is what the e2e specs are for.
 *
 * Run: node tests/pages-parse.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web', 'public');

const PAGES = [
  ['the app',            path.join(WEB, 'app.html')],
  ['the counter (master)', path.join(API, 'tools', 'tally-connector', 'till.html')],
  ['the counter (web)',  path.join(WEB, 'till.html')],
  ['the shop screen (master)', path.join(API, 'tools', 'tally-connector', 'promo.html')],
  ['the shop screen (web)', path.join(WEB, 'promo.html')],
  /* ⚠ THE STANDALONE PAGES BELONG HERE TOO, and were missing. Each is a one-file app with all of its script
     inline, so a syntax error is total in exactly the way the header above describes — and neither is covered
     by a spec that would have caught it. The offer lab is where offers are proved before they are published;
     the test board is where every other result is recorded, so a broken one is a testing session lost.
     ⚠️⚠️⚠️ [found 2026-09-26, fixing the Labs split] THIS ENTRY POINTED AT offer-lab.html — the RETIRED page
     (superseded by offer-lab-next.html; see app.html:6370 and cap-catsetup.js's own comment on the switch),
     which nothing links to any more. Every real nav path opens offer-lab-next.html, so the page actually
     shipped has had NO syntax-error guard here since the day it superseded offer-lab.html — exactly the class
     of silent gap this file's own header warns about. Corrected, and combo-lab.html (its own standalone page
     as of the same split) added alongside it. */
  ['the offer lab',      path.join(WEB, 'offer-lab-next.html')],
  ['the combo lab',      path.join(WEB, 'combo-lab.html')],
  ['the test board',     path.join(WEB, 'testing.html')],
];

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— every page a browser is asked to run —');

/* only blocks WITHOUT src=; a <script src> is a file of its own and is checked where it lives */
const INLINE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

for (const [name, file] of PAGES) {
  it(name + ' parses', () => {
    if (!fs.existsSync(file)) throw new Error('missing: ' + file);
    const html = fs.readFileSync(file, 'utf8');
    const blocks = [...html.matchAll(INLINE)];
    assert.ok(blocks.length, 'no inline script found — the matcher is wrong, or the page is not what we think');
    blocks.forEach((b, i) => {
      try { new vm.Script(b[1], { filename: path.basename(file) + ' block ' + (i + 1) }); }
      catch (e) {
        /* say WHERE, because "unexpected identifier" three thousand lines in is not a bug report */
        const upto = b[1].slice(0, e.stack && /:(\d+)/.test(e.stack) ? undefined : undefined);
        const line = (e.stack || '').match(/block \d+:(\d+)/);
        const at = line ? ('\n      near line ' + line[1] + ' of that block: '
          + String(b[1].split('\n')[Number(line[1]) - 1] || '').trim().slice(0, 120)) : '';
        throw new Error(path.basename(file) + ' block ' + (i + 1) + ' — ' + e.message + at);
      }
    });
  });
}

/* Blank the comments of a JS source, leaving strings, templates and regex literals untouched. Same length, same newlines. */
function blankJsComments(s) {
  let out = '', i = 0, prev = '';   /* prev = last significant char, to tell a regex from a division */
  const blank = (t) => t.replace(/[^\r\n]/g, ' ');
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (c === '/' && n === '*') { let e = s.indexOf('*/', i + 2); e = e < 0 ? s.length : e + 2; out += blank(s.slice(i, e)); i = e; continue; }
    if (c === '/' && n === '/') { let e = s.indexOf('\n', i); if (e < 0) e = s.length; out += blank(s.slice(i, e)); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; else if (c !== '`' && s[j] === '\n') break; j++; }
      out += s.slice(i, j + 1); i = j + 1; prev = c; continue;
    }
    if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /(?:^|[^\w$])(?:return|typeof|case|in|of)\s*$/.test(out.slice(-12)))) {
      let j = i + 1, cls = false;
      while (j < s.length && s[j] !== '\n' && (cls || s[j] !== '/')) { if (s[j] === '\\') j++; else if (s[j] === '[') cls = true; else if (s[j] === ']') cls = false; j++; }
      out += s.slice(i, j + 1); i = j + 1; prev = '/'; continue;
    }
    out += c; i++;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

/* the controls an onclick-style attribute calls that nothing in the sources defines */
function danglingHandlers(texts) {
  const defined = new Set();
  const blanked = texts.map((t) => blankJsComments(t));
  blanked.forEach((s) => { let m; const d = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g; while ((m = d.exec(s))) defined.add(m[1]); });
  const out = [];
  blanked.forEach((s) => { let m; const c = /on(?:click|change|input|submit)\s*=\s*(["'])\s*([A-Za-z_$][\w$]*)\s*\(/g; while ((m = c.exec(s))) if (!defined.has(m[2]) && out.indexOf(m[2]) < 0) out.push(m[2]); });
  return out;
}

it('the handler scanner: a "/*" inside a string is not a comment (cap-entry.js enSet, 2026-10-03)', () => {
  const swallowed = 'var a = \'<input accept="image/*,application/pdf">\';\nfunction enSet(k) { return k; }\n/* a real comment */\nvar b = \'<b onclick="enSet(1)">\';';
  assert.deepStrictEqual(danglingHandlers([swallowed]), [], 'the "/*" in a string swallowed the definition after it');
  assert.ok(blankJsComments(swallowed).includes('function enSet'));
  assert.ok(!blankJsComments(swallowed).includes('a real comment'), 'a real comment must still be blanked');
  const rx = 'var r = /a\\/*x/;\nfunction g() {}\n/* c */ var b = \'<b onclick="g()">\';';
  assert.deepStrictEqual(danglingHandlers([rx]), [], 'a "/*" inside a regex literal is not a comment either');
});

it('the handler scanner still catches a REAL missing function', () => {
  assert.deepStrictEqual(danglingHandlers(['function here() {}\nvar b = \'<b onclick="gone(1)">\';']), ['gone']);
  assert.deepStrictEqual(danglingHandlers(['// onclick="ghost()"\nvar x = 1;']), [], 'an illustration in a comment is not a control');
});

/**
 * ⭐⭐⭐ EVERY onclick NAMES A FUNCTION THAT EXISTS.
 *
 * ⚠️⚠️ WHY THIS EXISTS, and it is the same shape as the reason above. Removing a block from cap-supplies.js I
 * spliced out a line range and took `supBuy` with it — so "Record a purchase" became a button that called
 * nothing. `node -c` passed. The file parsed. The 354-check guard suite was green. Every one of those measures
 * whether the code is well-formed, and a missing function is perfectly well-formed: the call only fails when a
 * person presses the button. It shipped, and [SUP-01] pressed it.
 *
 * ⭐ Parsing proves a page LOADS; this proves its controls are WIRED. Cheap, static, and it covers the one gap
 * between "the file is valid" and "the screen does something".
 *
 * ⚠️ IT IS DELIBERATELY NARROW: bare `name(` at the start of an onclick, resolved against every function declared
 * anywhere in the shipped bundle plus the browser's own globals. Anything it cannot resolve confidently — a
 * method call, a property, an expression — is skipped rather than guessed at, because a guard that cries wolf
 * gets muted and then it protects nothing.
 */
it('⭐⭐⭐ every onclick in a capability calls a function that exists', () => {
  const appDir = path.join(WEB, 'app');
  if (!fs.existsSync(appDir)) return;
  const files = fs.readdirSync(appDir).filter((f) => f.endsWith('.js'))
    .map((f) => path.join(appDir, f)).concat([path.join(WEB, 'app.html')]);

  /* every function this bundle defines, however it is declared */
  const defined = new Set(['api', 'toast', 'modal', 'closeModal', 'esc', 'tx', 'txf', 'alert', 'confirm', 'open',
                           'setTimeout', 'clearTimeout', 'event', 'window', 'document', 'history', 'location',
                           'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'parseInt', 'parseFloat']);
  /**
   * ── ⚠️⚠️ BLANK THE COMMENTS BEFORE SCANNING. FOURTH GUARD, SAME FAULT ─────────────────────────────────────
   *
   * 2026-09-14: this guard reported `cap-testing.js → fn()`. There is no such call. Line 551 of that file is a
   * COMMENT — `onclick="fn('HERE')"` — written the day before to document the XSS escaping rule, and the guard
   * read the illustration as a control.
   *
   * ⚠️ token-check.cjs, modal-safe-repaint.cjs and screen-reads.cjs each needed exactly this, each after
   * firing on their own prose. A guard that reads comments punishes the codebase for explaining itself, and
   * the cheapest way to make it green is to delete the explanation — which is the worst possible outcome.
   *
   * ⭐ Replaced with spaces, not stripped: every offset and line number stays where it was, so any message
   * that quotes a position still points at the right place.
   */
  /* STRING-AWARE (2026-10-03). The first version was two regexes, and cap-entry.js has `accept="image/*,application/pdf"`
     inside a string: the `/*` opened a "comment" that ran to the next real star-slash and swallowed `function enSet`, so three
     live buttons were reported missing. A comment marker only counts OUTSIDE a string, template or regex literal.
     app.html is markup, not a script, so it keeps the plain pass. */
  const blankComments = (s, isJs) => isJs ? blankJsComments(s) : s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m) => m[0] + m.slice(1).replace(/[^\n]/g, ' '));

  const src = {};
  files.forEach((f) => {
    const s = blankComments(fs.readFileSync(f, 'utf8'), f.endsWith('.js')); src[f] = s;
    let m; const decl = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    while ((m = decl.exec(s))) defined.add(m[1]);
    const assign = /(?:^|\n)\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g;
    while ((m = assign.exec(s))) defined.add(m[1]);
    /* window.X = … and root.X = … — an IIFE handed window as `root` (chit-sheet.js, one-person.js), 2026-10-02 */
    const win = /(?:window|root)\.([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = win.exec(s))) defined.add(m[1]);
  });

  const KEYWORD = new Set(['if','for','while','switch','return','typeof','delete','void','catch','function','new']);
  const missing = [];
  files.forEach((f) => {
    let m; const call = /on(?:click|change|input|submit)\s*=\s*(["'])\s*([A-Za-z_$][\w$]*)\s*\(/g;
    while ((m = call.exec(src[f]))) {
      const fn = m[2];
      /* ⚠️ `onclick="if(...)"` is a statement, not a call — a keyword here is the guard misreading, not a bug */
      if (KEYWORD.has(fn)) continue;
      if (!defined.has(fn) && missing.indexOf(fn) < 0) missing.push(path.basename(f) + ' → ' + fn + '()');
    }
  });
  assert.deepStrictEqual(missing, [],
    'these controls call functions that do not exist anywhere in the bundle:\n       ' + missing.join('\n       '));
});

it('⚠️ the vendored copies still say what their masters say', () => {
  /* ⚠️ LINE ENDINGS ARE NOT CONTENT. The master is checked out CRLF on Windows and the vendor step writes LF, so a byte
     comparison fails on every run and would teach us to ignore this test — which is worse than not having it. */
  const same = (f) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
  for (const copy of ['till.html', 'promo.html']) {
    const a = path.join(API, 'tools', 'tally-connector', copy), b = path.join(WEB, copy);
    if (!fs.existsSync(b)) throw new Error(copy + ' has never been vendored — run scripts/vendor-till.cjs');
    const A = same(a), B = same(b);
    if (A === B) continue;
    /* say WHERE they diverge; a 170,000-character diff is not a bug report */
    let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
    throw new Error(copy + ' differs from its master at character ' + i + ' — run scripts/vendor-till.cjs.'
      + '\n      master: ' + JSON.stringify(A.slice(i, i + 70))
      + '\n      copy  : ' + JSON.stringify(B.slice(i, i + 70)));
  }
});

console.log(pass + ' checks');

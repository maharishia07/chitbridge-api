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
     the test board is where every other result is recorded, so a broken one is a testing session lost. */
  ['the offer lab',      path.join(WEB, 'offer-lab.html')],
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
  const src = {};
  files.forEach((f) => {
    const s = fs.readFileSync(f, 'utf8'); src[f] = s;
    let m; const decl = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    while ((m = decl.exec(s))) defined.add(m[1]);
    const assign = /(?:^|\n)\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g;
    while ((m = assign.exec(s))) defined.add(m[1]);
    const win = /window\.([A-Za-z_$][\w$]*)\s*=/g;
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

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

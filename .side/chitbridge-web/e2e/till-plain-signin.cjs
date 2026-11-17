/* till-plain-signin.cjs — [TILL-193] A SHOPKEEPER IS NEVER TOLD TO "PASTE A KEY"
 *
 * Athi, live, 2026-09-25, right after [TILL-192]: "we cannot showcase paste a key at all to the user, he
 * will not understand... if it is not mapping, then say that due to maintenance, signout and sign-in again
 * is required... sign-in again and upload a new key as long as the user is authorised."
 *
 * The mechanism was already right (pairAgain() -> usignOpen(true) -> a real, authorised re-enrol, proven by
 * till-reenrol.cjs). What this checks is the WORDS a browser counter puts in front of the person: nowhere
 * does "key" or "paste" appear on the surfaces a shopkeeper actually sees, and the story is the plain one
 * Athi gave — "due to maintenance" — not a diagnosis of which key is wrong. [[feedback-assume-they-cannot-read]]
 *
 * Run: node e2e/till-plain-signin.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof keyWord === 'function' && typeof shopReady === 'function'
    && typeof refreshFailed === 'function', null, { timeout: 30000 });

  console.log('\n── ⭐⭐⭐ THE BUTTON WORD — a browser counter is told to sign in, never to paste anything ' + '─'.repeat(0));
  const word = await p.evaluate(() => keyWord());
  say('keyWord() says "Sign in again," not "Paste a key"', word === 'Sign in again', '"' + word + '"');

  console.log('\n── ⚠️⚠️⚠️ AN UNPAIRED BROWSER COUNTER — the stop that opens on the very first sale attempt ' + '─'.repeat(0));
  const stop = await p.evaluate(() => {
    CloudHost.key = null;                    /* not paired at all — the state behind the reported screenshot */
    return shopReady().stops[0];
  });
  /* ⭐ M08: a browser with NOTHING on it is a fresh phone — "sign in", never "maintenance" (that is the KEY holder's story, kept below) */
  say('says "sign in", not "due to maintenance" and not a diagnosis of the key', /sign in/i.test(stop.why + ' ' + stop.means) && !/maintenance/i.test(stop.why), '"' + stop.why + '"');
  say('never uses the word "key" in front of the shopkeeper', !/key/i.test(stop.why) && !/key/i.test(stop.means),
    'why="' + stop.why + '" means="' + stop.means + '"');
  say('the fix button is the same plain word as keyWord()', stop.fix === 'Sign in again', '"' + stop.fix + '"');

  console.log('\n── ⚠️ THE INTERRUPTING FLASH ([TILL-157]) — refreshFailed() on a 401, mid-sale ' + '─'.repeat(0));
  const flash = await p.evaluate(() => {
    CloudHost.key = 'some-key';               /* paired, so refreshFailed reads the 401 itself, not "no key" */
    refreshFailed(401);
    return document.getElementById('flash').innerHTML;
  });
  say('shows "Due to maintenance," not "Not signed in"', flash.indexOf('Due to maintenance') >= 0, flash.indexOf('Due to maintenance') >= 0 ? 'present' : 'MISSING');
  say('the 🔑 key icon is gone', flash.indexOf('🔑') < 0, flash.indexOf('🔑') < 0 ? 'gone' : 'still there');
  say('replaced by a maintenance icon, not a blank symbol', flash.indexOf('🔧') >= 0, flash.indexOf('🔧') >= 0 ? '🔧 present' : 'MISSING');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nnowhere does a browser counter tell the shopkeeper to paste a key');
  process.exit(bad || errs.length ? 1 : 0);
})();

/**
 * e2e/net-19-one-session-keeper.test.cjs — NET-19 (proof 2026-11-14): the four public network pages load the one session keeper.
 * @type regression
 * OWNS      static proof that shop.html, store.html, embed.html and network.html each load /app/one-person.js (CBOnePerson, whose session this browser holds)
 *           in a live <script src> tag (not inside an HTML comment), and that the file exists and exports CBOnePerson.
 * MUTATION  NET19_MUTATE=1 drops the tag from network.html in memory (the pre-fix state); the test must then FAIL.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 *   node e2e/net-19-one-session-keeper.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const pub = path.join(__dirname, '..', 'public');
const mutate = process.env.NET19_MUTATE === '1';
let fail = 0;
const ok = (name, cond) => { if (!cond) fail++; console.log((cond ? '   ok   ' : '   FAIL ') + name); };
const TAG = /<script\b[^>]*\bsrc="\/app\/one-person\.js"[^>]*><\/script>/;
for (const page of ['shop.html', 'store.html', 'embed.html', 'network.html']) {
  let html = fs.readFileSync(path.join(pub, page), 'utf8');
  if (mutate && page === 'network.html') html = html.replace(TAG, '');
  const live = html.replace(/<!--[\s\S]*?-->/g, '');
  ok(page + ' loads /app/one-person.js', TAG.test(live));
}
const src = fs.readFileSync(path.join(pub, 'app', 'one-person.js'), 'utf8');
ok('one-person.js exports CBOnePerson', /root\.CBOnePerson\s*=/.test(src));
console.log(fail ? 'FAIL net-19' : 'PASS net-19');
process.exit(fail ? 1 : 0);

'use strict';
/* tests/page-global-collision.test.cjs — NO TWO SCRIPTS OF ONE PAGE ASSIGN THE SAME window GLOBAL (CRM-255).
 * UNIT      cross-cutting page wiring: one name per thing. The pane (app/cap-rewards.js) and the vendored engine (engine/rewards.js) both
 *           set window.CBRewards on app.html; the later script silently replaced the first and "CBRewards.load is not a function" threw.
 * OWNS      every public/*.html: the local <script src> files are read in order and each `window.X =` / `root.X =` / `globalThis.X =`
 *           assignment is collected; a name assigned by two different files fails, naming the page and both files. (Comments in the
 *           HTML are ignored; a file that assigns the same name twice is one file, fine.)
 * CALLED BY npm run check. No browser, no network.
 * Run: node tests/page-global-collision.test.cjs */
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const ASSIGN = /\b(?:window|root|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;

function collisions(html, read) {
  const srcs = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script[^>]*\ssrc="(\/[^"?]+)[^"]*"/g)].map((m) => m[1]);
  const seen = {};
  for (const s of srcs) {
    const text = read(s);
    if (text == null) continue;
    for (const m of text.matchAll(ASSIGN)) (seen[m[1]] = seen[m[1]] || new Set()).add(s);
  }
  return Object.entries(seen).filter(([, files]) => files.size > 1).map(([name, files]) => name + ' <- ' + [...files].join(' + '));
}

// the check itself must catch the CRM-255 shape
const fake = { '/a.js': 'root.CBRewards = api;', '/b.js': 'root.CBRewards = API;', '/c.js': 'window.Other = 1; window.Other = 2;' };
const html = '<script src="/a.js"></script><!-- <script src="/z.js"></script> --><script src="/b.js"></script><script src="/c.js"></script>';
const caught = collisions(html, (s) => fake[s]);
if (caught.length !== 1 || !/^CBRewards <- \/a\.js \+ \/b\.js$/.test(caught[0])) { console.error('self-check failed', caught); process.exit(1); }

let bad = 0, pages = 0;
for (const h of fs.readdirSync(PUB).filter((f) => f.endsWith('.html'))) {
  pages++;
  const found = collisions(fs.readFileSync(path.join(PUB, h), 'utf8'), (s) => {
    const f = path.join(PUB, s);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  });
  for (const c of found) { bad++; console.error('FAIL  ' + h + ': ' + c); }
}
if (bad) process.exit(1);
console.log('ok  ' + pages + ' pages: no window global is assigned by two scripts of one page');

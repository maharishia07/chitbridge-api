#!/usr/bin/env node
/* one-avatar-breaks.cjs — THE GUARD OF one-avatar.cjs, PROVED BY BREAKING IT. A harness that cannot fail proves nothing, so each case
 * below damages a COPY of the site (never the repo) in the way the rule forbids, and one-avatar.cjs must catch it:
 *
 *   1  a second avatar builder in public/                       → "no second avatar builder"
 *   2  a page that ignores cb_theme (it never loads the avatar) → "opens in Sand"
 *   3  a page that wears the theme on <html> but not on itself  → "its own background follows the theme"
 *   4  the owner menu loses Settings                       → "Settings is in the owner menu"
 *   5  an avatar page that does not load the engine themes      → "loads the engine themes"
 *   6  a page that reads cb_sess and does not mount the avatar  → "every page that reads cb_sess loads avatar.js"
 *
 * Case 0 is the control: the unmutated copy passes the same checks, so a "caught" is a catch and not noise.
 * Run one at a time:  NODE_PATH=e2e/node_modules node e2e/one-avatar-breaks.cjs                                                    */
'use strict';
const fs = require('fs'), path = require('path');
const { run, buildSite } = require('./one-avatar.cjs');

const edit = (dir, rel, fn) => { const f = path.join(dir, rel); const s = fs.readFileSync(f, 'utf8'); const t = fn(s); if (t === s) throw new Error('the break did not change ' + rel); fs.writeFileSync(f, t); };

const CASES = [
  { name: 'a second avatar builder in public/', groups: ['static'], expect: /no second avatar builder/,
    mutate: (d) => edit(d, 'accounts.html', (s) => s.replace('</body>', '<div class="avmenu" id="avmenu" data-testid="avatar-menu" hidden></div></body>')) },
  { name: 'a page that ignores cb_theme (accounts never loads the avatar)', groups: ['theme'], pages: ['accounts'], expect: /accounts opens in Sand/,
    mutate: (d) => edit(d, 'accounts.html', (s) => s.replace('<script src="/app/avatar.js"></script>', '<!-- no avatar -->')) },
  { name: 'a page that takes the theme on <html> but not on itself (accounts drops its bridge)', groups: ['theme'], pages: ['accounts'], expect: /accounts's own background follows the theme/,
    mutate: (d) => edit(d, 'accounts.html', (s) => s.replace(':root[data-themed]{--ground:var(--paper,#fbf6ec)', ':root[data-themed-off]{--ground:var(--paper,#fbf6ec)')) },
  /* UX-96 turned the old rule round: Settings is in the OWNER menu on every page (one-avatar.cjs 'present'), so the break is the menu losing it */
  { name: 'the owner menu loses Settings (avatar.js shows it to no one)', groups: ['present'], pages: ['accounts'], expect: /accounts · Settings is in the owner menu/,
    mutate: (d) => edit(d, 'app/avatar.js', (s) => s.replace("var showSettings = items.indexOf('settings') >= 0 && !!P.owner;", 'var showSettings = false;')) },
  { name: 'an avatar page without the engine themes', groups: ['static'], expect: /loads the engine themes/,
    mutate: (d) => edit(d, 'list-lab.html', (s) => s.split('<script src="/engine/screen.js"></script>').join('')) },
  { name: 'a page that reads cb_sess and shows no avatar', groups: ['static'], expect: /every page that reads cb_sess loads avatar\.js/,
    mutate: (d) => edit(d, 'product-lab.html', (s) => s.replace('<script src="/app/avatar.js"></script>', '').replace(/<script>if\(window\.CBAvatar\)[^\n]*<\/script>/, '')) },
];

(async () => {
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log('  ' + (ok ? 'ok  ' : 'XX  ') + m); };
  {
    const site = buildSite();
    const r = await run(site, { groups: ['static'], quiet: true });
    const r2 = await run(site, { groups: ['present', 'theme'], pages: ['accounts'], quiet: true, noShots: true });
    say(r.fail === 0 && r2.fail === 0, 'control · the unmutated copy passes the same checks (' + (r.pass + r2.pass) + ' ok, ' + (r.fail + r2.fail) + ' failed)');
    fs.rmSync(site, { recursive: true, force: true });
  }
  for (const c of CASES) {
    const site = buildSite(c.mutate);
    const r = await run(site, { groups: c.groups, pages: c.pages, quiet: true, noShots: true });
    const hit = r.lines.filter((l) => l.startsWith('  XX')).some((l) => c.expect.test(l));
    say(hit, 'caught · ' + c.name + (hit ? '' : ' — NOT CAUGHT (failures: ' + (r.lines.filter((l) => l.startsWith('  XX')).join(' | ') || 'none') + ')'));
    fs.rmSync(site, { recursive: true, force: true });
  }
  console.log('\n  ' + (CASES.length + 1 - bad) + ' of ' + (CASES.length + 1) + ' as expected');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

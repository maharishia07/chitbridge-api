/* counter-follows-shop.cjs — THE COUNTER THAT OPENS MUST BE THE SHOP YOU SIGNED IN AS
 *
 * Athi, 2026-09-27, cancelling a demo over it:
 *   *"i am going to sign-in a new store in front of them and then open the counter app, and it is going to
 *   open completely a different shop, they will immediately say, go away, we cannot trust your product."*
 *
 * ⚠️⚠️⚠️ AND NOBODY PRESSED ANYTHING. counterHere() answered "is there a till key in this browser" — any key,
 * belonging to any shop — and two callers act on that answer automatically: the router on every sign-in, and
 * registration verify the instant a brand-new shop is created. Both call toCounter(), which redirects to
 * /till.html after 1.8 seconds. So a browser that had ever opened Mayur Bhavan's counter would throw a
 * freshly-registered vegdemo1 straight into Mayur Bhavan's till, unasked.
 *
 * This harness drives the decision function directly rather than a whole sign-in, because that function IS
 * the bug: everything downstream of it was behaving correctly on the answer it was given.
 *
 * Run: node e2e/counter-follows-shop.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(60) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/app.html');
  await p.waitForFunction(() => typeof window.counterHere === 'function', null, { timeout: 30000 });

  const set = (key, keyShop, sessionShop) => p.evaluate(([k, ks, ss]) => {
    if (k) localStorage.setItem('cb_till_key', k); else localStorage.removeItem('cb_till_key');
    if (ks) localStorage.setItem('cb_till_entity', ks); else localStorage.removeItem('cb_till_entity');
    SESSION = SESSION || {};
    SESSION.token = 'tok'; SESSION.entityId = ss || ''; SESSION.entity = ss === 'ent-veg' ? 'vegdemo1' : 'Mayur Bhavan';
    return { here: counterHere(), hasKey: typeof counterHasKey === 'function' ? counterHasKey() : null };
  }, [key, keyShop, sessionShop]);

  console.log('\n══ WHOSE COUNTER OPENS? ' + '═'.repeat(44));

  /* ── ⭐⭐⭐ THE DEMO ───────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── the demo: a new store, in a browser that has opened another ' + '─'.repeat(0));
  const demo = await set('mayur-key-abc', 'ent-mayur', 'ent-veg');
  say('⭐⭐⭐ signing in as vegdemo1 does NOT hand back Mayur Bhavan’s key',
    demo.here === '', demo.here === '' ? 'no automatic jump' : 'RETURNED ' + demo.here);
  say('and the two checks now agree, instead of one being shop-aware and one not',
    demo.here === '' && demo.hasKey === false, 'counterHere "" · counterHasKey false');

  /* ── the paired shop PC this feature exists for — must still work ─────────────────────────────── */
  console.log('\n── the real case it was built for ' + '─'.repeat(29));
  const paired = await set('mayur-key-abc', 'ent-mayur', 'ent-mayur');
  say('a PC paired to the shop you signed in as still opens its counter',
    paired.here === 'mayur-key-abc', 'key handed back');
  say('and both checks agree here too', paired.hasKey === true, 'counterHasKey true');

  /* ── ⚠️ the key that cannot prove whose it is ─────────────────────────────────────────────────── */
  console.log('\n── a key with no recorded shop ' + '─'.repeat(32));
  const orphan = await set('older-key-xyz', '', 'ent-veg');
  say('⚠️ a key minted before we recorded its shop cannot prove whose it is — no jump',
    orphan.here === '', 'safe answer: do not auto-open a till we cannot identify');

  /* ── and the plain cases ──────────────────────────────────────────────────────────────────────── */
  console.log('\n── the plain cases ' + '─'.repeat(44));
  const none = await set('', '', 'ent-veg');
  say('no key at all, no jump', none.here === '', 'nothing to open');
  const nosess = await p.evaluate(() => {
    localStorage.setItem('cb_till_key', 'k'); localStorage.setItem('cb_till_entity', 'ent-mayur');
    SESSION = { token: 'tok' };                     /* signed in, but the session names no entity yet */
    return counterHere();
  });
  say('a session that does not yet name its shop cannot match one', nosess === '', 'no jump');

  console.log('\nconsole/page errors: ' + (errs.length ? errs.join(' · ') : 'none'));
  if (errs.length) bad++;
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed\n'
    : '\nthe counter that opens is the shop you signed in as, and nothing opens by itself\n');
  process.exit(bad ? 1 : 0);
})();

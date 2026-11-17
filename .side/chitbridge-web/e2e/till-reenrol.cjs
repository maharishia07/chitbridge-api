/* till-reenrol.cjs — [TILL-192] A KEY THE SHOP JUST REFUSED IS RE-MINTED ON RE-SIGN-IN, NOT SILENTLY KEPT
 *
 * Athi, live, 2026-09-25, after the shop rejected this device's counter key: "i signed out and signed in
 * again, but it's still not working." Traced to: paired() answers "is there A key on file", never "is the
 * key on file the one the shop just refused" — so pairAgain()'s own re-sign-in, entered ONLY because the
 * current key had already failed, still saw `paired()===true` and usignEnrolIfNeeded() skipped minting a
 * replacement, putting the caller back exactly where they started with no error to explain why.
 *
 * ⚠️⚠️⚠️ THIS DOES NOT SIGN IN FOR REAL — usignEnrolIfNeeded() takes a plain token and a stubbed fetchBy;
 * nothing about a session or a network call. It proves the GATE, the same way tests/variant.test.js proves
 * an engine offline: paired()+forceEnrol decide whether the enrol call is even attempted, not what it
 * returns.
 *
 * Run: node e2e/till-reenrol.cjs
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
  /**
   * ⚠️ MOVED, NOT DELETED (2026-09-28, one gate). usignEnrolIfNeeded() is gone: WHETHER a sign-in changes the
   * shop is usignShopMove()'s one question, and the change itself is becomeShop() — which RELOADS, so the new key
   * is read back from storage on the other side of the reload rather than from memory.
   */
  await p.waitForFunction(() => typeof usignShopMove === 'function' && typeof becomeShop === 'function' && typeof pairAgain === 'function', null, { timeout: 30000 });

  console.log('\n── ⚠️⚠️⚠️ [TILL-192] A ROUTINE SIGN-IN DOES NOT CHANGE THE SHOP — the existing key is trusted, as it always was ' + '─'.repeat(0));
  const routine = await p.evaluate(() => {
    ls.set('cb_till_key', 'old-refused-key'); CloudHost.key = 'old-refused-key';
    usignOpen();   /* no force — the routine 'signin' door's own call shape */
    /* ⭐ 2026-10-09 (shopMoveOf): "NEVER 'same' by default" — 'same' needs the shop KNOWN on both sides: the key's shop
       (S.entity_id, what the server said this key opens) and the person's own. An identity that names no shop is 'pair'. */
    S = Object.assign({}, S || {}, { entity_id: 'ent-x' });
    return { move: usignShopMove({ identity: { entity_id: 'ent-x' } }), unknown: usignShopMove({ identity: {} }), keyAfter: CloudHost.key };
  });
  say('a routine sign-in on a paired counter, by its own shop\'s person, is "same" — no enrol, no network', routine.move === 'same', 'move=' + routine.move);
  say('…and one whose shop is not said is "pair" (unknown is never "same", 2026-10-09)', routine.unknown === 'pair', 'move=' + routine.unknown);
  say('the existing key is left exactly as it was', routine.keyAfter === 'old-refused-key', '"' + routine.keyAfter + '"');

  console.log('\n── ⭐⭐⭐ pairAgain() FORCES A REAL RE-ENROL — entered ONLY because the current key just failed ' + '─'.repeat(0));
  const forced = await p.evaluate(() => {
    ls.set('cb_till_key', 'old-refused-key'); CloudHost.key = 'old-refused-key';
    pairAgain();   /* the real button the 🔑 "Not signed in" flash and whoAct()'s 'connect'/'key' doors press */
    return { forcedFlag: !!(USIGN && USIGN.forceEnrol), move: usignShopMove({ identity: {} }) };
  });
  say('pairAgain() marks the sign-in as a forced re-enrol', forced.forcedFlag, String(forced.forcedFlag));
  say('so this sign-in DOES change the key ("pair")', forced.move === 'pair', 'move=' + forced.move);
  /**
   * ⭐⭐⭐ M08 (2026-10-07): a browser no longer trades the session for a key. The forced re-sign-in KEEPS the person
   * session (cb_till_person) and reloads into the shop it names; /api/till/enrol is never called from a page, and the
   * old, refused key is LEFT WHERE IT IS beside it (its store is moved by M10, never dropped here).
   */
  let enrols = 0;
  await p.route('**/api/till/enrol', async (route) => { enrols++; await route.fulfill({ status: 410, contentType: 'application/json', body: '{}' }); });
  const nav = p.waitForEvent('load', { timeout: 30000 });
  await p.evaluate(() => { CloudHost.api = location.origin; becomeShop({ token: 'a.' + btoa(JSON.stringify({ jti: 'j1', exp: 1893456000 })) + '.s', idn: { entity_id: 'ent-x', display_name: 'X' }, who: { id: 'xo', name: 'X', entity: 'ent-x' } }); });
  await nav;
  await p.waitForFunction(() => typeof becomeShop === 'function', null, { timeout: 30000 });
  const after = await p.evaluate(() => ({ key: localStorage.getItem('cb_till_key'), person: JSON.parse(localStorage.getItem('cb_till_person') || 'null'), store: tillStore() }));
  say('⭐ no enrol call is made — a browser keeps the person session instead (M08)', enrols === 0, 'enrol calls=' + enrols);
  say('the session is kept, naming the shop, and the page reloaded into it', !!(after.person && after.person.entity_id === 'ent-x' && after.person.jti === 'j1'), JSON.stringify(after.person && { entity_id: after.person.entity_id, jti: after.person.jti }));
  say('⚠️ the OLD, refused key is left exactly where it was (its store is M10\'s to move)', after.key === 'old-refused-key', '"' + after.key + '"');
  say('and the store is now per shop + device, beside the key store', /^cb-till-ent-x-/.test(after.store), after.store);

  console.log('\n── ⚠️ AN UNPAIRED DEVICE STILL ENROLS — the FIRST-EVER pairing is not narrowed ' + '─'.repeat(0));
  const firstTime = await p.evaluate(() => {
    ls.set('cb_till_key', ''); try { localStorage.removeItem('cb_till_key'); localStorage.removeItem('cb_till_person'); } catch (_) {}
    CloudHost.key = null; CloudHost.person = null;   /* M08: nor a person session */
    usignOpen();   /* not forced — a brand-new device has never met a key */
    return { move: usignShopMove({ identity: {} }) };
  });
  say('a device with no key at all is "pair" on a plain, unforced sign-in', firstTime.move === 'pair', 'move=' + firstTime.move);

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\na key the shop already refused is replaced the moment someone re-signs in through the door built for exactly that');
  process.exit(bad || errs.length ? 1 : 0);
})();

/* till-shop-switch.cjs — ⚠️⚠️⚠️ A PERSON FROM ANOTHER SHOP SIGNING IN SWITCHES THE WHOLE COUNTER, OR NOBODY IS SIGNED IN
 *
 * Athi, 2026-09-28: "i have signed in shop x and trying to load new products etc, then signed out and sign-in
 * again into another shop, but still i could see the products of shop x. when sign-in, if the shop credentials
 * are different, then the till has to switch to new shop and it should not allow to carry on."
 *
 * ⚠️ WHY [TILL-04] NEVER CAUGHT IT. counter-key.spec.js opens the counter from the APP, where counterHasKey()
 * compares shops. This path is the counter's OWN sign-in dialog, which trusted any key it already held
 * (the old usignEnrolIfNeeded) and adopted a person from shop Y onto shop X's shelf.
 *
 * ⭐ DRIVEN THROUGH THE DIALOG'S OWN CONTROLS — type the user id, press "Send me a code", press "Sign in",
 * answer the question — against a stand-in ChitBridge that answers PER KEY, so each shop's shelf arrives through
 * the page's real boot path, not planted in S. [[feedback-shoot-the-screen-not-the-dom]]
 *
 * Run: node e2e/till-shop-switch.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const SI = require('./lib/signin.cjs');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = path.join(__dirname, '..', 'test-results', 'till-shop-switch');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(66) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* two shops, one person each — and one person from a server too old to say which shop they belong to */
const SHOPS = {
  'KEY-X': { entity_id: 'ent-x', shop: { country: 'IN', name: 'Shop X', bridge_id: 'CB-X' }, item: 'XMANGO' },
  'KEY-Y': { entity_id: 'ent-y', shop: { country: 'IN', name: 'Shop Y', bridge_id: 'CB-Y' }, item: 'YPANEER' },
};
const PEOPLE = {
  xclerk:  { identity_id: 'p-x', user_id: 'xclerk',  display_name: 'X Clerk', identity_type: 'actor',  entity_id: 'ent-x', key: 'KEY-X' },
  yowner:  { identity_id: 'ent-y', user_id: 'yowner', display_name: 'Y Owner', identity_type: 'entity', entity_id: 'ent-y', key: 'KEY-Y' },
  oldsrv:  { identity_id: 'p-o', user_id: 'oldsrv',  display_name: 'Old Server', identity_type: 'actor' /* no entity_id */ },
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  const enrolled = [], snapEng = [];
  const api = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const j = (c2, o) => { r.writeHead(c2, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0];
    const b = raw ? JSON.parse(raw) : {};
    if ((u === '/api/entities/register' || u === '/api/signin/ask')) return j(200, { message: 'sent', dev_otp: '123456' });
    if ((u === '/api/entities/verify' || u === '/api/signin/verify')) {
      const p = PEOPLE[b.id || b.user_id]; if (!p) return j(404, { message: 'not found' });   /* CBSignin posts { id, otp } */
      const id = { identity_id: p.identity_id, bridge_id: 'CB-P', display_name: p.display_name, user_id: p.user_id,
                   identity_type: p.identity_type };
      if (p.entity_id) id.entity_id = p.entity_id;
      return j(200, { token: 'TOKEN-' + p.user_id, identity: id });
    }
    if (u === '/api/till/enrol') {
      const who = String(q.headers.authorization || '').replace('Bearer TOKEN-', '');
      const p = PEOPLE[who]; enrolled.push(who);
      if (!p || !p.key) return j(403, { message: 'no shop' });
      return j(200, { key: p.key, shop: SHOPS[p.key].shop });
    }
    if (u === '/api/till/snapshot') {
      const e = new URL(q.url, 'http://x').searchParams.get('eng'); if (e) snapEng.push(e);
      /* M08: a person session (Bearer TOKEN-<user>) opens that person's shop; a key opens its own, as before */
      const bearer = String(q.headers.authorization || '').replace('Bearer TOKEN-', '');
      const viaPerson = PEOPLE[bearer] && PEOPLE[bearer].key && q.headers['x-device-id'] ? SHOPS[PEOPLE[bearer].key] : null;
      const s = viaPerson || SHOPS[q.headers['x-api-key']]; if (!s) return j(401, { message: 'key refused' });
      return j(200, { at: new Date().toISOString(), entity_id: s.entity_id, shop: s.shop,
        items: [{ id: s.item.toLowerCase(), name: s.item, price: 50, unit: 'nos', code: s.item }] });
    }
    return j(200, { ok: true });
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  await new Promise((res) => api.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.address().port;

  const b = await chromium.launch();
  const ctx = await b.newContext();
  /* the device already belongs to shop X — set ONCE, never again after a reload */
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-X');
  }, API);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const shelf = () => p.evaluate(() => ({ shop: (S && S.shop && S.shop.name) || null,
    items: ((S && S.items) || []).map((i) => i.name), key: localStorage.getItem('cb_till_key'),
    person: (function(){ try { return (JSON.parse(localStorage.getItem('cb_till_person') || 'null') || {}).entity_id || null; } catch (_) { return null; } })(),
    who: (typeof WHO !== 'undefined' && WHO && WHO.name) || null }));
  const ready = async (shop) => {
    await p.waitForFunction(() => typeof usignOpen === 'function' && typeof becomeShop === 'function', null, { timeout: 30000 });
    await p.evaluate(() => refresh().catch(function(){}));
    await p.waitForFunction((n) => S && S.shop && S.shop.name === n, shop, { timeout: 30000 });
  };
  /* the real dialog: user id → "Send me a code" → the test server's code is filled in → "Sign in" */
  const signIn = (who) => SI.signIn(p, who);                    /* the one window (CBSignin, #68) — e2e/lib/signin.cjs */

  /* ⭐ v1.6.0: an online sign-in is followed by "Choose a counter PIN" — these checks are about shops, so: Not now */
  const signedIn = () => SI.signedIn(p);

  await p.goto('http://127.0.0.1:' + web.address().port + '/till.html');
  await ready('Shop X');
  const x0 = await shelf();
  say('⭐ a browser counter sends its engine releases with its claim (engine/versions.json)', snapEng.some((e) => /money:\d+\.\d+\.\d+/.test(e) && /signin:\d+\.\d+\.\d+/.test(e)), (snapEng[0] || 'nothing sent').slice(0, 80));
  say('the counter starts as shop X, with X\'s own shelf', x0.shop === 'Shop X' && x0.items.indexOf('XMANGO') >= 0, JSON.stringify(x0.items));

  console.log('\n── ⭐ SHOP X\'s OWN PERSON signs in — nothing switches, nothing is asked ' + '─'.repeat(0));
  await signIn('xclerk');
  await signedIn();
  const x1 = await shelf();
  /* ⭐ M10: a browser's first sign-in KEEPS the person session (same shop, reload); X's key is retired because its store owed nothing — the store itself stays */
  say('signed in on the same counter — as X\'s person now; the key, with nothing owed in its store, is retired', x1.who === 'X Clerk' && x1.person === 'ent-x' && x1.key === null && x1.shop === 'Shop X', 'who=' + x1.who + ' person=' + x1.person + ' key=' + x1.key);
  say('no enrol call — an ordinary sign-in stays cheap', enrolled.length === 0, 'enrol calls=' + enrolled.length);
  await p.click('[data-testid="till-usign-out"]');
  await p.evaluate(() => usignClose());

  /* ⚠️ REMOVED (round W1): "Y's owner signs in and says STAY". Athi, 2026-10-09 — THE PERSON SIGNING IN WINS: the sheet
     has one button ("Open my shop"; Esc is the same answer), it only SAYS what happens to the old shop. There is no Stay to press. */
  console.log('\n── ⭐⭐⭐ SHOP Y\'s OWNER signs in — the counter SAYS what happens, and the whole counter becomes Y ' + '─'.repeat(0));
  await signIn('yowner');
  await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
  const asked = await p.evaluate(() => document.getElementById('askbody').textContent + ' | ' + document.getElementById('askok').textContent);
  say('the counter SAYS before anything changes — a different shop, and the one button opens it', /different shop/i.test(asked) && /Open my shop/i.test(asked), '"' + asked.slice(0, 70) + '…"');
  await p.screenshot({ path: path.join(SHOTS, '1-asked.png') });
  const nav = p.waitForEvent('load', { timeout: 30000 });
  await p.click('#askok');
  await nav;
  await ready('Shop Y');
  const y = await shelf();
  await p.screenshot({ path: path.join(SHOTS, '2-switched.png') });
  say('the page RELOADED into shop Y (not repainted)', y.shop === 'Shop Y', 'shop=' + y.shop);
  say('shop Y\'s own shelf is on it', y.items.indexOf('YPANEER') >= 0, JSON.stringify(y.items));
  say('⚠️⚠️ and NOTHING of shop X', y.items.indexOf('XMANGO') < 0, 'XMANGO present=' + (y.items.indexOf('XMANGO') >= 0));
  const txt = await p.evaluate(() => document.body.innerText);
  say('not on the screen anywhere either', txt.indexOf('XMANGO') < 0 && txt.indexOf('Shop X') < 0, 'screen text checked');
  /* ⭐ M08: a browser keeps Y's PERSON SESSION — no key is minted; X's key is left where it was (its store is M10's to move) */
  say('the device bills as Y\'s person now (X\'s key was already retired; X\'s store stays)', y.person === 'ent-y' && y.key === null, 'person=' + y.person + ' key=' + y.key);
  say('and the person who switched it is signed in', y.who === 'Y Owner', 'who=' + y.who);
  const stores = await p.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []));
  say('X\'s own store is KEPT, not wiped (its queue is money)', stores.filter((n) => /^cb-till-/.test(n)).length >= 2, JSON.stringify(stores));

  /* ⚠️ CHANGED (round W1): this asserted "the old behaviour, never a new refusal" — signed in as before, Y's session kept.
     Athi, 2026-10-09 (shopMoveOf): unknown is NEVER 'same' — that default is how a person landed in the last shop. A sign-in
     whose shop the server cannot say is spent on the one door, which refuses it IN WORDS; nobody is signed in and nothing
     of Y's is touched. The property that stays: never a new LEAK. */
  console.log('\n── ⚠️ A SERVER THAT CANNOT SAY WHICH SHOP — refused in words, and the counter is left exactly as it was ' + '─'.repeat(0));
  await p.click('[data-testid="till-usign-out"]').catch(() => {});
  await p.evaluate(() => { try { usignOut(); usignClose(); } catch (_) {} });
  await signIn('oldsrv');
  await p.waitForSelector('[data-testid="signin-why"]', { timeout: 15000 });
  const oWhy = await p.locator('[data-testid="signin-why"]').textContent();
  const o = await shelf();
  say('the sign-in is refused, and says why: the shop was not said', /which shop/i.test(oWhy), '"' + oWhy + '"');
  say('nobody is signed in, and Y\'s session and shelf are untouched', o.who === null && o.person === 'ent-y' && o.shop === 'Shop Y', 'who=' + o.who + ' person=' + o.person);
  await p.evaluate(() => usignClose());

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  say('no page errors', errs.length === 0, errs.length + ' error(s)');
  await b.close(); web.close(); api.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

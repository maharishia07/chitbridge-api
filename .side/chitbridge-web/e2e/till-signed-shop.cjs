/* till-signed-shop.cjs — SIGNING IN ALWAYS OPENS THE SHOP THE PERSON SIGNED IN TO, NEVER THE ONE THIS DEVICE HAD
 *
 * Athi, 2026-10-09: signed in as mayri123 on the till and "veg shop" (the shop signed in earlier) appeared. Each shop has
 * its own store; the counter must not carry the previous shop. "Otherwise we are back to square 1."
 *
 * Driven through the dialog's own controls against a stand-in ChitBridge that answers PER KEY. Veg Shop's send is REFUSED
 * (503) so its unsent bill stays queued; the check is that it is still in Veg Shop's own store afterwards, and in no other.
 *   1  device paired to Veg Shop, shop read, a person of Fish Shop signs in -> told, no "Stay", lands in Fish Shop
 *   2  the same, but the page has NOT read its shop (offline start / before the snapshot) -> still Fish Shop
 *   3  a staff login of Veg Shop on the Veg Shop device -> Veg Shop, no question (same shop is correct)
 * Run: sh C:/dev/toolset/e2e.sh <checkout> e2e/till-signed-shop.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, 'FAILED'))); };
const SHOPS = {
  'KEY-A': { entity_id: 'ent-a', shop: { country: 'IN', name: 'Veg Shop', bridge_id: 'CB-A' }, item: 'AMANGO' },
  'KEY-B': { entity_id: 'ent-b', shop: { country: 'IN', name: 'Fish Shop', bridge_id: 'CB-B' }, item: 'BPRAWN' },
};
const PEOPLE = {
  mayri123: { identity_id: 'p-b', user_id: 'mayri123', display_name: 'Mayri', identity_type: 'actor', entity_id: 'ent-b', key: 'KEY-B' },
  vegstaff: { identity_id: 'p-a', user_id: 'vegstaff', display_name: 'Veg Staff', identity_type: 'actor', entity_id: 'ent-a', key: 'KEY-A' },
};
const BILL = 'C1/26-27/0001';

(async () => {
  let web, api, b;
  try {
    web = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
      r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    });
    api = http.createServer(async (q, r) => {
      let raw = ''; for await (const c of q) raw += c;
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      const j = (c2, o) => { r.writeHead(c2, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      const u = q.url.split('?')[0], bd = raw ? JSON.parse(raw) : {};
      const pid = String(bd.id || bd.user_id || '').trim().toLowerCase();
      if (u === '/api/entities/register' || u === '/api/signin/ask') return PEOPLE[pid] ? j(200, { message: 'sent' }) : j(404, { message: 'not known' });
      if (u === '/api/entities/verify' || u === '/api/signin/verify') {
        const p = PEOPLE[pid]; if (!p) return j(404, { message: 'not found' });
        return j(200, { token: 'TOKEN-' + p.user_id, identity: { identity_id: p.identity_id, bridge_id: 'CB-P', display_name: p.display_name,
          user_id: p.user_id, identity_type: p.identity_type, entity_id: p.entity_id } });
      }
      if (u === '/api/till/enrol') {
        const p = PEOPLE[String(q.headers.authorization || '').replace('Bearer TOKEN-', '')];
        if (!p) return j(403, { message: 'no shop' });
        return j(200, { key: p.key, shop: SHOPS[p.key].shop });
      }
      if (u === '/api/till/snapshot') {
        const bearer = String(q.headers.authorization || '').replace('Bearer TOKEN-', '');
        const via = PEOPLE[bearer] && q.headers['x-device-id'] ? SHOPS[PEOPLE[bearer].key] : null;
        const s = via || SHOPS[q.headers['x-api-key']]; if (!s) return j(401, { message: 'key refused' });
        return j(200, { at: new Date().toISOString(), entity_id: s.entity_id, shop: s.shop,
          items: [{ id: s.item.toLowerCase(), name: s.item, price: 50, unit: 'nos', code: s.item }] });
      }
      if (u === '/api/chits/send') return j(503, { message: 'line down' });       /* Veg Shop's bill must stay queued */
      return j(200, { ok: true });
    });
    await new Promise((res) => web.listen(0, '127.0.0.1', res));
    await new Promise((res) => api.listen(0, '127.0.0.1', res));
    const API = 'http://127.0.0.1:' + api.address().port, WEB = 'http://127.0.0.1:' + web.address().port;
    b = await chromium.launch();

    const storesOf = (p) => p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => /^cb-till-/.test(n)));
    const rows = (p, name) => p.evaluate((n) => new Promise((res) => {
      const rq = indexedDB.open(n); rq.onerror = () => res([]);
      rq.onsuccess = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('queue')) { db.close(); return res([]); }
        const g = db.transaction('queue').objectStore('queue').getAllKeys();
        g.onsuccess = () => { db.close(); res(g.result); };
      };
    }), name);
    const shelf = (p) => p.evaluate(() => ({ shop: (S && S.shop && S.shop.name) || null, items: ((S && S.items) || []).map((i) => i.name),
      who: (typeof WHO !== 'undefined' && WHO && WHO.name) || null, text: document.body.innerText }));

    async function scenario(title, who, unread) {
      console.log('\n-- ' + title);
      const ctx = await b.newContext();
      await ctx.addInitScript((a) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-A');
      }, API);
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(WEB + '/till.html');
      await p.waitForFunction(() => typeof usignOpen === 'function' && typeof becomeShop === 'function', null, { timeout: 30000 });
      await p.evaluate(() => refresh().catch(function () {}));
      await p.waitForFunction(() => S && S.shop && S.shop.name === 'Veg Shop', null, { timeout: 30000 });
      await p.evaluate((no) => DB.put('queue', { no: no, at: new Date().toISOString(), chitBody: { client_ref: no, total: 50 } }), BILL);
      await p.evaluate(async () => { const st = await HOST.state(); if (st) STATE = st; });   /* the counter's own queue count, as its 15 s tick reads it */
      const aStore = await storesOf(p);
      if (unread) {
        await p.evaluate(() => { S = null; Object.keys(localStorage).filter((k) => /^cb_till_shop/.test(k)).forEach((k) => localStorage.removeItem(k)); });
      }
      await p.evaluate(() => usignOpen());
      const promise = await p.textContent('[data-testid="till-usign-whichshop"]').catch(() => '');
      say('the sign-in window says it opens YOUR shop, naming none', /your own shop/i.test(promise) && !/Veg/.test(promise), '"' + promise + '"');
      await p.fill('[data-testid="signin-id"]', who);
      await p.click('[data-testid="signin-go"]');
      await p.waitForSelector('[data-testid="signin-code"]');
      await p.fill('[data-testid="signin-code"]', '123456');
      await p.click('[data-testid="signin-verify"]');
      return { p, ctx, aStore, errs };
    }
    const finish = async (sc) => { say('no page errors', sc.errs.length === 0, sc.errs.join(' | ') || 'none'); await sc.ctx.close(); };

    async function landsInFish(sc, expectAsk) {
      const p = sc.p;
      if (expectAsk) {
        await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
        const hidden = await p.evaluate(() => document.getElementById('askno').hidden);
        const txt = await p.evaluate(() => document.getElementById('askbody').textContent);
        say('told what happens to Veg Shop; there is NO "Stay" choice', hidden && !/stay\b/i.test(txt) && /unsent bill/i.test(txt) && /Veg Shop/.test(txt), '"' + txt.slice(0, 90) + '..."');
        const nav = p.waitForEvent('load', { timeout: 30000 });
        await p.click('#askok');
        await nav;
      } else {
        await p.waitForEvent('load', { timeout: 30000 });
      }
      await p.waitForFunction(() => typeof S !== 'undefined' && S && S.shop && S.shop.name === 'Fish Shop', null, { timeout: 30000 });
      const y = await shelf(p);
      say('lands in the shop the person signed in to (Fish Shop)', y.shop === 'Fish Shop' && y.items.indexOf('BPRAWN') >= 0, y.shop + ' ' + JSON.stringify(y.items));
      say('nothing of Veg Shop on the shelf or the screen', y.items.indexOf('AMANGO') < 0 && y.text.indexOf('AMANGO') < 0 && y.text.indexOf('Veg Shop') < 0, 'checked');
      say('and the person is signed in', y.who === 'Mayri', 'who=' + y.who);
      const stores = await storesOf(p), withBill = [];
      for (const n of stores) { if ((await rows(p, n)).indexOf(BILL) >= 0) withBill.push(n); }
      say('Veg Shop\'s unsent bill is still in ITS OWN store, and in no other', withBill.length === 1 && sc.aStore.indexOf(withBill[0]) >= 0 && stores.length > sc.aStore.length, JSON.stringify(withBill) + ' of ' + stores.length + ' stores');
    }

    let sc = await scenario('1 - device paired to Veg Shop, a person of Fish Shop signs in (shop read)', 'mayri123', false);
    await landsInFish(sc, true); await finish(sc);

    sc = await scenario('2 - the page has not read its shop yet: unknown must not mean keep the old shop', 'mayri123', true);
    await landsInFish(sc, false); await finish(sc);

    sc = await scenario('3 - a staff login of Veg Shop on the Veg Shop device: same shop, no question', 'vegstaff', false);
    await sc.p.waitForSelector('[data-testid="signin-pin1"], [data-testid="till-usign-in"]', { timeout: 15000 });
    if (await sc.p.locator('[data-testid="signin-later"]').count()) await sc.p.click('[data-testid="signin-later"]');
    await sc.p.waitForSelector('[data-testid="till-usign-in"]', { timeout: 10000 });
    const asked = await sc.p.evaluate(() => !!document.querySelector('#askdlg[open]'));
    const y3 = await shelf(sc.p);
    say('no question asked, still Veg Shop, the staff member is in', !asked && y3.shop === 'Veg Shop' && y3.who === 'Veg Staff', 'asked=' + asked + ' shop=' + y3.shop + ' who=' + y3.who);
    await finish(sc);
  } catch (e) {
    bad++; console.error('SPEC ERROR', e && e.message ? e.message : e);
  } finally {
    try { if (b) await b.close(); } catch (_) {}
    try { if (web) web.close(); } catch (_) {}
    try { if (api) api.close(); } catch (_) {}
    console.log('\n' + (bad ? bad + ' FAILED' : 'all good'));
    process.exit(bad ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });

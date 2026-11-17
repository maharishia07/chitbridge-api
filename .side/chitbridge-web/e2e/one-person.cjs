/* one-person.cjs — ONE BROWSER, ONE SHOP, PROVED (Athi, 2026-10-01).
 * *"the very first check is to see any fingerprint of any other entity here. if so make sure that it logs out and
 * very clear. do not allow the shop to open until the browser or session is clear out of danger."*
 *
 * Pattern: index-page.cjs / books-web.cjs — Playwright, ONE browser context (tabs share localStorage and a
 * BroadcastChannel, as a real browser's tabs do), a stand-in API answering INSIDE the page, the static server on a
 * free OS port. Nothing here reaches localhost:3000, port 7351, or the live site.
 *
 *  1  tab 1 signs in as Alpha Timers (A) → the shop opens; cb_sess and cb_owner say A
 *  2  tab 2 signs in as Tally Test (B) → STOPPED at "Close the other shop first": an app tab open · 1 unsent draft.
 *     The shop does not open, cb_sess is NOT B's, a renderApp() or a deep link from behind the screen opens nothing
 *  3  "Sync and sign Alpha Timers out" → tab 1 signs out and says why; A's session, draft and saved screen settings
 *     are gone; tab 2 opens as B; cb_owner says B
 *  4  the index in tab 3 shows B; the Till tile: not paired · paired to B · paired to Mayuri123 (amber, still a link)
 *  5  a co-assist of the SAME shop signs in → no screen, nobody is signed out
 *  6  sign out in tab 2 → the co-assist's tab and the index are signed out too; a read that lands late paints nothing
 *  7  a counter paired to Mayuri123 (in the counter's own IndexedDB) → B is stopped; the screen sends you to the
 *     counter; once the counter's keys say Mayuri123 is gone, "Check again" opens B. Never creates a database.
 *  8  A's session left behind with no tab → "still signed in" → cleared
 *  7  (changed 2026-10-01) a counter paired elsewhere with nothing unsent no longer stops B; a counter's unsent bills
 *     are a NOTICE (11): B opens, A's counter copy and key are byte-identical, and still drain (till.html, A's key)
 *  9  the index with another shop's app tab open → the close-first row instead of facts → cleared → facts
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const exp = Math.floor(Date.now() / 1000) + 3600;
const tok = (claims) => b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp }, claims)) + '.x';
const SHOPS = {
  alpha: { ent: 'ent-A', name: 'Alpha Timers', email: 'alpha@shop.in', items: 3 },
  tallytest: { ent: 'ent-B', name: 'Tally Test', email: 'tally@shop.in', items: 7 },
};
for (const k of Object.keys(SHOPS)) SHOPS[k].token = tok({ identity_id: SHOPS[k].ent, identity_type: 'entity' });
const RAVI = tok({ identity_id: 'act-B1', identity_type: 'actor', parent_entity_id: 'ent-B', parent_entity_name: 'Tally Test', display_name: 'Ravi' });

function claimsOf(h) { try { return JSON.parse(Buffer.from(String(h || '').replace(/^Bearer /, '').split('.')[1], 'base64').toString()); } catch (_) { return {}; } }
function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
  const c = claimsOf(q.headers().authorization), ent = c.parent_entity_id || c.identity_id;
  const shop = Object.values(SHOPS).find((s) => s.ent === ent);
  if (p === '/api/entities/register' && m === 'POST') { const s = SHOPS[String(body.display_name || '').toLowerCase()]; return s ? J(r, 200, { email: s.email }) : J(r, 404, { error: 'not found' }); }
  if (p === '/api/entities/verify' && m === 'POST') { const s = Object.values(SHOPS).find((x) => x.email === body.email); return s ? J(r, 200, { token: s.token, entity: { display_name: s.name, bridge_id: s.ent + '-br' } }) : J(r, 401, { error: 'bad code' }); }
  if (p === '/api/actors/check-login') return J(r, 200, { valid: true, has_pin: true });
  if (p === '/api/actors/login' && m === 'POST') return J(r, 200, { token: RAVI, actor: { display_name: 'Ravi', parent_entity: 'Tally Test', break_status: 'active' } });
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: shop ? shop.name : '', currency_code: 'INR', gstn: null } });
  if (p === '/api/products') {
    const n = shop ? shop.items : 0, items = [];
    for (let i = 0; i < n; i++) items.push({ id: 'p' + i, item_data: { price: { amount: 10 }, cost: { amount: 5 }, category: 'S' + i } });
    if (S.slowProducts) return new Promise((res) => setTimeout(() => res(J(r, 200, { items })), S.slowProducts));
    return J(r, 200, { items });
  }
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if ((!f.startsWith(PUB) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [];
  const S = {};
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route('**/api/**', (r) => route(S, r));
  /* the counter page is the counter's own (vendored, never driven here): a stand-in, so opening it changes no key */
  let tillOpened = 0;
  await ctx.route('**/till.html*', (r) => { tillOpened++; return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>counter stand-in</title>' }); });
  const tab = async (url) => { const p = await ctx.newPage(); p.on('pageerror', (e) => threw.push(e.message)); if (url) await p.goto(base + url); return p; };
  const ls = (p, k) => p.evaluate((k) => localStorage.getItem(k), k);
  const sessEnt = async (p) => { const s = JSON.parse(await ls(p, 'cb_sess') || 'null'); return s ? claimsOf('Bearer ' + s.token).parent_entity_id || claimsOf('Bearer ' + s.token).identity_id : null; };
  const opened = (p, ms) => p.waitForSelector('[data-testid="nav-home"]', { timeout: ms || 15000 }).then(() => true, () => false);
  const gated = (p, ms) => p.waitForSelector('[data-testid="gate"]', { timeout: ms || 15000 }).then(() => true, () => false);
  async function signIn(p, id, code) {
    if (!/#\/login/.test(p.url())) await p.goto(base + '/app.html#/login');
    await p.waitForSelector('#l_id', { timeout: 15000 });
    await p.fill('#l_id', id); await p.click('#l_go');
    const sel = id.includes('@') ? '#l_pin' : '#l_otp';
    await p.waitForSelector(sel, { timeout: 15000 });
    await p.fill(sel, code); await p.click('#l_go');
  }
  async function signOutVia(p) {
    await p.click('[data-testid="icon-logout"]');
    await p.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 });
    await p.click('[data-testid="confirm-ok"]');
  }

  /* ── 1 · A opens ─────────────────────────────────────────────────────────────────────────────────────────── */
  const t1 = await tab('/app.html#/login');
  await signIn(t1, 'alpha', '111111');
  ok(await opened(t1), '1 · Alpha Timers signs in in tab 1 — the shop opens');
  ok(await sessEnt(t1) === 'ent-A', '1 · cb_sess is A\'s');
  ok(JSON.parse(await ls(t1, 'cb_owner') || '{}').ent === 'ent-A', '1 · cb_owner says the browser\'s work is A\'s');
  /* what A leaves behind: a half-typed message, and a saved screen setting under A's id */
  await t1.evaluate(() => { localStorage.setItem('cb.draft.msg.c1', JSON.stringify({ at: Date.now(), data: 'half a message' }));
                             localStorage.setItem('cb_colw@ent-A', '{"w":1}'); });

  /* ── 2 · B is stopped ────────────────────────────────────────────────────────────────────────────────────── */
  const t2 = await tab('/app.html#/login');
  await signIn(t2, 'tallytest', '222222');
  ok(await gated(t2), '2 · Tally Test signs in in tab 2 — STOPPED at the close-first screen');
  const say = await t2.textContent('[data-testid="gate-other"]').catch(() => '');
  ok(/This browser still holds Alpha Timers: an app tab open · 1 unsent draft\. Close it first\./.test(say), '2 · it names the shop and what it holds ("' + say.replace(/\s+/g, ' ').trim().slice(0, 110) + '")');
  ok(/Sync and sign Alpha Timers out/.test(await t2.textContent('[data-testid="gate-clear"]').catch(() => '')), '2 · one button: "Sync and sign Alpha Timers out"');
  ok(!(await opened(t2, 600)), '2 · the shop has not opened');
  ok(await sessEnt(t2) === 'ent-A', '2 · cb_sess is NOT written for B before the browser is clean');
  /* the back doors: an async loader calling renderApp(), and a deep link, from behind the screen */
  await t2.evaluate(() => { try { renderApp(); } catch (_) {} });
  await t2.waitForTimeout(200);
  ok(await t2.locator('[data-testid="nav-home"]').count() === 0, '2 · a renderApp() from behind the screen paints no shop');
  await t2.waitForSelector('[data-testid="gate"]', { timeout: 5000 }).catch(() => {});
  await t2.evaluate(() => { location.hash = '#/app/messages'; }); /* the Ledger moved to accounts.html (app.html:4043), so a deep link to it leaves the page; messages stays in app.html */
  await t2.waitForTimeout(700);
  ok(await t2.locator('[data-testid="gate"]').count() === 1 && !(await opened(t2, 300)), '2 · renderApp() and a deep link from behind the screen open nothing');
  ok(await ls(t2, 'cb_nav@ent-B') === null, '2 · the deep link wrote nothing of B\'s either (route stopped before it)');
  ok(await opened(t1, 1000) && await sessEnt(t1) === 'ent-A', '2 · tab 1 is still A — nobody was switched silently');
  await t2.screenshot({ path: path.join(__dirname, 'shots', 'one-person-gate.png') }).catch(() => {});

  /* ── 3 · Sync and sign A out ─────────────────────────────────────────────────────────────────────────────── */
  await t2.click('[data-testid="gate-clear"]');
  ok(await opened(t2, 15000), '3 · after the clear-out, tab 2 opens as Tally Test');
  await t1.waitForSelector('[data-testid="signed-out-why"]', { timeout: 8000 }).catch(() => {});
  const why1 = await t1.textContent('[data-testid="signed-out-why"]').catch(() => '');
  ok(/^Signed out — Tally Test opened in another tab\.$/.test(why1.trim()), '3 · tab 1 signs out and says why ("' + why1.trim() + '")');
  ok(await t1.locator('#l_id').count() === 1 && await t1.locator('[data-testid="nav-home"]').count() === 0, '3 · tab 1 is at sign-in — it did not re-render as B');
  ok(await sessEnt(t2) === 'ent-B', '3 · cb_sess is now B\'s');
  ok(await ls(t2, 'cb.draft.msg.c1') === null, '3 · A\'s unsent draft is gone');
  ok(await ls(t2, 'cb_colw@ent-A') === null, '3 · A\'s saved screen settings are gone');
  ok(JSON.parse(await ls(t2, 'cb_owner') || '{}').ent === 'ent-B', '3 · cb_owner now says B');
  ok(/Tally Test/.test(await t2.evaluate(() => document.body.innerText)) && !/Alpha Timers/.test(await t2.evaluate(() => document.body.innerText)), '3 · tab 2 shows B\'s shop and nothing of A');
  await t1.screenshot({ path: path.join(__dirname, 'shots', 'one-person-left.png') }).catch(() => {});

  /* ── 4 · the index shows B, and the Till tile names the counter's shop ───────────────────────────────────── */
  /* N18: the index is the shell's Home. The shop's name is the shell's header; a card's figures come from its manifest facts read
     (none for the Till yet). A counter paired to ANOTHER shop earns an amber alert row (only a failing thing earns a row);
     paired here, or not paired, earns nothing. */
  const t3 = await tab('/');
  await t3.waitForSelector('[data-testid="shell-shop"]', { timeout: 15000 }).catch(() => {});
  await t3.waitForFunction(() => /Tally Test/.test((document.querySelector('[data-testid="shell-shop"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(/Tally Test/.test(await t3.textContent('[data-testid="shell-shop"]')), '4 · the index in tab 3 shows Tally Test');
  await t3.waitForTimeout(600);
  ok(await t3.locator('[data-testid="till-paired"]').count() === 0, '4 · no counter paired → no row (nothing wrong)');
  const pairTo = async (ent, name) => t2.evaluate(([e, n]) => { localStorage.setItem('cb_till_shop@abc1', e); localStorage.setItem('cb_till_shopname@abc1', n);
    localStorage.setItem('cb_till_key', 'k-' + e); localStorage.setItem('cb_till_lastslot', 'cb-till-abc1'); }, [ent, name]);
  await pairTo('ent-B', 'Tally Test');
  await t3.waitForTimeout(600);
  ok(await t3.locator('[data-testid="till-paired"]').count() === 0, '4 · paired here → still no row (repainted from the counter\'s keys, no reload)');
  await pairTo('ent-C', 'Mayuri123');
  await t3.waitForFunction(() => /Mayuri123/.test((document.querySelector('[data-testid="till-paired"]') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const amber = await t3.evaluate(() => { const e = document.querySelector('[data-testid="till-paired"]'); return e ? { t: e.textContent.replace(/\s+/g, ' ').trim(), warn: e.classList.contains('warn'), fix: (e.querySelector('.fix') || {}).getAttribute && e.querySelector('.fix').getAttribute('href') } : {}; });
  ok(/Counter 1 · paired to Mayuri123, not this shop/.test(amber.t || '') && amber.warn, '4 · paired elsewhere → an amber row "' + amber.t + '"');
  ok((amber.fix || '').indexOf('/till.html#shop=ent-B&as=Tally') === 0 && await t3.getAttribute('[data-testid="shell-card-till"]', 'href') === '/till.html', '4 · its button PAIRS the counter to this shop (SET-WALK1 W6: /till.html#shop=<ent>&as=<name>) and the Till card opens the counter');
  await t3.screenshot({ path: path.join(__dirname, 'shots', 'one-person-index-amber.png') }).catch(() => {});
  await t2.evaluate(() => ['cb_till_shop@abc1', 'cb_till_shopname@abc1', 'cb_till_key', 'cb_till_lastslot'].forEach((k) => localStorage.removeItem(k)));
  await t3.waitForFunction(() => !document.querySelector('[data-testid="till-paired"]'), null, { timeout: 5000 }).catch(() => {});

  /* ── 5 · the same shop passes cleanly ────────────────────────────────────────────────────────────────────── */
  const t4 = await tab('/app.html#/login');
  await signIn(t4, 'ravi@tallytest', '1234');
  ok(await opened(t4), '5 · Ravi, a co-assist of Tally Test, signs in — the shop opens');
  ok(await t4.locator('[data-testid="gate"]').count() === 0, '5 · no close-first screen for the same shop');
  await t4.waitForTimeout(600);
  ok(await opened(t2, 500) && await t2.locator('[data-testid="signed-out-why"]').count() === 0, '5 · the owner\'s tab 2 is still signed in');
  ok(/Tally Test/.test(await t3.textContent('[data-testid="shop-name"]')) && await t3.locator('[data-testid="signed-out-why"]').count() === 0, '5 · the index still shows Tally Test');
  /* RED (PRODUCT, P3): device-id.js (SEC-85) covers tab 2 with "You signed in as another shop in another tab" although Ravi is of the SAME shop.
     Tab 2 took over by the clear-out in place (no reload, no api write yet), so its remembered shop is still A's and Ravi's cb_sess storage event reads B as another shop.
     Fix belongs in device-id.js: follow the page's own cb_sess write. */
  ok(!(await t2.evaluate(() => CBDevice.stopped())), '5 · same shop, second person: tab 2 is NOT covered with "signed in as another shop" (SEC-85 false stop)');
  await t2.reload(); await opened(t2, 15000);   /* the cover's own advice, so the walk goes on */

  /* ── 6 · sign out in tab 2 → the others follow; a late read paints nothing ───────────────────────────────── */
  S.slowProducts = 1500;
  await t3.reload(); await t3.waitForSelector('[data-testid="till-paired"]', { timeout: 15000 }).catch(() => {});
  await signOutVia(t2);
  await t4.waitForSelector('[data-testid="signed-out-why"]', { timeout: 8000 }).catch(() => {});
  ok(/Signed out — you signed out in another tab\./.test(await t4.textContent('[data-testid="signed-out-why"]').catch(() => '')), '6 · sign out in tab 2 → the co-assist\'s tab signs out and says why');
  await t3.waitForSelector('[data-testid="signin-door"]', { timeout: 8000 }).catch(() => {});
  ok(await t3.locator('[data-testid="signin-door"]').count() === 1 && /signed out in another tab/.test(await t3.textContent('[data-slot="alerts"]')), '6 · the index signs out too, with the one door in');
  await t3.waitForTimeout(1800);
  ok(await t3.locator('.box .f').count() === 0, '6 · the read that landed after the sign-out painted nothing (' + await t3.locator('.box .f').count() + ' facts)');
  S.slowProducts = 0;
  ok(await t2.evaluate(() => _mePrefetch === null && _meReq === null && GATE.ent === null), '6 · signing out drops the old person\'s /me and closes the gate');

  /* ── 7 · a counter paired to another shop with NOTHING unsent: not a block, and nothing to say ──────────── */
  await t2.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('cb-till-c7', 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('bills', { keyPath: 'no' }); rq.result.createObjectStore('queue', { keyPath: 'no' }); };
    rq.onsuccess = () => { const db = rq.result; const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ entity_id: 'ent-C', shop: { name: 'Mayuri123' }, items: [] }, 'snapshot');
      tx.oncomplete = () => { db.close(); localStorage.setItem('cb_till_key', 'k-c'); localStorage.setItem('cb_till_lastslot', 'cb-till-c7'); res(); }; };
  }));
  await signIn(t2, 'tallytest', '222222');
  ok(await opened(t2), '7 · counter paired to Mayuri123, 0 unsent → Tally Test opens (the gate no longer stops for a counter)');
  ok(await t2.locator('[data-testid="gate"]').count() === 0 && await t2.locator('[data-testid="gate-notice"]').count() === 0, '7 · no gate screen and no notice (nothing is unsent)');
  ok(await sessEnt(t2) === 'ent-B', '7 · cb_sess is B\'s');
  const tr7 = await t2.evaluate(() => CBOnePerson.traces({ ent: 'ent-B' }).then((r) => ({ clean: r.clean, notice: r.notice, pair: r.pair.ent })));
  ok(tr7.clean && tr7.notice === null && tr7.pair === 'ent-C', '7 · traces: clean, no notice, the counter still read as Mayuri123\'s (' + JSON.stringify(tr7) + ')');
  /* the check never creates a database: a slot named but absent stays absent */
  await t2.evaluate(() => localStorage.setItem('cb_till_lastslot', 'cb-till-ghost'));
  await t2.evaluate(() => CBOnePerson.counterPair());
  const dbs = await t2.evaluate(() => indexedDB.databases().then((l) => l.map((d) => d.name)));
  ok(dbs.indexOf('cb-till-ghost') < 0, '7 · reading the counter never creates its database (' + JSON.stringify(dbs) + ')');
  await t2.evaluate(() => new Promise((res) => { ['cb_till_key', 'cb_till_lastslot'].forEach((k) => localStorage.removeItem(k));
    const d = indexedDB.deleteDatabase('cb-till-c7'); d.onsuccess = d.onerror = d.onblocked = () => res(); }));

  /* ── 8 · A's session left behind, no tab open ────────────────────────────────────────────────────────────── */
  await signOutVia(t2);
  await t2.waitForSelector('#l_id', { timeout: 8000 });
  await t2.evaluate((t) => localStorage.setItem('cb_sess', JSON.stringify({ token: t, role: 'entity', name: 'Alpha Timers', entity: 'Alpha Timers' })), SHOPS.alpha.token);
  for (const p of [t1, t3, t4]) await p.close();
  const t5 = await tab('/app.html#/login');
  await signIn(t5, 'tallytest', '222222');
  ok(await gated(t5), '8 · A\'s session left behind (no tab) → Tally Test is stopped');
  ok(/This browser still holds Alpha Timers: still signed in\. Close it first\./.test(await t5.textContent('[data-testid="gate-other"]').catch(() => '')), '8 · "This browser still holds Alpha Timers: still signed in."');
  await t5.click('[data-testid="gate-clear"]');
  ok(await opened(t5) && await sessEnt(t5) === 'ent-B', '8 · cleared → Tally Test opens, cb_sess is B\'s');

  /* ── 9 · the index, with another shop's app tab still open ───────────────────────────────────────────────── */
  const fake = await tab('/app.html#/login');   /* a tab that answers as A over the channel, as an old A tab would */
  await fake.evaluate(() => { window.__left = 0; const c = new BroadcastChannel('cb-one-person');
    c.onmessage = (e) => { const m = e.data || {}; if (m.t === 'who') c.postMessage({ t: 'here', q: m.q, tab: 'fake', ent: 'ent-A', uid: 'ent-A', name: 'Alpha Timers' });
      if (m.t === 'leave' && m.ent === 'ent-A') { window.__left++; c.close(); c2.postMessage({ t: 'left', q: m.q, tab: 'fake' }); } };
    const c2 = new BroadcastChannel('cb-one-person'); window.__c = c; });
  const t6 = await tab('/');
  await t6.waitForSelector('[data-testid="close-first"]', { timeout: 10000 }).catch(() => {});
  ok(/This browser still holds Alpha Timers: an app tab open\. Close it first\./.test(await t6.textContent('[data-slot="alerts"]')), '9 · the index with A\'s app tab open → the close-first row');
  ok(await t6.locator('#f_cat .f').count() === 0, '9 · and no facts while it is there');
  ok(await t6.locator('[data-testid="till-paired"]').count() === 1, '9 · the Till tile still says what the counter is paired to');
  await t6.screenshot({ path: path.join(__dirname, 'shots', 'one-person-index-close.png') }).catch(() => {});
  await t6.click('[data-testid="close-first-go"]');
  await t6.waitForFunction(() => /7/.test((document.getElementById('f_cat') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  ok(await fake.evaluate(() => window.__left) === 1, '9 · the A tab was told to leave');
  ok(/\b7\b/.test(await t6.textContent('#f_cat')) && await t6.locator('[data-testid="close-first"]').count() === 0, '9 · cleared → the index shows Tally Test\'s facts');

  /* ── 10 · START WITH A CLEAN BROWSER — a fresh context where service workers may register, as in a real one ── */
  {
    const c2 = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
    await c2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await c2.route('**/api/**', (r) => route(S, r));
    const tabC = async (url) => { const p = await c2.newPage(); p.on('pageerror', (e) => threw.push(e.message)); await p.goto(base + url); return p; };
    const a1 = await tabC('/app.html#/login');
    await signIn(a1, 'alpha', '111111');
    ok(await opened(a1), '10 · Alpha Timers opens in a fresh browser');
    await a1.waitForFunction(() => navigator.serviceWorker.getRegistrations().then((r) => r.length > 0), null, { timeout: 10000 }).catch(() => {});
    /* what a used browser holds: a counter paired to Mayuri123 with 2 bills in its queue, a Lab database, a cache,
       a session flag — and an Offer Lab tab open */
    await a1.evaluate(() => new Promise((res) => {
      const rq = indexedDB.open('cb-till-q1', 1);
      rq.onupgradeneeded = () => { ['kv'].forEach((n) => rq.result.createObjectStore(n)); rq.result.createObjectStore('queue', { keyPath: 'no' }); rq.result.createObjectStore('bills', { keyPath: 'no' }); };
      rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['kv', 'queue'], 'readwrite');
        tx.objectStore('kv').put({ entity_id: 'ent-C', shop: { name: 'Mayuri123' }, items: [] }, 'snapshot');
        tx.objectStore('queue').put({ no: 'C1/1' }); tx.objectStore('queue').put({ no: 'C1/2' });
        tx.oncomplete = () => { db.close(); localStorage.setItem('cb_till_key', 'k-q1'); localStorage.setItem('cb_till_lastslot', 'cb-till-q1');
          sessionStorage.setItem('cb_stay_in_app', '1');
          caches.open('cb-test').then((c) => c.put('/x', new Response('x'))).then(res); }; };
    }));
    const lab = await tabC('/offer-lab-next.html');
    await lab.waitForTimeout(800);
    const b1 = await tabC('/app.html#/login');
    await signIn(b1, 'tallytest', '222222');
    ok(await gated(b1), '10 · Tally Test is stopped (A\'s tab, and the counter paired to Mayuri123)');
    ok(await b1.locator('[data-testid="gate-start-clean"]').count() === 1 && /Or open a private window — it starts clean by itself\./.test(await b1.textContent('[data-testid="gate"]')),
      '10 · the screen offers "Start with a clean browser", and says a private window starts clean too');
    /* a Lab save that could not be sent yet is work too */
    /* the Labs' own schema (combo-lab.html LabDB): kv + an autoIncrement outbox, version 1 */
    const labRow = (add) => b1.evaluate((add) => new Promise((res) => { const rq = indexedDB.open('offerlab', 1);
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true }); };
      rq.onsuccess = () => { const db = rq.result;
      if (!db.objectStoreNames.contains('outbox')) { db.close(); return res('no outbox'); }
      const tx = db.transaction('outbox', 'readwrite'); if (add) tx.objectStore('outbox').put({ url: '/api/x', method: 'POST' }); else tx.objectStore('outbox').clear();
      tx.oncomplete = () => { db.close(); res('ok'); }; }; }), add);
    const lr = await labRow(true);
    await b1.click('[data-testid="gate-start-clean"]');
    await b1.waitForFunction(() => /Labs/.test((document.querySelector('[data-testid="gate-clean-why"]') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    ok(lr === 'ok' && /^The Labs still hold 1 unsent save\./.test((await b1.textContent('[data-testid="gate-clean-why"]')).trim()), '10 · a Lab save not sent yet → refused, and it says so (' + lr + ')');
    await labRow(false);
    /* a tab that answers the roll but never the wipe */
    const mute = await tabC('/app.html#/login');
    await mute.evaluate(() => { const c = new BroadcastChannel('cb-one-person'); c.onmessage = (e) => { const m = e.data || {}; if (m.t === 'roll') c.postMessage({ t: 'present', q: m.q, tab: 'mute', label: 'The stuck tab' }); }; window.__c = c; });
    await b1.click('[data-testid="gate-start-clean"]');
    await b1.waitForFunction(() => /No answer/.test((document.querySelector('[data-testid="gate-clean-why"]') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    ok(/^No answer from: The stuck tab\. Close it, then press again\.$/.test((await b1.textContent('[data-testid="gate-clean-why"]')).trim()), '10 · a tab that does not answer is NAMED, and nothing is wiped');
    ok(await ls(b1, 'cb_till_key') === 'k-q1', '10 · (the counter key is still there)');
    await mute.close();
    /* a per-tab key must go too — without one here, a wipe that skips sessionStorage looks the same as one that does it */
    await b1.evaluate(() => { sessionStorage.setItem('cb_stay_in_app', '1');
      localStorage.setItem('cb_till_shop@q1', 'ent-C'); localStorage.setItem('cb_till_shopname@q1', 'Mayuri123'); localStorage.setItem('cb_till_entity', 'ent-C');
      localStorage.setItem('cb-till-q1-queue-C1/3', JSON.stringify({ no: 'C1/3' })); localStorage.setItem('cb_other_junk', 'x'); });
    await b1.click('[data-testid="gate-start-clean"]');
    await b1.waitForURL(/\/app\.html#\/login$/, { timeout: 15000 }).catch(() => {});
    await b1.waitForSelector('[data-testid="signed-out-why"]', { timeout: 10000 }).catch(() => {});
    ok(/^This browser is clean\. 3 unsent bills for Mayuri123 stay on this browser\. They are sent when that counter is next opened online\.$/.test((await b1.textContent('[data-testid="signed-out-why"]').catch(() => '')).trim()),
      '10 · 3 unsent bills (2 + 1 fallback row) are SPARED, not refused: "' + (await b1.textContent('[data-testid="signed-out-why"]').catch(() => '')).trim() + '"');
    ok(/Signed out — this browser is being cleaned\./.test(await a1.textContent('[data-testid="signed-out-why"]').catch(() => '')), '10 · the other app tab signed out and says why');
    await lab.waitForURL(/cleaned=1/, { timeout: 5000 }).catch(() => {});
    ok(/cleaned=1/.test(lab.url()) && /this browser is being cleaned/.test(await lab.textContent('[data-slot="alerts"]').catch(() => '')), '10 · the Offer Lab tab left for the home page, which says so');
    await b1.waitForTimeout(800);
    const left = await b1.evaluate(async () => ({
      ls: Object.keys(localStorage).filter((k) => /^cb/.test(k)).sort(), ss: Object.keys(sessionStorage).filter((k) => /^cb/.test(k)),
      q: await new Promise((res) => { const rq = indexedDB.open('cb-till-q1'); rq.onsuccess = () => { const db = rq.result, g = db.transaction('queue').objectStore('queue').count(); g.onsuccess = () => { db.close(); res(g.result); }; }; }),
      db: (await indexedDB.databases()).map((d) => d.name), sw: (await navigator.serviceWorker.getRegistrations()).length, caches: await caches.keys() }));
    ok(JSON.stringify(left.ls) === JSON.stringify(['cb-till-q1-queue-C1/3', 'cb_till_entity', 'cb_till_key', 'cb_till_lastslot', 'cb_till_shop@q1', 'cb_till_shopname@q1']),
      '10 · only the spared counter\'s keys remain in localStorage (' + JSON.stringify(left.ls) + ')');
    ok(left.ss.length === 0, '10 · no cb* key in sessionStorage');
    ok(JSON.stringify(left.db) === JSON.stringify(['cb-till-q1']) && left.q === 2, '10 · only the counter\'s database is left, with its 2 queued bills (' + JSON.stringify(left.db) + ', ' + left.q + ')');
    ok(left.sw === 0, '10 · no service worker registered (' + left.sw + ')');
    ok(left.caches.length === 0, '10 · no cache left (' + JSON.stringify(left.caches) + ')');
    await b1.screenshot({ path: path.join(__dirname, 'shots', 'one-person-clean.png') }).catch(() => {});
    /* a pairing with NOTHING unsent is wiped as before: the key, the slot and its database go */
    await b1.evaluate(() => new Promise((res) => { const rq = indexedDB.open('cb-till-q1'); rq.onsuccess = () => { const db = rq.result, tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').clear(); tx.oncomplete = () => { db.close(); res(); }; }; }));
    await b1.evaluate(() => localStorage.removeItem('cb-till-q1-queue-C1/3'));
    const r0 = await b1.evaluate(() => CBOnePerson.startClean());
    const left0 = await b1.evaluate(async () => ({ ls: Object.keys(localStorage).filter((k) => /^cb/.test(k)), db: (await indexedDB.databases()).map((d) => d.name) }));
    ok(r0.ok && r0.kept === null && left0.ls.length === 0 && left0.db.length === 0, '10 · a counter paired with 0 unsent is cleared as before — key, slot and database gone (' + JSON.stringify(left0) + ')');
    await c2.close();
  }

  /* ── 11 · THE COURTESY (Athi, live, 2026-10-01): another shop's unsent bills are a notice, never a block ───── */
  {
    /* a stand-in ChitBridge for the counter page, on its own free OS port: it answers per KEY and records every send */
    const sent = [];
    const api = http.createServer(async (q, r) => {
      let raw = ''; for await (const c of q) raw += c;
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      const j = (c2, o) => { r.writeHead(c2, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      const u = q.url.split('?')[0], key = q.headers['x-api-key'];
      if (u === '/api/till/snapshot') return key === 'KEY-A' ? j(200, { at: new Date().toISOString(), entity_id: 'ent-A', shop: { name: 'Alpha Timers', bridge_id: 'CB-A' }, items: [{ id: 'm', name: 'MANGO', price: 5, unit: 'nos', code: 'M' }] }) : j(401, { message: 'key refused' });
      if (u === '/api/chits/send') { sent.push({ key, body: raw }); return key === 'KEY-A' ? j(200, { chit_id: 'chit-' + sent.length }) : j(403, { message: 'refused' }); }
      return j(200, { ok: true });
    });
    await new Promise((r) => api.listen(0, '127.0.0.1', r));
    const API = 'http://127.0.0.1:' + api.address().port;
    /* the counter's slot is named after its KEY (till.html tillStore(): djb2, base 36) — computed, never typed */
    const slotOf = (k) => { let h = 5381; for (let i = 0; i < k.length; i++) h = (((h * 33) ^ k.charCodeAt(i)) >>> 0); return 'cb-till-' + h.toString(36); };
    const SLOT = slotOf('KEY-A'), SFX = SLOT.slice(8);
    const mkCtx = async (viewport) => {
      const c = await b.newContext({ viewport: viewport || { width: 1280, height: 860 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await c.route('**/api/**', (r) => r.request().url().indexOf(API) === 0 ? r.fallback() : route(S, r));
      return c;
    };
    const tabOf = async (c, url) => { const p = await c.newPage(); p.on('pageerror', (e) => threw.push(e.message)); if (url) await p.goto(base + url); return p; };
    /* shop A's counter in this browser: 1 bill in IndexedDB, 1 in the localStorage fallback, its key and pairing keys */
    const seedA = (p, n) => p.evaluate(([slot, sfx, n]) => new Promise((res) => {
      const rq = indexedDB.open(slot, 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('bills', { keyPath: 'no' }); rq.result.createObjectStore('queue', { keyPath: 'no' }); };
      rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['kv', 'queue'], 'readwrite');
        tx.objectStore('kv').put({ entity_id: 'ent-A', shop: { name: 'Alpha Timers' }, items: [], at: '2026-10-01T00:00:00.000Z' }, 'snapshot');
        tx.objectStore('kv').put('ent-A', 'owner');
        for (let i = 0; i < n; i++) tx.objectStore('queue').put({ no: 'A1/' + (i + 1), total: 5 * (i + 1), lines: [{ id: 'm', qty: i + 1 }] });
        tx.oncomplete = () => { db.close();
          if (n) localStorage.setItem(slot + '-queue-A1/9', JSON.stringify({ no: 'A1/9', total: 9 }));
          localStorage.setItem('cb_till_key', 'KEY-A'); localStorage.setItem('cb_till_lastslot', slot); localStorage.setItem('cb_till_entity', 'ent-A');
          localStorage.setItem('cb_till_name', 'Counter 1'); localStorage.setItem('cb_till_shop@' + sfx, 'ent-A');
          localStorage.setItem('cb_till_shopname@' + sfx, 'Alpha Timers'); localStorage.setItem('cb_till_counter_name@' + sfx, 'Counter 1'); res(); }; };
    }), [SLOT, SFX, n]);
    /* every byte of A's counter copy: each store's keys and rows, plus every pairing / slot key in localStorage */
    const dumpA = (p) => p.evaluate((slot) => new Promise((res) => {
      const ls = {}; Object.keys(localStorage).filter((k) => /^cb_till_|^cb-till/.test(k)).sort().forEach((k) => { ls[k] = localStorage.getItem(k); });
      const rq = indexedDB.open(slot);
      rq.onsuccess = () => { const db = rq.result, out = {}, names = Array.from(db.objectStoreNames); let left = names.length;
        if (!left) return res(JSON.stringify({ ls, idb: null }));
        names.forEach((n) => { const st = db.transaction(n).objectStore(n), ks = st.getAllKeys(), vs = st.getAll();
          vs.onsuccess = () => { out[n] = { keys: ks.result, rows: vs.result }; if (!--left) { db.close(); res(JSON.stringify({ ls, idb: out })); } }; }); };
      rq.onerror = () => res(JSON.stringify({ ls, idb: 'no database' }));
    }), SLOT);
    const queueCount = (p) => p.evaluate((slot) => new Promise((res) => { const rq = indexedDB.open(slot);
      rq.onsuccess = () => { const db = rq.result, g = db.transaction('queue').objectStore('queue').count(); g.onsuccess = () => { db.close(); res(g.result); }; }; }), SLOT);
    const WORDS = '2 unsent bills for Alpha Timers stay on this browser. They are sent when that counter is next opened online.';

    /* ── (a) A's counter holds 2 unsent bills → B signs in and the shop OPENS ── */
    const ca = await mkCtx();
    const pa = await tabOf(ca, '/app.html#/login');
    await seedA(pa, 1);
    const before = await dumpA(pa);
    await signIn(pa, 'tallytest', '222222');
    ok(await opened(pa), '11a · A\'s counter holds 2 unsent bills (1 database, 1 fallback) → Tally Test signs in and the shop OPENS');
    ok(await pa.locator('[data-testid="gate"]').count() === 0, '11a · no gate screen');
    await pa.waitForSelector('[data-testid="gate-notice"]', { timeout: 5000 }).catch(() => {});
    const nt = (await pa.textContent('[data-testid="gate-notice"]').catch(() => '')).replace(/\s+/g, ' ').trim();
    ok(nt === WORDS + 'Dismiss', '11a · one line names A and the count: "' + nt + '"');
    ok(await sessEnt(pa) === 'ent-B' && JSON.parse(await ls(pa, 'cb_owner') || '{}').ent === 'ent-B', '11a · B\'s own session is in place, and the browser\'s work is now B\'s');
    ok(await dumpA(pa) === before, '11a · A\'s database, queue rows, fallback row, cb_till_key and @' + SFX + ' keys are byte-identical before and after (' + before.length + ' bytes)');
    ok(await ls(pa, 'cb_till_key') === 'KEY-A' && await ls(pa, 'cb_till_lastslot') === SLOT, '11a · the counter key and slot are still A\'s');
    await pa.screenshot({ path: path.join(__dirname, 'shots', 'gate-courtesy-signin.png') });
    await pa.click('[data-testid="gate-notice-x"]');
    ok(await pa.locator('[data-testid="gate-notice"]').count() === 0, '11a · the notice is dismissible');
    /* the index page: the same words, no button needed, the facts still show */
    const pi = await tabOf(ca, '/');
    await pi.waitForSelector('[data-testid="gate-notice"]', { timeout: 15000 }).catch(() => {});
    await pi.waitForFunction(() => /7/.test((document.getElementById('f_cat') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    ok((await pi.textContent('[data-testid="gate-notice"]').catch(() => '')).replace(/\s+/g, ' ').trim().replace(/^!/, '') === WORDS + 'Dismiss' && await pi.locator('[data-testid="close-first"]').count() === 0, '11a · the index shows the same words, and no close-first row');
    ok(/\b7\b/.test(await pi.textContent('#f_cat')), '11a · and B\'s own figures (7 products)');
    await pi.screenshot({ path: path.join(__dirname, 'shots', 'gate-courtesy-index.png') });

    /* ── (e) the kept bills are still sendable: the counter opens against a stand-in, with A's key ── */
    const till = await tabOf(ca);
    await till.addInitScript((a) => { try { localStorage.setItem('cb_till_api', a); } catch (_) {} }, API);
    await till.goto(base + '/till.html');
    await till.waitForFunction(() => typeof refresh === 'function' && typeof S !== 'undefined', null, { timeout: 30000 }).catch(() => {});
    await till.evaluate(() => refresh().catch(function () {})).catch(() => {});
    for (let i = 0; i < 60 && (await queueCount(till)) > 0; i++) { await till.waitForTimeout(500); if (i % 6 === 5) await till.evaluate(() => (typeof drain === 'function' ? drain({ force: true }) : (CloudHost && CloudHost.drain && CloudHost.drain({ force: true }))).catch(function () {})).catch(() => {}); }
    ok(await queueCount(till) === 0, '11e · after B\'s sign-in, the counter opens with A\'s key and A\'s queue drains to 0');
    ok(sent.length === 1 && sent.every((x) => x.key === 'KEY-A'), '11e · the stand-in got the bills under A\'s key (' + sent.length + ' sent, keys ' + JSON.stringify(sent.map((x) => x.key)) + ')');
    ok(await ls(pa, 'cb_till_key') === 'KEY-A', '11e · A\'s counter key is still in place after the drain');
    await ca.close();

    /* ── (b) A paired with 0 unsent → B opens, no notice ── */
    const cb = await mkCtx();
    const pb = await tabOf(cb, '/app.html#/login');
    await seedA(pb, 0);
    await signIn(pb, 'tallytest', '222222');
    ok(await opened(pb), '11b · A paired with 0 unsent → Tally Test opens');
    ok(await pb.locator('[data-testid="gate"]').count() === 0 && await pb.locator('[data-testid="gate-notice"]').count() === 0, '11b · no gate and no notice');
    await cb.close();

    /* ── (d) another shop's live tab still blocks — the counter's bills do not change that, and are named only as a trace ── */
    const cd = await mkCtx();
    const pd = await tabOf(cd, '/app.html#/login');
    await seedA(pd, 1);
    const fakeA = await tabOf(cd, '/app.html#/login');
    await fakeA.evaluate(() => { const c = new BroadcastChannel('cb-one-person'), c2 = new BroadcastChannel('cb-one-person');
      c.onmessage = (e) => { const m = e.data || {}; if (m.t === 'who') c2.postMessage({ t: 'here', q: m.q, tab: 'fakeA', ent: 'ent-A', uid: 'ent-A', name: 'Alpha Timers' });
        if (m.t === 'leave' && m.ent === 'ent-A') { c.close(); c2.postMessage({ t: 'left', q: m.q, tab: 'fakeA' }); } }; window.__c = [c, c2]; });
    const dBefore = await dumpA(pd);
    await signIn(pd, 'tallytest', '222222');
    ok(await gated(pd), '11d · another shop\'s live tab open → STOPPED as before, even with its counter holding bills');
    ok(/This browser still holds Alpha Timers: an app tab open · a counter paired to it\. Close it first\./.test(await pd.textContent('[data-testid="gate-other"]').catch(() => '')), '11d · the same sentence as today');
    ok(await pd.locator('[data-testid="gate-counter"]').count() === 0 && await pd.locator('[data-testid="gate-notice"]').count() === 0, '11d · no counter block and no notice on the gate screen itself');
    await pd.click('[data-testid="gate-clear"]');
    ok(await opened(pd), '11d · once the tab is cleared, Tally Test opens');
    await pd.waitForSelector('[data-testid="gate-notice"]', { timeout: 5000 }).catch(() => {});
    ok((await pd.textContent('[data-testid="gate-notice"]').catch(() => '')).indexOf(WORDS) === 0, '11d · and the notice follows the clear-out');
    ok(await dumpA(pd) !== null && (await ls(pd, 'cb_till_key')) === 'KEY-A' && JSON.parse(dBefore).idb.queue.rows.length === 1 && (await queueCount(pd)) === 1, '11d · clearing the tab touched nothing of A\'s counter (key kept, queue 1)');
    await cd.close();

    /* ── phone: 390 px, no sideways scroll, the notice readable ── */
    const cp = await mkCtx({ width: 390, height: 800 });
    const pp = await tabOf(cp, '/app.html#/login');
    await seedA(pp, 1);
    await signIn(pp, 'tallytest', '222222');
    await pp.waitForSelector('[data-testid="gate-notice"]', { timeout: 15000 }).catch(() => {});
    const sw = await pp.evaluate(() => document.documentElement.scrollWidth);
    ok(sw === 390 && await pp.locator('[data-testid="gate-notice"]').count() === 1, '11 · phone (390 px): scrollWidth === ' + sw + ' and the notice is there');
    await pp.screenshot({ path: path.join(__dirname, 'shots', 'gate-courtesy-phone.png') });
    await cp.close();
    api.close();
  }

  /* ── the words ── */
  const src = fs.readFileSync(path.join(PUB, 'app', 'one-person.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  { const W = {}; new Function('window', 'self', fs.readFileSync(path.join(PUB, 'app', 'one-person.js'), 'utf8').replace(/\}\)\(typeof window[^;]*;\s*$/, '})(window);'))(W, W);
    const N = W.CBOnePerson.noticeSentence;
    ok(N({ name: 'Mayuri Bhavan', unsent: 1 }) === '1 unsent bill for Mayuri Bhavan stays on this browser. It is sent when that counter is next opened online.', 'the words: one bill, with the shop named');
    ok(N({ name: '', unsent: 3 }) === '3 unsent bills for another shop stay on this browser. They are sent when that counter is next opened online.', 'the words: several bills, no name → "another shop"'); }
  ok(!/accounting/i.test(src), 'the word "accounting" appears nowhere in what this adds');

  const mine = threw.filter((m) => !/fonts|favicon/i.test(m));
  ok(mine.length === 0, 'no page error' + (mine.length ? ' — ' + mine.slice(0, 3).join(' | ').slice(0, 300) : ''));
  await b.close(); srv.close();
  console.log('\n  one-person: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
/* a harness that stops part-way is a failed check, said as one — a break that strands it must still read as caught */
})().catch((e) => { console.log('  XX  the harness stopped: ' + String((e && e.message) || e).split('\n')[0]); console.log('\n  one-person: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });

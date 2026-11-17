/* till-counter-faults.cjs — four counter faults from the backlog (M12 · M13 · M18 · M19, 2026-09-28), one case each
 *
 *   M12  a combo naming an age-restricted part billed with no age prompt
 *   M13  a shop-set theme could never take effect (the device's default always won)
 *   M18  Julian dating: nothing asserted the number a bill is actually GIVEN
 *   M19  a category with an apostrophe ("Baker's") could never be chosen
 *
 * The real till.html, a stand-in ChitBridge, through the page's own controls where there is one.
 * Run: node e2e/till-counter-faults.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const SI = require('./lib/signin.cjs');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  const api = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const j = (c2, o) => { r.writeHead(c2, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0];
    if (u === '/api/till/snapshot') return j(200, { at: new Date().toISOString(), entity_id: 'ent-x', shop: { country: 'IN', name: 'Shop X', bridge_id: 'CB-X' },
      till: { suggested_id: 'C1', assigned_id: 'C1' },
      items: [
        { id: 'beer', name: 'BEER', price: 200, unit: 'nos', code: 'BEER1', category: 'Drinks', age_check: 21 },
        { id: 'party', name: 'PARTY PACK', price: 500, unit: 'nos', code: 'PARTY1', category: 'Drinks', combo_of: ['BEER'] },
        { id: 'bun', name: 'BUN', price: 20, unit: 'nos', code: 'BUN1', category: "Baker's" },
        { id: 'mango', name: 'XMANGO', price: 50, unit: 'nos', code: 'XMANGO', category: 'Fruit' },
      ] });
    if ((u === '/api/entities/register' || u === '/api/signin/ask')) return j(200, { message: 'sent', dev_otp: '123456' });
    if ((u === '/api/entities/verify' || u === '/api/signin/verify')) return j(200, { token: 'T', identity: { identity_id: 'p-x', user_id: 'xclerk', display_name: 'X Clerk', identity_type: 'actor', entity_id: 'ent-x' } });
    if (u === '/api/chits/send') return j(200, { chit_id: 'c1' });
    return j(200, { ok: true });
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  await new Promise((res) => api.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-X');
  }, API);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + web.address().port + '/till.html');
  await p.waitForFunction(() => typeof refresh === 'function' && typeof ageOf === 'function', null, { timeout: 30000 });
  await p.evaluate(() => refresh().catch(function(){}));
  await p.waitForFunction(() => S && S.shop && S.shop.name === 'Shop X' && (S.items || []).length === 4, null, { timeout: 30000 });
  /* the window does not prefill the stand-in's dev_otp — the code is typed, as a person would (e2e/lib/signin.cjs) */
  await SI.signIn(p, 'xclerk'); await SI.signedIn(p);
  await p.evaluate(() => usignClose());

  console.log('\n── M12 · ⚠️⚠️ a combo naming an 18+/21+ part asks for the age check ' + '─'.repeat(0));
  await p.fill('#q', 'PARTY');
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  await p.waitForSelector('#askdlg[open]', { timeout: 5000 }).catch(() => {});
  const asked = await p.evaluate(() => { var d = document.getElementById('askdlg'); return d && d.open ? d.innerText : ''; });
  say('adding PARTY PACK (names BEER, 21+) asks the age question', /under 21/.test(asked), '"' + asked.replace(/\s+/g, ' ').slice(0, 70) + '"');
  if (asked) await p.click('#askno');
  say('and "no" keeps it off the bill', await p.evaluate(() => !CART.some(function(c){ return c.name === 'PARTY PACK'; })), 'cart has ' + await p.evaluate(() => CART.length) + ' line(s)');

  console.log('\n── M19 · ⚠️ the "Baker\'s" chip can be chosen ' + '─'.repeat(0));
  await p.fill('#q', '');
  await p.evaluate(() => { try { searchTyped(); } catch (_) {} });
  const chip = p.locator('[data-testid="till-chip-baker-s"]');
  await chip.waitFor({ timeout: 10000 });
  await chip.click();
  const f19 = await p.evaluate(() => ({ cat: FILTER.cat, on: (document.querySelector('[data-testid="till-chip-baker-s"]') || {}).className || '' }));
  say('the chip filters on the category\'s real name', f19.cat === "Baker's" && /\bon\b/.test(f19.on), JSON.stringify(f19));
  await chip.click();

  console.log('\n── M13 · ⚠️ a theme the SHOP set takes effect where this device never chose one ' + '─'.repeat(0));
  const t13 = await p.evaluate(() => {
    localStorage.removeItem('cb_till_theme');
    tillOptSet({ screen: Object.assign({}, tillOpt().screen || {}, { theme: 'navy' }) });
    var shop = screenCfg().theme;
    ls.set('cb_till_theme', 'dark');
    var device = screenCfg().theme;
    localStorage.removeItem('cb_till_theme');
    return { shop: shop, device: device };
  });
  say('no choice on this device → the shop\'s navy', t13.shop === 'navy', 'theme ' + t13.shop);
  say('a choice made on this device still wins', t13.device === 'dark', 'theme ' + t13.device);

  console.log('\n── M18 · Julian dating: the number a bill is actually GIVEN ' + '─'.repeat(0));
  await p.evaluate(() => { tillOptSet({ series: Object.assign({}, tillOpt().series || {}, { dating: 'julian' }) }); });
  await p.fill('#q', 'XMANGO');
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  await p.click('[data-testid="till-pay-cash"]');
  await p.fill('#tendered', '500');
  await p.click('#save');
  await p.waitForSelector('#sliptitle', { timeout: 20000 });
  const r18 = await p.evaluate(() => {
    var t = document.getElementById('sliptitle').textContent || '';
    var want = (window.CBDoc && CBDoc.julianLabel) ? CBDoc.julianLabel(new Date(), 0) : null;
    return { title: t, want: want };
  });
  say('the bill number carries today\'s Julian date', !!r18.want && r18.title.indexOf('/' + r18.want + '/') >= 0, r18.title.trim() + ' · julian ' + r18.want);

  console.log('\n── M15 · what the browser counter KEEPS — once a business day, unsent never leaves ' + '─'.repeat(0));
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  await p.evaluate(async (at) => {
    var mk = function(no, sent){ var b = { no: no, at: at, total: 50, lines: [{ name: 'XMANGO', qty: 1, net: 50 }], payments: [{ how: 'Cash', amount: 50 }] };
      if (sent) b._sent = { chit_id: 'c-' + no }; return b; };
    await DB.put('bills', mk('OLD/0001', true)); await DB.put('bills', mk('OLD/0002', true)); await DB.put('bills', mk('OLD/0003', false));
    ls.set(shopLs('cb_till_retained'), '2000-01-01');
  }, old);
  await p.reload();
  await p.waitForFunction(() => typeof retainDaily === 'function' && S && S.shop, null, { timeout: 30000 });
  await p.waitForFunction(() => ls.get(shopLs('cb_till_retained'), '') === bizDay(), null, { timeout: 15000 }).catch(() => {});
  const r15 = await p.evaluate(async (at) => {
    var nos = ((await DB.all('bills')) || []).map(function(b){ return b.no; });
    var dk = dayKeyOf(at); /* CTR-242: the till keys a day's summary by the SHOP day, not the UTC date */
    return { nos: nos, dk: dk, sum: !!(await DB.get('sum:' + dk)), ran: ls.get(shopLs('cb_till_retained'), '') === bizDay() };
  }, old);
  say('the day\'s first open ran it (not only a counter being retired)', r15.ran, 'ran=' + r15.ran);
  say('settled bills older than 30 days left this device', r15.nos.indexOf('OLD/0001') < 0 && r15.nos.indexOf('OLD/0002') < 0, 'kept: ' + r15.nos.join(', '));
  say('⚠️⚠️ the UNSENT one stayed, however old', r15.nos.indexOf('OLD/0003') >= 0, 'OLD/0003 kept');
  say('and the day they left was summarised first', r15.sum, 'sum:' + r15.dk);
  await p.evaluate(() => openSettings('technical'));
  await p.waitForSelector('[data-testid="till-set-keep-days"]', { timeout: 10000 });
  await p.fill('[data-testid="till-set-keep-days"]', '7');
  await p.dispatchEvent('[data-testid="till-set-keep-days"]', 'change');
  await p.waitForFunction(() => /\S/.test((document.querySelector('[data-testid="till-set-keep-say"]') || {}).textContent || ''), null, { timeout: 10000 });
  const s15 = await p.evaluate(() => ({ days: retainLimits().days, say: document.querySelector('[data-testid="till-set-keep-say"]').textContent }));
  say('Settings shows the three limits, saves a change, and says what binds', s15.days === 7 && /bill/.test(s15.say), JSON.stringify(s15));
  await p.evaluate(() => { retainSet('days', 30); setClose(); });

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ').slice(0, 300) : 'none');
  say('no page errors', errs.length === 0, errs.length + ' error(s)');
  await b.close(); web.close(); api.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

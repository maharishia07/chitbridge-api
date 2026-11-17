/* till-tidy.cjs — round 4b-tidy: the gaps the black-box walk found, held (2026-10-09). No new function: each check reads what the
 * till already does. Run: sh C:/dev/toolset/e2e.sh <checkout> e2e/till-tidy.cjs   (SHOT_PHASE=before|after names the screenshots)
 * Stand-in HOST as phone-till.cjs: one page-local object, no server, ports from the OS. window.print is silenced. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = path.join(__dirname, 'shots', 'till-tidy');
const PHASE = process.env.SHOT_PHASE || 'after';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(72) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const CATS = ['Tiffin', 'Chinese', 'South Indian Meals', 'Beverages', 'Desserts and Sweets', 'North Indian Curries', 'Snacks'];
const ITEMS = [];
for (let n = 0; n < 40; n++) ITEMS.push({ item_id: 'i' + n, name: (n % 3 ? 'Dosa ' : 'Idli ') + n, code: 'C' + n, category: CATS[n % CATS.length], unit: 'plate', price: 40 + n, tax_rate: n % 5 ? 5 : null });
ITEMS.push({ item_id: 'chilli', name: 'Chilli Paneer', code: 'CP', category: 'Chinese', unit: 'plate', price: 185, tax_rate: 5,
  modifiers: [{ name: 'Spice', required: true, max: 1, options: [{ name: 'Mild', price: 0 }, { name: 'Medium', price: 0 }, { name: 'Hot', price: 0 }] }] });
function web() {
  return http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
}
const SIZES = [{ n: '1366', o: { viewport: { width: 1366, height: 768 } } },
  { n: '390', o: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }];
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = web(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const WEB = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  for (const sz of SIZES) {
    console.log('\n── ' + sz.n + ' px ' + '─'.repeat(40));
    const ctx = await b.newContext(Object.assign({ locale: 'en-IN' }, sz.o)); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.addInitScript(() => { window.print = function () {}; });
    const shot = (n) => p.screenshot({ path: path.join(SHOTS, PHASE + '-' + sz.n + '-' + n + '.png') });
    await p.goto(WEB + '/till.html');
    await p.waitForFunction(() => typeof modOpen === 'function' && typeof finish === 'function', null, { timeout: 30000 });
    await p.evaluate((items) => {
      window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', gstin: '33ABCDE1234F1Z5', reg_type: 'regular' }, items: items, offers: [], at: new Date().toISOString() };
      CloudHost.key = 'demo-key'; ls.set(tillGivenKey(), 'C1'); window.WHO = { id: 'c1', name: 'Clerk', kind: 'coassist' };
      var BILLS = [];
      window.HOST = { mode: 'cloud', key: 'demo-key',
        bill: async function (body) { var s = Object.assign({}, body, { no: 'C1/26-27/' + (BILLS.length + 1), at: new Date().toISOString(), _sent: { at: Date.now(), chit_id: 'x' } }); BILLS.push(s); return { ok: true, bill: s, today: { count: BILLS.length, total: 0, by: {} } }; },
        bills: async function () { return BILLS.slice(); },
        state: async function () { return { snapshot: window.S, online: true, queued: 0, today: { count: BILLS.length, total: 0, by: {} }, till: { id: 'C1', name: 'Counter 1', host: 'this device' }, engines: {} }; } };
      setMode('sell'); applyLook(); try { stepsApply(); paintHits(); paintChips(); paintQuick(); paintSide(); } catch (_) {}
    }, ITEMS);
    await p.waitForTimeout(400);
    await shot('01-shelf');

    /* 1 · the rail */
    const wide = sz.n === '1366';
    if (wide) {
      const rail = await p.evaluate(() => [].map.call(document.querySelectorAll('#tillsideicons > button'), (b) => b.getAttribute('data-testid')));
      say('the rail holds at most 7 icons (Menu + Bills · Check · Expense · Settings · Install)', rail.length <= 7, rail.length + ': ' + rail.join(' '));
      /* T2i (M207, round W1): Labs left the rail for the Menu — so no Labs icon at all here, let alone three (asserted below too) */
      say('no rail icon for the three Labs separately', !rail.some((t) => /productlab|offerlab|combolab/.test(t)), '');
      say('Capability health is not on the rail', !rail.some((t) => /-line$/.test(t)), '');
      const noTitle = await p.evaluate(() => [].filter.call(document.querySelectorAll('#tillsideicons > button'), (b) => !b.title).length);
      say('every rail icon says what it is (tooltip)', noTitle === 0, noTitle + ' without');
    }

    /* 2 · one Check */
    await p.evaluate(() => { toggleMenu(); });
    await p.waitForTimeout(200);
    const doors = await p.evaluate(() => ({ chip: !!document.querySelector('[data-testid="till-hub-chip-alerts"]'), fn: typeof openCheck === 'function' }));
    say('one Check: openCheck exists', doors.fn, JSON.stringify(doors));
    if (doors.chip) {
      await p.click('[data-testid="till-hub-chip-alerts"]'); await p.waitForTimeout(200);
      const a = await p.evaluate(() => ({ open: !document.getElementById('tillmenu').hidden, on: !!document.querySelector('[data-testid="till-msec-alerts"].open') }));
      say('the "need you" chip opens the Check section', a.open && a.on, JSON.stringify(a));
      await p.click('[data-testid="till-hub-chip-alerts"]').catch(() => {}); await p.waitForTimeout(150);
      const a2 = await p.evaluate(() => !!document.querySelector('[data-testid="till-msec-alerts"].open'));
      say('pressing it again keeps Check open (a door, not a toggle)', a2, '');
    }
    await p.evaluate(() => { closeMenu(); });
    if (wide) {
      await p.click('[data-testid="till-side-check"]', { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(250);
      const c = await p.evaluate(() => ({ open: !document.getElementById('tillmenu').hidden, on: !!document.querySelector('[data-testid="till-msec-alerts"].open'),
        health: !!(document.getElementById('healthdlg') || {}).open }));
      say('the rail Check opens the same Check section (not a second dialog)', c.open && c.on && !c.health, JSON.stringify(c));
      await shot('02-check');
      await p.evaluate(() => { closeMenu(); });
      /* T2i (M207): the rail's Labs slot is the Expense register; Labs stay in the Menu (Lab section) */
      const rl = await p.evaluate(() => ({ labs: !!document.querySelector('[data-testid="till-side-labs"]'), exp: !!document.querySelector('[data-testid="till-side-expense"]') }));
      say('the rail holds Expense, not Labs', rl.exp && !rl.labs, JSON.stringify(rl));
      await p.evaluate(() => { openLabs(); }); await p.waitForTimeout(250);
      const l = await p.evaluate(() => ({ open: !document.getElementById('tillmenu').hidden, rows: ['productlab', 'offerlab', 'combolab'].filter((k) => document.querySelector('[data-testid="till-' + k + '"]')).length }));
      say('Labs still open from the Menu: Product · Offer · Combo', l.open && l.rows === 3, JSON.stringify(l));
      await shot('02-labs');
      await p.evaluate(() => { closeMenu(); });
    }
    /* 3 · one Customer screen */
    await p.evaluate(() => { toggleMenu(); }); await p.waitForTimeout(150);
    const scr = await p.evaluate(() => ({ show: !!document.querySelector('[data-testid="till-msec-show"]'),
      names: [].filter.call(document.querySelectorAll('#tillmenu .mt b'), (e) => /shop screen|show the shop|customer screen/i.test(e.textContent)).map((e) => e.textContent) }));
    say('one "Customer screen" entry in the menu', !scr.show && scr.names.length === 1 && /Customer screen/.test(scr.names[0]), JSON.stringify(scr));
    await p.evaluate(() => { closeMenu(); });

    /* 4 · not connected said once */
    const nc = await p.evaluate(() => {
      var s0 = window.S, k0 = CloudHost.key, p0 = CloudHost.person; window.S = null; CloudHost.key = null; CloudHost.person = null; try { paintFoot(); } catch (_) {} paintHits(); paintQuick(); try { paintCart(); } catch (_) {}
      var n = (document.body.innerText.match(/not connected to a shop/gi) || []).length, c = !!document.querySelector('[data-testid="till-connect"]');
      window.S = s0; CloudHost.key = k0; CloudHost.person = p0; paintHits(); paintQuick(); return { n: n, connect: c };
    });
    say('"not connected to a shop" is said once, with its Connect button', nc.n === 1 && nc.connect, JSON.stringify(nc));

    /* 5 · search shown once, one scroll, chips */
    await p.fill('#q', 'dosa'); await p.waitForTimeout(400);
    await shot('03-search');
    const sr = await p.evaluate(() => {
      var q = document.getElementById('quick'), h = document.getElementById('hits');
      var vis = (e) => e && e.offsetParent !== null && e.getBoundingClientRect().height > 4;
      var scrolls = [q, h].filter((e) => vis(e) && e.scrollHeight > e.clientHeight + 2).length;
      return { quick: vis(q), hits: vis(h), scrolls: scrolls };
    });
    say('search results shown once (tiles OR list)', !(sr.quick && sr.hits), JSON.stringify(sr));
    say('one scroll area for the items', sr.scrolls <= 1, 'scrolling boxes: ' + sr.scrolls);
    await p.fill('#q', ''); await p.waitForTimeout(300);
    const cl = await p.evaluate(() => {
      var c = document.getElementById('chips'); var cr = c.getBoundingClientRect();
      var bs = [].slice.call(c.querySelectorAll('button')).filter((b) => b.offsetParent);
      var cut = bs.filter((b) => { var r = b.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1; }).length;
      return { n: bs.length, cut: cut, scrollW: c.scrollWidth, w: c.clientWidth };
    });
    say('category chips are not cut mid-word', cl.cut === 0 && cl.scrollW <= cl.w + 2, JSON.stringify(cl));
    await shot('04-chips');
    const two = await p.evaluate(() => { var q = document.getElementById('quick'), h = document.getElementById('hits');
      var vis = (e) => e && e.offsetParent !== null && e.getBoundingClientRect().height > 4;
      return [q, h].filter((e) => vis(e) && e.scrollHeight > e.clientHeight + 2).length; });
    say('idle shelf: one scroll area too', two <= 1, 'scrolling boxes: ' + two);

    /* 6 · kitchen badge counts kitchen lines only */
    const kb = await p.evaluate(() => {
      tillOptSet({ kot: true }); CART.length = 0; STATE = Object.assign({}, STATE, { queued: 3 }); try { paintOrderBar(); } catch (_) {}
      var b = document.querySelector('[data-testid="till-kot"] b'); return b ? b.textContent : '';
    });
    say('Kitchen badge ignores unsent bills (3 waiting, empty bill)', kb === '', 'badge="' + kb + '"');
    const kb2 = await p.evaluate(() => {
      var i = S.items[0]; CART.push({ item_id: i.item_id, name: i.name, qty: 1, price: i.price, unit: 'plate' });
      try { paintOrderBar(); } catch (_) {}
      var b = document.querySelector('[data-testid="till-kot"] b'); var v = b ? b.textContent : ''; CART.length = 0; try { paintOrderBar(); } catch (_) {} return v;
    });
    say('Kitchen badge counts a line for the kitchen', kb2 === '1', 'badge=' + kb2);

    /* 7 · TB1: no "in the combo" on a single dish */
    await p.evaluate(() => { var i = S.items.filter((x) => x.item_id === 'chilli')[0]; modOpen(i); });
    await p.waitForSelector('#moddlg[open]', { timeout: 5000 }).catch(() => {});
    const mw = await p.evaluate(() => { var d = document.getElementById('moddlg'); return d ? d.innerText : ''; });
    say('a single dish does not say "in the combo"', /Medium/.test(mw) && !/in the combo/i.test(mw), 'sheet has ' + mw.length + ' chars');
    await shot('05-options');
    await p.evaluate(() => { var d = document.getElementById('moddlg'); if (d && d.open) d.close(); });

    /* 9 · TS12: no warning on every row */
    const rn = await p.evaluate(() => (document.getElementById('hits').innerText.match(/rate not set/g) || []).length);
    say('"rate not set" is not repeated on the rows', rn === 0, rn + ' row(s)');
    say('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(bad ? '\n✗ ' + bad + ' FAILED' : '\nall OK'); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

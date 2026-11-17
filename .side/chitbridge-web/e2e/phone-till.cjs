/* phone-till.cjs — ⚠️⚠️ BACK MUST NEVER LOSE THE PERSON OR THE BILL (T66/T67/T69, Athi's phone test 2026-10-04)
 *
 * Athi rang two cash bills on a phone. Three things went wrong: the phone's own Back button left till.html
 * outright with a product sheet open; the paid receipt had no Share and, once closed, could not be found
 * again; Today's bills spoke in "20:00" and "(s)". This walks the same phone through all three, through the
 * real screen — taps, not function calls, for every step the proof asks for.
 *
 * ⭐ STAND-IN, NOT A LIVE SERVER. HOST here is a page-local object that writes a bill to memory and hands it
 * back — the same shape CloudHost.bill()/bills() return, never a second reading of what a bill IS. The only
 * other things planted are this shop's two products and the facts a real pairing would already have put on
 * this device (a given counter number, somebody signed in) — never the sign-in/enrol code itself.
 *
 * Run: node e2e/phone-till.cjs   (never localhost:3000, never 7351, never the live site: ports from the OS)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = path.join(__dirname, 'shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  locale: 'en-IN',   /* the shop's own locale time format (T69) — "8 pm", not whatever the CI box defaults to */
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36' };

/* a plain cup of tea (adds straight to the bill) and a dosa that asks a question first (opens the product sheet) */
const TEA = { item_id: 't1', name: 'Tea', code: 'T1', category: 'Drinks', unit: 'cup', price: 15 };
const DOSA = { item_id: 'd1', name: 'Masala Dosa', code: 'D1', category: 'Tiffin', unit: 'plate', price: 70,
  modifiers: [{ name: 'Choose a chutney', required: true, max: 1,
                options: [{ name: 'Coconut', price: 0 }, { name: 'Tomato', price: 0 }] }] };

function webServer(){
  return http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const web = webServer();
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  const WEB = 'http://127.0.0.1:' + web.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext(PHONE);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  const shot = async (n) => { const f = 'phone-till-' + n + '.png'; await p.screenshot({ path: path.join(SHOTS, f) }); return f; };

  await p.goto(WEB + '/till.html');
  await p.waitForFunction(() => typeof modOpen === 'function' && typeof finish === 'function', null, { timeout: 30000 });

  /* ⚠️ the ONLY things planted: a shop with two products, this counter's own given number and somebody signed
     in — exactly the facts a real pairing leaves on the device — and a stand-in HOST that writes a bill to
     memory instead of a server. The sign-in and enrol code is not touched or bypassed; sign-in is simply not
     what this walk is testing. */
  await p.evaluate(({ tea, dosa }) => {
    window.S = { shop: { name: 'Mayur Bhavan', currency: 'INR', country: 'IN' }, items: [tea, dosa], offers: [], at: new Date().toISOString() };
    CloudHost.key = 'demo-key';                                 /* paired() reads this, whatever HOST is */
    ls.set(tillGivenKey(), 'C1');                                /* tillStopped() must stay a real gate */
    window.WHO = { id: 'c1', name: 'Clerk', kind: 'coassist' };
    var BILLS = [];
    window.HOST = {
      mode: 'cloud', key: 'demo-key',
      bill: async function(body){
        var no = 'C1/26-27/' + String(BILLS.length + 1).padStart(4, '0');
        /* ⭐ _sent, as a real drain() would stamp once the shop acknowledged it — this stand-in answers
           straight away, which is the same "online, acknowledged" case */
        var saved = Object.assign({}, body, { no: no, at: new Date().toISOString(), _sent: { at: Date.now(), chit_id: no } });
        BILLS.push(saved);
        return { ok: true, bill: saved, today: { count: BILLS.length,
          total: BILLS.reduce(function(t, x){ return t + (x.total || 0); }, 0), by: {} } };
      },
      bills: async function(){ return BILLS.slice(); },
      state: async function(){ return { snapshot: window.S, online: true, queued: 0,
        today: { count: BILLS.length, total: 0, by: {} }, till: { id: 'C1', name: 'Counter 1', host: 'this device' }, engines: {} }; },
    };
    setMode('sell'); applyLook(); try { stepsApply(); paintHits(); } catch (_) {}
  }, { tea: TEA, dosa: DOSA });
  await p.waitForTimeout(300);
  await shot('01-shelf');

  console.log('\n── ⭐ 1 · pick a product, then the phone\'s own Back — T66 ' + '─'.repeat(10));
  await p.fill('#q', 'Tea');
  await p.waitForSelector('[data-testid="till-hit-0"][data-item="t1"]', { timeout: 10000 });
  await p.tap('[data-testid="till-add-0"]');                     /* a plain product — straight onto the bill */
  await p.waitForTimeout(150);
  const afterTea = await p.evaluate(() => CART.length);
  say('the plain product went straight onto the bill', afterTea === 1, 'cart has ' + afterTea + ' line(s)');

  await p.fill('#q', 'Dosa');
  await p.waitForSelector('[data-testid="till-hit-0"][data-item="d1"]', { timeout: 10000 });
  await p.tap('[data-testid="till-add-0"]');                      /* a product with a choice — opens the sheet */
  await p.waitForSelector('#moddlg[open]', { timeout: 10000 });
  await shot('02-mod-open');
  say('the product sheet opened', true, 'the chutney choice, not yet answered');

  await p.goBack();
  await p.waitForTimeout(250);
  const back1 = await p.evaluate(() => ({ url: location.pathname, modOpen: !!(document.getElementById('moddlg') || {}).open,
    cart: CART.length, title: document.title }));
  await shot('03-after-back');
  say('⭐⭐ still on till.html — the browser did not leave the page', /till\.html$/.test(back1.url), back1.url);
  say('the product sheet is closed', !back1.modOpen, 'moddlg.open=' + back1.modOpen);
  say('the bill keeps its line (the Tea it already had)', back1.cart === 1, back1.cart + ' line(s)');

  console.log('\n── a bill in hand — Back asks before leaving ' + '─'.repeat(10));
  await p.goBack();
  await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
  const confirmText = (await p.locator('#askdlg').innerText()).replace(/\s+/g, ' ');
  await shot('04-leave-confirm');
  say('⭐⭐ Back with a bill in hand asks first, and names the bill', /Leave the counter/.test(confirmText) && /stays on this device/.test(confirmText), '"' + confirmText + '"');
  await p.click('#askno');                                        /* Stay */
  await p.waitForTimeout(150);
  const stayed = await p.evaluate(() => ({ url: location.pathname, cart: CART.length }));
  say('choosing to stay keeps the till open, with the line still on it', /till\.html$/.test(stayed.url) && stayed.cart === 1, JSON.stringify(stayed));

  console.log('\n── ⭐ 2 · pay, share, and find the bill again — T67 ' + '─'.repeat(10));
  await p.tap('[data-testid="till-step-pay"]');
  await p.evaluate(() => { try { paintPays(); } catch (_) {} });
  await p.tap('[data-testid="till-pay-cash"]');
  await p.tap('#save');
  await p.waitForSelector('#slipdlg[open]', { timeout: 10000 });
  await shot('05-receipt');
  const receipt = await p.evaluate(() => ({
    share: !(document.getElementById('slipshare') || {}).hidden,
    print: (function(){ const b = document.getElementById('slipprint'); return !!b && getComputedStyle(b).display !== 'none'; })(),
    title: (document.getElementById('sliptitle') || {}).textContent || '',
    lastno: window.LASTNO,
  }));
  say('⭐⭐ the receipt shows a Share control', receipt.share, 'slipshare hidden=' + !receipt.share);
  say('⭐ and Print beside it, on a phone too (Athi: share AND print)', receipt.print, 'slipprint shown=' + receipt.print);
  say('it is the bill just rung', /C1\//.test(receipt.title), '"' + receipt.title + '"');

  await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
  await p.waitForTimeout(150);
  await shot('06-after-pay');
  const after = await p.evaluate(() => ({
    cart: CART.length,
    lastbill: (document.querySelector('[data-testid="till-lastbill"]') || {}).textContent || '',
  }));
  say('the bill is empty, and names the last one rather than staying blank', after.cart === 0 && /Last bill/.test(after.lastbill), after.lastbill);
  const lastno = await p.evaluate(() => window.LASTNO);
  say('"Last bill …" carries the real bill number', after.lastbill.indexOf(lastno) >= 0, '"' + after.lastbill + '"');

  /* ⚠️ finish() sends the next customer to Items ("the next customer starts at Items") — the phone's Bill
     step, where this message lives, is one tap away, same as it always was for an empty bill. */
  await p.tap('[data-testid="till-step-bill"]');
  await p.waitForSelector('[data-testid="till-lastbill"]', { state: 'visible', timeout: 10000 });
  await p.tap('[data-testid="till-lastbill"]');
  await p.waitForSelector('#slipdlg[open]', { timeout: 10000 });
  const reopened = await p.evaluate(() => (document.getElementById('sliptitle') || {}).textContent || '');
  await shot('07-lastbill-reopened');
  say('"Last bill" reopens the SAME bill (reprint → showSlip, not a copy)', reopened === receipt.title, '"' + reopened + '"');
  await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });

  console.log('\n── ⭐ 3 · Today\'s bills, in plain words — T69 ' + '─'.repeat(10));
  await p.evaluate(() => openBills());
  await p.waitForSelector('#billsdlg[open]', { timeout: 10000 });
  await shot('08-todays-bills');
  const bills = await p.evaluate(() => ({
    hour: document.querySelector('#billsbody details summary').innerText.replace(/\s+/g, ' '),
    banner: (document.querySelector('[data-testid="till-sync-report"]') || {}).innerText || '',
    dayclose: (document.getElementById('billsbody') ? document.querySelector('[data-testid="till-dayclose"]').getAttribute('aria-label') : ''),
    close: document.querySelector('[data-testid="till-bills-close"]').textContent,
  }));
  say('the hour group reads in words, not "HH:00"', /\d{1,2}\s?(am|pm)\s?–\s?\d{1,2}\s?(am|pm)/i.test(bills.hour), '"' + bills.hour + '"');
  say('and never "(s)"', !/\(s\)/.test(bills.hour) && !/\(s\)/.test(bills.banner), 'hour="' + bills.hour + '" banner="' + bills.banner + '"');
  say('one bill today reads "The bill reached the shop"', /The bill reached the shop/.test(bills.banner), '"' + bills.banner.replace(/\s+/g, ' ') + '"');
  say('the buttons read "Day report" and "✕"', bills.dayclose === 'Day report' && bills.close === '✕', '"' + bills.dayclose + '" / "' + bills.close + '"');
  await p.tap('[data-testid="till-bills-close"]');
  await p.waitForTimeout(150);
  say('✕ closes Today\'s bills', !(await p.evaluate(() => (document.getElementById('billsdlg') || {}).open)), 'closed');

  console.log('\nshots: e2e/shots/phone-till-*.png');
  say('no page errors', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 300) : 'none');
  await b.close(); web.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

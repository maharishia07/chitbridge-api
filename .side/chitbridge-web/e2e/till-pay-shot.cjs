/* till-pay-shot.cjs — DOES THE PAY CARD LOOK LIKE png/FullTabletPay.png? ([TILL-59], 2026-09-19)
 * Drives the CONTROL, never the function: it clicks the Pay button a cashier would tap.
 * Run: node e2e/till-pay-shot.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
                '.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json' };
const ITEMS = [
  { item_id:'t1', name:'Red Label Green tea 100 g', code:'BEV-1', category:'Beverages', unit:'pkt', price:64 },
  { item_id:'t2', name:'Tata Health drink 100 g',   code:'BEV-2', category:'Beverages', unit:'pkt', price:163 },
  { item_id:'t3', name:'Tata Filter coffee 250 g',  code:'BEV-3', category:'Beverages', unit:'pkt', price:352 },
];
(async () => {
  const srv = http.createServer((q,r)=>{ const rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
    const f=path.join(ROOT,rel);
    if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}
    r.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream'});
    fs.createReadStream(f).pipe(r); });
  await new Promise(r=>srv.listen(0,r));
  const base='http://127.0.0.1:'+srv.address().port;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1280,height:900}, deviceScaleFactor:2 });
  const threw=[]; p.on('pageerror',e=>threw.push(e.message));
  await p.goto(base+'/till.html');
  await p.waitForFunction(()=>typeof window.setMode==='function'&&!!window.CBSearch,null,{timeout:30000});

  const before = await p.evaluate((items)=>{
    window.S={shop:{country: 'IN', name:'CB Test Traders',currency:'INR'},items:items,offers:[],at:new Date().toISOString()};
    /* the TABLET layout — the case this exists for: pay is a 'step' while the shape stays wide */
    screenSet({ layout:'tablet' });
    setMode('sell');
    items.forEach(function(i){ addItem(i, 5); });
    /* ⚠️ addItem() does not repaint — its callers do (add() → repaint() → price()). Seeding the cart
       without that leaves the totals, and therefore the Pay button, at zero. */
    price();
    return { layout: screenCfg().layout, paySlot: slotAt('pay'), card: payAsCard() };
  }, ITEMS);
  /* ⚠️ addItem() schedules the repaint rather than painting inline, so the button arrives a frame later.
     Reading it immediately says '(none)' about a control that is about to be perfectly fine. */
  await p.waitForSelector('[data-testid="till-paygo"]', { timeout: 5000 });
  before.go = await p.evaluate(() => document.getElementById('paygo').innerText.replace(/s+/g, ' '));
  console.log('layout=' + before.layout + ' paySlot=' + before.paySlot + ' payAsCard=' + before.card);
  console.log('button · ' + before.go.replace(/\s+/g,' '));

  /* ⚠️ DRIVE THE CONTROL, not payOpen() — a button that is unreachable is the bug this feature fixes */
  await p.click('[data-testid="till-paygo"]');
  await p.waitForSelector('body.paying', { timeout: 4000 });
  const card = await p.evaluate(()=>{
    const z=document.getElementById('payzone'); const r=z.getBoundingClientRect();
    return { top:Math.round(r.top), h:Math.round(r.height), w:Math.round(r.width),
             text:z.innerText.replace(/\s+/g,' ').slice(0,200) };
  });
  console.log('card · top=' + card.top + ' ' + card.w + '×' + card.h);
  console.log('     · ' + card.text);
  const shot = path.join(__dirname,'shots','pay-card.png');
  fs.mkdirSync(path.dirname(shot),{recursive:true});
  await p.screenshot({ path: shot });
  console.log('wrote ' + shot);

  /* ⚠️⚠️ AND ESCAPE MUST CLOSE THE CARD, NOT THE BILL — [TILL-30] */
  await p.keyboard.press('Escape');
  const after = await p.evaluate(()=>({ paying: document.body.classList.contains('paying'), lines: CART.length }));
  console.log('escape · paying=' + after.paying + ' lines still=' + after.lines
    + (after.lines === 3 && !after.paying ? '  ✓ the bill survived' : '  ✗ TILL-30 REGRESSION'));

  /* ⚠️⚠️ WITH THE CARD CLOSED THE FOOT IS Clear · Park · Pay AND NOTHING ELSE. Leaving the tenders and
     Save & print in the flow made Pay a SECOND way to take money — the duplicate-button design I argued
     against, built by accident. */
  const closed = await p.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return { tenders: vis(document.querySelector('#pay button')), take: vis(document.querySelector('.take')),
             save: vis(document.getElementById('save')), clear: vis(document.querySelector('.go button')),
             pay: vis(document.querySelector('[data-testid="till-paygo"]')) };
  });
  const footOk = !closed.tenders && !closed.take && !closed.save && closed.clear && closed.pay;
  console.log('closed · tenders=' + closed.tenders + ' take=' + closed.take + ' save=' + closed.save
    + ' clear=' + closed.clear + ' pay=' + closed.pay + (footOk ? '  ✓ one way to take money' : '  ✗ Pay is a DUPLICATE route'));
  if (!footOk) process.exitCode = 1;

  /* ⭐⭐ AND THE KEYBOARD TERMINAL MUST BE EXACTLY AS IT WAS — no Pay button, tenders and Save inline. */
  const desk = await p.evaluate(() => {
    screenSet({ layout: 'horizontal' }); price();
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return { card: payAsCard(), slot: slotAt('pay'), pay: vis(document.querySelector('[data-testid="till-paygo"]')),
             tenders: vis(document.querySelector('#pay button')), save: vis(document.getElementById('save')),
             cls: document.body.className };
  });
  const deskOk = !desk.card && !desk.pay && desk.tenders && desk.save && desk.cls.indexOf('paycard') < 0;
  console.log('horizontal · slot=' + desk.slot + ' payAsCard=' + desk.card + ' payBtn=' + desk.pay
    + ' tenders=' + desk.tenders + ' save=' + desk.save + (deskOk ? '  ✓ the keyboard terminal is untouched' : '  ✗ CHANGED'));
  if (!deskOk) process.exitCode = 1;

  if (threw.length) { console.log('THREW · ' + threw.join(' | ')); process.exitCode = 1; }
  await b.close(); srv.close();
})();

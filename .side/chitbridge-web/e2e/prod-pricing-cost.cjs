/* prod-pricing-cost.cjs — [OFFR-02] COST AND MARKUP ARE VISIBLE ON THE PRODUCT'S OWN PRICING TAB, READ-ONLY
 *
 * Athi: "the price updated should be visible in offer lab, either in the backend app or in the frontend
 * app... can we bring a markup value in the screen, we have to see where we can showcase? where it will be
 * suitable, any standard or switch can be introduced?"
 *
 * The standard already existed: lib/item-cost.js says cost "MUST NEVER REACH A CUSTOMER-FACING SURFACE",
 * unconditionally, no switch — exposure.js already enforces that for the storefront. Markup carries the
 * same risk and follows the same rule; no switch is introduced because none is needed on a screen (app.html's
 * product editor) that was never customer-facing to begin with.
 *
 * ⚠️⚠️⚠️ THIS DOES NOT MINT AN ENTITY OR SIGN IN — prodCostMarkupHTML(d) takes a plain item_data object,
 * nothing about UI.prods, a session or a network call, the same offline-provable shape prod-modifiers-tab.cjs
 * already established for this page's other read-only tabs.
 *
 * Run: node e2e/prod-pricing-cost.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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
  await p.goto('http://127.0.0.1:' + srv.address().port + '/app.html');
  await p.waitForFunction(() => typeof prodCostMarkupHTML === 'function', null, { timeout: 30000 });

  console.log('\n── ⭐ no cost yet — an answer, not a blank, with the one door that can set it ' + '─'.repeat(0));
  const noCost = await p.evaluate(() => prodCostMarkupHTML({ price: 100 }));
  say('says plainly that no cost is set', /Cost.*not set/.test(noCost.replace(/<[^>]+>/g, ' ')), 'found');
  say('and points at Offer Lab, the one place it is written', /Offer Lab/.test(noCost), 'found');
  say('never computes a markup with no cost to compute it from', !/Markup/.test(noCost), 'no Markup label shown');

  console.log('\n── ⭐⭐⭐ a real cost — the exact percentage a shopkeeper would work out by hand ' + '─'.repeat(0));
  const withCost = await p.evaluate(() => prodCostMarkupHTML({ price: 100, cost: { value: 40, source: 'manual' } }));
  say('the cost value itself is shown', /40/.test(withCost), 'found');
  say('markup is (price−cost)/cost — 150% here, not price/cost or some other formula', /150%/.test(withCost), withCost.replace(/<[^>]+>/g, ' ').trim());

  console.log('\n── ⚠️ cost above price is a real, negative markup — never hidden, never clamped to zero ' + '─'.repeat(0));
  const loss = await p.evaluate(() => prodCostMarkupHTML({ price: 40, cost: { value: 50, source: 'manual' } }));
  say('a loss shows as a real negative percentage — (40−50)/50, not clamped to zero', /-20%/.test(loss), loss.replace(/<[^>]+>/g, ' ').trim());

  console.log('\n── ⚠️⚠️ NO EDIT CONTROL HERE — one place writes cost, this only reads it ' + '─'.repeat(0));
  const noInput = await p.evaluate(() => prodCostMarkupHTML({ price: 100, cost: { value: 40, source: 'manual' } }));
  say('no <input> in this markup — Offer Lab’s setCost() is the only writer', !/<input/.test(noInput), 'confirmed read-only');

  say('no console/page errors', errs.length === 0, errs.join(' | ') || 'none');
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\ncost and markup are visible on the product’s own page, read-only, with no new switch needed');
  await b.close(); srv.close();
  process.exit(bad || errs.length ? 1 : 0);
})();

'use strict';
/**
 * walk-offer-lab-fixes.cjs — the 24 Oct reviewer walk's Offer Lab findings (R41 R44 R46 R47), each pinned.
 *   R44  a saved ladder carries `percent` and the ONE engine (CBOffers.evaluate) takes it off; the step error disables Add
 *   R41  rupees off >= the item's price is refused in a sentence; no cost = "margin not known", never "All clear"
 *   R46  give-back >= the bill is refused; no Infinity/NaN in the sheet; no cost = "margin not known", not a made-up loss
 *   R47  negative delivery charge refused; a worksheet-only kind has no save words; the "All n" row is not ₹0 / ✗ 0%
 * Offline: serves public/ on a local port, drives the page's own functions (no walk Chrome, no data written).
 */
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html');
  await p.waitForTimeout(300);
  let n = 0;
  const ok = (name, cond, got) => { assert.ok(cond, name + (got === undefined ? '' : ' -> ' + JSON.stringify(got))); n++; console.log('  ok   ' + name); };

  // R44 — the rule the lab SAVES, run through the engine: 5 x Rs40 at "3+ 10% · 5+ 15%" = 200 - 30
  const tier = await p.evaluate(() => {
    pickGoal('qty'); S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; S.tiers = [[3, 10], [5, 15]];
    const rule = ruleParamsOf();
    const ev = CBOffers.evaluate({ lines: [{ key: 'a', item_id: 'masala', qty: 5, unitPrice: 40 }], offers: [Object.assign({ id: 'x', kind: subKindOf() }, rule)] });
    return { steps: rule.tiers, off: ev.goods_adjustment };
  });
  ok('R44 saved ladder steps carry percent', tier.steps.every((t) => t.percent != null && t.pct === undefined), tier.steps);
  ok('R44 5 x 40 at 15% takes Rs30 off through CBOffers.evaluate', Math.abs(tier.off + 30) < 0.01, tier.off);
  const gate = await p.evaluate(() => { S.tiers = [[3, 10], [5, 15], [5, 20]]; return { why: sheetWhy() }; });
  ok('R44 a step that is not more than the one before is a reason Add is off', /Step 3 must be more than 5/.test(gate.why), gate.why);

  // R41 — Rs100 off an Rs80 dosa
  const rs = await p.evaluate(() => {
    pickGoal('amount'); S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; S.rsOff = 100;
    const dosa = byId('masala'); dosa.price = 80;
    const refused = sheetWhy();
    S.rsOff = 5;
    const fine = sheetWhy();
    const saved = P.map((x) => x.cost); P.forEach((x) => { x.cost = null; });
    const note = amountMarginNote(lineRows(), 0);
    P.forEach((x, i) => { x.cost = saved[i]; });
    return { refused, fine, note };
  });
  ok('R41 Rs100 off an Rs80 item is refused in a sentence', /less than .*80/.test(rs.refused), rs.refused);
  ok('R41 Rs5 off is fine', rs.fine === '', rs.fine);
  ok('R41 no cost: the corner says the margin is not known, never "All clear"', /not known/.test(rs.note) && !/All clear/.test(rs.note), rs.note);

  // R46 — reward a big bill
  const sp = await p.evaluate(() => {
    pickGoal('spend'); S.spendAt = 500; S.spendVal = 600;
    const refused = sheetWhy();
    S.spendAt = 300; S.spendVal = 30;
    const fine = sheetWhy();
    const saved = P.map((x) => x.cost); P.forEach((x) => { x.cost = null; });
    const html = outSpend();
    P.forEach((x, i) => { x.cost = saved[i]; });
    S.spendAt = 500; S.spendVal = 600; // even if it got through, no Infinity/NaN
    const raw = outSpend();
    return { refused, fine, html, raw };
  });
  ok('R46 give back Rs600 on Rs500 is refused', /less than the bill must reach/.test(sp.refused), sp.refused);
  ok('R46 Rs30 back on Rs300 is fine', sp.fine === '', sp.fine);
  ok('R46 no cost: "margin not known", no made-up loss', /not known/.test(sp.html) && !/You make|catalogue average/.test(sp.html), sp.html.slice(0, 200));
  ok('R46 no Infinity or NaN in any figure', !/Infinity|NaN/.test(sp.html + sp.raw));

  // R47 — free delivery, worksheet-only band, the "All n" row
  const sh = await p.evaluate(() => {
    pickGoal('ship'); S.shipAt = 500; S.shipCost = 40; S.shipCharge = -10;
    const refused = sheetWhy(); S.shipCharge = 0;
    const saved = P.map((x) => x.cost); P.forEach((x) => { x.cost = null; });
    const foot = percentFootUnknownHTML(1, false), costless = outShip();
    P.forEach((x, i) => { x.cost = saved[i]; });
    return { refused, fine: sheetWhy(), foot, costless };
  });
  ok('R47 a negative delivery charge is refused', /0 or more/.test(sh.refused), sh.refused);
  ok('R47 free delivery at 0 is fine', sh.fine === '', sh.fine);
  ok('R47 "All n" row with no costs shows not known, not Rs0 / 0%', /not known/.test(sh.foot) && !/0%|₹0/.test(sh.foot), sh.foot);
  ok('R47 free delivery with no cost says margin not known', /not known/.test(sh.costless) && !/Infinity|NaN/.test(sh.costless));
  const band = await p.evaluate(() => {
    localStorage.setItem('cb_sess', JSON.stringify({ token: 't' }));
    pickGoal('band'); S.bandLo = 100; S.bandHi = 5000; S.applied = true;
    const save = document.getElementById('workSave');
    paintSaveGate(save);
    return { hidden: save.style.display === 'none', promiseHidden: document.getElementById('workPromise').style.display === 'none' };
  });
  ok('R47 a worksheet-only kind hides the save button and the draft words', band.hidden && band.promiseHidden, band);

  ok('no page errors', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log('offer-lab-walk-fixes: ' + n + ' checks passed');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

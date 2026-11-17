/* offer-lab-next-typing.cjs — EVERY NUMBER FIELD, MID-KEYSTROKE ([TILL-187] follow-up)
 *
 * Athi: "couldn't edit loyalty bonus in setting page, something happening there... check in next page as
 * well." Not just loyalty — every input on every screen called edit() on oninput, and render() rebuilt the
 * WHOLE screen on every call, destroying and recreating the very input being typed into. One character
 * worked; a second character landed nowhere, because the field had already lost focus rebuilding itself
 * after the first. This drives REAL sequential keystrokes (page.type, not fill()) — fill() sets a value
 * atomically and would never have reproduced this at all.
 *
 * Run: node e2e/offer-lab-next-typing.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(48) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html');
  await p.waitForTimeout(200);

  console.log('\n── SETTINGS — the loyalty ceiling, typed character by character ' + '─'.repeat(1));
  await p.evaluate(() => { S.custOn = true; render(); });
  const loyalty = await p.evaluate(() => document.querySelector('[data-key="cap"]') != null);
  say('the field carries data-key', loyalty, 'data-key="cap" is on the input');
  const capEl = await p.$('[data-key="cap"]');
  await capEl.click({ clickCount: 3 });   /* select-all, the way a real edit starts */
  await p.keyboard.type('15', { delay: 30 });   /* REAL keystrokes — one at a time, through the DOM */
  await p.waitForTimeout(100);
  const capResult = await p.evaluate(() => ({ value: document.querySelector('[data-key="cap"]').value, S_cap: S.cap, focused: document.activeElement === document.querySelector('[data-key="cap"]') }));
  say('⭐⭐⭐ both characters actually landed (not just the first)', capResult.value === '15', 'field shows "' + capResult.value + '"');
  say('state agrees with what is on screen', String(capResult.S_cap) === '15', 'S.cap is ' + capResult.S_cap);
  say('and focus survived every rebuild in between', capResult.focused, 'still the field being typed into');

  console.log('\n── SETTINGS — margin, same test ' + '─'.repeat(37));
  const marginEl = await p.$('[data-key="margin"]');
  await marginEl.click({ clickCount: 3 });
  await p.keyboard.type('32', { delay: 30 });
  await p.waitForTimeout(100);
  const marginResult = await p.evaluate(() => ({ value: document.querySelector('[data-key="margin"]').value, S_margin: S.margin }));
  say('margin also takes a real two-digit edit', marginResult.value === '32' && String(marginResult.S_margin) === '32',
      JSON.stringify(marginResult));

  console.log('\n── WORK IT OUT — percent off, the next screen Athi asked to check ' + '─'.repeat(0));
  /* since the 09-26 rebuild apply() opens the result sheet OVER the controls; a person returns to the fields with
     "Change it" (closeWork) — the same path here, or the click lands on the sheet's backdrop */
  await p.evaluate(() => { pickGoal('percent'); S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; apply(); closeWork(); });
  await p.waitForTimeout(100);
  const pctEl = await p.$('[data-key="pctOff"]');
  await pctEl.click({ clickCount: 3 });
  await p.keyboard.type('18', { delay: 30 });
  await p.waitForTimeout(100);
  const pctResult = await p.evaluate(() => ({ value: document.querySelector('[data-key="pctOff"]').value, S_pctOff: S.pctOff }));
  say('percent-off field takes a real two-digit edit too', pctResult.value === '18' && String(pctResult.S_pctOff) === '18',
      JSON.stringify(pctResult));

  console.log('\n── WORK IT OUT — rupees off, a decimal this time ' + '─'.repeat(19));
  await p.evaluate(() => { pickGoal('amount'); S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; apply(); closeWork(); });
  await p.waitForTimeout(100);
  const rsEl = await p.$('[data-key="rsOff"]');
  await rsEl.click({ clickCount: 3 });
  await p.keyboard.type('12.5', { delay: 30 });
  await p.waitForTimeout(100);
  const rsResult = await p.evaluate(() => ({ value: document.querySelector('[data-key="rsOff"]').value, S_rsOff: S.rsOff }));
  say('a four-keystroke edit (with a decimal point) lands in full', rsResult.value === '12.5' && String(rsResult.S_rsOff) === '12.5',
      JSON.stringify(rsResult));

  console.log('\n── the SAME field, a SECOND time — clearing and retyping (the real "editing" case) ' + '─'.repeat(0));
  /* ⚠️ RE-QUERIED, NOT THE OLD HANDLE — every render() destroys and recreates the input, so a handle from
     before the last edit is stale by design now; this is exactly why edit() re-finds it by data-key too. */
  await (await p.$('[data-key="rsOff"]')).click({ clickCount: 3 });
  await p.keyboard.press('Backspace');
  await p.keyboard.type('7', { delay: 30 });
  await p.waitForTimeout(100);
  const retype = await p.evaluate(() => ({ value: document.querySelector('[data-key="rsOff"]').value, S_rsOff: S.rsOff }));
  say('replacing an existing value works too, not just a blank field', retype.value === '7' && String(retype.S_rsOff) === '7',
      JSON.stringify(retype));

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nevery number field keeps its focus and its cursor through the live rebuild, on every screen');
  process.exit(bad || errs.length ? 1 : 0);
})();

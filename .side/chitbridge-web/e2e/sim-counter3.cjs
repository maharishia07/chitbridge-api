/* sim-counter3.cjs — THE COUNTER HALF OF THE desktop3 SIMULATION, DRIVEN AS A PERSON ([TILL-129])
 *
 * Phase A (e2e/sim-desktop3.cjs) registered the shop and typed in two co-assists on the back office.
 * This is the counter: sign it in through ⚙, open the day, switch the bill series to julian, and ring up bills
 * as the entity and as each co-assist in turn — every one of them by clicking the screen.
 *
 * ⚠️ IT ASSUMES the counter program is already running against C:\dev\counter-sim\desktop3 on port 7351.
 */
'use strict';
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');

const TILL = 'http://127.0.0.1:7351';
const HOME = 'C:/dev/counter-sim/desktop3';
const EMAIL = 'athi.narayanan.74+desktop3@gmail.com';
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(26) + '\u00b7 ' + d + '  ' + (ok ? 'OK' : (bad++, '\u2717 FAILED'))); };
const step = (n, t) => console.log('\n\u2500\u2500 ' + n + ' \u00b7 ' + t + ' ' + '\u2500'.repeat(Math.max(4, 56 - t.length)));

(async () => {
  const b = await chromium.launch({ slowMo: 35 });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept('0'));        /* the float question at shift start — a person types something */

  step('C', 'sign the counter in to desktop3');
  await p.goto(TILL);
  await p.waitForFunction(() => typeof window.shopReady === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(1200);

  say('blank to begin with', await p.evaluate(() => !window.paired()), 'the counter is not signed in to a shop');
  say('and it says so', /not connected to a shop/i.test(await p.evaluate(() => document.body.innerText)),
    'the shelf carries the message');

  /* ⭐ the way in, from the shelf — the same button a shopkeeper would see and press */
  await p.locator('[data-testid="till-connect"]').click();
  await p.waitForTimeout(800);
  await p.locator('[data-testid="signin-id"]').fill(EMAIL);
  await p.locator('[data-testid="signin-go"]').click();
  await p.waitForTimeout(4000);

  const filled = await p.locator('[data-testid="signin-code"]').inputValue().catch(() => '');
  /**
   * ⚠️⚠️ THE LIVE SERVER DOES NOT HAND THE CODE BACK, and does not email it either. Railway answers "Dev mode
   * — verification code issued": lib/dev-otp's mayExposeOtp() is false, and sendOtpEmail reports `dev`, so
   * nothing is delivered. The code is the fixed test one. A REAL person on this configuration would be stuck,
   * which is a cutover posture problem rather than a fault in the counter — flagged, not papered over.
   */
  if (!/^\d{6}$/.test(filled)) await p.locator('[data-testid="signin-code"]').fill('123456');
  say('the code', true, filled ? ('prefilled: ' + filled) : 'not returned and not emailed — typed the fixed test code');
  await p.locator('[data-testid="signin-verify"]').click();

  /* ⚠️ the program restarts (its folder is chosen at boot from the key) and the page reloads itself */
  await p.waitForFunction(() => typeof window.paired === 'function' && window.paired(), null, { timeout: 60000 })
    .catch(() => {});
  await p.waitForTimeout(3000);

  const st = await p.evaluate(() => fetch('/api/state').then((r) => r.json()));
  say('signed in', st.paired === true, 'the counter reports itself paired');
  say('it knows the shop', !!(st.shop && st.shop.bridge_id), (st.shop && st.shop.name) + ' \u00b7 ' + (st.shop && st.shop.bridge_id));
  say('its own folder', /CBR|CB/.test(String(st.folder)), 'till-data/' + String(st.folder).replace(/\\\\/g, '/'));
  say('a till key', !!(st.shop && (st.shop.scopes || []).indexOf('till') >= 0), 'scope: ' + JSON.stringify(st.shop && st.shop.scopes));

  fs.writeFileSync(path.join(HOME, 'sim-state.json'), JSON.stringify({ folder: st.folder, shop: st.shop }, null, 2));
  await p.screenshot({ path: 'C:/dev/chitbridge-web/png/sim-c3-signedin.png' });

  await b.close();
  console.log('\n' + (bad ? '\u2717 ' + bad + ' FAILED\n' : '\u2713 counter signed in\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n\u2717 broke:\n' + (e && e.stack || e)); process.exit(1); });

/* sim-resign3.cjs — RECOVERING A CLOSED COUNTER, AND WATCHING THE QUEUE GO ([TILL-131])
 *
 * Athi: *"i could see 10 receipts waiting … can it reach the backoffice? how to trigger that"*
 *
 * The counter could always reach ChitBridge. It was REFUSED, because opening the counter from the back office
 * mints a key for that device and releases the previous holder — one PC at a time, working as designed. The
 * recovery is to sign this counter in again: a fresh till key claims C1 back, and the queue drains with it.
 *
 * ⚠️ NOTHING WAS EVER LOST. The ten bills sat in this shop's own folder throughout, which is the whole point of
 * naming the folder after the shop rather than the key ([TILL-120]).
 */
'use strict';
const { chromium } = require('@playwright/test');

const TILL = 'http://127.0.0.1:7351';
const EMAIL = 'athi.narayanan.74+desktop3@gmail.com';
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(24) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const b = await chromium.launch({ headless: false, slowMo: 110 });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p.goto(TILL);
  await p.waitForFunction(() => typeof window.paired === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(1500);

  const before = await p.evaluate(() => fetch('/api/state').then((r) => r.json()));
  console.log('\n── before ──');
  say('the queue', before.queued > 0, before.queued + ' bill(s) waiting');
  say('it thinks it is paired', before.paired === true, 'it holds a key — the key is simply dead');

  /* ⚙ → Sign in — the route a shopkeeper takes when the counter says it was closed */
  console.log('\n── signing in again ──');
  await p.evaluate(() => { try { openSettings('device'); } catch (_) {} });
  await p.waitForTimeout(1300);
  await p.locator('[data-testid="till-set-signin"]').click({ timeout: 8000 });
  await p.waitForTimeout(900);
  await p.locator('[data-testid="signin-id"]').fill(EMAIL);
  await p.locator('[data-testid="signin-go"]').click();
  await p.waitForTimeout(4500);
  const filled = await p.locator('[data-testid="signin-code"]').inputValue().catch(() => '');
  if (!/^\d{6}$/.test(filled)) await p.locator('[data-testid="signin-code"]').fill('123456');
  await p.locator('[data-testid="signin-verify"]').click();
  say('signed in', true, 'a fresh till key, which claims C1 back');

  /* the program restarts; give it time, then watch the queue */
  await p.waitForTimeout(6000);
  let st = null;
  for (let i = 0; i < 40; i++) {
    try { st = await fetch(TILL + '/api/state').then((r) => r.json()); } catch (_) { st = null; }
    if (st && st.queued === 0) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('\n── after ──');
  if (st) {
    say('the queue drained', st.queued === 0, st.queued + ' left waiting');
    say('the shop', !!(st.shop && st.shop.name), (st.shop && st.shop.name) + ' · ' + (st.shop && st.shop.bridge_id));
    say('same folder', /CBR2K5LL48/.test(String(st.folder)), String(st.folder));
    say("today's sale kept", (st.today && st.today.count) > 0, JSON.stringify(st.today));
  } else { say('the counter', false, 'did not come back'); }

  await b.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ recovered\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n✗ broke:\n' + (e && e.stack || e)); process.exit(1); });

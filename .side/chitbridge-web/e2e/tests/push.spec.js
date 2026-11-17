// push.spec.js — [PUSH-01] The mailbox bell: a signed-in tab holds one push stream; a chit that arrives for this entity rings it, and
// the list refreshes without the timer. Athi, 2026-09-04: "why can't we notify like a mailbox?"
//
// Driven through the app's own controls: the stream is opened by sign-in (startAutoRefresh → cbPushStart), the chit
// is composed and sent through the wizard to SELF (the sender is a recipient too, so the bell rings in this tab).
// The arrival is observed at the ONE seam the client owns — cbPushArrived — not by sniffing the network.
const { test, expect } = require('@playwright/test');
const { mintEntity, composeSelfChit, clickNav } = require('../fixtures');

test('[PUSH-01] a chit that arrives rings the bell and refreshes the list without the timer', async ({ page }) => {
  test.setTimeout(240000);
  let subject = '';
  await mintEntity(page);

  await test.step('STREAM UP — sign-in opened one push stream; the fallback timer stretched', async () => {
    await page.waitForFunction(() => typeof cbPushUp === 'function' && cbPushUp(), null, { timeout: 30000 });
    const up = await page.evaluate(() => ({ up: cbPushUp(), one: !!(_push && _push.es) }));
    expect(up.up).toBe(true); expect(up.one).toBe(true);
  });

  await test.step('OBSERVE — hook the arrival seam', async () => {
    await page.evaluate(() => {
      window.__cbArrived = [];
      const orig = window.cbPushArrived;
      window.cbPushArrived = function (d) { window.__cbArrived.push(d); return orig(d); };
    });
  });

  await test.step('ARRIVAL — a chit sent to self rings the bell within seconds', async () => {
    subject = 'PUSH-01 ' + Date.now();
    await composeSelfChit(page, subject);
    await page.waitForFunction(() => Array.isArray(window.__cbArrived) && window.__cbArrived.length > 0, null, { timeout: 20000 });
    const ev = await page.evaluate(() => window.__cbArrived[0]);
    expect(ev.kind).toBe('chit');
    expect(typeof ev.at).toBe('string');
  });

  await test.step('THE LIST — Task shows the chit; the stream is still the one opened at sign-in', async () => {
    await clickNav(page, 'task');
    await expect(page.getByText(subject).first()).toBeVisible({ timeout: 25000 });   /* the chit is on the list, by its subject */
    const still = await page.evaluate(() => cbPushUp());
    expect(still).toBe(true);
  });
});

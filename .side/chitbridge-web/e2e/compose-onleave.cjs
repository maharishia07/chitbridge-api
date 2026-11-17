'use strict';
/* ── e2e/compose-onleave.cjs — TICKED ITEMS MUST SURVIVE LEAVING THE STEP ───────────────────────────────────────
 *
 * Athi, 2026-09-02: *"i clicked two items, but the chit came out with zero item, i understood, it asks add these
 * items again."*
 *
 * ⭐⭐ THE CAUSE: `ccAddPicked` was the cart's onCheckout, so ticking put lines in the CART and only a separate
 * press moved them onto the chit. Every other press on that screen commits what you just did; that one did not,
 * and the penalty for missing it was a chit with nothing on it — reported at the end, not at the moment.
 *
 * ⭐ THE FIX is a step hook, not a bigger button: CBSteps gained `onLeave(stepKey)`, and compose commits the cart
 * on the way out of `items`. Leaving a step is the honest moment to bank what the step collected.
 *
 * ⚠️ THIS ASSERTS THE PATH THAT USED TO LOSE THEM — tick, then advance WITHOUT pressing "+ Add to the chit".
 * Asserting the happy path (tick, press add, advance) passes against the bug, which is why it was never caught.
 *
 * Run: node e2e/compose-onleave.cjs
 */
const { chromium } = require('@playwright/test');
const { attachSession } = require('./session.cjs');
const path = require('path');
const say = (s) => console.log('  ' + s);

/**
 * ⚠️ SEED WHAT THE PROBE NEEDS. An earlier version leaned on the shared account happening to hold products —
 * true until the session was re-minted, after which every assertion failed on an empty catalogue and read as a
 * broken screen. A probe that depends on leftover data is a probe that expires without telling anyone.
 */
async function seedCatalogue(p, wanted) {
  const have = await p.evaluate(async (want) => {
    await ensureCatalogue(true);
    const names = (STORE.catalogue || []).map((x) => x.particulars);
    const missing = want.filter((w) => !names.includes(w.name));
    for (const m of missing) {
      await api('prodAdd', { body: { item_data: { name: m.name, unit: 'piece', price: m.price } } }).catch(() => null);
    }
    await ensureCatalogue(true);
    return (STORE.catalogue || []).length;
  }, wanted);
  return have;
}

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ storageState: path.join(__dirname, '.auth', 'user.json'), viewport: { width: 1180, height: 820 } });
  /* ⚠️ SIGN IN AND PIN THE API BEFORE THE FIRST goto — see session.cjs; both are inherited accidents otherwise. */
  const where = await attachSession(c);
  const p = await c.newPage();
  p.on('pageerror', (e) => say('PAGEERROR ' + String(e.message || e).slice(0, 200)));
  say('session   · minted for ' + where.origin + ' · API ' + where.apiBase);
  await p.goto('http://localhost:5173/app.html');
  await p.waitForTimeout(4200);
  const stock = await seedCatalogue(p, [{ name: 'Sugar, 1kg', price: 52 }, { name: 'Tea, 250g packet', price: 180 }]);
  say('catalogue · ' + stock + ' product(s)');

  await p.evaluate(() => compose());
  await p.waitForTimeout(4000);
  const ids = await p.evaluate(() => [...document.querySelectorAll('#cbpick_cc .cbcat-row')].map((r) => r.dataset.testid).slice(0, 2));
  say('offered   : ' + ids.length + ' row(s)');
  for (const id of ids) {
    await p.locator('[data-testid="' + id + '"] [data-testid="cart-add"]').click();
    await p.waitForTimeout(900);
  }
  const inCart = await p.evaluate(() => ({ cart: UI._ccCart ? UI._ccCart.lines() : -1, onChit: (CC.items || []).length }));
  say('after 2 + : cart holds ' + inCart.cart + ', chit holds ' + inCart.onChit + '   <- the chit is still empty, correctly');

  /* ⚠️ ADVANCE WITHOUT PRESSING ADD. This is the press Athi never made, and never should have had to. */
  const pri = await p.evaluate(() => { const b = document.querySelector('.cbst-foot .pri'); return b ? { t: b.textContent, tid: b.dataset.testid, disabled: b.disabled } : null; });
  say('next btn : ' + JSON.stringify(pri));
  await p.click('.cbst-foot .pri');
  await p.waitForTimeout(2200);
  const after = await p.evaluate(() => ({ onChit: (CC.items || []).length, names: (CC.items || []).map((i) => i.particulars || i.name) }));
  say('advanced  : chit holds ' + after.onChit + ' ' + JSON.stringify(after.names));

  const ok = ids.length >= 2 && inCart.cart === 2 && after.onChit === 2;
  say(ok ? '\n  + ticking is enough — leaving the step commits the lines'
         : '\n  x lines were lost on the way out of the step');
  await b.close();
  process.exit(ok ? 0 : 1);
})();

// [TILL-41] AGE-RESTRICTED ITEMS, AND THE CHOOSER THE SEARCH BOX USED TO SKIP.
//
// India first, as every rule at this counter is. COTPA 2003 §6 forbids selling tobacco to anyone under 18;
// alcohol is state-licensed with its own ages. So the age is the PRODUCT's — item_data.age_check, a number of
// years — and never a rule the page invents.
//
// ⚠️ WHAT IS WORTH TESTING IS THE REFUSAL AND THE RECORD, not that a dialog opened. A prompt that cannot refuse
// is decoration, and a bill that says somebody checked when nobody did is worse than no prompt at all.
//
// ⚠️⚠️ AND THE BUG THIS SPEC EXISTS TO PIN DOWN. add() — the search-and-scan path — called addItem() directly
// and never modOpen(), so a dish with REQUIRED choices billed by typing its name went to the kitchen with no
// choices at all. "Must choose" was enforced on the quick-key path and silently skipped on the other one. Both
// paths now come through the one funnel, which is also where the age gate sits; if that funnel is ever bypassed
// again, the second test here fails.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

/** open a counter on a fresh shop and return its page */
async function counterFor(page, context, name, products) {
  await mintEntity(page, { fresh: true, name: name + Date.now().toString(36) });
  for (const p of products) await addProduct(page, p);
  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
  return till;
}

test('[TILL-41] an age-restricted item is refused, asked once, and recorded', async ({ page, context }) => {
  test.setTimeout(240000);
  const till = await counterFor(page, context, 'agecheck', [
    { name: 'Rolling Papers', unit: 'piece', price: 20 },
    { name: 'Matchbox', unit: 'piece', price: 5 },
  ]);

  /* the shop marks one product as 18+ — on the counter's own copy, which is what it bills from */
  await till.evaluate(() => {
    const i = S.items.find((x) => x.name === 'Rolling Papers');
    i.age_check = 18;
  });

  /* ── 1 · REFUSING ADDS NOTHING. The whole point of asking. ── */
  await till.evaluate(() => { clearBill(); });
  await till.evaluate(() => {
    document.getElementById('q').value = 'Rolling Papers';
    paintHits();
    const n = hits().findIndex((x) => x.name === 'Rolling Papers');
    add(n);
  });
  await till.waitForSelector('dialog[open]', { timeout: 15000 });
  const asked = await till.evaluate(() => document.querySelector('dialog[open]').textContent);
  expect(asked, 'the prompt names the age and the product').toMatch(/18/);
  await till.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    [...d.querySelectorAll('button')].find((b) => /cancel/i.test(b.textContent)).click();
  });
  await till.waitForTimeout(600);
  expect(await till.evaluate(() => CART.length), 'refused — nothing on the bill').toBe(0);

  /* ── 2 · ACCEPTING ADDS IT, AND THE LINE CARRIES THE AGE ── */
  await till.evaluate(() => {
    document.getElementById('q').value = 'Rolling Papers';
    paintHits();
    add(hits().findIndex((x) => x.name === 'Rolling Papers'));
  });
  await till.waitForSelector('dialog[open]', { timeout: 15000 });
  await till.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    [...d.querySelectorAll('button')].find((b) => /Yes, checked/.test(b.textContent)).click();
  });
  await till.waitForTimeout(800);
  expect(await till.evaluate(() => CART.length)).toBe(1);
  expect(await till.evaluate(() => CART[0].age), 'the line remembers it needed checking').toBe(18);

  /* ── 3 · ASKED ONCE PER BILL. Asked every scan, a cashier learns to dismiss it without reading. ── */
  await till.evaluate(() => {
    document.getElementById('q').value = 'Rolling Papers';
    paintHits();
    add(hits().findIndex((x) => x.name === 'Rolling Papers'));
  });
  await till.waitForTimeout(900);
  expect(await till.evaluate(() => !!document.querySelector('dialog[open]')), 'not asked twice').toBe(false);
  expect(await till.evaluate(() => CART[0].qty), 'it was added again all the same').toBe(2);

  /* ── 4 · THE BILL CARRIES THE EVIDENCE ── */
  const rec = await till.evaluate(() => ageRecord());
  expect(Array.isArray(rec) && rec.length, 'the check is on the record').toBeTruthy();
  expect(rec[0].age).toBe(18);
  expect(rec[0].at, 'and when it was made').toBeTruthy();

  /* ── 5 · AND IT DIES WITH THE BILL. Carried on, it would record a check nobody made. ── */
  await till.evaluate(() => { clearBill(); });
  await till.waitForTimeout(400);
  expect(await till.evaluate(() => ageRecord()), 'a new customer is a new check').toBeNull();

  /* an unrestricted product is untouched by any of this */
  await till.evaluate(() => {
    document.getElementById('q').value = 'Matchbox';
    paintHits();
    add(hits().findIndex((x) => x.name === 'Matchbox'));
  });
  await till.waitForTimeout(700);
  expect(await till.evaluate(() => !!document.querySelector('dialog[open]')), 'nothing to ask about').toBe(false);
  expect(await till.evaluate(() => CART.length)).toBe(1);
});

test('[TILL-41] a required choice is asked for however the item was reached', async ({ page, context }) => {
  test.setTimeout(240000);
  const till = await counterFor(page, context, 'chooser', [{ name: 'Dosa', unit: 'plate', price: 70 }]);

  await till.evaluate(() => {
    const i = S.items.find((x) => x.name === 'Dosa');
    i.modifiers = [{ name: 'Spice', required: true, max: 1, options: [{ name: 'Mild' }, { name: 'Hot' }] }];
  });

  /* ⚠️⚠️ THE REGRESSION. Reached by TYPING, this used to bill straight past the chooser. */
  await till.evaluate(() => {
    clearBill();
    document.getElementById('q').value = 'Dosa';
    paintHits();
    add(hits().findIndex((x) => x.name === 'Dosa'));
  });
  await till.waitForTimeout(900);
  expect(await till.evaluate(() => document.getElementById('moddlg').open),
    'typing the name must ask for the choice, exactly as the quick key does').toBe(true);
  expect(await till.evaluate(() => CART.length), 'and nothing is billed until it is answered').toBe(0);

  /* answering it bills one line that carries the choice */
  await till.evaluate(() => { modToggle(0, 1); modAddNow(); });
  await till.waitForTimeout(700);
  expect(await till.evaluate(() => CART.length)).toBe(1);
  expect(await till.evaluate(() => (CART[0].mods || []).map((m) => m.option).join())).toBe('Hot');
});

// [TILL-34] THE LABEL A WEIGHING MACHINE PRINTS — a veg market does not type weights.
//
// Athi, 2026-09-18: *"i wanted to have the till which can caters to demands very quickly, say veg market,
// hotel, simple shops"* and *"i'll arrange the real shop to test with weighing machine and so on"*. So this is
// tested the way that shop will use it: the scale weighs, prints a sticker, and the counter scans the sticker.
//
// The convention is GS1's "2" range, reserved for in-store codes and used by every scale in the trade:
//   2 IIIII PPPPP C   price-embedded  — item code, then the PRICE in paise
//   2 IIIII WWWWW C   weight-embedded — item code, then the WEIGHT in grams
//
// ⚠️ WHAT IS WORTH TESTING IS THE MONEY AND THE REFUSALS, not that a dialog opened. A misread digit is a wrong
// price on a bag a customer is holding, so the check digit, the unknown code and the off switch are asserted
// as hard as the happy path.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

/** build a valid EAN-13 from its first twelve digits — the same arithmetic the scale does */
function ean13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return first12 + String((10 - (sum % 10)) % 10);
}

test('[TILL-34] a scale label bills the weight it states, and a bad one is refused', async ({ page, context }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'veg' + Date.now().toString(36) });
  /* a veg shop: sold by the kilo, with a five-digit code the scale is programmed with */
  await addProduct(page, { name: 'Tomato', unit: 'kg', price: 40, code: '00021' });
  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'veg counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });

  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });

  /* 1.250 kg of tomato at ₹40/kg = ₹50.00 → the scale prints the PRICE, 5000 paise */
  const priceLabel = ean13('2' + '000021' + '05000');
  /* the same bag, on a machine set to print the WEIGHT instead: 1250 grams */
  const weightLabel = ean13('2' + '000021' + '01250');

  await test.step('⚠️ OFF by default — a "2" barcode is an ordinary barcode until a shop says otherwise', async () => {
    const read = await till.evaluate((c) => weighRead(c), priceLabel);
    expect(read, 'a shop that does not weigh must not have its barcodes re-read as prices').toBeNull();
  });

  await test.step('⭐ price-embedded: the label says ₹50.00, and ₹50.00 is what is billed', async () => {
    await till.evaluate(() => tillOptSet({ weigh: { on: true, prefix: '2', kind: 'price' } }));
    await till.evaluate(() => clearBill());
    const read = await till.evaluate((c) => { const w = weighRead(c); return w && { name: w.item.name, qty: w.qty, price: w.price }; }, priceLabel);
    expect(read.name).toBe('Tomato');
    expect(read.price, 'the price on the sticker is the price on the bill').toBe(50);
    expect(read.qty, '₹50 at ₹40/kg is 1.25 kg').toBeCloseTo(1.25, 3);

    /* and through the real path a scanner uses: type the code, the counter bills it */
    await till.fill('#q', priceLabel);
    await till.evaluate(() => searchTyped());
    await expect.poll(() => till.evaluate(() => CART.length)).toBe(1);
    const line = await till.evaluate(() => ({ qty: CART[0].qty, total: billMoney().net }));
    expect(line.total, 'the bill must equal the sticker, not our own arithmetic').toBe(50);
  });

  await test.step('⭐ weight-embedded: the label says 1.250 kg and the shop\'s own rate prices it', async () => {
    await till.evaluate(() => { tillOptSet({ weigh: { on: true, prefix: '2', kind: 'weight' } }); clearBill(); });
    const read = await till.evaluate((c) => { const w = weighRead(c); return w && { qty: w.qty, price: w.price }; }, weightLabel);
    expect(read.qty, '1250 g is 1.25 kg').toBeCloseTo(1.25, 3);
    expect(read.price, 'a weight label carries no price — the shop rates it').toBeNull();
    await till.fill('#q', weightLabel);
    await till.evaluate(() => searchTyped());
    await expect.poll(() => till.evaluate(() => CART.length)).toBe(1);
    expect(await till.evaluate(() => billMoney().net), '1.25 kg at ₹40 is ₹50').toBe(50);
  });

  await test.step('⚠️⚠️ a misread digit is REFUSED, not guessed at', async () => {
    const bad = priceLabel.slice(0, 12) + String((Number(priceLabel[12]) + 1) % 10);   // wrong check digit
    expect(await till.evaluate((c) => weighRead(c), bad), 'a bad check digit must never reach a bill').toBeNull();
    const unknown = ean13('2' + '999999' + '05000');
    expect(await till.evaluate((c) => weighRead(c), unknown), 'an unknown item code must not be guessed').toBeNull();
    const zero = ean13('2' + '000021' + '00000');
    expect(await till.evaluate((c) => weighRead(c), zero), 'a zero weight is not a sale').toBeNull();
  });

  await test.step('⭐ two bags are two lines — each sticker is its own weighing', async () => {
    await till.evaluate(() => { tillOptSet({ weigh: { on: true, prefix: '2', kind: 'price' } }); clearBill(); });
    for (const c of [priceLabel, ean13('2' + '000021' + '03000')]) {
      await till.fill('#q', c);
      await till.evaluate(() => searchTyped());
      await till.waitForTimeout(300);
    }
    const lines = await till.evaluate(() => CART.map((c) => ({ qty: c.qty, price: c.price })));
    expect(lines.length, 'merging two weighings would lose what was on each bag').toBe(2);
    expect(await till.evaluate(() => billMoney().net), '₹50 + ₹30').toBe(80);
  });
});

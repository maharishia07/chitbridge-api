// [TILL-49] [TILL-50] HOW A PERSON ASKS FOR FIVE OF SOMETHING.
//
// Athi, across an afternoon of testing: *"when i say upma 5 plate, it is typing all, instead, upma and qty should
// be 5?"* · *"we already had convention 5* on up, it should bring, onion upma, 5 qty"* · *"when the count comes
// first before an item or after an item, can it be considered as count, also tamil it is not picking up. oru,
// rendu etc?"*
//
// Four ways of saying the same thing, and the counter has to read all four without ever reading a PRODUCT NAME as
// a quantity. That last clause is the whole difficulty: "Aavin milk 500 ml" and "upma 500 gm" are the same shape.
//
// ⚠️ These drive typed() directly. It is a pure function over the search box and the shelf, and the property being
// tested is what it READS — the screen's part of it (the qty hint, the bill) is asserted at the end, once.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

/* the shelf a hotel actually has: serving units, a bracketed pack size in a name, and a number inside a name */
const SHELF = [
  { name: 'Upma', unit: 'plate', price: 45 },
  { name: 'Semiya Upma', unit: 'plate', price: 50 },
  { name: 'Onion Uttapam', unit: 'plate', price: 75 },
  { name: 'Tea', unit: 'cup', price: 20 },
  { name: 'Buttermilk', unit: 'glass', price: 25 },
  { name: 'Idli (2 pc)', unit: 'plate', price: 40 },
  /* ⚠️ THE TRAP, ON THE SHELF ON PURPOSE: a number that is part of the name, with a unit right after it */
  { name: 'Aavin milk 500 ml', unit: 'piece', price: 28 },
];

async function counter(page, context) {
  await mintEntity(page, { fresh: true, name: 'qty' + Date.now().toString(36) });
  const made = await page.evaluate(async (items) => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    await api('prodAddMany', { body: { items } });
    const k = await api('keysMint', { body: { name: 'counter', scopes: ['till'], days: 1 } });
    return (k && (k.key || k.api_key)) || null;
  }, SHELF);
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(made));
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
  return till;
}

/** what the counter makes of a phrase: the quantity it took and the words it will actually search for */
async function read(till, phrase) {
  return till.evaluate((p) => {
    document.getElementById('q').value = p;
    const t = typed();
    const h = hits();
    return { qty: t.qty, unit: t.unit, text: t.text, first: h.length ? h[0].name : null };
  }, phrase);
}

test('[TILL-49] [TILL-50] four ways to ask for five, and none of them eats a product name',
  async ({ page, context }) => {
    test.setTimeout(240000);
    const till = await counter(page, context);

    /* ── 1 · the unit the shop sells it in, at either end ────────────────────────────────────────────────── */
    for (const p of ['upma 5 plate', '5 plate upma', 'upma 5 plates']) {
      const r = await read(till, p);
      expect(r, p).toMatchObject({ qty: 5, unit: 'plate', text: 'upma', first: 'Upma' });
    }
    expect(await read(till, '3 cup tea')).toMatchObject({ qty: 3, unit: 'cup', first: 'Tea' });
    expect(await read(till, '2 glass buttermilk')).toMatchObject({ qty: 2, unit: 'glass', first: 'Buttermilk' });

    /* ── 2 · the 5* shorthand, which must keep working with an abbreviated name ──────────────────────────── */
    expect(await read(till, '5* on up')).toMatchObject({ qty: 5, first: 'Onion Uttapam' });
    expect(await read(till, '3* sem up')).toMatchObject({ qty: 3, first: 'Semiya Upma' });

    /* ── 3 · a bare count, before or after ───────────────────────────────────────────────────────────────── */
    for (const p of ['upma 5', '5 upma']) expect(await read(till, p), p).toMatchObject({ qty: 5, text: 'upma' });
    for (const p of ['tea 3', '3 tea']) expect(await read(till, p), p).toMatchObject({ qty: 3, first: 'Tea' });

    /* ── 4 · Tamil number words, which is the same feature ───────────────────────────────────────────────── */
    /**
     * ⚠️ digitsForWords() ALWAYS WORKED — "rendu upma" became "2 upma" long before today. What did not work was
     * the bare number after it, so the counter fell back to searching the original words and found nothing. The
     * Tamil was never the problem, which is why these live in the same test as the plain digits.
     */
    expect(await read(till, 'rendu upma')).toMatchObject({ qty: 2, text: 'upma', first: 'Upma' });
    expect(await read(till, 'upma rendu')).toMatchObject({ qty: 2, text: 'upma', first: 'Upma' });
    expect(await read(till, 'moonu idli')).toMatchObject({ qty: 3, first: 'Idli (2 pc)' });
    /* ⚠️ `oru` is the article "a", not the numeral one, when another number follows — lib/numerals owns that rule */
    expect(await read(till, 'oru tea')).toMatchObject({ qty: 1, first: 'Tea' });

    /* ── 5 · ⚠️⚠️ AND NONE OF IT MAY EAT A PRODUCT NAME ──────────────────────────────────────────────────── */
    /**
     * This is the clause the whole design turns on. "Aavin milk 500 ml" is one packet, not five hundred; the
     * digits sit inside the name, where every dairy and every spice packet keeps them.
     */
    const milk = await read(till, 'Aavin milk 500 ml');
    expect(milk.qty, 'a pack size in a name is not an order').toBe(1);
    expect(milk.first).toBe('Aavin milk 500 ml');
    const idli = await read(till, 'Idli (2 pc)');
    expect(idli.qty, 'nor is a count in a name').toBe(1);
    expect(idli.first).toBe('Idli (2 pc)');
    /* ⚠️ and a phrase that matches nothing is left exactly as typed rather than half-eaten */
    const junk = await read(till, 'zzz 4 plate');
    expect(junk.qty).toBe(1);
    expect(junk.text).toBe('zzz 4 plate');

    /* ── 6 · and the quantity reaches the BILL, not only the hint above it ───────────────────────────────── */
    /**
     * ⚠️⚠️ THE ONE THAT ACTUALLY COST MONEY. The hint said "Adding 5 plate" and the bill said 1: qtyInUnit answers
     * converted:false both when the unit is wrong AND when it needs no conversion at all, and the add path read
     * the two as one. Five plates of something sold by the plate is five.
     */
    const billed = await till.evaluate(async () => {
      clearBill();
      document.getElementById('q').value = 'upma 5 plate';
      searchTyped();
      document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      return CART.map((c) => c.name + ' x' + c.qty);
    });
    expect(billed, 'the bill agrees with the hint').toEqual(['Upma x5']);
  });

/**
 * ⚠️ WHAT IS NOT CLAIMED HERE, said out loud so nobody reads the test as promising it: a Tamil PRODUCT NAME does
 * not match an English catalogue. "இரண்டு உப்புமா" reads its two correctly and then looks for "உப்புமா", which a
 * shop whose products are named "Upma" does not have. That is a catalogue question — names or aliases in the
 * shop's own script — not a parser one, and it belongs to the localisation thread.
 */
test('[TILL-50] a Tamil number is read even when the Tamil product name finds nothing',
  async ({ page, context }) => {
    test.setTimeout(240000);
    const till = await counter(page, context);
    const r = await read(till, 'இரண்டு உப்புமா');
    /* the NUMBER is understood — this is the half that is ours */
    expect(await till.evaluate(() => digitsForWords('இரண்டு உப்புமா'))).toMatch(/^2\s/);
    /* and the phrase is left whole rather than half-eaten, because the remainder matches no product */
    expect(r.qty).toBe(1);
    expect(r.first).toBe(null);
  });

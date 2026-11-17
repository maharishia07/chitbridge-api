// [TILL-41] R1 — A BILL CAN NEVER BE LOST.
//
// The design package (design-handoff/NOW-reliability-usability.md) makes this the counter's first promise and
// writes its own test: *"kill the tab/app at 20 random points during a bill; after restart the bill is intact
// every time."* That is the second test below, run literally.
//
// ⚠️⚠️ WHAT WAS MISSING BEFORE THIS. The two bills that are easy to see already survived — a parked bill is on
// the rail, a finished one is in IndexedDB. The bill being RUNG lived in a `var` and nowhere else, so a power
// cut, a browser update or a thumb on the wrong tab took it with no trace it had existed.
//
// ⚠️ THESE KILL THE PAGE, they do not ask it nicely. page.reload() drops every variable in the counter, which is
// the whole point: anything that comes back came off the device.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

async function counter(page, context, name, products) {
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

/** ring a few things up the way a counter does, then read what is on the device */
async function ring(till, n) {
  await till.evaluate((count) => {
    clearBill();
    (S.items || []).slice(0, count).forEach((i) => addItem(i, 1, null));
    price();
  }, n);
  await till.waitForTimeout(400);
}

test('[TILL-41] the bill being rung is on the device after every change, and comes back after a kill',
  async ({ page, context }) => {
    test.setTimeout(240000);
    const till = await counter(page, context, 'draft', [
      { name: 'Idli', unit: 'plate', price: 40 },
      { name: 'Dosa', unit: 'plate', price: 70 },
      { name: 'Coffee', unit: 'cup', price: 25 },
    ]);

    /* ⚠️ AN EMPTY SCREEN IS NOT A BILL — and this is also what clears the draft after a sale */
    await till.evaluate(() => { clearBill(); });
    await till.waitForTimeout(400);
    expect(await till.evaluate(() => (localStorage.getItem(shopLs('cb_till_draft')) || '').length),
      'nothing is kept for an empty counter').toBe(0);

    await ring(till, 2);
    /* ⚠️ WHAT WAS RUNG, ASKED OF THE COUNTER — not a list typed here. The shelf comes back in the catalogue's
       own order, and an earlier version of this test asserted ['Idli','Dosa'] and failed on ['Coffee','Dosa']:
       the draft had restored the bill perfectly and the expectation was the thing that was wrong. */
    const rang = await till.evaluate(() => CART.map((c) => c.name + ' x' + c.qty));
    expect(rang.length).toBe(2);
    await till.evaluate(() => {
      document.getElementById('cname').value = 'Ravi'; rwTyped();
      pickPay('UPI');
    });
    await till.waitForTimeout(500);

    const kept = await till.evaluate(() => JSON.parse(localStorage.getItem(shopLs('cb_till_draft')) || 'null'));
    expect(kept, 'the open bill is on the device').toBeTruthy();
    expect(kept.cart.length).toBe(2);
    /* ⚠️ not only the lines — R1 names "tender picked" as a change that must be saved */
    expect(kept.name).toBe('Ravi');
    expect(kept.picked).toBe('UPI');

    /**
     * ⚠️⚠️ R1 CARRIES A NUMBER: "bill saved locally < 50 ms". A promise nobody measures is a promise nobody
     * keeps, so the counter times its own write and this reads the measurement back.
     */
    expect(await till.evaluate(() => DRAFT_MS), 'the save is well inside the 50 ms budget').toBeLessThan(50);

    /* ── and now the kill ── */
    await till.reload();
    await till.waitForSelector('#askdlg[open]', { timeout: 60000 });
    expect(await till.evaluate(() => document.getElementById('asktitle').textContent))
      .toContain('A bill was left open');
    /* ⚠️ NEITHER ANSWER IS A CANCEL — the two words are the two real choices */
    expect(await till.evaluate(() => document.getElementById('askok').textContent)).toBe('Continue that bill');
    expect(await till.evaluate(() => document.getElementById('askno').textContent)).toBe('Start fresh');
    /**
     * ⚠️ AND NO STRAY LABEL. `.dlg label{display:block}` beat the `hidden` attribute, so "Your answer" sat under
     * the message of every say() and sure() in the counter — including "Give back ₹500 against C1/…?".
     */
    expect(await till.evaluate(() => getComputedStyle(document.getElementById('asklabel')).display)).toBe('none');

    await till.evaluate(() => document.getElementById('askok').click());
    await till.waitForTimeout(1200);
    expect(await till.evaluate(() => CART.map((c) => c.name + ' x' + c.qty)),
      'the same bill, off the device').toEqual(rang);
    expect(await till.evaluate(() => document.getElementById('cname').value)).toBe('Ravi');
    expect(await till.evaluate(() => PICKED)).toBe('UPI');

    /**
     * ⚠️⚠️ "START FRESH" IS NOT A WAY OF LOSING A BILL. The promise is that a bill is never lost, so the answer
     * to the question cannot be a way of losing one — it goes on the parked rail, where getting rid of it is a
     * deliberate act with its own ×.
     */
    await till.reload();
    await till.waitForSelector('#askdlg[open]', { timeout: 60000 });
    const parkedWas = await till.evaluate(() => PARKED.length);
    await till.evaluate(() => document.getElementById('askno').click());
    await till.waitForTimeout(1000);
    expect(await till.evaluate(() => CART.length), 'the counter is clear for the next customer').toBe(0);
    expect(await till.evaluate(() => PARKED.length), 'and the old bill is on the rail, not gone').toBe(parkedWas + 1);
    expect(await till.evaluate(() => PARKED[PARKED.length - 1].cart.length)).toBe(2);
    expect(await till.evaluate(() => (localStorage.getItem(shopLs('cb_till_draft')) || '').length),
      'and it is no longer also the open bill').toBe(0);

    /* ⚠️ asked ONCE — load() runs again on every reconnect, and a question that keeps reappearing is one people
       learn to dismiss without reading */
    await till.evaluate(() => { load(); });
    await till.waitForTimeout(1500);
    expect(await till.evaluate(() => !!document.querySelector('#askdlg[open]'))).toBe(false);
  });

test('[TILL-41] killed at twenty points in a bill, the bill is intact every time',
  async ({ page, context }) => {
    test.setTimeout(600000);
    const till = await counter(page, context, 'draftkill', [
      { name: 'Rice', unit: 'kg', price: 62 },
      { name: 'Dal', unit: 'kg', price: 148 },
      { name: 'Oil', unit: 'litre', price: 190 },
      { name: 'Salt', unit: 'kg', price: 22 },
    ]);

    /**
     * The package's own test, run literally. Each round builds a DIFFERENT bill — a different number of lines,
     * a different quantity on the last one, sometimes a customer, sometimes a tender — and then kills the page
     * at that exact point. Twenty rounds, and the bill has to come back whole each time.
     * ⚠️ The killing is a reload, which drops every variable in the counter. Nothing in memory can help it.
     */
    const lost = [];
    for (let round = 0; round < 20; round++) {
      const want = await till.evaluate((r) => {
        clearBill();
        const items = (S.items || []);
        const n = (r % items.length) + 1;
        for (let k = 0; k < n; k++) addItem(items[k], 1, null);
        /* a different quantity each round, so a saved qty that never changed would not pass by luck */
        if (CART.length) CART[CART.length - 1].qty = (r % 4) + 1;
        if (r % 3 === 0) { document.getElementById('cname').value = 'Customer ' + r; rwTyped(); }
        if (r % 4 === 0) pickPay('Card');
        price();
        return { lines: CART.map((c) => c.name + ' x' + c.qty), who: document.getElementById('cname').value, how: PICKED };
      }, round);
      await till.waitForTimeout(250);

      await till.reload();
      await till.waitForSelector('#askdlg[open]', { timeout: 60000 });
      await till.evaluate(() => document.getElementById('askok').click());
      await till.waitForTimeout(900);

      const got = await till.evaluate(() => ({
        lines: CART.map((c) => c.name + ' x' + c.qty),
        who: document.getElementById('cname').value, how: PICKED,
      }));
      if (JSON.stringify(got) !== JSON.stringify(want)) lost.push({ round, want, got });
    }
    /* ⚠️ THE WHOLE LIST, not the first failure — "one of twenty" and "twenty of twenty" are different faults */
    expect(lost, 'every kill gave the bill back exactly as it was').toEqual([]);
  });

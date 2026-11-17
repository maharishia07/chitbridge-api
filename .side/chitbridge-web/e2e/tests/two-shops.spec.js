// two-shops.spec.js — [ISO-01] TWO SHOPS IN ONE CHROME, AND NOTHING CROSSES.
//
// Athi, 2026-09-09: "try to load different shops with a small set of products in the same chrome and see how genuinely the
// distinction is kept, and create chit life cycle and should not cross over."
//
// ⚠️ WHY THIS IS THE TEST THAT MATTERS. Every isolation defect this week looked exactly like working software: the counter that
// held two shops' stock still billed, still printed, still totalled. Nothing threw. So this spec does not check that the code
// takes the right branch — it puts two REAL shops in ONE browser, does a whole sale in each, and then asks each shop what it
// thinks happened. If anything crosses, the money is in the wrong books, and that is the only symptom worth designing a test for.
//
// ⚠️ ONE CHROME, ONE ORIGIN, ONE localStorage — deliberately the hostile case. Two tabs of the same browser SHARE storage, which
// is precisely the arrangement that produced the mixing in the first place.
// ⚠️ ADDING IS A DELIBERATE ACT SINCE 2026-09-10. A click on a row CHOOSES it; the + button (or Enter) puts it
// on the bill. Athi: "by just clicking the list it gets added to the cart, that is not my intention." These specs
// clicked the row and expected a bill line — so they are what caught the change, correctly, and they drive the
// new control rather than the old one.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

/** open a counter in this context, pair it with a key, and wait until it is really holding a shop */
async function counterFor(context, key, shopId) {
  const p = await context.newPage();
  const threw = [];
  p.on('pageerror', (e) => threw.push(e.message));
  p._threw = threw;
  await p.goto('/till.html#key=' + encodeURIComponent(key) + '&shop=' + encodeURIComponent(shopId));
  await p.waitForFunction(() => window.CBOffers && window.CBTax && typeof window.refresh === 'function', null, { timeout: 60000 });
  await p.waitForFunction(() => document.getElementById('shopname').textContent !== 'Not paired yet', null, { timeout: 60000 });
  await p.evaluate(() => refresh());
  await p.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
  return p;
}

/** a whole sale: find it, add it, take cash, save — and hand back the bill number */
async function sell(p, what) {
  await p.fill('#q', what);
  await p.waitForSelector('[data-testid="till-hit-0"]', { timeout: 30000 });
  await p.click('[data-testid="till-add-0"]');
  await p.click('[data-testid="till-pay-cash"]');
  await p.fill('#tendered', '500');
  await p.click('#save');
  await p.waitForSelector('#sliptitle', { timeout: 30000 });
  const no = (await p.locator('#sliptitle').textContent()).replace('Bill ', '').split(' ·')[0].trim();
  await p.click('#slipdlg button:has-text("Close")');
  return no;
}

test('[ISO-01] two shops, one browser: stock, bills and chits all stay where they belong', async ({ page, context }) => {
  test.setTimeout(600000);

  /* ── shop A ── */
  await mintEntity(page, { fresh: true, name: 'Alpha shop ' + Date.now().toString().slice(-5) });
  const A = { id: await page.evaluate(() => SESSION.entityId), name: await page.evaluate(() => SESSION.entity) };
  await page.evaluate(async () => {
    for (const r of [{ name: 'Alpha rice 5 kg', code: 'A1', unit: 'bag', category: 'Rice & grains', price: 299 },
                     { name: 'Alpha dal 1 kg', code: 'A2', unit: 'packet', category: 'Pulses', price: 168 },
                     { name: 'Alpha oil 1 L', code: 'A3', unit: 'litre', category: 'Edible oil', price: 142 }])
      await api('prodAdd', { body: { item_data: r } });
  });
  A.key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'counter A', scopes: ['till'], days: 1 } }); })).key;

  /* ── shop B, in the SAME browser ── */
  await mintEntity(page, { fresh: true, name: 'Beta shop ' + Date.now().toString().slice(-5) });
  const B = { id: await page.evaluate(() => SESSION.entityId), name: await page.evaluate(() => SESSION.entity) };
  expect(B.id).not.toBe(A.id);
  await page.evaluate(async () => {
    for (const r of [{ name: 'Beta sugar 1 kg', code: 'B1', unit: 'packet', category: 'Staples', price: 46 },
                     { name: 'Beta tea 250 g', code: 'B2', unit: 'packet', category: 'Beverages', price: 128 },
                     { name: 'Beta soap', code: 'B3', unit: 'piece', category: 'Personal care', price: 48 }])
      await api('prodAdd', { body: { item_data: r } });
  });
  B.key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'counter B', scopes: ['till'], days: 1 } }); })).key;

  /* ── both counters, side by side, in ONE Chrome ── */
  const tillA = await counterFor(context, A.key, A.id);
  const tillB = await counterFor(context, B.key, B.id);

  await test.step('⭐⭐ each counter holds ONLY its own shop', async () => {
    const a = await tillA.evaluate(() => (S.items || []).map((i) => i.name).sort());
    const b = await tillB.evaluate(() => (S.items || []).map((i) => i.name).sort());
    expect(a).toEqual(['Alpha dal 1 kg', 'Alpha oil 1 L', 'Alpha rice 5 kg']);
    expect(b).toEqual(['Beta sugar 1 kg', 'Beta soap', 'Beta tea 250 g'].sort());
    /* the crossover, said as plainly as it can be said */
    expect(a.join('|'), 'shop A is holding shop B stock').not.toContain('Beta');
    expect(b.join('|'), 'shop B is holding shop A stock').not.toContain('Alpha');
  });

  await test.step('⭐ every row is stamped with its OWN shop, and there is exactly one stamp each', async () => {
    for (const [p, shop, who] of [[tillA, A, 'A'], [tillB, B, 'B']]) {
      const stamps = await p.evaluate(() => [...new Set((S.items || []).map((i) => i._shop || 'UNSTAMPED'))]);
      expect(stamps, 'counter ' + who + ' has rows from more than one shop: ' + stamps.join(', ')).toEqual([shop.id]);
    }
  });

  await test.step('⚠️ and the two copies are in SEPARATE databases, not one shared store', async () => {
    const dbA = await tillA.evaluate(() => tillStore());
    const dbB = await tillB.evaluate(() => tillStore());
    expect(dbA, 'both counters are using the same local database').not.toBe(dbB);
  });

  /* ── a whole sale in each ── */
  let billA, billB;
  await test.step('⭐⭐⭐ a real sale on each counter', async () => {
    billA = await sell(tillA, 'Alpha rice');
    billB = await sell(tillB, 'Beta tea');
    expect(billA).toMatch(/^C1\/\d\d-\d\d\/\d{4}$/);
    expect(billB).toMatch(/^C1\/\d\d-\d\d\/\d{4}$/);
  });

  await test.step('⚠️⚠️ THE MONEY: each shop sees its own bill and NOT the other one', async () => {
    /* asked of the SERVER with each key — the counter's own opinion is not evidence about where the money landed */
    for (let i = 0; i < 20; i++) {
      const ra = await page.request.get(API + '/api/till/bills?days=1&limit=50', { headers: { 'X-Api-Key': A.key } });
      const rb = await page.request.get(API + '/api/till/bills?days=1&limit=50', { headers: { 'X-Api-Key': B.key } });
      const la = JSON.stringify(await ra.json()), lb = JSON.stringify(await rb.json());
      /**
       * ⚠️ COMPARE WHAT IS IN THE BILL, NOT ITS NUMBER. Both counters call their first sale C1/26-27/0001 — a bill number is
       * per COUNTER, scoped by the entity that owns it, so the same string in two shops is correct and expected. Testing
       * containment of the number proves nothing; testing that shop A's books contain Alpha stock and never Beta stock is the
       * question actually being asked.
       */
      if (la.indexOf('Alpha') >= 0 && lb.indexOf('Beta') >= 0) {
        const ja = JSON.parse(la), jb = JSON.parse(lb);
        expect(ja.count, 'shop A has more bills than the one sale it made').toBe(1);
        expect(jb.count, 'shop B has more bills than the one sale it made').toBe(1);
        expect(la, 'shop A books contain shop B stock — the money is in the wrong books').not.toContain('Beta');
        expect(lb, 'shop B books contain shop A stock — the money is in the wrong books').not.toContain('Alpha');
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('the bills never reached ChitBridge within a minute');
  });

  await test.step('⭐ each counter today total counts only its own sale', async () => {
    for (const [p, who] of [[tillA, 'A'], [tillB, 'B']]) {
      const n = await p.evaluate(() => (STATE.today && STATE.today.count) || 0);
      expect(n, 'counter ' + who + ' counted a sale that was not its own').toBe(1);
    }
  });

  await test.step('⚠️ a queued row of one shop is never handed to the other', async () => {
    const qa = await tillA.evaluate(async () => (await DB.all('queue')).map((r) => r.no));
    const qb = await tillB.evaluate(async () => (await DB.all('queue')).map((r) => r.no));
    expect(qa.filter((n) => qb.indexOf(n) >= 0), 'the two counters share a queued row').toEqual([]);
  });

  await test.step('⭐⭐ and each counter says so itself, when asked to check', async () => {
    for (const [p, shop, who] of [[tillA, A, 'A'], [tillB, B, 'B']]) {
      const report = await p.evaluate(async () => { await verifyCounter(); return document.getElementById('slipbox').textContent; });
      expect(report, 'counter ' + who + ' does not agree with its own shop').toContain('agrees with ChitBridge');
      expect(report).toContain('Every row is from one shop');
      expect(report, 'counter ' + who + ' named the wrong shop').toContain(shop.name);
    }
  });

  expect(tillA._threw, 'counter A threw').toEqual([]);
  expect(tillB._threw, 'counter B threw').toEqual([]);
  await tillA.close(); await tillB.close();
});

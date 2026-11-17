// purchase.spec.js — [PUR-01] GOODS IN, AND THE MATCH THAT FOLLOWS. Athi, 2026-09-08: "purchase, sales, despatch in the till format" and, on the
// matching: "how does the received qty match against the bill received?"
//
// This drives the REAL counter against the REAL API: place an order, receive LESS than was ordered with a reason, and then read the
// three-way match — ordered, received, invoiced — and check it names the difference rather than smoothing it away. That last part is
// the whole product claim, so it is worth a test that would fail loudly if the number ever quietly agreed with the supplier.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[PUR-01] receive against an order: what we counted stands, the difference is named, and the match says so', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Goods in ' + Date.now().toString().slice(-6) });

  await test.step('a shop with two things it buys', async () => {
    await addProduct(page, { name: 'Ponni rice 25kg', unit: 'bag', price: 1180, code: 'RICE25' });
    await addProduct(page, { name: 'Sunflower oil 1L', unit: 'litre', price: 142, code: 'OIL1' });
  });

  /* the purchase order: a chit WE send. A supplier who is not on ChitBridge is the ordinary case, so this one is addressed by name. */
  let orderId;
  await test.step('an order goes out to a supplier', async () => {
    const r = await page.evaluate(async () => {
      const body = {
        /* ⚠️ addressed to SELF: /chits/send refuses a recipient who is not on the platform, and most suppliers are not.
           The supplier's name rides in business_json — a shop's own record of what it asked for. See BACKLOG 2026-09-08. */
        recipients: [{ self: true, name: 'self' }],
        /* ⭐ side: 'buy' — a self chit lands as 'received', so it must SAY it is a purchase (routes/till.js sideOf) */
        business_json: { side: 'buy', party: { name: 'Anand Traders' }, order_no: 'PO-1' },
        purpose: 'order', subject: 'Weekly load', manual_subject: 'Weekly load',
        line_items: [
          { particulars: 'Ponni rice 25kg', quantity: 40, unit: 'bag', price: 1000, total: 40000 },
          { particulars: 'Sunflower oil 1L', quantity: 120, unit: 'litre', price: 120, total: 14400 },
        ],
      };
      const res = await fetch(CFG.API_BASE + '/api/chits/send', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    orderId = r.body.chit_id || (r.body.chit && r.body.chit.chit_id);
    expect(orderId).toBeTruthy();
  });

  let key;
  await test.step('a counter key — and it may read the shop\'s own open orders, nothing else', async () => {
    key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
      return api('keysMint', { body: { name: 'goods in', scopes: ['till'], days: 1 } }); })).key;
    expect(key).toBeTruthy();
    /* ⚠️ the match is an owner's screen: a counter must never read what the shop pays its suppliers */
    const nosy = await page.request.get(API + '/api/till/match', { headers: { 'X-Api-Key': key } });
    expect(nosy.status(), 'a till key can see open orders but not the match').toBe(403);
  });

  await test.step('the order shows up as work to receive, with what is still owed', async () => {
    const r = await page.request.get(API + '/api/till/tasks?kind=receive', { headers: { 'X-Api-Key': key } });
    expect(r.status()).toBe(200);
    const j = await r.json();
    const mine = j.tasks.find((t) => t.chit_id === orderId);
    expect(mine, 'the order we just sent is not in the receiving list').toBeTruthy();
    expect(mine.lines.length, 'both lines are there to receive').toBe(2);
    const rice = mine.lines.find((l) => l.name.indexOf('Ponni') >= 0);
    expect(rice.ordered).toBe(40);
    expect(rice.remaining, 'nothing has arrived yet').toBe(40);
  });

  const till = await context.newPage();
  till.on('pageerror', (e) => console.log('   till threw: ' + e.message));
  await test.step('the counter opens in RECEIVE, against that order', async () => {
    await till.goto('/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBSearch && typeof window.setMode === 'function', null, { timeout: 30000 });
    await till.evaluate(() => refresh());
    await till.evaluate(() => setMode('receive'));
    await till.waitForFunction((id) => (TASKS.receive || []).some((t) => t.chit_id === id), orderId, { timeout: 30000 });
    await till.evaluate((id) => rcvPickTask(id), orderId);
    await till.waitForSelector('[data-testid="rcv-line-0"]', { timeout: 15000 });
  });

  await test.step('⚠️ 38 bags arrived, not 40 — and it will not confirm until somebody says why', async () => {
    await till.evaluate(() => {
      /* count what actually came: two bags short, and all the oil */
      const rice = RCV.lines.findIndex((l) => l.name.indexOf('Ponni') >= 0);
      const oil = RCV.lines.findIndex((l) => l.name.indexOf('Sunflower') >= 0);
      rcvSet(rice, 'counted', 38); rcvSet(oil, 'counted', 120);
      RCV.vendor = 'Anand Traders'; RCV.bill_no = '4471'; RCV.bill_total = 54400;   /* their bill still says 40 bags */
    });
    let asked = '';
    till.once('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
    await till.evaluate(() => rcvConfirm());
    await till.waitForTimeout(500);
    expect(asked, 'it confirmed a short delivery without a reason').toContain('why');
  });

  await test.step('with the reason given, the receipt is recorded and printed', async () => {
    await till.evaluate(() => {
      const rice = RCV.lines.findIndex((l) => l.name.indexOf('Ponni') >= 0);
      rcvSet(rice, 'reason', 'damaged');
      RCV.costs.freight = 2000;                     /* and a lorry to pay for */
    });
    await till.waitForTimeout(200);
    await till.evaluate(() => rcvConfirm());
    await expect(till.locator('#sliptitle')).toContainText('Receipt', { timeout: 20000 });
    const paper = await till.locator('#slipbox').innerText();
    expect(paper).toContain('GOODS RECEIVED');
    expect(paper, 'the difference and its reason belong on the paper').toContain('damaged');
    expect(paper, 'the freight is part of what the goods cost').toContain('LANDED');
    await till.click('#slipdlg button:has-text("Close")');
  });

  await test.step('what arrived is on the ORDER now — 2 bags still owed, not 40', async () => {
    const owed = await page.evaluate(async ({ base, id }) => {
      for (let i = 0; i < 15; i++) {
        const r = await fetch(base + '/api/till/tasks?kind=receive', { headers: { Authorization: 'Bearer ' + SESSION.token } });
        const j = await r.json().catch(() => ({}));
        const t = (j.tasks || []).find((x) => x.chit_id === id);
        const rice = t && t.lines.find((l) => l.name.indexOf('Ponni') >= 0);
        if (rice && rice.moved > 0) return rice.remaining;
        await new Promise((res) => setTimeout(res, 2000));
      }
      return null;
    }, { base: API, id: orderId });
    expect(owed, 'the movement never reached the order').toBe(2);
  });

  await test.step('⭐⭐ and the MATCH names the difference instead of smoothing it away', async () => {
    const m = await page.evaluate(async ({ base, id }) => {
      for (let i = 0; i < 15; i++) {
        const r = await fetch(base + '/api/till/match?days=30', { headers: { Authorization: 'Bearer ' + SESSION.token } });
        const j = await r.json().catch(() => ({}));
        const o = (j.orders || []).find((x) => x.chit_id === id);
        if (o && o.lines.some((l) => l.received > 0)) return o;
        await new Promise((res) => setTimeout(res, 2000));
      }
      return null;
    }, { base: API, id: orderId });

    expect(m, 'the order never appeared in the match').toBeTruthy();
    const rice = m.lines.find((l) => l.name.indexOf('Ponni') >= 0);
    expect(rice.ordered).toBe(40);
    expect(rice.received, 'RECEIVED is what our own door counted — never what their bill says').toBe(38);
    expect(rice.difference).toBe(-2);
    expect(rice.state).toBe('short');
    expect(rice.reason, 'the reason the person at the door gave travels with the difference').toBe('damaged');
    expect(m.verdict).toBe('differs');
    expect(m.invoiced_total, 'their bill total, keyed at the door').toBe(54400);
    expect(m.invoiced_from).toContain('keyed');
    /* ⭐ the money gap is the sentence the product is sold on: three claims, and CB takes no side */
    expect(m.received_total).toBe(52400);          // 38 × 1000 + 120 × 120
    expect(m.money_gap).toBe(-2000);               // they billed 2,000 more than we counted
  });
});

// [DSP-01] GOODS OUT. Athi: "we receive a task, so left hand side is the task received, right hand side is the material collated,
// so each scanning or item added reduces the count once filled." The rules that make a scan worth trusting are the point: you cannot
// pick more than was ordered, you cannot pick something that is not on the order, and a short pick has to say why TODAY.
test('[DSP-01] pick against an order: every unit scanned, over-picking refused, and the order updated in both copies', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Goods out ' + Date.now().toString().slice(-6) });

  await test.step('a shop with two things it sells', async () => {
    await addProduct(page, { name: 'Brake pad set', unit: 'set', price: 1450, code: 'BRK' });
    await addProduct(page, { name: 'Engine oil 5L', unit: 'can', price: 2100, code: 'OIL5' });
  });

  let orderId, items;
  await test.step('a customer order lands on us', async () => {
    /* ⚠️ an order we RECEIVE is a sale — and a SELF chit lands as 'received', so it needs no side to be read as one (sideOf) */
    const r = await page.evaluate(async () => {
      const res = await fetch(CFG.API_BASE + '/api/chits/send', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token },
        body: JSON.stringify({ recipients: [{ self: true, name: 'self' }], purpose: 'order',
          subject: 'Chola Auto Care', manual_subject: 'Chola Auto Care',
          business_json: { party: { name: 'Chola Auto Care' } },
          line_items: [
            { particulars: 'Brake pad set', quantity: 12, unit: 'set', price: 1450, total: 17400 },
            { particulars: 'Engine oil 5L', quantity: 6, unit: 'can', price: 2100, total: 12600 },
          ] }) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    orderId = r.body.chit_id || (r.body.chit && r.body.chit.chit_id);
    expect(orderId).toBeTruthy();
  });

  let key;
  await test.step('a counter key, and the order shows as work to send', async () => {
    key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
      return api('keysMint', { body: { name: 'goods out', scopes: ['till'], days: 1 } }); })).key;
    const r = await page.request.get(API + '/api/till/tasks?kind=despatch', { headers: { 'X-Api-Key': key } });
    const j = await r.json();
    const mine = j.tasks.find((t) => t.chit_id === orderId);
    expect(mine, 'the customer order is not in the despatch list').toBeTruthy();
    expect(mine.lines.find((l) => l.name.indexOf('Brake') >= 0).remaining).toBe(12);
    /* ⚠️ and the same order must NOT be in the receiving list — that is what side means */
    const other = await (await page.request.get(API + '/api/till/tasks?kind=receive', { headers: { 'X-Api-Key': key } })).json();
    expect(other.tasks.some((t) => t.chit_id === orderId), 'a sale turned up on the goods-in screen').toBe(false);
  });

  const till = await context.newPage();
  till.on('pageerror', (e) => console.log('   till threw: ' + e.message));
  const snap = await page.evaluate(async () => (await (await fetch(CFG.API_BASE + '/api/till/snapshot', { headers: { Authorization: 'Bearer ' + SESSION.token } })).json()));
  items = snap.items;

  await test.step('the counter opens in DESPATCH, on that order', async () => {
    await till.goto('/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBSearch && typeof window.setMode === 'function', null, { timeout: 30000 });
    await till.evaluate(() => refresh());
    await till.evaluate(() => setMode('despatch'));
    await till.waitForFunction((id) => (TASKS.despatch || []).some((t) => t.chit_id === id), orderId, { timeout: 30000 });
    await till.evaluate((id) => dspPickTask(id), orderId);
    await till.waitForSelector('[data-testid="dsp-line-0"]', { timeout: 15000 });
  });

  await test.step('⚠️ a scan for something not on the order is refused, not added', async () => {
    let said = '';
    till.once('dialog', async (d) => { said = d.message(); await d.dismiss(); });
    await till.evaluate(() => dspScan({ item_id: 'not-on-this-order', name: 'Windscreen wiper' }, 1));
    await till.waitForTimeout(400);
    expect(said).toContain('not on this order');
    expect(await till.evaluate(() => DSP.lines.length), 'it grew a line nobody ordered').toBe(2);
  });

  await test.step('⚠️ and it will not pick more than was ordered', async () => {
    const brake = items.find((i) => i.name.indexOf('Brake') >= 0);
    let said = '';
    till.once('dialog', async (d) => { said = d.message(); await d.dismiss(); });
    await till.evaluate((it) => dspScan(it, 20), { item_id: brake.item_id, name: brake.name });
    await till.waitForTimeout(400);
    expect(said).toContain('dispute');
    expect(await till.evaluate(() => DSP.lines.find((l) => l.name.indexOf('Brake') >= 0).picked)).toBe(12);
  });

  await test.step('the rest is short, and it says why before it goes', async () => {
    const oil = items.find((i) => i.name.indexOf('Engine oil') >= 0);
    await till.evaluate((it) => dspScan(it, 4), { item_id: oil.item_id, name: oil.name });
    let said = '';
    till.once('dialog', async (d) => { said = d.message(); await d.dismiss(); });
    await till.evaluate(() => dspConfirm());
    await till.waitForTimeout(500);
    expect(said, 'it despatched a short line with no reason').toContain('why');
    await till.evaluate(() => { const n = DSP.lines.findIndex((l) => l.name.indexOf('Engine oil') >= 0); dspSet(n, 'reason', 'no stock'); DSP.ref = 'TN01 AB 1234'; DSP.weight = 14.2; });
    await till.waitForTimeout(200);
    await till.evaluate(() => dspConfirm());
    await expect(till.locator('#sliptitle')).toContainText('Despatch', { timeout: 20000 });
    const paper = await till.locator('#slipbox').innerText();
    expect(paper).toContain('PACKING SLIP');
    expect(paper, 'the customer is told what is short, on the paper').toContain('no stock');
    expect(paper).toContain('TN01 AB 1234');
  });

  await test.step('⭐ and the order knows what left: 2 cans still owed', async () => {
    const owed = await page.evaluate(async ({ base, id }) => {
      for (let i = 0; i < 15; i++) {
        const j = await (await fetch(base + '/api/till/tasks?kind=despatch', { headers: { Authorization: 'Bearer ' + SESSION.token } })).json().catch(() => ({}));
        const t = (j.tasks || []).find((x) => x.chit_id === id);
        const oil = t && t.lines.find((l) => l.name.indexOf('Engine oil') >= 0);
        if (oil && oil.moved > 0) return oil.remaining;
        await new Promise((res) => setTimeout(res, 2000));
      }
      return null;
    }, { base: API, id: orderId });
    expect(owed, 'the pick never reached the order').toBe(2);
  });
});

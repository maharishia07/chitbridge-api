// [TILL-22] [TILL-23] A COUNTER IS A STANDING IDENTITY — created once, opened and closed again and again, one PC at a time.
//
// Athi, 2026-09-17: *"it has to be like a co-assist, so I know the counter number, and I should be able to open and close the
// counter again and again — but in only one PC."* And, before that: *"as it is an offline capability, the system should be
// updated with the next seq number whenever the sync completes"*, and *"it has to be online to create a counter."*
//
// ⚠️ THE FAULT THIS REPLACES: a PC "opened a counter" by minting a fresh unnamed key, so one test shop held nine, and two PCs
// numbered as the same C1 — the second PC's sales absorbed as the first's.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

const helpers = (page) => ({
  app: (name, opts) => page.evaluate(async ({ name, opts }) => {
    try { return { ok: true, body: await api(name, opts || {}) }; }
    catch (e) { return { ok: false, message: (e && e.message) || String(e), status: e && e.status }; }
  }, { name, opts }),
  raw: (method, path, key, body) => page.evaluate(async ({ method, path, key, body }) => {
    const r = await fetch(CFG.API_BASE + path, { method,
      headers: Object.assign({ 'X-Api-Key': key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j };
  }, { method, path, key, body }),
});

test('[TILL-22] create, open, refuse a second PC, close, reopen and continue, release', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Ctr ' + Date.now().toString().slice(-6) });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const h = helpers(page);

  let id;
  await test.step('⭐ the shop creates a counter — it gets a number of its own', async () => {
    const r = await h.app('counterAdd', { body: { name: 'Front desk' } });
    expect(r.ok, r.message).toBe(true);
    id = r.body.counter.id;
    expect(id).toMatch(/^[A-Z][1-9]$/);
    expect(r.body.counter.name).toBe('Front desk');
    expect(r.body.counter.state).toBe('closed');
  });

  let keyA;
  await test.step('⭐ a PC opens it', async () => {
    const r = await h.app('counterOpen', { params: { id } });
    expect(r.ok, r.message).toBe(true);
    keyA = r.body.key;
    expect(keyA).toBeTruthy();
    const snap = await h.raw('GET', '/api/till/snapshot?till=C1&issued=0', keyA);
    expect(snap.body.till.assigned_id, 'the PC was not given the COUNTER\'s number').toBe(id);
    expect(snap.body.till.counter).toBe(id);
  });

  await test.step('⛔ ONE PC AT A TIME — a second open is refused and names the holder', async () => {
    const r = await h.app('counterOpen', { params: { id } });
    expect(r.ok, 'two PCs were allowed to hold one counter').toBe(false);
    expect(r.message).toMatch(/already open/i);
  });

  const period = 'P-' + Date.now().toString().slice(-5);
  await test.step('⭐⭐ a bill that reaches ChitBridge moves the counter\'s place in its series', async () => {
    const no = id + '/26-27/0005';
    const r = await h.raw('POST', '/api/chits/send', keyA, {
      recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, client_ref: no,
      business_json: { till: { id }, bill_no: no, billed_at: new Date().toISOString(),
                       series: { prefix: id, period, seq: 5 } },
      line_items: [{ particulars: 'Tea', quantity: 1, unit: 'cup', price: 10, total: 10 }] });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    let c = null;
    for (let i = 0; i < 10; i++) {     /* the high-water update runs after the answer */
      const l = await h.app('counters');
      c = (l.body.counters || []).find((x) => x.id === id);
      if (c && c.next === 6) break;
      await page.waitForTimeout(800);
    }
    expect(c.next, 'the cloud did not learn where the series stands').toBe(6);
    expect(c.period).toBe(period);
    expect(c.state).toBe('open');
  });

  await test.step('🔒 the PC closes the counter — its key stops, the counter is free and keeps its place', async () => {
    const r = await h.raw('POST', '/api/till/close', keyA, { last_no: id + '/26-27/0005', bills: 1, next: 6, period });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = await h.raw('GET', '/api/till/snapshot', keyA);
    expect(after.status, 'a closed counter\'s key still works').toBe(401);
    expect(after.body.code).toBe('COUNTER_CLOSED');
    const l = await h.app('counters');
    const c = l.body.counters.find((x) => x.id === id);
    expect(c.state).toBe('closed');
    expect(c.next, 'closing lost the counter\'s place').toBe(6);
  });

  let keyB;
  await test.step('⭐⭐⭐ OPEN AGAIN — on another PC — and it carries on from its last bill', async () => {
    const r = await h.app('counterOpen', { params: { id } });
    expect(r.ok, 'a closed counter could not be opened again: ' + r.message).toBe(true);
    keyB = r.body.key;
    expect(keyB).not.toBe(keyA);
    const snap = await h.raw('GET', '/api/till/snapshot?till=C1&issued=0', keyB);
    expect(snap.body.till.assigned_id, 'reopening gave a different number').toBe(id);
    expect(snap.body.till.resume_next, 'the new PC was not told where to carry on').toBe(6);
    expect(snap.body.till.resume_period).toBe(period);
  });

  await test.step('⚠️ release — for a PC that cannot close itself — frees the counter and stops that key', async () => {
    const r = await h.app('counterRelease', { params: { id } });
    expect(r.ok, r.message).toBe(true);
    const after = await h.raw('GET', '/api/till/snapshot', keyB);
    expect(after.status).toBe(401);
    const l = await h.app('counters');
    expect(l.body.counters.find((x) => x.id === id).state).toBe('closed');
  });

  await test.step('⚠️ a new counter never takes a number that already has bills in the books', async () => {
    const r = await h.app('counterAdd', { body: { name: 'Billing 2' } });
    expect(r.ok, r.message).toBe(true);
    expect(r.body.counter.id).not.toBe(id);
  });
});

// [TILL-23] ON THE COUNTER ITSELF: a PC that has never held the counter continues its series, and a counter with no number
// yet issues nothing.
test('[TILL-23] a reopened counter continues its run on a PC that never held it', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Ctr2 ' + Date.now().toString().slice(-6) });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const h = helpers(page);
  const id = (await h.app('counterAdd', { body: { name: 'Front desk' } })).body.counter.id;

  /* PC A takes five numbers, then closes */
  const openA = await h.app('counterOpen', { params: { id } });
  expect(openA.ok, 'PC A could not open the counter: ' + openA.message).toBe(true);
  const keyA = openA.body.key;
  const a = await context.newPage();
  await a.goto(TILL + '/till.html#key=' + encodeURIComponent(keyA));
  await a.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await a.evaluate(() => refresh());
  const taken = await a.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 5; i++) { LAST_SERIES = null; out.push(await nextNumber()); }
    return { nums: out, series: LAST_SERIES, id: tillId() };
  });
  expect(taken.id, 'PC A did not take the counter\'s number').toBe(id);
  expect(taken.nums[4]).toMatch(new RegExp('^' + id + '/.*/0005$'));
  const close = await h.raw('POST', '/api/till/close', keyA, { next: 6, period: taken.series.period, bills: 0 });
  expect(close.status, JSON.stringify(close.body)).toBe(200);

  await test.step('⭐⭐⭐ PC B — its own browser storage — opens the same counter and issues 0006, not 0001', async () => {
    const openB = await h.app('counterOpen', { params: { id } });
    expect(openB.ok, 'PC B could not open the counter: ' + openB.message).toBe(true);
    const keyB = openB.body.key;
    const pcB = await page.context().browser().newContext();     /* a different PC: nothing shared with PC A */
    const b = await pcB.newPage();
    await b.goto((TILL || page.url().split('/').slice(0, 3).join('/')) + '/till.html#key=' + encodeURIComponent(keyB));
    await b.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await b.evaluate(() => refresh());
    const got = await b.evaluate(async () => { LAST_SERIES = null; const no = await nextNumber(); return { no, id: tillId() }; });
    expect(got.id).toBe(id);
    expect(got.no, 'the counter started its series again on the new PC').toMatch(new RegExp('^' + id + '/.*/0006$'));
    await pcB.close();
  });

  await test.step('⚠️ a counter that has never been given a number issues NOTHING', async () => {
    const pcC = await page.context().browser().newContext();
    const c = await pcC.newPage();
    /* ⚠️ the line drops before the counter ever reads the shop — every snapshot is refused */
    await c.route('**/api/till/snapshot**', (r) => r.abort());
    const loose = await page.evaluate(async () => (await api('keysMint', { body: { name: 'loose', scopes: ['till'], days: 1 } })).key);
    await c.goto((TILL || page.url().split('/').slice(0, 3).join('/')) + '/till.html#key=' + encodeURIComponent(loose));
    await c.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    const stopped = await c.evaluate(async () => { window.say = () => {}; return await tillStopped(); });
    expect(stopped, 'a counter with no number from the shop was allowed to bill').toBe(true);
    await pcC.close();
  });
});

// ⭐⭐⭐ [TILL-24] A NETWORK STORE'S COUNTER SELLS THE NETWORK'S PRODUCTS. Athi, 2026-09-17, on a showroom brand: *"a network
// store where the network provides the catalogue and offer details — every store underneath is a store on its own with its own
// GSTIN, but they use the catalogue information from the network to sell the product."*
// ⚠️ That reached the store's shopfront and never its counter: the snapshot read only the store's own rows.
test('[TILL-24] a store that adopts a network catalogue sells its priced lines at the counter', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'NetStore ' + Date.now().toString().slice(-6) });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const h = helpers(page);

  await test.step('the store adopts the brand\'s catalogue — pricing one line, leaving another unpriced', async () => {
    const r = await h.app('catalogueAdopt', { body: { source: 'beta-royale-play@v1',
      commercials: { 'Tussar': { price: 1200, unit: 'litre' } } } });
    expect(r.ok, r.message).toBe(true);
  });

  const id = (await h.app('counterAdd', { body: { name: 'Showroom desk' } })).body.counter.id;
  const key = (await h.app('counterOpen', { params: { id } })).body.key;

  await test.step('⭐⭐ the counter\'s shop read carries the network line, priced by the STORE', async () => {
    const snap = await h.raw('GET', '/api/till/snapshot', key);
    expect(snap.status).toBe(200);
    const net = (snap.body.items || []).filter((i) => i.source);
    const tussar = net.find((i) => i.name === 'Tussar');
    expect(tussar, 'the network\'s product never reached the counter').toBeTruthy();
    expect(tussar.price, 'the store\'s own price did not overlay the brand\'s line').toBe(1200);
    expect(tussar.source.key).toBe('beta-royale-play@v1');
    expect(tussar.item_id, 'a network line needs a stable id the counter can hold').toMatch(/^src:/);
    /* ⚠️ an unpriced line is held back and COUNTED, never sent at zero */
    expect(net.every((i) => i.price > 0), 'a network line was offered at no price').toBe(true);
    expect(snap.body.network.unpriced, 'the unpriced lines were not counted').toBeGreaterThan(0);
    /* ⚠️ the count the counter checks its copy against must include them, or every refresh re-reads the whole shop */
    expect(snap.body.total, 'total leaves the network lines out').toBe((snap.body.items || []).length);
  });

  await test.step('⭐⭐⭐ and the counter rings it up', async () => {
    const till = await context.newPage();
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    const got = await till.evaluate(() => {
      const i = ((S && S.items) || []).find((x) => x.name === 'Tussar');
      if (!i) return { found: false };
      CART = []; addItem(i, 1);
      return { found: true, price: i.price, source: i.source && i.source.key, cart: CART.map((c) => c.name) };
    }).catch((e) => ({ err: String(e) }));
    expect(got.found, 'the counter does not list the network product: ' + JSON.stringify(got)).toBe(true);
    expect(got.price).toBe(1200);
    expect(got.cart, 'the network product would not go on the bill').toEqual(['Tussar']);
  });
});

// ⭐⭐ [TILL-25] A BREAK IS NOT A CLOSE. Athi, 2026-09-17: *"closing a counter need not be closing the sale for the day — they can
// go for a break also."* The counter stays held, nothing is billed, and the shop's Counters screen says "on break".
test('[TILL-25] a break keeps the counter, stops billing, and shows on the Counters screen', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Brk ' + Date.now().toString().slice(-6) });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const h = helpers(page);
  const id = (await h.app('counterAdd', { body: { name: 'Front desk' } })).body.counter.id;
  const key = (await h.app('counterOpen', { params: { id } })).body.key;
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await till.evaluate(() => refresh());

  await test.step('⚠️ BEFORE any break, the counter is uncovered — the cover must never sit over a working till', async () => {
    await expect(till.locator('[data-testid="till-break-cover"]')).toBeHidden();
  });

  await test.step('☕ taking a break covers the counter and stops billing', async () => {
    /* a cashier is signed in, as at any real counter */
    await till.evaluate(() => { WHO = { id: 'a1', name: 'Ravi', since: new Date().toISOString(), float: 0 }; ls.set(shopLs('cb_till_who'), JSON.stringify(WHO)); });
    await till.evaluate(() => takeBreak());
    await expect(till.locator('[data-testid="till-break-cover"]')).toBeVisible();
    const stopped = await till.evaluate(async () => { window.say = () => {}; return await tillStopped(); });
    expect(stopped, 'a counter on break could still bill').toBe(true);
  });

  await test.step('⭐ the shop sees it on break — and the counter is still HELD, so no other PC can take it', async () => {
    let c = null;
    for (let i = 0; i < 10; i++) {
      c = ((await h.app('counters')).body.counters || []).find((x) => x.id === id);
      if (c && c.state === 'break') break;
      await page.waitForTimeout(700);
    }
    expect(c.state, 'the shop cannot see the break').toBe('break');
    const other = await h.app('counterOpen', { params: { id } });
    expect(other.ok, '⚠️ another PC took a counter that was only on break').toBe(false);
  });

  await test.step('⚠️ a break survives a reload — the cover is back before anyone can bill', async () => {
    await till.reload();
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await expect(till.locator('[data-testid="till-break-cover"]')).toBeVisible();
    /* ⚠️ and so is the cashier — this was forgotten on every reload before [TILL-25] found why */
    await till.waitForFunction(() => WHO && WHO.name === 'Ravi', null, { timeout: 15000 });
  });

  await test.step('⭐ back to billing — the cover lifts, and the shop sees it open again', async () => {
    /* ⚠️ MOVED, NOT DELETED (2026-09-28, Athi: "make break a lock too"). Back to billing is a SIGN-IN now: the
       tap opens the one sign-in and the cover stays until somebody is proved. This spec is about the break
       reaching the shop, so it hands the gate the cashier it signed in above; the proof itself — counter PIN,
       offline, wrong tries — is e2e/till-lock.cjs. */
    await till.locator('[data-testid="till-break-end"]').click();
    await expect(till.locator('#usigndlg')).toBeVisible();
    await expect(till.locator('[data-testid="till-break-cover"]')).toBeVisible();
    await till.evaluate(() => { usignClose(); personIn({ id: WHO.id, name: WHO.name, kind: 'coassist' }); });
    await expect(till.locator('[data-testid="till-break-cover"]')).toBeHidden();
    let c = null;
    for (let i = 0; i < 10; i++) {
      c = ((await h.app('counters')).body.counters || []).find((x) => x.id === id);
      if (c && c.state === 'open') break;
      await page.waitForTimeout(700);
    }
    expect(c.state).toBe('open');
  });
});

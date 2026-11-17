// [TILL-18] TWO COUNTERS BOTH CALLED C1. Athi, 2026-09-17: *"from this PC the bills are pushed, but still not
// happening from the other PC."* The screen said "sent", and nothing reached Task.
//
// ⚠️⚠️⚠️ THE ROOT CAUSE. Only three counter bills had reached ChitBridge in five days, and his two PCs — on
// 152.233.15.121 and .123 — were BOTH counter `C1`, because the till id defaults to C1 and nobody renamed either.
// Both numbered C1/26-27/0001, 0002, … independently. The server is idempotent on the bill number, and its
// collision guard compared TILL IDS — equal for two unrenamed counters — so every clash read as a same-device
// retry: the second PC's real sale was absorbed, the server answered 200 with the FIRST PC's chit id, and the
// counter stamped that as its receipt and showed "✓ sent". No failure anywhere; no log; no queue row; no panel.
//
// ⚠️ THE GUARD HAD NEVER BEEN TESTED. Its own comment described this exact case, and the code missed it.
//
// Driven straight at the API: a counter is only a client of POST /api/chits/send, and this is a server rule.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

/* the bill a counter sends — the same shape tools/tally-connector/till.html chitOf() builds */
const bill = (no, till, at) => ({
  recipients: [{ self: true, name: 'self' }],
  purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no,
  client_ref: no,
  business_json: {
    customer: { name: 'Walk-in' },
    till: { id: till, name: 'Counter 1', host: 'browser', by: null },
    bill_no: no, billed_at: at,
    payment: { mode: 'cash', paid: 10, change: 0, parts: [] },
    slip: 'cash',
  },
  line_items: [{ particulars: 'Tea', quantity: 1, unit: 'cup', price: 10, total: 10 }],
});

test('[TILL-18] a second counter with the same name and number is refused, not absorbed', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Clash ' + Date.now().toString().slice(-6) });

  /* two counters, two keys — exactly two PCs paired to one shop */
  const keys = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const out = [];
    for (const n of ['pc one', 'pc two']) {
      const r = await api('keysMint', { body: { name: n, scopes: ['till'], days: 1 } });
      out.push(r && (r.key || r.api_key));
    }
    return out;
  });
  const base = await page.evaluate(() => (typeof CFG !== 'undefined' && CFG.API_BASE) || '');
  const send = (key, body) => page.evaluate(async ({ base, key, body }) => {
    const r = await fetch(base + '/api/chits/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j };
  }, { base, key, body });

  const NO = 'C1/26-27/' + String(Date.now()).slice(-4);
  const firstAt = new Date(Date.now() - 60000).toISOString();

  let first;
  await test.step('the first PC records its bill', async () => {
    first = await send(keys[0], bill(NO, 'C1', firstAt));
    expect(first.status, 'the first bill did not land: ' + JSON.stringify(first.body)).toBeLessThan(300);
    expect(first.body && first.body.chit_id, 'no chit came back for the first bill').toBeTruthy();
  });

  await test.step('⭐ a genuine RETRY of that same bill is still answered with the same chit — unchanged', async () => {
    const again = await send(keys[0], bill(NO, 'C1', firstAt));
    expect(again.status).toBe(200);
    expect(again.body.duplicate, 'a retry should be recognised as one').toBe(true);
    expect(again.body.chit_id, 'a retry must get back ITS OWN chit').toBe(first.body.chit_id);
  });

  await test.step('⚠️⚠️⚠️ the OTHER PC, also called C1, same number, different sale — REFUSED and named', async () => {
    const other = await send(keys[1], bill(NO, 'C1', new Date().toISOString()));
    /* before the fix this was 200, duplicate:true, and the FIRST PC's chit id — a lost sale reported as sent */
    expect(other.status, 'the second PC\'s sale was absorbed as a retry: ' + JSON.stringify(other.body)).toBe(409);
    expect(other.body.code).toBe('TILL_SERIES_COLLISION');
    expect(other.body.chit_id, 'a refusal must never hand back somebody else\'s chit id').toBeFalsy();
    /* ⚠️ and the words must make sense when both counters carry the same name */
    expect(other.body.message, 'the refusal does not tell them how to fix it').toMatch(/ALSO called C1/);
  });

  await test.step('⭐ a re-paired counter re-sending ITS OWN bill (new key, same moment) is still a retry', async () => {
    /* the stranded-sales rescue sends old bills under a new key — that must not read as a collision */
    const rescued = await send(keys[1], bill(NO, 'C1', firstAt));
    expect(rescued.status, 'a re-sent bill from a re-paired counter was refused').toBe(200);
    expect(rescued.body.chit_id).toBe(first.body.chit_id);
  });
});

// ⭐⭐⭐ [TILL-19] ONE PERMANENT PREFIX PER COUNTER, GIVEN BY THE SHOP. Athi, 2026-09-17: *"if the same counter
// number is already opened in another PC ... either stop opening that counter, or allow — but with a different
// sequence number"*, and then: *"the counter sequence number — we should offer it, and it cannot be changed for a
// PC, so it is a permanent number."*
//
// ⚠️ THE ASSERTION MOVED, IT WAS NOT DROPPED. The first version of this case asserted the newer PC was STOPPED.
// Athi's second message is better than that design: GST rule 46 allows invoices in multiple series, each
// consecutive for the year, so the newer PC is simply MOVED to a free prefix and told why. The case now asserts the
// move — and still asserts it is refused a prefix another counter holds, which is what the stop was protecting.
test('[TILL-19] each counter gets its own prefix; a clashing one is moved, never given a held prefix', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Prefix ' + Date.now().toString().slice(-6) });

  const keys = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const out = [];
    for (const n of ['older pc', 'newer pc', 'fresh pc']) {
      const r = await api('keysMint', { body: { name: n, scopes: ['till'], days: 1 } });
      out.push(r && (r.key || r.api_key));
      await new Promise((ok) => setTimeout(ok, 1100));   /* created_at decides who is older — keep them apart */
    }
    return out;
  });
  const base = await page.evaluate(() => (typeof CFG !== 'undefined' && CFG.API_BASE) || '');
  const snap = (key, till, issued) => page.evaluate(async ({ base, key, till, issued }) => {
    const r = await fetch(base + '/api/till/snapshot?till=' + encodeURIComponent(till) + '&issued=' + (issued ? 1 : 0),
                          { headers: { 'X-Api-Key': key } });
    const j = await r.json().catch(() => null);
    return { status: r.status, till: j && j.till };
  }, { base, key, till, issued });

  await test.step('two PCs that have both issued numbers as C1 — the OLDER keeps it', async () => {
    const older = await snap(keys[0], 'C1', true);
    expect(older.status).toBe(200);
    expect(older.till.moved_from, 'the older counter was moved off its own series').toBeFalsy();
    expect(older.till.assigned_id).toBe('C1');
  });

  let movedTo;
  await test.step('⭐⭐ … and the NEWER one is MOVED to a free prefix, with the reason named', async () => {
    const newer = await snap(keys[1], 'C1', true);
    expect(newer.till.clash, 'a counter was stopped when a free prefix existed').toBeFalsy();
    expect(newer.till.moved_from, 'the move is not said out loud').toBe('C1');
    expect(newer.till.held_by, 'the move does not say which counter holds C1').toBe('older pc');
    movedTo = newer.till.assigned_id;
    expect(movedTo, '⚠️ two PCs were left on one series').not.toBe('C1');
    expect(movedTo).toMatch(/^[A-Z][1-9]$/);
  });

  await test.step('⭐ the move is PERMANENT — asking again with the new prefix keeps it, and does not move it back', async () => {
    const again = await snap(keys[1], movedTo, true);
    expect(again.till.assigned_id).toBe(movedTo);
    expect(again.till.moved_from, 'a settled counter was moved a second time').toBeFalsy();
  });

  await test.step('⭐⭐ a PC that has issued NOTHING is given a prefix nobody holds — and it too is kept', async () => {
    const fresh = await snap(keys[2], 'C1', false);
    expect(fresh.till.clash).toBeFalsy();
    expect(fresh.till.assigned_id, 'a fresh counter was handed the prefix another counter holds').not.toBe('C1');
    expect(fresh.till.assigned_id, 'a fresh counter was handed the prefix the moved counter holds').not.toBe(movedTo);
    const again = await snap(keys[2], fresh.till.assigned_id, false);
    expect(again.till.assigned_id, 'the prefix moved between two reads').toBe(fresh.till.assigned_id);
  });
});

// ⭐⭐⭐ [TILL-20] THE RECOVERY — option (a), Athi 2026-09-17. A bill absorbed before the fix holds a REAL chit id —
// somebody else's — so the counter cannot tell it from a good one. /api/till/reconcile reads each chit back and
// compares the bill number AND the moment it was taken.
test('[TILL-20] reconcile tells a recorded bill from an absorbed one', async ({ page }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Recon ' + Date.now().toString().slice(-6) });
  const keys = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const out = [];
    for (const n of ['pc a', 'pc b']) {
      const r = await api('keysMint', { body: { name: n, scopes: ['till'], days: 1 } });
      out.push(r && (r.key || r.api_key));
    }
    return out;
  });
  const base = await page.evaluate(() => (typeof CFG !== 'undefined' && CFG.API_BASE) || '');
  const post = (key, path, body) => page.evaluate(async ({ base, key, path, body }) => {
    const r = await fetch(base + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j };
  }, { base, key, path, body });

  const NO = 'C1/26-27/' + String(Date.now()).slice(-4);
  const atA = new Date(Date.now() - 120000).toISOString();
  const atB = new Date(Date.now() - 60000).toISOString();

  /* PC A's sale lands. PC B's sale — same number, a minute later — is what the OLD server absorbed, handing back A's chit. */
  const a = await post(keys[0], '/api/chits/send', bill(NO, 'C1', atA));
  expect(a.status).toBeLessThan(300);
  const chitOfA = a.body.chit_id;

  await test.step('⭐ PC A asking about its own bill: ok', async () => {
    const r = await post(keys[0], '/api/till/reconcile', { bills: [{ no: NO, at: atA, chit_id: chitOfA }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.bills[0].verdict).toBe('ok');
  });

  await test.step('⚠️⚠️ PC B holding A\'s chit id for ITS sale: absorbed — the sale never reached the books', async () => {
    const r = await post(keys[1], '/api/till/reconcile', { bills: [{ no: NO, at: atB, chit_id: chitOfA }] });
    expect(r.body.bills[0].verdict, 'an absorbed sale was reported as recorded').toBe('absorbed');
  });

  await test.step('a chit id that does not exist: missing', async () => {
    const r = await post(keys[1], '/api/till/reconcile',
      { bills: [{ no: NO, at: atB, chit_id: '00000000-0000-0000-0000-000000000000' }] });
    expect(r.body.bills[0].verdict).toBe('missing');
  });

  await test.step('⭐⭐ and the renumbered sale is recorded, carrying the number the customer was given', async () => {
    const NEW = 'C9/26-27/' + String(Date.now()).slice(-4);
    const b = bill(NEW, 'C9', atB);
    b.business_json.printed_as = NO;
    b.business_json.renumbered = { from: NO, to: NEW, why: 'test' };
    const r = await post(keys[1], '/api/chits/send', b);
    expect(r.status, 'the renumbered sale was refused: ' + JSON.stringify(r.body)).toBeLessThan(300);
    expect(r.body.chit_id).not.toBe(chitOfA);
    const back = await post(keys[1], '/api/till/reconcile', { bills: [{ no: NEW, at: atB, chit_id: r.body.chit_id }] });
    expect(back.body.bills[0].verdict, 'the recovered sale is not in the books').toBe('ok');
  });
});

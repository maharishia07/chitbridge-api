// [TILL-47] R2 — OFFLINE IS A NORMAL STATE, NOT AN ERROR.
//
// The design package writes its own test: *"airplane mode for 2 hours of billing, 40 bills, then reconnect:
// 40 bills arrive, none duplicated, numbers unchanged."* That is the second test below, run literally (minus the
// two hours, which the clock does not need to prove).
//
// ⚠️ The offline here is REAL — context.setOffline(true) cuts the browser's network, so the counter meets the
// same dropped fetches a shop on 2G does. Nothing is stubbed.
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

/** ring one thing up and take the money — the whole of a sale, through the counter's own calls */
async function sell(till, n) {
  await till.evaluate((k) => {
    clearBill();
    const items = (S.items || []).filter((i) => !(i.modifiers && i.modifiers.length) && !i.age_check && !i.combo_of);
    addItem(items[k % items.length], 1, null);
    price();
    pickPay('Cash');
    document.getElementById('tendered').value = '500';
  }, n);
  await till.waitForTimeout(150);
  await till.evaluate(() => finish());
  await till.waitForTimeout(400);
  await till.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
}

test('[TILL-47] the ladder: 2s, 4s, 8s … capped at five minutes, and it survives a restart',
  async ({ page, context }) => {
    test.setTimeout(240000);
    const till = await counter(page, context, 'ladder', [{ name: 'Tea', unit: 'cup', price: 20 }]);

    /* the package's numbers, exactly */
    expect(await till.evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map((n) => qBackoff(n))))
      .toEqual([2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000]);
    /**
     * ⚠️⚠️ THE CAP IS FIVE MINUTES, NOT GIVING UP. A bill is somebody's money — nothing may park it, drop it or
     * stop trying. This asserts the ladder FLATTENS rather than ending.
     */
    expect(await till.evaluate(() => qBackoff(100))).toBe(300000);

    /* a row that has never failed is always due */
    expect(await till.evaluate(() => qDue({}))).toBe(true);
    expect(await till.evaluate(() => qDue({ _nextAt: Date.now() + 60000 }))).toBe(false);
    expect(await till.evaluate(() => qDue({ _nextAt: Date.now() - 1 }))).toBe(true);

    /**
     * ⚠️ IT RIDES ON THE ROW, NOT IN A TIMER. A ladder held in memory resets to zero on every reload, and a
     * counter is reopened all day — that is no ladder at all. Written, reloaded, still waiting.
     */
    await till.evaluate(async () => {
      await DB.put('queue', { no: 'LADDER/TEST/1', lines: [], _tries: 6, _at: Date.now(),
                              _nextAt: Date.now() + 120000, _why: 'a made-up refusal' });
    });
    await till.reload();
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
    const after = await till.evaluate(async () => {
      const rows = (await DB.all('queue')) || [];
      const r = rows.filter((x) => x.no === 'LADDER/TEST/1')[0];
      return r ? { tries: r._tries, waiting: !qDue(r), says: qWaitWords(r) } : null;
    });
    expect(after, 'the row is still there after a restart').toBeTruthy();
    expect(after.tries).toBe(6);
    expect(after.waiting, 'and still serving its wait').toBe(true);
    /* ⚠️ A WAIT NOBODY CAN READ LOOKS LIKE A WEDGE — the panel must be able to say when, not only why */
    expect(after.says).toMatch(/next try in \d+m/);

    /**
     * ⚠️⚠️ A HAND ON THE BUTTON BEATS THE LADDER. "Send now" that silently does nothing because every row is in a
     * five-minute wait is the wedge shape this file has already paid for twice.
     */
    await till.evaluate(() => qReady('the test pressed it'));
    await till.waitForTimeout(300);
    expect(await till.evaluate(async () => {
      const r = ((await DB.all('queue')) || []).filter((x) => x.no === 'LADDER/TEST/1')[0];
      return qDue(r);
    }), 'clearing the wait makes it due at once').toBe(true);

    await till.evaluate(async () => { await DB.del('queue', 'LADDER/TEST/1'); });
  });

test('[TILL-47] forty bills rung with the line down arrive once each, with their numbers unchanged',
  async ({ page, context }) => {
    test.setTimeout(900000);
    const till = await counter(page, context, 'offline40', [
      { name: 'Tea', unit: 'cup', price: 20 },
      { name: 'Coffee', unit: 'cup', price: 25 },
      { name: 'Vada', unit: 'piece', price: 15 },
    ]);
    /* let the counter settle and send anything from opening the day, so the count below is only ours */
    await till.evaluate(() => HOST.drain({ force: true }));
    await till.waitForTimeout(1500);

    const N = 40;
    await context.setOffline(true);
    try {
      /* ⚠️ THE COUNTER MUST NOT NOTICE. Billing, numbering and the bill list are all local by design. */
      for (let i = 0; i < N; i++) await sell(till, i);

      const off = await till.evaluate(async () => ({
        queued: ((await DB.all('queue')) || []).length,
        bills: ((await DB.all('bills')) || []).length,
        numbers: ((await DB.all('bills')) || []).map((b) => b.no).sort(),
        says: queueWords(),
      }));
      expect(off.queued, 'every sale is on the device, waiting').toBe(N);
      expect(off.bills).toBe(N);
      /* ⚠️ NUMBERS ARE MINTED LOCALLY — being offline must not change one, or the numbering proves nothing */
      expect(new Set(off.numbers).size, 'forty distinct numbers').toBe(N);
      /* ⚠️ AND IT SAYS SO. "everything has reached ChitBridge" over forty unsent sales would be the worst lie
         this counter could tell. [[feedback-silence-is-the-bug]] */
      expect(off.says).not.toContain('everything has reached');
      expect(off.says).toMatch(/waiting to reach ChitBridge/);

      var numbersWhileOffline = off.numbers;
    } finally {
      await context.setOffline(false);
    }

    /* the line returns — and the counter's own 'online' handler clears the waits and drains */
    await till.evaluate(() => window.dispatchEvent(new Event('online')));
    /**
     * ⚠️ WAIT FOR THE QUEUE, NOT FOR A CLOCK. A fixed sleep either flakes or hides a slow drain.
     * ⚠️⚠️ AND NOT page.waitForFunction WITH AN ASYNC PREDICATE — reading the queue needs an await, the function
     * then returns a Promise, and a Promise is always truthy, so the wait passes on the first poll and the
     * assertion after it reads a queue that was never drained. Polled from here instead, where the await is real.
     */
    let left = -1, why = null;
    for (let t = 0; t < 150; t++) {
      const now = await till.evaluate(async () => ({
        n: ((await DB.all('queue')) || []).length,
        why: (HOST.last && HOST.last.why) || null,
        online: navigator.onLine,
      }));
      left = now.n; why = now.why;
      if (!left) break;
      await till.waitForTimeout(2000);
    }
    expect(left, 'the queue emptied after the line returned — last reason: ' + why).toBe(0);

    const back = await till.evaluate(async () => {
      const bills = (await DB.all('bills')) || [];
      return {
        queued: ((await DB.all('queue')) || []).length,
        numbers: bills.map((b) => b.no).sort(),
        confirmed: bills.filter((b) => b._sent && b._sent.chit_id).length,
        sentNoProof: bills.filter((b) => b._sent && !b._sent.chit_id).length,
        says: queueWords(),
      };
    });
    expect(back.queued).toBe(0);
    /* ⚠️⚠️ THE NUMBERS ARE THE SAME ONES. A renumber here would mean the paper in a customer's hand is wrong. */
    expect(back.numbers, 'the numbers did not move').toEqual(numbersWhileOffline);
    /**
     * ⚠️⚠️ NONE DUPLICATED. client_ref is the bill number and the server dedupes on it, so a retry cannot double
     * a sale — this asks the SERVER what it holds rather than trusting the counter's own opinion of itself.
     */
    /* ⚠️ ASKED THROUGH THE COUNTER'S OWN KEY. /api/till/bills is gated on a till key, not a session, so the
       question goes from the page that holds one — HOST.history(), the same call the learned keys use. */
    const onServer = await till.evaluate(async (nums) => {
      const h = await HOST.history(2);
      const rows = (h && h.bills) || [];
      const mine = rows.filter((b) => nums.indexOf(b.no) >= 0);
      /**
       * ⚠️⚠️ TWO ROWS WITH ONE NUMBER ARE NOT NECESSARILY TWO BILLS, AND THE DIFFERENCE IS THE WHOLE POINT:
       *   · same number, DIFFERENT chit_id  → the server really did record the sale twice. Idempotency is broken
       *     and a customer is billed twice. This is the fault R2 exists to prevent.
       *   · same number, SAME chit_id       → one bill, listed twice. The money is right; the LISTING multiplies,
       *     which is what a LEFT JOIN onto a table with more than one row per chit does.
       * Counting names alone cannot tell them apart, so this counts chits.
       */
      const byNo = {};
      mine.forEach((b) => { (byNo[b.no] = byNo[b.no] || {})[b.chit_id || '?'] = 1; });
      const realDupes = Object.keys(byNo).filter((n) => Object.keys(byNo[n]).length > 1);
      const listedTwice = mine.length - Object.keys(byNo).length;
      return { found: Object.keys(byNo).length, dupes: realDupes, listedTwice,
               rows: mine.length, offline: !!h.offline, why: h.why || null };
    }, numbersWhileOffline);
    expect(onServer.offline, 'the server was actually asked: ' + onServer.why).toBe(false);
    /* ⚠️⚠️ THE ONE THAT MEANS MONEY: no bill number may map to two different chits. */
    expect(onServer.dupes, 'the server recorded each bill exactly once (a retry never doubled one)').toEqual([]);
    expect(onServer.found, 'and it holds all forty').toBe(N);
    /**
     * ⚠️ AND THE LISTING MUST NOT MULTIPLY THEM EITHER. GET /api/till/bills LEFT JOINs chit_detail, which holds a
     * row per copy of a chit — so a self-billed sale can come back once per copy. Nobody is billed twice by
     * that, but every screen reading history counts the day twice, which is its own kind of wrong number.
     */
    expect(onServer.listedTwice, 'each bill is listed once, not once per copy').toBe(0);

    /* ⚠️ "sent" is not "confirmed" — a bill says sent only if it carries the id ChitBridge answered with */
    expect(back.confirmed + back.sentNoProof).toBe(N);
    expect(back.says).toContain('everything has reached ChitBridge');
  });

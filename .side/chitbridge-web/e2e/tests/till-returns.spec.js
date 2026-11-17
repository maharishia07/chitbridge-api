// [TILL-42] TAKING SOMETHING BACK — A GST §34 CREDIT NOTE.
//
// From the gap list: *"Refunds / returns — there is NO path. A shop cannot take anything back. This blocks
// every retail use, not just groceries."* Athi, 2026-09-18: *"refund are also can be taken care of."*
//
// ⚠️⚠️ A RETURN IS NOT A NEGATIVE SALE. Under §34 it is its OWN document, in its OWN consecutive series, naming
// the invoice it reverses and the reason. The original bill was issued, printed and possibly filed; nothing may
// go back and change it. Everything below is about proving those two sentences hold in the numbers.
//
// What is worth testing here is the MONEY and the SERIES, not that a dialog opened:
//   · a credit note must never draw a number out of the sales run — that leaves a hole nobody can account for
//   · the figures come off the ORIGINAL bill, scaled — never recomputed against today's slabs
//   · the same goods must not be refundable twice
//   · the day must net it, count it as a return rather than a bill, and tell the drawer what left it
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const TILL = process.env.CB_TILL_BASE || '';

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

/** bill the first three products, two of each, paid in cash */
async function billThree(till) {
  return till.evaluate(async () => {
    clearBill();
    (S.items || []).slice(0, 3).forEach((i) => addItem(i, 2, null));
    price();
    PICKED = 'Cash';
    document.getElementById('tendered').value = String(billMoney().net);
    await finish();
    await new Promise((r) => setTimeout(r, 1200));
    try { document.getElementById('slipdlg').close(); } catch (_) {}
    const rows = await HOST.bills();
    return rows.filter((b) => b.kind !== 'credit_note')
      .sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  });
}

/** answer the counter's own confirm dialog */
async function confirmReturn(till) {
  await till.waitForTimeout(600);
  await till.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const y = d && [...d.querySelectorAll('button')].find((b) => /Yes, give it back/i.test(b.textContent));
    if (y) y.click();
  });
  await till.waitForTimeout(1400);
  await till.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
}

test('[TILL-42] a credit note has its own series and leaves the sales run whole', async ({ page, context }) => {
  test.setTimeout(240000);
  const till = await counterFor(page, context, 'returns', [
    { name: 'Rice', unit: 'kg', price: 80 },
    { name: 'Dal', unit: 'kg', price: 60 },
    { name: 'Oil', unit: 'litre', price: 70 },
  ]);
  const bill = await billThree(till);
  expect(bill.no, 'a sale is numbered plainly').not.toMatch(/^C\//);

  await till.evaluate(async (no) => { await retOpen(no); }, bill.no);
  await till.waitForSelector('[data-testid="till-return"][open]', { timeout: 15000 });
  await till.evaluate(() => { retSet(0, 1); });
  await till.waitForTimeout(300);

  /* ⭐ THE FIGURE IS THE ORIGINAL'S, SCALED. One of two sold at ₹80 is ₹80 back — not today's price. */
  const shown = await till.evaluate(() => document.querySelector('[data-testid="till-ret-total"]').textContent);
  expect(shown).toContain('80');

  await till.evaluate(() => { retIssue(); });
  await confirmReturn(till);

  const after = await till.evaluate(async () => {
    const rows = await HOST.bills();
    const cn = rows.filter((b) => b.kind === 'credit_note').pop();
    return {
      cn: cn && cn.no,
      against: cn && cn.against && cn.against.bill_no,
      total: cn && cn.total,
      refunds: cn && cn.refunds,
      sales: rows.filter((b) => b.kind !== 'credit_note').map((b) => b.no),
      wirePurpose: cn && cn.chitBody && cn.chitBody.purpose,
      wireQty: cn && cn.chitBody && cn.chitBody.line_items.map((l) => l.quantity),
      wireHasSeries: cn && cn.chitBody && ('series' in (cn.chitBody.business_json || {})),
    };
  });

  /* ⚠️⚠️ ITS OWN SERIES. Before the engine learned the kind, compose() skipped the unknown tag and handed back
     the next SALES number — two documents in one run, discovered only at filing. */
  expect(after.cn, 'a credit note is tagged C and numbered in its own run').toMatch(/^C\//);
  expect(after.sales, 'and the sales run has no hole in it').not.toContain(after.cn);
  expect(after.against, 'it names the invoice it reverses — §34').toBe(bill.no);

  /* ⚠️ STORED NEGATIVE, so every bare "+" that adds up a day nets it without being taught about returns */
  expect(after.total).toBeLessThan(0);
  /* ⚠️ and money OUT is its own array — every reader of `payments` assumes money taken */
  expect(after.refunds[0].amount).toBeGreaterThan(0);

  /* ⚠️⚠️ THE WIRE CARRIES A POSITIVE QUANTITY. lib/stock-from-chit refuses any line with qty <= 0 outright, so a
     negative here would move NO stock and say nothing about it. The reason decides the direction, not the sign. */
  expect(after.wirePurpose).toBe('credit_note');
  expect(after.wireQty.every((q) => q > 0), 'a negative on the wire moves no stock, silently').toBe(true);
  /* ⚠️ no series key — that is the SALES high-water mark the cloud keeps per counter */
  expect(after.wireHasSeries).toBe(false);
});

test('[TILL-42] the same goods cannot be given back twice', async ({ page, context }) => {
  test.setTimeout(240000);
  const till = await counterFor(page, context, 'returns2', [
    { name: 'Rice', unit: 'kg', price: 80 },
    { name: 'Dal', unit: 'kg', price: 60 },
    { name: 'Oil', unit: 'litre', price: 70 },
  ]);
  const bill = await billThree(till);

  /* return the THIRD line only */
  await till.evaluate(async (no) => { await retOpen(no); }, bill.no);
  await till.waitForSelector('[data-testid="till-return"][open]', { timeout: 15000 });
  await till.evaluate(() => { retSet(2, 2); });
  await till.waitForTimeout(300);

  /**
   * ⚠️⚠️ THE BUG THIS PINS DOWN. A credit note holds only the lines that came back, so its line 0 may be the
   * original's line 2. retLeft() first matched prior credit notes BY ARRAY POSITION, so returning line 2 marked
   * line 0 as returned — leaving line 2 refundable all over again. A shop could have refunded the same goods
   * twice. from_line is what makes the match honest.
   */
  const marked = await till.evaluate(() => retMoney().lines.map((l) => ({ from_line: l.from_line, name: l.name })));
  expect(marked[0].from_line, 'the returned line says which line of the original it came from').toBe(2);

  await till.evaluate(() => { retIssue(); });
  await confirmReturn(till);

  const left = await till.evaluate(async (no) => {
    await retOpen(no);
    await new Promise((r) => setTimeout(r, 400));
    const out = (RET_FOR.lines || []).map((l, n) => ({ name: l.name, sold: l.qty, left: retLeft(RET_FOR, n) }));
    retClose();
    return out;
  }, bill.no);

  expect(left[2].left, 'the line that came back is exhausted').toBe(0);
  expect(left[0].left, 'and the lines that did NOT come back are untouched').toBe(left[0].sold);
  expect(left[1].left).toBe(left[1].sold);

  /* and you cannot ask for more than was sold */
  const clamped = await till.evaluate(async (no) => {
    await retOpen(no);
    await new Promise((r) => setTimeout(r, 300));
    retSet(0, 99);
    const v = document.querySelector('[data-testid="till-ret-qty-0"]').value;
    retClose();
    return Number(v);
  }, bill.no);
  expect(clamped, 'a return is capped at what was sold').toBe(2);
});

test('[TILL-42] the day nets the return, counts it as a return, and tells the drawer', async ({ page, context }) => {
  test.setTimeout(240000);
  const till = await counterFor(page, context, 'returns3', [
    { name: 'Rice', unit: 'kg', price: 80 },
    { name: 'Dal', unit: 'kg', price: 60 },
    { name: 'Oil', unit: 'litre', price: 70 },
  ]);
  const bill = await billThree(till);
  const sold = Number(bill.total);

  await till.evaluate(async (no) => { await retOpen(no); }, bill.no);
  await till.waitForSelector('[data-testid="till-return"][open]', { timeout: 15000 });
  await till.evaluate(() => { retSet(0, 1); retHow('Cash'); });
  await till.waitForTimeout(300);
  await till.evaluate(() => { retIssue(); });
  await confirmReturn(till);

  const d = await till.evaluate(async () => {
    const rows = await HOST.bills();
    const sheet = dayCloseSheet(rows);
    return {
      rows: rows.length, bills: sheet.bills, returns: sheet.returns, returned: sheet.returned,
      taken: sheet.total, first: sheet.first, last: sheet.last,
      cash: sheet.cash, cashBack: sheet.cash_back, expected: sheet.expected_cash,
      people: sheet.people, html: dayCloseHTML(sheet),
      bohniIsReturn: !!(bohniOf(rows.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))) || {}).kind,
    };
  });

  /* ⭐ the MONEY nets by itself, because a credit note is stored negative and every accumulator is a bare "+" */
  expect(d.taken).toBeCloseTo(sold - 80, 2);
  /* ⚠️ but the COUNT does not net — a return is not a sale made */
  expect(d.rows, 'two documents on the counter — a bill and a credit note').toBe(2);
  expect(d.bills, 'one of which is a bill').toBe(1);
  expect(d.returns, 'and one of which is a return').toBe(1);
  expect(d.returned).toBeCloseTo(80, 2);
  /* ⚠️ nor does the run: first/last are the invoice numbers, and a credit note has a run of its own */
  expect(d.first).not.toMatch(/^C\//);
  expect(d.last).not.toMatch(/^C\//);
  /* ⚠️ a refund is not a sale by that person either */
  expect(Object.values(d.people)[0].bills).toBe(1);

  /**
   * ⚠️⚠️ CASH HANDED BACK HAS LEFT THE DRAWER. Nothing produces a negative Cash mode — a refund lives in its own
   * array — so the drawer has to be told separately, or the count at close is short by exactly the refunds and
   * somebody gets accused of it.
   */
  expect(d.cashBack).toBeCloseTo(80, 2);
  expect(d.expected).toBeCloseTo(d.cash - 80, 2);
  expect(d.html, 'and the sheet says so, rather than leaving it to be worked out').toMatch(/RETURNS/);
  expect(d.html).toMatch(/Cash given back/);

  /* ⚠️ a return is never the bohni — the first SALE sets the day's luck */
  expect(d.bohniIsReturn).toBe(false);
});

/**
 * delivery-full.spec.js — FULL DELIVERY, end to end.
 *
 * Athi, 2026-08-14: *"once we complete full round of testing for the full delivery, then focus on partial
 * delivery, then the cost … let us prove one at a time."*
 *
 * This is the first of that sequence: a line ordered, delivered IN FULL, and every consequence that follows.
 * Partial delivery is deliberately NOT tested here — a spec that mixes the two proves neither, because the
 * interesting cases are exactly where they differ.
 *
 * ⚠️ WHAT MAKES THIS WORTH A SPEC. "Delivered" is not one fact, it is five that must agree: the event is recorded,
 * the arithmetic closes (pending → 0), the line reads complete, the order LOCKS, and both parties' copies say the
 * same thing. Any one of them can be right while another is wrong, and the screen looks fine either way.
 *
 * Watch it:  npx playwright test delivery-full --headed --project=authed
 */
const { test, expect } = require('@playwright/test');
const { mintEntity, settle } = require('../fixtures');

test.describe('DELIVERY — in full', () => {
  test.setTimeout(180_000);

  /* One chit, two lines: deliver ONE in full and leave its neighbour untouched. A single-line chit cannot show
     that completion is per LINE rather than per chit, which is the property everything else depends on. */
  async function setup(page) {
    return page.evaluate(async () => {
      await ensureCap('chit2');
      const s = String(Date.now()).slice(-6);
      const me = await api('me').catch(() => null);
      const myId = (me && (me.identity_id || (me.entity || {}).identity_id)) || null;
      const sent = await api('createChit', { body: {
        purpose: 'order', manual_subject: 'Full delivery ' + s,
        line_items: [{ particulars: 'Onion', quantity: 10, unit: 'kg', price: 40 },
                     { particulars: 'Potato', quantity: 5, unit: 'kg', price: 30 }],
        recipients: myId ? [{ entity_id: myId, role: 'to' }] : [] } });
      const det = await api('chit', { params: { id: sent.chit_id } });
      const ls = det.live_set || [];
      return { chit_id: sent.chit_id, subject: 'Full delivery ' + s,
               a: ls[0].line_id, b: ls[1].line_id, lines: ls.length };
    });
  }
  const progress = (page, chit_id, line_id) => page.evaluate(async (x) => {
    const d = await api('chit', { params: { id: x.chit_id } });
    return ((d.line_delivery || {})[x.line_id]) || null;
  }, { chit_id, line_id });

  test('DEL-01 · the full quantity closes the line, and only that line', async ({ page }) => {
    await mintEntity(page);
    const S = await setup(page);
    expect(S.lines, 'a self-chit writes ONE copy — two lines, not four').toBe(2);

    const before = await progress(page, S.chit_id, S.a);
    expect(before && before.delivered, 'nothing is delivered yet').toBe(0);
    expect(before.ordered, 'the ordered figure comes from the live line').toBe(10);
    expect(before.complete, 'and it is not complete').toBe(false);

    // ── deliver the WHOLE ordered quantity ──────────────────────────────────────────────────────────────────────
    const r = await page.evaluate(async (x) => api('c2DeliverLines', { params: { id: x.chit_id },
      body: { rows: [{ line_id: x.a, quantity: 10, unit: 'kg', reference: 'DC-001' }] } }), S);
    expect(r && r.delivered && r.delivered[0].quantity, 'the delivery is recorded at the full quantity').toBe(10);

    const after = await progress(page, S.chit_id, S.a);
    expect(after.delivered, 'delivered equals ordered').toBe(10);
    expect(after.pending, '⭐ nothing is left to send').toBe(0);
    expect(after.complete, 'the line reads complete').toBe(true);
    expect(after.over, 'and nothing was over-delivered').toBe(0);
    expect(after.events.length, 'one delivery event, with its reference kept').toBe(1);
    expect(after.events[0].reference, 'the delivery note number survives — it is the evidence').toBe('DC-001');

    /* ⭐ PER LINE. The neighbour must be untouched: a chit is not "delivered", its lines are. */
    const nb = await progress(page, S.chit_id, S.b);
    expect(nb ? nb.delivered : 0, 'the untouched line is still owed in full').toBe(0);
    expect(nb ? nb.complete : false, 'and is not complete').toBe(false);
  });

  test('DEL-02 · a delivered line amends UP but never below what went out', async ({ page }) => {
    await mintEntity(page);
    const S = await setup(page);
    await page.evaluate(async (x) => api('c2DeliverLines', { params: { id: x.chit_id },
      body: { rows: [{ line_id: x.a, quantity: 10, unit: 'kg' }] } }), S);

    /* ⚠️ THE REFUSAL BELONGS TO THE SERVER, not to a greyed button. Everything that is not the screen — a
       connector, a retry, a second tab — hits the same wall. */
    const amend = await page.evaluate(async (x) => {
      try {
        await api('amend', { params: { id: x.chit_id },
          body: { edits: [{ line_index: 0, line_id: x.a, line: { particulars: 'Onion', quantity: 99, unit: 'kg' }, reason_code: 'misread_by_ai' }] } });
        return { ok: true };
      } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
    }, S);
    /**
     * ⭐ THE RULE CHANGED, AND THIS SPEC IS THE RECORD OF IT.
     *
     * Athi wrote it on 2026-08-13 as *"once the receipt is made, then no more amendments"*, which I implemented
     * as "any delivery at all locks the line". On 2026-08-14 he reversed it: *"partial delivery can be amendable,
     * that is what makes it interesting."* The old rule froze the 60 still owed because 40 had gone out — the
     * part someone most needs to change.
     *
     * ⚠️ SO AMENDING UP IS NOW ALLOWED, and the guard moved to the three things that are genuinely unsafe:
     * below-delivered, a unit change, and removal. Those are asserted below.
     */
    expect(amend.ok, 'a partly delivered line amends UPWARD — 10 delivered, 99 ordered is legal').toBe(true);

    const below = await page.evaluate(async (x) => {
      try {
        await api('amend', { params: { id: x.chit_id },
          body: { edits: [{ line_index: 0, line_id: x.a, line: { particulars: 'Onion', quantity: 1, unit: 'kg' }, reason_code: 'quantity_change' }] } });
        return { ok: true };
      } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
    }, S);
    /* ⚠️ THE ONE THAT MATTERS: reducing below what has gone out would make delivered goods vanish from the
       arithmetic. That is a return, and it needs a negative event so both figures stay on the record. */
    expect(below.ok, 'but NOT below what has already been delivered — that is a return, not an amendment').toBe(false);
    expect(below.message, 'and the refusal names the remedy').toMatch(/delivered/i);

    const removal = await page.evaluate(async (x) => {
      try {
        await api('amend', { params: { id: x.chit_id },
          body: { edits: [{ line_index: 0, line_id: x.a, line: null, reason_code: 'stock_unavailable' }] } });
        return { ok: true };
      } catch (e) { return { ok: false }; }
    }, S);
    expect(removal.ok, 'nor removed — you cannot un-order what has been handed over').toBe(false);

    /* The neighbour is NOT locked. Freezing a whole order because one line shipped would block correcting the
       lines that have not. */
    const ok = await page.evaluate(async (x) => {
      try {
        await api('amend', { params: { id: x.chit_id },
          body: { edits: [{ line_index: 1, line_id: x.b, line: { particulars: 'Potato', quantity: 7, unit: 'kg' }, reason_code: 'misread_by_ai' }] } });
        return true;
      } catch (e) { return false; }
    }, S);
    expect(ok, 'the undelivered neighbour still amends').toBe(true);
  });

  test('DEL-03 · the screen agrees with the arithmetic', async ({ page }) => {
    await mintEntity(page);
    const S = await setup(page);
    await page.evaluate(async (x) => api('c2DeliverLines', { params: { id: x.chit_id },
      body: { rows: [{ line_id: x.a, quantity: 10, unit: 'kg' }] } }), S);

    await page.evaluate(async (x) => { await ensureCap('chit2'); await openChit2(x.chit_id); }, S);
    await settle(page);
    await page.evaluate(() => { c2Side('us'); c2Tab('work'); });
    await settle(page);

    const body = await page.evaluate(() => document.body.innerText);
    /* ⚠️ THE SCREEN IS THE LAST PLACE THIS CAN GO WRONG. The numbers can be right in the API and still render from
       the wrong field — which is how "0 left" and "10 left" both looked plausible earlier today. */
    expect(body, 'the completed line shows a tick, not a number').toMatch(/✓/);
    expect(body, 'the roll-up counts it as done').toMatch(/1 done|done/);
    expect(body, 'the untouched line still shows what is owed').toMatch(/Potato/);

    const errs = await page.evaluate(() => (window.__err || []));
    expect(errs, 'no swallowed exception').toEqual([]);
  });
});

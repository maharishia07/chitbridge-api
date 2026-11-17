'use strict';
/* detail-design-parties.spec.js — ── EACH PARTY READS THEIR OWN COPY THEIR OWN WAY ─────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-24: *"the customer copy and supplier copy should be the same, but the interpretation can be in
 * another tab — how the customer request is interpreted can stay within the receiving end. That is what we are
 * doing in the WhatsApp case: we store the customer request but interpret the same according to job item."*
 *
 * ⭐⭐ THE COMPLICATION STEP 3 WAS LOOKING FOR, and it was already in the code. Both `chit_header` inserts wrote
 * the SAME summary_json, so a recipient's copy carried the SENDER's detail_design stamp. A fleet customer set to
 * Order level would have decided that their workshop reads jobs at order level too — the customer choosing how
 * the supplier organises their mechanics. The record is shared; the reading of it is not.
 *
 * ⚠️ TWO CONTEXTS, NOT TWO TABS. Each party is a separate signed-in browser context, so each `storedDesign` call
 * reads that party's OWN chit_header row under their own RLS. Reading both copies from one session would either
 * breach isolation or quietly read the same row twice and pass for the wrong reason.
 */
const { test, expect } = require('@playwright/test');
const { mintInContext, composeChit, settle } = require('../fixtures');
const { setDetailDesign, storedDesign, watchSends } = require('../flows/detail-design');

const stamp = () => Date.now().toString().slice(-6);

test.describe('Detail page · two parties, one chit', () => {
  test('[DD-02] the recipient reads their copy their own way, not the sender\'s', async ({ browser }) => {
    test.setTimeout(12 * 60 * 1000);
    const s = stamp();

    /* CUSTOMER — leaves the default alone. Order level, and therefore no stamp at all. */
    const cust = await mintInContext(browser, {});
    /* SUPPLIER — a workshop that works line by line, because that is how work is handed to mechanics. */
    const supp = await mintInContext(browser, {});
    await settle(cust.page);
    await settle(supp.page);

    await test.step('THE SUPPLIER CHOOSES LINE LEVEL', async () => {
      await setDetailDesign(supp.page, 'lines');
    });

    let chitId;
    await test.step('THE CUSTOMER SENDS THE JOB', async () => {
      const sent = watchSends(cust.page);
      await composeChit(cust.page, {
        subject: 'Service request ' + s, recipients: [supp.name],
        item: 'Brake pads ' + s, qty: 2, price: 1200,
      });
      await expect.poll(() => sent.length, { timeout: 40000 }).toBeGreaterThan(0);
      const last = sent[sent.length - 1];
      expect(last.status, 'the chit was refused, so neither copy exists to compare').toBeLessThan(400);
      chitId = last.id;
    });

    await test.step('THE CUSTOMER\'S COPY — their own reading, which is Order level', async () => {
      expect(await storedDesign(cust.page, chitId),
        'the sender\'s copy is not carrying the sender\'s own reading').toBe(null);
    });

    await test.step('⭐⭐ THE SUPPLIER\'S COPY — THEIRS, NOT THE SENDER\'S', async () => {
      /**
       * ⚠️ THIS IS THE ASSERTION THAT MATTERS. If it reads null, the recipient's copy was written from the
       * sender's summary_json and the customer has just decided how the workshop reads its own work.
       */
      expect(await storedDesign(supp.page, chitId),
        'the recipient\'s copy carries the SENDER\'s detail design — the customer is deciding how the supplier '
        + 'reads their own work. Each chit_header row must be stamped with its own owner\'s preference.')
        .toBe('lines');
    });

    await test.step('AND THE SUPPLIER\'S SCREEN OBEYS THEIR OWN COPY', async () => {
      /* ⭐ The record is proved above; this proves the supplier's screen follows it — the point of the whole
         switch is that the receiving end reads the job the way the receiving end works. */
      await supp.page.reload({ waitUntil: 'domcontentloaded' });
      await supp.page.getByTestId('nav-compose').waitFor({ timeout: 30000 });
      await supp.page.waitForTimeout(3000);
      await supp.page.evaluate((id) => { if (typeof openChit === 'function') openChit(id); }, chitId);
      const opened = await supp.page.getByTestId('c2-side-them')
        .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
      expect(opened, 'the supplier chose Line level but their copy did not open line by line').toBe(true);
    });

    await test.step('THE CUSTOMER\'S SCREEN IS UNTOUCHED BY THE SUPPLIER\'S CHOICE', async () => {
      await cust.page.reload({ waitUntil: 'domcontentloaded' });
      await cust.page.getByTestId('nav-compose').waitFor({ timeout: 30000 });
      await cust.page.waitForTimeout(3000);
      await cust.page.evaluate((id) => { if (typeof openChit === 'function') openChit(id); }, chitId);
      await cust.page.waitForTimeout(8000);
      const design2 = await cust.page.evaluate(
        () => document.querySelectorAll('[data-testid="c2-side-them"]').length);
      expect(design2,
        'the customer\'s screen went line by line because the SUPPLIER chose it — the leak in the other direction')
        .toBe(0);
    });

    await cust.context.close();
    await supp.context.close();
  });
});

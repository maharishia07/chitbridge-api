// [ADOPT-02] THE ADOPT PANEL, DRIVEN. Built 2026-09-10 and opened by nobody — the rules are covered by
// [ADOPT-01] against the API; this is the first time a person's path through them runs.
//
// ⚠️ IT CLICKS THE BUTTON. The panel is what is under test, so the button that opens it must be clicked rather
// than c2Adopt() called — otherwise the one thing that could be broken (a missing global, a wrong id, a button
// that renders on the wrong pane) is exactly what gets skipped.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

const authOf = async (p) => ({ Authorization: 'Bearer ' + await p.evaluate(() => SESSION.token),
                               'Content-Type': 'application/json' });
async function setSector(p, sectors) {
  const r = await p.request.put(API + '/api/governance/profile', { headers: await authOf(p), data: { sectors } });
  if (!r.ok()) throw new Error('could not set the sector: ' + r.status());
}

test('[ADOPT-02] a delivery offers its new products, and the refusal needs a person', async ({ page, browser }) => {
  test.setTimeout(420000);

  await mintEntity(page, { fresh: true, name: 'Kirana ' + Date.now().toString().slice(-6) });
  const me = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const m = await api('me'); const e = (m && m.entity) || m || {};
    return { id: e.entity_id || e.identity_id };
  });
  await setSector(page, ['kirana']);

  /* a pharma supplier — the interesting case, because a grocery may not simply take medicine onto its shelf */
  const medCtx = await browser.newContext();
  const med = await medCtx.newPage();
  await mintEntity(med, { fresh: true, name: 'MedCo ' + Date.now().toString().slice(-5) });
  await med.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  await setSector(med, ['pharma']);

  let chit;
  await test.step('a pharma supplier sends a delivery with two lines', async () => {
    chit = await med.evaluate(async (to) => api('createChit', { body: {
      recipients: [{ entity_id: to }], purpose: 'receipt',
      subject: 'Goods received', manual_subject: 'Goods received',
      client_ref: 'GRN-UI-' + Date.now().toString().slice(-6),
      business_json: { doc: 'receipt', doc_no: 'GRN-UI', party: { name: 'MedCo' } },
      line_items: [
        { particulars: 'Paracetamol 500mg strip', quantity: 50, unit: 'strip', price: 9,
          item_data: { batch: 'P-9001', expiry: '2027-06-30', unit_cost: 9.4 } },
        { particulars: 'Cotton roll 100g', quantity: 20, unit: 'roll', price: 30,
          item_data: { batch: 'C-77', expiry: '2029-01-31', unit_cost: 31 } },
      ] } }), me.id);
    expect(chit && chit.chit_id, JSON.stringify(chit)).toBeTruthy();
  });

  await test.step('⭐ the delivery opens, and the lines pane offers to add the products', async () => {
    /* openChit2 is the app's own router entry for a chit — the equivalent of a URL. What is under test is the
       BUTTON and the panel, and both are clicked. */
    await page.evaluate(async (id) => { await ensureCap('chit2'); return openChit2(id); }, chit.chit_id);
    await page.evaluate(() => c2Side('them'));
    await page.evaluate(() => c2Tab('ord'));
    const btn = page.getByTestId('c2-adopt');
    await expect(btn, 'a goods receipt must offer to add its new products').toBeVisible({ timeout: 30000 });
    await btn.click();
  });

  await test.step('⭐⭐⭐ the refusal is shown, and it says what stocking them would OBLIGE', async () => {
    const box = page.getByTestId('adopt-refused').first();
    await expect(box, 'pharma goods at a grocery must be refused, not offered').toBeVisible({ timeout: 25000 });
    const said = await box.textContent();
    /* ⚠️ NOT "vertical mismatch" — that is a phrase from our world. It has to say what it means for the shop. */
    expect(said, said).toMatch(/batch and an expiry/);
    expect(said).toMatch(/recall/);
    await expect(box.getByTestId('adopt-override'), 'a refusal with no way through is a wall').toBeVisible();
  });

  await test.step('⚠️⚠️ Accept is DISABLED until a person has done the work', async () => {
    const accept = page.getByTestId('adopt-accept');
    await expect(accept).toBeDisabled();
    await expect(accept).toContainText(/Nothing ready/i);

    /* ticking the override alone is not enough — the shop must still name it and give it a SKU */
    await page.getByTestId('adopt-refused').first().getByTestId('adopt-override').check();
    await expect(accept, 'an override alone must not arm Accept').toBeDisabled();
  });

  await test.step('⭐⭐ naming it and giving it a SKU arms Accept — and counts only what is ready', async () => {
    const box = page.getByTestId('adopt-refused').first();
    await box.getByTestId('adopt-name').fill('Paracetamol 500');
    await box.getByTestId('adopt-sku').fill('MED-PAR-500');
    await box.getByTestId('adopt-price').fill('14');
    const accept = page.getByTestId('adopt-accept');
    await expect(accept).toBeEnabled({ timeout: 10000 });
    /* ⚠️ ONE, not two — the second line has been left alone and must not be swept in */
    await expect(accept).toContainText(/Add 1 /);
  });

  await test.step('⭐ the suggested SKU can be taken with a tap', async () => {
    const boxes = page.getByTestId('adopt-refused');
    const second = boxes.nth(1);
    await second.getByTestId('adopt-name').fill('Cotton roll');
    await second.getByTestId('adopt-override').check();
    const sug = second.getByTestId('adopt-usesku');
    if (await sug.count()) {
      await sug.click();
      const v = await second.getByTestId('adopt-sku').inputValue();
      expect(v, 'tapping the suggestion must fill the SKU box').toBeTruthy();
    }
  });

  await test.step('⭐⭐⭐ Accept adds them as the SHOP\'s own products', async () => {
    await page.getByTestId('adopt-accept').click();
    /* the panel closes and the catalogue now holds them under the shop's own words */
    await expect(page.getByTestId('adopt-accept'), 'the panel should close').toHaveCount(0, { timeout: 25000 });
    const items = await page.evaluate(async () => api('prodList'));
    const list = (items && (items.items || items.products || items)) || [];
    const got = list.find((x) => /Paracetamol 500$/.test(((x.item_data || x).name) || ''));
    expect(got, 'the adopted product is not in the catalogue').toBeTruthy();
    const d = got.item_data || got;
    expect(d.sku).toBe('MED-PAR-500');
    expect(d.batch, 'the vertical\'s attributes must travel').toBe('P-9001');
    expect(d.batch_tracked, 'a pharma product arrives already keeping stock per batch').toBe(true);
    /* ⚠️ somebody reading this in a year can see a PERSON decided it */
    expect(d.adopted_override, 'an override with no trace is indistinguishable from no gate').toBe('pharma');
  });

  await test.step('⚠️ re-opening the delivery no longer offers what was taken', async () => {
    await page.getByTestId('c2-adopt').click();
    await expect(page.getByTestId('adopt-accept')).toBeVisible({ timeout: 25000 });
    /**
     * ⚠️⚠️ MATCHED BY THE SUPPLIER'S WORDING, not by the shop's. The shop adopted 'Paracetamol 500mg strip'
     * AS 'Paracetamol 500' — two different strings — so a name-only match offered the same line again as new,
     * and accepting twice would leave two products for one thing. Adoption now writes the supplier's wording
     * as an ALIAS, which is what the counter already does when it matches a delivery line by hand.
     * ⚠️ ASSERTED ON THE PANEL'S OWN BOXES, not on page text — the page carries its own script
     * source and a loose match would pass on almost anything.
     */
    var offered = '';
    for (const id of ['adopt-offer', 'adopt-refused']) {
      const l = page.getByTestId(id); const n = await l.count();
      for (let i = 0; i < n; i++) offered += ' | ' + await l.nth(i).textContent();
    }
    /* ⭐ THE PROOF: the adopted line is gone even though the shop named it something else entirely. */
    expect(offered, 'the adopted line was offered again under the supplier wording: ' + offered.slice(0, 200))
      .not.toMatch(/Paracetamol/);
    /* and the line nobody adopted is still there, which is what makes the assertion above mean something */
    expect(offered, 'nothing at all was offered — the panel may simply be empty').toMatch(/Cotton roll/);
  });

  await medCtx.close();
});

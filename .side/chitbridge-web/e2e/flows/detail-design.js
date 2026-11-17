'use strict';
/* detail-design.js — ── THE DETAIL-PAGE CHOICE, AS A DRIVER ───────────────────────────────────────────────────────────────────────
 *
 * ⭐ EXTRACTED ON THE SECOND CALL SITE, not the third. `detail-design.spec.js` proved the choice for one entity;
 * `detail-design-parties.spec.js` proves it for two. Two copies of "set the preference" is how two specs end up
 * disagreeing about what setting it means — and this one is fiddly enough (its own rail, a write to wait on)
 * that a drifted copy would fail slowly and look like a product bug.
 *
 * ⚠️ A DRIVER, NOT A SPEC: it says HOW the choice is operated and read back. What that proves belongs to whoever
 * calls it.
 */
const { expect } = require('@playwright/test');
const { openAvatarItem, settle } = require('../fixtures');

/** Set the preference the way a person does: avatar → Settings → policy → the Detail page control. */
async function setDetailDesign(page, value) {
  await openAvatarItem(page, 'nav-settings');
  await page.waitForTimeout(2000);
  /* ⚠️ Settings has its own rail — the flags live under 'policy' and the screen opens on 'work'. */
  const sec = page.getByTestId('set-sec-policy');
  await expect(sec, 'the Settings screen has no policy section').toBeVisible({ timeout: 20000 });
  await sec.click();
  await page.waitForTimeout(2500);
  const sel = page.getByTestId('pol-detail_design');
  await expect(sel, 'the Detail page setting is not on the Settings screen').toBeVisible({ timeout: 20000 });
  await sel.selectOption(value);
  /* ⚠️ Wait for the WRITE — the card repaints from what the server returns, so the response is the truth. */
  await page.waitForResponse((r) => /\/entities\/policy/.test(r.url()) && r.request().method() === 'PATCH'
    && r.status() < 400, { timeout: 30000 });
  await settle(page);
}

/**
 * What THIS page's entity has stored on its own copy of the chit.
 *
 * ⭐⭐ PER-COPY BY CONSTRUCTION, which is the whole point once two parties are involved: `chit_header` is keyed
 * (chit_id, entity_id), so the same call from two signed-in pages reads two different rows. Asking each party's
 * own browser is therefore not a convenience — it is the only way to see a copy without breaking isolation.
 */
async function storedDesign(page, chitId) {
  return page.evaluate(async (id) => {
    try {
      const r = await api('chit', { params: { id } });
      const h = (r && r.header) || {};
      return ((h.summary_json || {}).detail_design) || null;
    } catch (e) { return 'ERROR ' + (e && e.message); }
  }, chitId);
}

/** Every chit_id this page sends, in order — the only reliable handle on a chit a spec created (the subject is
 *  not: composeChit types one a fresh entity's blueprint may not carry, so the chit is created auto-subjected). */
function watchSends(page) {
  const sent = [];
  page.on('response', async (r) => {
    if (!/\/chits\/send/.test(r.url()) || r.request().method() !== 'POST') return;
    try { const j = await r.json(); if (j && j.chit_id) sent.push({ id: j.chit_id, status: r.status() }); }
    catch (e) { /* a body we cannot read is reported by the caller's assertions */ }
  });
  return sent;
}

module.exports = { setDetailDesign, storedDesign, watchSends };

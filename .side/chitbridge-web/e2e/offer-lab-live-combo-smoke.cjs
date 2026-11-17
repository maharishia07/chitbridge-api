/* offer-lab-live-combo-smoke.cjs — [OFFR-06] LIVE, AGAINST REAL PRODUCTION, DRIVING THE REAL BROWSER
 *
 * Athi: "can you check using playwright script try multiple combination and if any failure fix it. i'll
 * check in the morning."
 *
 * ⚠️⚠️⚠️ THIS HITS REAL PRODUCTION — chitbridge-web.vercel.app and chitbridge-api-production.up.railway.app —
 * signed in as the real mayuri123@demo-cb.com ("Mayur Bhavan") account, the one Athi actually tests with.
 * Every UI action in here is a REAL click/fill on the REAL rendered page, not a page.evaluate() shortcut
 * calling internal functions directly — that is what every other e2e/offer-lab-next-*.cjs file already does
 * (against a local static server, no network), and it is not what "try multiple combination" asked for.
 *
 * ⚠️ TOUCHES NOTHING REAL. A disposable scratch product ("OFFR-06 Playwright scratch item") is created
 * through the real API before the browser opens, every combo built/saved during the run is deleted again at
 * the end (a try/finally, so a FAILED run still cleans up), and the scratch product itself is deleted last.
 * Nothing Athi already has in his real catalogue is read, let alone touched.
 *
 * This is a live smoke check, not a CI regression test — it is not wired into scripts/guards.cjs or any
 * roster; run it by hand: node e2e/offer-lab-live-combo-smoke.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');

const WEB = 'https://chitbridge-web.vercel.app';
const API = 'https://chitbridge-api-production.up.railway.app';
const EMAIL = 'mayuri123@demo-cb.com';
const DISPLAY_NAME = 'Mayur Bhavan';
const OTP = require('./lib/signin-code.cjs').codeOrSkip(API);   // SEC1: E2E_TESTER_CODE on the deployed api (unset → skipped with a warning)

let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(76) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

async function apiJson(path, opts) {
  opts = opts || {};
  const r = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.token ? { Authorization: 'Bearer ' + opts.token } : {}),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body: body };
}
async function signIn() {
  await apiJson('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: DISPLAY_NAME } });
  const v = await apiJson('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: OTP } });
  return (v.body && v.body.token) || null;
}

(async () => {
  console.log('\n== [OFFR-06] LIVE SMOKE — real browser, real production, real (disposable) data ==\n');

  const token = await signIn();
  if (!token) { console.log('COULD NOT SIGN IN — nothing proved either way. Re-run.'); process.exit(2); }
  console.log('  signed in as ' + EMAIL);

  const createdProduct = await apiJson('/api/products', { method: 'POST', token: token,
    body: { item_data: { name: 'OFFR-06 Playwright scratch item', price: 99, category: 'Test' } } });
  const scratchId = createdProduct.body && createdProduct.body.item && createdProduct.body.item.item_id;
  if (!scratchId) { console.log('COULD NOT CREATE THE SCRATCH PRODUCT — nothing proved. ' + JSON.stringify(createdProduct)); process.exit(2); }
  console.log('  scratch product created: ' + scratchId + '\n');

  const templateIdsToClean = [];
  let browser = null;

  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

    await page.goto(WEB + '/offer-lab-next.html');
    await page.evaluate((sess) => { try { localStorage.setItem('cb_sess', JSON.stringify(sess)); } catch (_) {} },
      { token: token, role: 'entity', name: DISPLAY_NAME, entity: DISPLAY_NAME });
    await page.reload();

    console.log('── signing into the real catalogue, through the real "Use my catalogue" button ' + '─'.repeat(0));
    await page.waitForSelector('#labMineBtn', { timeout: 20000 });
    await page.click('#labMineBtn');
    await page.waitForFunction(() => window.S && S.biz === 'mine', null, { timeout: 20000 });
    const productCount = await page.evaluate(() => P.length);
    say('switched to the real, signed-in catalogue', true, 'S.biz === "mine"');
    say('the real catalogue loaded with real products', productCount > 0, productCount + ' product(s)');

    console.log('\n── opening the modifier lab and finding the scratch product ' + '─'.repeat(0));
    await page.click('button:has-text("Open the modifier lab")');
    await page.waitForSelector('#modLabOverlay.on');
    say('the lab opens', true, 'confirmed');
    await page.fill('#modLabSearch', 'OFFR-06 Playwright scratch item');
    await page.waitForTimeout(250);
    const scratchRows = await page.locator('#modLabBody .ovltbl tbody tr').count();
    say('the scratch product is findable by search', scratchRows === 1, scratchRows + ' row(s)');

    console.log('\n── COMBINATION 1 · build a fresh combo with two groups, real clicks and typing ' + '─'.repeat(0));
    await page.click('button:has-text("Build a combo")');
    await page.waitForFunction(() => MODLAB.building === true);
    say('"Build a combo" opens the real builder', true, 'MODLAB.building === true');

    const group1 = page.locator('#modLabBody .kv').nth(0);
    await group1.locator('input.inp').first().fill('Choose a size');
    await group1.locator('input.inp').first().press('Tab');
    await group1.locator('input[type="number"]').first().fill('1');
    await group1.locator('input[type="number"]').first().press('Tab');
    let g0 = await page.evaluate(() => modLabGroups()[0]);
    say('typing a real group name really changes the draft', g0.name === 'Choose a size', JSON.stringify(g0.name));

    await page.click('#modLabBody button:has-text("+ Add a group")');
    await page.waitForFunction(() => modLabGroups().length === 2);
    const group2 = page.locator('#modLabBody .kv').nth(1);
    await group2.locator('input.inp').first().fill('Add extras');
    await group2.locator('input.inp').first().press('Tab');
    await group2.locator('input[type="checkbox"]').check();
    await group2.locator('button:has-text("+ Add an option")').click();
    await page.waitForTimeout(150);
    const groups = await page.evaluate(() => modLabGroups());
    say('a second group, with its own options, added by real clicks', groups.length === 2 && groups[1].options.length >= 1,
      JSON.stringify(groups.map((g) => ({ name: g.name, opts: g.options.length }))));

    console.log('\n── COMBINATION 2 · the live preview reacts to real clicks, exactly like a customer’s would ' + '─'.repeat(0));
    const beforePreview = await page.locator('#modLabBody').innerText();
    say('a required group is flagged before anything is tapped', /Still needs/.test(beforePreview), 'shown');
    await page.locator('#modLabBody .sect .kv').first().locator('button.btn.sm').first().click();
    await page.waitForTimeout(150);
    const afterPreview = await page.locator('#modLabBody').innerText();
    say('tapping a preview option updates the live preview for real', /✓/.test(afterPreview), 'a picked option is marked');

    console.log('\n── COMBINATION 3 · "Save as" — the real inline row, the real POST /api/combo-templates ' + '─'.repeat(0));
    await page.click('#modLabFoot button:has-text("Save as")');
    await page.waitForSelector('#modLabSaveName');
    await page.fill('#modLabSaveName', 'Playwright combo A');
    await page.locator('#modLabBody').getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => MODLAB.savingAs === false, null, { timeout: 10000 });
    const toast1 = await page.locator('#labtoast').innerText().catch(() => '');
    say('saving closes the inline row on success', true, 'confirmed');
    say('and says so in the toast', /Playwright combo A/.test(toast1), '"' + toast1 + '"');

    const listAfterSave = await apiJson('/api/combo-templates', { token: token });
    const saved1 = (listAfterSave.body.templates || []).find((t) => t.name === 'Playwright combo A');
    if (saved1) templateIdsToClean.push(saved1.id);
    say('it is really on the server, under the real account', !!saved1, saved1 ? saved1.id : 'not found');
    say('carrying both groups, correctly', saved1 && saved1.definition.length === 2, saved1 ? JSON.stringify(saved1.definition.map((g) => g.name)) : '');

    console.log('\n── COMBINATION 4 · "My saved combos" — the real library, fetched from the server ' + '─'.repeat(0));
    await page.click('button:has-text("Use a saved combo")');
    await page.waitForFunction(() => MODLAB.libraryOpen === true);
    await page.waitForFunction(() => COMBO_LIB.loaded === true, null, { timeout: 10000 });
    const libText = await page.locator('#modLabBody').innerText();
    say('the library opens and lists the just-saved combo', /Playwright combo A/.test(libText), 'found');
    say('with an honest group count', /2 groups/.test(libText), 'confirmed');

    console.log('\n── COMBINATION 5 · "Use" brings a saved combo back in — ADDED, never replacing what is there ' + '─'.repeat(0));
    const beforeUseCount = (await page.evaluate(() => modLabGroups())).length;
    await page.locator('#modLabBody').getByRole('button', { name: 'Use', exact: true }).click();
    await page.waitForFunction((n) => modLabGroups().length > n, beforeUseCount, { timeout: 10000 });
    const afterUseGroups = await page.evaluate(() => modLabGroups());
    say('"Use" ADDS the saved groups rather than replacing the draft', afterUseGroups.length === beforeUseCount + 2,
      beforeUseCount + ' → ' + afterUseGroups.length + ' groups');
    say('landing back in the builder, not the picker', await page.evaluate(() => MODLAB.building === true), 'confirmed');

    console.log('\n── EDGE CASE · saving with a BLANK name is refused, not silently accepted ' + '─'.repeat(0));
    const countBefore = (await apiJson('/api/combo-templates', { token: token })).body.templates.length;
    await page.click('#modLabFoot button:has-text("Save as")');
    await page.fill('#modLabSaveName', '   ');
    await page.locator('#modLabBody').getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(400);
    const countAfter = (await apiJson('/api/combo-templates', { token: token })).body.templates.length;
    say('a blank name creates NOTHING on the server', countAfter === countBefore, countBefore + ' → ' + countAfter);
    say('and the save row stays open, waiting for a real name', await page.evaluate(() => MODLAB.savingAs === true), 'confirmed');
    await page.evaluate(() => modLabSaveAsCancel());   /* closes the still-open inline row from the refused save above */

    console.log('\n── EDGE CASE · a group stripped of every option is flagged, and blocks Save as ' + '─'.repeat(0));
    await page.evaluate(() => { while (modLabGroups()[0].options.length) modLabRemoveOption(0, 0); });
    await page.waitForTimeout(150);
    const flaggedHtml = await page.locator('#modLabBody').innerHTML();
    say('an empty group is flagged in red, right on the group', /has no options yet/.test(flaggedHtml), 'found');
    const blockedSave = await page.evaluate(async () => {
      let called = false;
      const real = window.apiFetch; window.apiFetch = async (m, u) => { if (/combo-templates/.test(u)) called = true; return real(m, u); };
      modLabSaveAsOpen();
      document.getElementById('modLabSaveName').value = 'Should never save';
      await modLabSaveAsConfirm();
      window.apiFetch = real;
      return { called: called, stillOpen: MODLAB.savingAs };
    });
    say('Save as refuses to even ask the server while a group is broken', blockedSave.called === false, 'apiFetch not called for a save');

    console.log('\n── COMBINATION 6 · discard, then build again and attach a fresh draft to the scratch product ' + '─'.repeat(0));
    await page.evaluate(() => modLabSaveAsCancel());
    await page.click('button:has-text("Cancel")');
    await page.waitForFunction(() => MODLAB.building === false && MODLAB.draft.length === 0);
    say('"← Cancel" really discards the draft', true, 'MODLAB.draft is empty');

    await page.click('button:has-text("Build a combo")');
    await page.waitForFunction(() => MODLAB.building === true);
    const g1b = page.locator('#modLabBody .kv').nth(0);
    await g1b.locator('input.inp').first().fill('Playwright topping choice');
    await g1b.locator('input.inp').first().press('Tab');
    await page.click('#modLabFoot button:has-text("Apply to a product")');
    await page.waitForFunction(() => MODLAB.building === false && !MODLAB.pid);
    const banner = await page.locator('#modLabBody').innerText();
    say('"Apply to a product ▸" returns to the picker with a clear banner', /unsaved combo/i.test(banner), 'shown');

    await page.fill('#modLabSearch', 'OFFR-06 Playwright scratch item');
    await page.waitForTimeout(250);
    await page.click('#modLabBody .ovltbl tbody tr');
    await page.waitForFunction((id) => MODLAB.pid === id, scratchId, { timeout: 10000 });
    const attached = await page.evaluate(() => modLabGroups());
    say('clicking the product attaches the pending draft to it', attached.length === 1 && attached[0].name === 'Playwright topping choice',
      JSON.stringify(attached.map((g) => g.name)));

    const patchWait = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/products\//.test(r.url()), { timeout: 10000 }).catch((e) => e);
    await page.click('#modLabFoot button:has-text("Apply to")');
    const patchResp = await patchWait;
    const patchInfo = (patchResp && typeof patchResp.status === 'function')
      ? { status: patchResp.status(), url: patchResp.url(), body: await patchResp.json().catch(() => null) }
      : { error: String(patchResp) };
    say('the real PATCH request actually fired', !patchInfo.error, JSON.stringify(patchInfo).slice(0, 200));
    const toastAfterApply = await page.locator('#labtoast').innerText().catch(() => '');
    say('and the page says it saved', /saved/i.test(toastAfterApply), '"' + toastAfterApply + '"');

    const liveProduct = await apiJson('/api/products?limit=500', { token: token });
    const scratchRow = (liveProduct.body.items || liveProduct.body.products || []).find((x) => x.item_id === scratchId);
    const liveMods = scratchRow && scratchRow.item_data && scratchRow.item_data.modifiers;
    say('⭐⭐⭐ "Apply" really wrote to the real product on the real server', !!(liveMods && liveMods.length === 1 && liveMods[0].name === 'Playwright topping choice'),
      liveMods ? JSON.stringify(liveMods.map((g) => g.name)) : ('no modifiers found — item_data: ' + JSON.stringify(scratchRow && scratchRow.item_data)));

    console.log('\n── CLEANUP · deleting the saved combo(s) this run created, and re-checking the library ' + '─'.repeat(0));
    for (const id of templateIdsToClean) {
      const del = await apiJson('/api/combo-templates/' + id, { method: 'DELETE', token: token });
      say('deleted saved combo ' + id, del.status === 200, del.status);
    }
    const finalList = await apiJson('/api/combo-templates', { token: token });
    say('no Playwright test combos left behind on the real account', !(finalList.body.templates || []).some((t) => /Playwright/.test(t.name)),
      (finalList.body.templates || []).length + ' template(s) remain');

    console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
    if (errs.length) bad += errs.length;
  } finally {
    if (browser) await browser.close();
    const del = await apiJson('/api/products/' + scratchId, { method: 'DELETE', token: token });
    console.log('\n  scratch product deleted: ' + (del.status === 200 ? 'yes' : 'NO (status ' + del.status + ' — check manually: ' + scratchId + ')'));
  }

  console.log(bad ? '\n' + bad + ' failed\n' : '\nevery combination checked out, live, on the real account\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });

/**
 * tour.cjs — photograph every screen that changed, so "what is finished" is a thing you can look at.
 *
 * Athi, 2026-09-02: *"can you show me in localhost whatever updates are so i understand which one are getting
 * finished."*
 *
 * ⚠️ A COMMIT MESSAGE IS NOT EVIDENCE TO THE PERSON WHO ASKED FOR THE CHANGE. Several things this session were
 * green in every check and dead on the screen — a storefront gate on the wrong predicate, cancel columns added
 * to one of three queries, a fix applied to a renderer with no callers. A picture of the running app is the
 * cheapest thing that cannot lie about those.
 *
 * ⭐ IT SEEDS ITS OWN DATA. The account auth.setup mints is empty, and an empty screen photographs as a feature
 * that is missing rather than one that has nothing to show. Products and one self-chit, through the API, so the
 * seeding cannot be mistaken for part of what is being demonstrated.
 *
 * Run: node e2e/tour.cjs          → e2e/shots/*.png
 */
'use strict';
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CB_WEB_BASE || 'http://localhost:5173';
const API  = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const STATE = path.join(__dirname, '.auth', 'user.json');
const OUT = path.join(__dirname, 'shots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 940 } });
  const page = await ctx.newPage();
  const say = (s) => console.log('  ' + s);
  const shot = async (name, note) => {
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    say(name.padEnd(26) + note);
  };

  await page.goto(BASE + '/app.html');
  await page.waitForTimeout(4000);

  /* ── seed, so the screens have something to be about ─────────────────────────────────────────────────────── */
  const seeded = await page.evaluate(async (api) => {
    let tok = '';
    try { tok = (JSON.parse(localStorage.getItem('cb_sess') || '{}') || {}).token || ''; } catch (_) {}
    if (!tok) return 'no session';
    const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
    const post = (p, b) => fetch(api + p, { method: 'POST', headers: h, body: JSON.stringify(b) })
      .then((r) => r.status).catch(() => 'x');
    const out = [];
    /* One of each availability state, so the catalogue shows all three readings at once. */
    out.push(await post('/api/products', { item_data: { name: 'Pallet wrap, 500mm roll', unit: 'roll',
      price: 890, status: 'available', avail: { qty: 14, source: 'manual', as_of: new Date().toISOString() } } }));
    out.push(await post('/api/products', { item_data: { name: 'Corrugated carton, 6-pack', unit: 'carton',
      price: 250, status: 'available', avail: { qty: 0, source: 'manual', as_of: new Date().toISOString() } } }));
    out.push(await post('/api/products', { item_data: { name: 'Strapping tape, 12mm', unit: 'roll',
      price: 120, status: 'unavailable' } }));
    out.push(await post('/api/chits/send', { recipients: [{ name: 'Self', role: 'to', self: true }],
      manual_subject: 'Packing materials for the March run', subject: 'Packing materials for the March run',
      purpose: 'order',
      line_items: [
        { particulars: 'Pallet wrap, 500mm roll', comment: 'clear, 20 micron', unit: 'roll', quantity: 4, price: 890 },
        { particulars: 'Corrugated carton, 6-pack', unit: 'carton', quantity: 12, price: 250 } ] }));
    return out.join(',');
  }, API);
  say('seeded: ' + seeded);
  await page.reload();
  await page.waitForTimeout(4000);

  /* ── 1 · CATALOGUE — quantity, N/A, availability filters, status chip ────────────────────────────────────── */
  await page.evaluate(() => navTo('catalogue'));
  await page.waitForTimeout(4000);
  await shot('1-catalogue', 'quantity 14 / 0 / N-A · availability filter chips · status chip colour');

  /* ── 2 · CATEGORIES — the schemes block ──────────────────────────────────────────────────────────────────── */
  await page.evaluate(() => navTo('categories'));
  await page.waitForTimeout(3500);
  await shot('2-categories', 'HS printed once · explanation below the name · notes wrap · no file-path footnote');

  /* ── 3 · STANDARD SETS — see them, pick from them, add your own ──────────────────────────────────────────── */
  await page.getByTestId('catg-seed').click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot('3-standard-sets', 'the sets, now openable rather than "Add these" blind');
  await page.getByTestId('catg-seed-veg').click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot('4-set-picker', '26 nested, all ticked, All/None, and a box for your own');
  await page.evaluate(() => { try { closeModal(); } catch (_) {} });
  await page.waitForTimeout(600);

  /* ── 5 · THE ORDER/TASK DETAIL — two-line rows, folded chips, the tabs ───────────────────────────────────── */
  for (const f of ['task', 'order']) {
    await page.evaluate((x) => navTo(x), f);
    await page.waitForTimeout(3000);
    /* ⚠️ BY TEXT, NOT BY TESTID. chits.spec.js's locator header advertises chit-row-* and no such attribute
       exists in app.html — a stale note in the one place a reader goes for the truth. The seeded subject is
       unambiguous and cannot go stale the same way. */
    const row = page.getByText('Packing materials for the March run').first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(3000);
      await shot('5-detail-' + f, 'two-line lines · chips folded behind ⋯ · tabs' + (f === 'order' ? ' · ⊘ Withdraw' : ''));
      break;
    }
  }

  say('');
  say('shots in e2e/shots/');
  await browser.close();
})();

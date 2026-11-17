/**
 * seedpick-shot.cjs — can you see what is in a standard set, and take part of it?
 *
 * Athi, 2026-09-02: *"we are providing option to opt from standard set, but there is no way of knowing what they
 * are… say out of 26 they may be interested in 20 plus few more of their own."*
 *
 * ⚠️ THE CASCADE IS THE PART WORTH DRIVING. Unticking a parent has to take its children with it (a child whose
 * parent was never created is an orphan), and ticking a child has to bring its parent back (the standard nests
 * them). Both directions are easy to write and easy to get backwards, and neither shows up in a syntax check.
 *
 * ⭐ It never presses the final button: creating categories writes real rows on a real entity, and what is being
 * checked here is the SELECTION, which is entirely client-side.
 *
 * Run: node e2e/seedpick-shot.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = process.env.CB_WEB_BASE || 'http://localhost:5173';
const STATE = path.join(__dirname, '.auth', 'user.json');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const say = (s) => console.log('  ' + s);
  let bad = 0;

  await page.goto(BASE + '/app.html');
  await page.waitForTimeout(4000);
  await page.evaluate(() => navTo('categories'));
  await page.waitForTimeout(2500);

  await page.getByTestId('catg-seed').click();
  await page.waitForTimeout(1200);
  const setBtn = page.getByTestId('catg-seed-veg');
  say('set button reads: "' + (await setBtn.innerText()).trim() + '"');

  await setBtn.click();
  await page.waitForTimeout(1200);

  const shape = await page.evaluate(() => {
    const boxes = document.querySelectorAll('[data-seedgid]');
    return { rows: boxes.length, counter: (document.getElementById('cbcat_seed_n') || {}).textContent || '',
             go: (document.getElementById('cbcat_seed_go') || {}).textContent || '',
             own: !!document.getElementById('cbcat_seed_own') };
  });
  say('nodes listed : ' + shape.rows);
  say('counter      : ' + shape.counter);
  say('primary says : ' + shape.go);
  say('own-names box: ' + (shape.own ? 'present' : 'MISSING'));
  if (!shape.rows) { say('the list did not render'); await browser.close(); process.exit(1); }

  /* ── untick a PARENT: its children must go too ─────────────────────────────────────────────────────────── */
  const casc = await page.evaluate(() => {
    const set = CB_STARTER_CATEGORIES.veg;
    const parent = set.nodes.find((n) => !n.parent && set.nodes.some((k) => k.parent === n.gid));
    const kids = set.nodes.filter((n) => n.parent === parent.gid).map((n) => n.gid);
    cbcatSeedTick(parent.gid, false);
    const afterOff = { sel: Object.keys(CBCAT_SEED.sel).length,
                       kidsStillSelected: kids.filter((g) => CBCAT_SEED.sel[g]).length,
                       kidsStillChecked: kids.filter((g) => (document.querySelector('[data-seedgid="' + g + '"]') || {}).checked).length };
    /* ── now tick ONE child: its parent must come back ───────────────────────────────────────────────────── */
    cbcatSeedTick(kids[0], true);
    const afterOn = { parentBack: !!CBCAT_SEED.sel[parent.gid],
                      parentChecked: !!(document.querySelector('[data-seedgid="' + parent.gid + '"]') || {}).checked,
                      sel: Object.keys(CBCAT_SEED.sel).length };
    return { parent: parent.name, kids: kids.length, afterOff, afterOn,
             counter: (document.getElementById('cbcat_seed_n') || {}).textContent || '' };
  });

  say('parent "' + casc.parent + '" has ' + casc.kids + ' children');
  const offOk = casc.afterOff.kidsStillSelected === 0 && casc.afterOff.kidsStillChecked === 0;
  say((offOk ? '  + ' : '  x ') + 'unticking the parent took its children (' + casc.afterOff.kidsStillSelected
    + ' left in state, ' + casc.afterOff.kidsStillChecked + ' left ticked on screen)');
  if (!offOk) bad++;
  const onOk = casc.afterOn.parentBack && casc.afterOn.parentChecked;
  say((onOk ? '  + ' : '  x ') + 'ticking a child brought the parent back (state ' + casc.afterOn.parentBack
    + ', screen ' + casc.afterOn.parentChecked + ')');
  if (!onOk) bad++;
  say('counter now  : ' + casc.counter);

  /* None / All still work. */
  await page.getByTestId('catg-seed-none').click();
  await page.waitForTimeout(400);
  const none = await page.evaluate(() => ({ sel: Object.keys(CBCAT_SEED.sel).length,
    go: (document.getElementById('cbcat_seed_go') || {}).textContent || '' }));
  say('after None   : ' + none.sel + ' selected, primary says "' + none.go + '"');
  if (none.sel !== 0) bad++;

  await page.getByTestId('catg-seed-all').click();
  await page.waitForTimeout(400);
  const all = await page.evaluate(() => Object.keys(CBCAT_SEED.sel).length);
  say('after All    : ' + all + ' selected');
  if (all !== shape.rows) bad++;

  await page.screenshot({ path: path.join(__dirname, 'seedpick.png') });
  say('shot: e2e/seedpick.png');
  await browser.close();
  process.exit(bad ? 1 : 0);
})();

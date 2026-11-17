/**
 * register-shots.cjs — drive the Register through its outcome loop and photograph each view.
 *
 * ⭐ THE POINT IS THE THIRD SHOT. Live and Impact show what the capability looks like; CLOSURE shows what it
 * PRODUCES, which is the only reason to keep a register at all.
 *
 * ⚠️ MINTS ITS OWN ENTITY. Never point this at a real account — it writes a register and an entry.
 *
 *   CB_WEB_BASE=http://localhost:5173 CB_API_BASE=https://… node register-shots.cjs
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const { mintEntity } = require('./fixtures');

const OUT = path.join(__dirname, 'register-shots');
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  /* ⚠️ baseURL is a CONTEXT option — this script builds its own context, so it does not inherit the one in
     playwright.config.js and page.goto('/app.html') has nothing to resolve against. */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 },
    baseURL: process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app' });
  const page = await ctx.newPage();
  /* ⚠️ THE PANEL, NOT THE PAGE. A full-viewport shot is 90% app chrome around a 300px pane — the thing being
     shown ends up a tenth of the picture and unreadable wherever it is pasted. */
  const shot = async (name) => {
    await page.waitForTimeout(600);
    const el = page.locator('[data-testid="register-panel"]');
    if (await el.count()) await el.screenshot({ path: path.join(OUT, name + '.png') });
    else await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  ✓ ' + name + '.png');
  };

  try {
    await mintEntity(page);
    await page.evaluate(() => navTo('raida'));
    await page.getByTestId('register-panel').waitFor({ state: 'visible', timeout: 20000 });

    /**
     * ⭐⭐ A SECOND REGISTER, SO THE DEPENDENCY HAS SOMEWHERE TO POINT. An edge is what makes the Impact view
     * exist at all; before the target fields were added, every dependency stayed a sentence and the graph could
     * not be populated through the product no matter what anyone typed.
     */
    const newRegister = async (type, name) => {
      await page.getByTestId('register-new').click();
      await page.getByTestId('register-new-type').selectOption(type);
      await page.getByTestId('register-new-name').fill(name);
      await page.getByTestId('register-new-save').click();
      await page.getByTestId('register-subject').filter({ hasText: name.split(' ')[0] })
        .waitFor({ state: 'visible', timeout: 20000 });
    };
    await newRegister('release', 'Pad refurbishment');
    await newRegister('campaign', 'Engine E-7 qualification');

    /* Three entries, rated differently, so Live has something to sort worst-first. */
    const add = async (kind, body, l, s, owner, waitsOn, response) => {
      await page.getByTestId('raida-add-open').click();
      await page.getByTestId('raida-kind').selectOption(kind);
      await page.getByTestId('raida-body').fill(body);
      if (owner) await page.locator('#rgOwner').fill(owner);
      if (l) await page.locator('#rgL').fill(String(l));
      if (s) await page.locator('#rgS').fill(String(s));
      /* ⭐ The target is what turns a dependency into an EDGE the walk can traverse. */
      /* ⭐ The 4 T's (b192) — what the decision IS, beside the treatment that says what we are doing. */
      if (response) await page.getByTestId('raida-response').selectOption(response);
      if (waitsOn) {
        await page.locator('#rgTo').selectOption({ label: waitsOn });
        await page.locator('#rgNeed').fill('2026-09-15');
      }
      await page.getByTestId('raida-save').click();
      await page.getByTestId('raida-item').filter({ hasText: body.slice(0, 18) })
        .waitFor({ state: 'visible', timeout: 20000 });
    };
    await add('risk', 'Rig availability may slip past week 3', 3, 4, 'Rao', null, 'treat');
    await add('issue', 'Igniter delay measured 40ms over spec', 4, 4, 'Priya');
    await add('assumption', 'Fuel batch B12 matches the qualification lot', 2, 3, 'Rao');
    await add('dependency', 'Cannot start hot-fire until the pad is signed off', 3, 5, 'Rao',
              'Pad refurbishment');

    await shot('1-live');

    await page.getByTestId('register-tab-impact').click();
    await page.waitForTimeout(1500);
    await shot('2-impact');

    await page.getByTestId('register-tab-closure').click();
    await shot('3-closure-gate');

    /* End each one differently, so the closure statement shows all three groups at once. */
    /**
     * ⚠️⚠️ WAITS FOR THE ROW TO ACTUALLY LEAVE THE OPEN BAND. The first version fired three closes, slept, and
     * photographed the result — and only ONE had landed. It reported success, because nothing checked. A driver
     * that does not verify its own write photographs whatever happened to be there.
     */
    const end = async (text, disposition, note) => {
      await page.getByTestId('register-tab-live').click();
      const row = page.getByTestId('raida-item').filter({ hasText: text });
      await row.getByTestId('raida-close').click();
      await page.getByTestId('raida-disposition').selectOption(disposition);
      if (disposition === 'carried_forward') {
        await page.getByTestId('raida-carry').selectOption({ label: 'Pad refurbishment' });
      }
      await page.getByTestId('raida-close-note').fill(note);
      await page.getByTestId('raida-close-save').click();
      /* It has ended when its row no longer offers an ending. */
      await row.getByTestId('raida-close').waitFor({ state: 'detached', timeout: 20000 })
        .catch(() => { throw new Error('close did not take for "' + text + '" as ' + disposition); });
    };
    await end('Rig availability', 'action', 'Booked the rig for week 2');
    await end('Igniter delay', 'accepted', 'Within the derated envelope; signed off by test authority');
    await end('Fuel batch', 'resolved', 'Lot certificate checked against the qualification lot');
    await end('Cannot start hot-fire', 'carried_forward', 'Moves to the pad register');

    await page.getByTestId('register-tab-closure').click();
    await shot('4-closure-outcome');


    console.log('\nShots in ' + OUT);
  } catch (e) {
    console.error('FAILED: ' + e.message);
    await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

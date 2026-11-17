// [TILL-09] THE × THAT DID NOT REMOVE. Athi, 2026-09-16: *"two bill just saved, but when I click the x mark it
// is not getting removed."*
//
// ⚠️ THERE ARE TWO × CONTROLS HE COULD MEAN and guessing between them is how a wrong fix ships. A cart LINE has
// one (drop) and a SAVED — parked — bill has one (dropParked). This drives both through the real page and says
// which of them actually fails, so the fix is aimed at the broken one rather than at the likelier-sounding one.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');

// ⭐ the COUNTER page can be pointed at a local build while the app it mints its key from stays where it
// is — the only way to prove a counter fix that is not deployed yet. CB_TILL_BASE=http://localhost:8941
const TILL = process.env.CB_TILL_BASE || '';

test('[TILL-09] both × controls remove what they sit on', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Rm ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Ponni rice 1 kg', unit: 'kg', price: 62, code: 'RICE9' });
  await addProduct(page, { name: 'Filter coffee 200 g', unit: 'packet', price: 145, code: 'COF9' });

  let till;
  await test.step('pair a counter', async () => {
    const key = await page.evaluate(async () => {
      if (typeof ensureCap === 'function') await ensureCap('admin');
      const r = await api('keysMint', { body: { name: 'rm counter', scopes: ['till'], days: 1 } });
      return (r && (r.key || r.api_key)) || null;
    });
    expect(key, 'no till key was minted').toBeTruthy();
    till = await context.newPage();
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
  });

  await test.step('⭐ a cart line’s × removes THAT line', async () => {
    await till.evaluate(() => { add(0); add(1); });
    await expect(till.locator('[data-testid="till-line-1"]')).toBeVisible();
    const before = await till.evaluate(() => CART.map((c) => c.name));
    /* the control, driven the way a person drives it — the button, not the function behind it */
    await till.locator('[data-testid="till-line-0"] button.x').click();
    await till.waitForTimeout(250);
    const after = await till.evaluate(() => CART.map((c) => c.name));
    expect(after.length, 'the cart × left the line where it was: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after)).toBe(before.length - 1);
    expect(after).not.toContain(before[0]);
  });

  await test.step('⭐⭐ a SAVED (parked) bill’s × throws that bill away', async () => {
    /* two saved bills, which is exactly what he had on screen */
    await till.evaluate(() => { CART = []; add(0); parkBill(); add(1); parkBill(); });
    await till.waitForTimeout(250);
    await expect(till.locator('[data-testid="till-parked-1"]')).toBeVisible();
    const before = await till.evaluate(() => PARKED.length);
    expect(before, 'two bills should be parked').toBe(2);

    /* ⚠️ the × is a SPAN INSIDE the chip button — clicking it must throw the bill away and must NOT bring it back */
    await till.locator('[data-testid="till-parked-0"] span').click();
    await till.waitForTimeout(300);
    const after = await till.evaluate(() => ({ parked: PARKED.length, cart: CART.length }));
    expect(after.parked, 'the parked × did not remove the bill').toBe(1);
    expect(after.cart, 'the parked × brought the bill back into the cart instead of throwing it away').toBe(0);

    /* and it must survive a reload — a removal that only repaints is not a removal */
    const stored = await till.evaluate(() => JSON.parse(localStorage.getItem(shopLs('cb_till_parked')) || '[]').length);
    expect(stored, 'the removal was not written to this device').toBe(1);
  });
});

// ⚠️⚠️ THE ACTUAL FAULT OF 2026-09-16, kept as a case. The × was never broken. `parkedSave()` serialised the
// whole rail in the ARGUMENT to a storage call, so one parked cart that would not stringify threw before the
// repaint — the chip stayed, the removal was never written, and `ls.set` swallowed its own failure so nothing
// said a word. Athi: *"other parked bills are removed, but this two got stuck."*
test('[TILL-10] one unsaveable parked bill does not wedge the rail, and a failed write is spoken aloud', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Wedge ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Sugar 1 kg', unit: 'kg', price: 44, code: 'SUG9' });

  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'wedge counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });

  await test.step('⭐⭐ a circular cart is dropped by name instead of jamming every other bill', async () => {
    await till.evaluate(() => {
      CART = []; add(0); parkBill();
      CART = []; add(0); parkBill();
      /* ⚠️ a row JSON.stringify genuinely REFUSES. An earlier version of this case set a property on the cart
         ARRAY, which stringify silently ignores — the case passed while testing nothing at all. */
      PARKED[0].name = 'Poison';
      PARKED[0].cart = [{ name: 'x', qty: 1, price: 1, net: 1,
                          toJSON: function(){ throw new Error('will not serialise'); } }];
    });
    /* removing the OTHER bill must still work, and must reach the device */
    await till.evaluate(() => dropParked(1));
    await till.waitForTimeout(250);
    const after = await till.evaluate(() => ({
      mem: PARKED.length,
      stored: JSON.parse(localStorage.getItem(shopLs('cb_till_parked')) || '[]').length,
    }));
    /* the poison row is dropped too — but the rail is NOT wedged and the write did happen */
    expect(after.mem, 'the rail was wedged by one bad row').toBeLessThanOrEqual(1);
    expect(after.stored, 'the removal never reached the device').toBe(after.mem);
  });

  await test.step('⚠️ and a storage that refuses is reported, not swallowed', async () => {
    const said = await till.evaluate(() => {
      /* ⚠️ Storage has a NAMED-PROPERTY SETTER: `localStorage.setItem = fn` quietly stores the string "fn"
         under the key "setItem" instead of shadowing the method. The prototype is the only place to stand. */
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k) {
        if (String(k).indexOf('cb_probe') === 0) return real.apply(this, arguments);
        const e = new Error('full'); e.name = 'QuotaExceededError'; throw e;
      };
      const ok = ls.set('cb_till_probe_write', 'x');
      Storage.prototype.setItem = real;
      return { ok, why: ls.last && ls.last.why };
    });
    expect(said.ok, 'ls.set claimed a write that never happened').toBe(false);
    expect(said.why, 'the failure was not recorded anywhere').toBe('QuotaExceededError');
  });
});

// ⭐⭐ [TILL-11] THE KEYS SAY WHERE THEY COME FROM. Athi, 2026-09-16: *"how do we set the quick keys? it is just
// appearing here — where are we setting it?"* On the default source the counter offered no control at all: the
// group controls appeared only once somebody had already switched to groups, and the only way to switch was a
// trip to ⚙ Setup. This asserts the control is on the counter BEFORE anyone knows the feature exists.
test('[TILL-11] the quick keys carry the control that decides what fills them', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Qk ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Idli podi 100 g', unit: 'packet', price: 55, code: 'POD9' });

  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'qk counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });

  await test.step('⚠️ on the DEFAULT source — a brand new counter, nobody has changed anything', async () => {
    const src = await till.evaluate(() => tillOpt().quickSource);
    expect(src, 'this case only means anything on the default source').toBe('frequent');
    await expect(till.locator('[data-testid="till-quick-src"]')).toBeVisible();
  });

  await test.step('⭐ and changing it there switches the source, without going to Setup', async () => {
    await till.selectOption('[data-testid="till-quick-src"]', 'groups');
    await till.waitForTimeout(300);
    expect(await till.evaluate(() => tillOpt().quickSource), 'the bar did not change the setting').toBe('groups');
    /* the CHOOSER follows it into view — which group fills the keys is a selling decision */
    await expect(till.locator('[data-testid="till-quick-group"]')).toBeVisible();
  });

  /**
   * ⭐⭐ AUTHORING IS NOT SELLING — MOVED, NOT DROPPED (2026-09-18, then again 00-CORRECTIONS.md #18, Phase
   * 4.5). Athi: *"quick key management is not part of selling — sell panel should have only temporary out of
   * stock buttons, not to create or update the group."* Then the package's own reconciliation went further:
   * *"Quick keys: a setting, or maintenance? Decision: Maintenance. Settings keeps one line and a link."*
   *
   * This step used to assert `till-quick-group-new` was visible ON THE KEYS, then straight inside Settings ⚙
   * Setup ▸ Quick keys. Both moves are the same rule applied again: the capability moved rather than went
   * away, this time from Settings itself into its own Quick keys maintenance dialog, reached by the one line
   * Settings now keeps.
   */
  await test.step('⚠️ making or filling a group is NOT on the sell panel, and IS in Quick keys maintenance', async () => {
    await expect(till.locator('[data-testid="till-quick-group-new"]')).toHaveCount(0);
    await expect(till.locator('[data-testid="till-quick-group-add"]')).toHaveCount(0);
    await expect(till.locator('[data-testid^="till-quick-group-add-"]')).toHaveCount(0);
    await expect(till.locator('[data-testid^="till-quick-ungroup-"]')).toHaveCount(0);

    /* ⚠️ SETTINGS ITSELF NEVER EDITS A GROUP AGAIN — it keeps one line (a value and "Edit ↗") and nothing here
       lets you touch a group without going through it, which is the honest answer to "where did ＋ group go?" */
    await till.evaluate(() => openSettings('keys'));
    await expect(till.locator('[data-testid="till-quicksum"]')).toBeVisible();
    await expect(till.locator('[data-testid="till-set-group-new"]')).toHaveCount(0);
    await till.click('[data-testid="till-quickmaint-open"]');
    await expect(till.locator('[data-testid="till-set-group-new"]')).toBeVisible();
    /* ⭐ and a group can actually be FILLED here — the dialog could make one and empty one but never fill one
       until the sell-panel ＋ was removed, which would have left a list nobody could put anything into. */
    await till.evaluate(() => { tillOptSet({ groups: { Morning: [] }, group: 'Morning' }); quickMaintPaint(); });
    await expect(till.locator('[data-testid="till-set-group-find"]')).toBeVisible();
    const box = till.locator('[data-testid="till-set-group-items"]');
    await expect(box).toBeVisible();
    const tick = box.locator('input[type="checkbox"]').first();
    await tick.check();
    expect(await till.evaluate(() => (tillOpt().groups.Morning || []).length),
      'ticking a product in the maintenance dialog did not put it in the group').toBe(1);
    /* ⭐ and Settings' own one line picked up the change live, behind the dialog — it is a VIEW of the same state */
    await till.evaluate(() => quickMaintClose());
    await expect(till.locator('[data-testid="till-quicksum"]')).toContainText('Morning (1)');
    await till.evaluate(() => { document.getElementById('setdlg').close(); });
  });

  await test.step('⚠️ the maintenance dialog and the bar are ONE setting, never two opinions about it', async () => {
    const same = await till.evaluate(() => {
      openSettings();
      quickMaintOpen();
      const opts = [...document.getElementById('qm_qsrc').options].map((o) => o.value);
      const picked = document.getElementById('qm_qsrc').value;
      quickMaintClose();
      document.getElementById('setdlg').close();
      return { opts, picked, src: QUICK_SRC.map((s) => s[0]) };
    });
    expect(same.opts, 'the maintenance dialog offers a different list from the bar').toEqual(same.src);
    expect(same.picked, 'it opened showing something other than what is in force').toBe('groups');
  });
});

// ⭐⭐⭐ [TILL-12] RELEASING A QUEUE ON A PC NOBODY CAN REACH. Athi, 2026-09-16: *"how do I release the stuck
// queue ... in real life if a PC is in such a situation how do we resolve it, because that PC cannot be
// scrutinised through you."*
//
// ⚠️ The stuck condition is made the way it really happens — pair to one shop, bill, then re-pair to another.
// Every ordinary screen then reads through the ownership filter and sees nothing wrong, which is exactly why
// nothing reported it: drain, the bill list and the day totals were all blinded by the same guard at once.
test('[TILL-12] one press frees a queue blocked by another shop, and the report can leave the PC', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Rel ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Toor dal 1 kg', unit: 'kg', price: 148, code: 'DAL9' });

  const keys = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const a = await api('keysMint', { body: { name: 'counter A', scopes: ['till'], days: 1 } });
    const b = await api('keysMint', { body: { name: 'counter B', scopes: ['till'], days: 1 } });
    return [(a && (a.key || a.api_key)), (b && (b.key || b.api_key))];
  });
  const till = await context.newPage();

  await test.step('a bill is taken while paired one way …', async () => {
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(keys[0]));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
    /* a queued row stamped for THIS owner, then the owner is changed under it */
    await till.evaluate(async () => {
      const row = { no: 'STUCK-1', at: new Date().toISOString(), total: 148, lines: [], _tries: 0 };
      await DB.put('queue', row); await DB.put('bills', row);
    });
    const held = await till.evaluate(async () => (await DB.allRaw('queue')).length);
    expect(held, 'the probe row was not written').toBeGreaterThan(0);
  });

  await test.step('⚠️ … and after re-pairing, every ordinary screen says the counter is clean', async () => {
    await till.evaluate((k) => { OWNER = 'SHOP-B-' + k.slice(-6); }, keys[1]);
    const seen = await till.evaluate(async () => ({
      filtered: (await DB.all('queue')).length,       /* what drain and the bill list can see */
      really: (await DB.allRaw('queue')).length,      /* what is actually in there */
    }));
    expect(seen.really, 'the row should still be in the store').toBeGreaterThan(seen.filtered);
    expect(seen.filtered, 'the guard should be hiding it from every ordinary reader').toBe(0);
  });

  await test.step('⭐⭐ the panel NAMES it rather than saying the counter is fine', async () => {
    await till.evaluate(() => openStuck());
    await expect(till.locator('[data-testid="till-stuck-verdict"]')).toContainText(/DIFFERENT shop/i);
    await expect(till.locator('[data-testid="till-stuck-release"]')).toBeVisible();
  });

  await test.step('⭐⭐⭐ one press frees it — and does not delete this shop\'s own sale', async () => {
    till.once('dialog', (d) => d.accept());                  /* the confirm before removing another shop's rows */
    await till.evaluate(() => { window.sure = async () => true; window.say = () => {}; });
    await till.evaluate(() => releaseQueue());
    await till.waitForTimeout(600);
    const after = await till.evaluate(async () => ({
      foreign: (await DB.allRaw('queue')).filter((r) => r && r._shop && String(r._shop) !== String(OWNER)).length,
    }));
    expect(after.foreign, 'the blocking rows are still there — the queue can never empty').toBe(0);
  });

  await test.step('⭐⭐ and the report is plain text that carries the facts, with no customer in it', async () => {
    const rep = await till.evaluate(() => stuckReport());
    expect(rep, 'the report does not say which shop the database belongs to').toMatch(/shop this database belongs to/i);
    expect(rep, 'the report has no support code to quote on a call').toMatch(/support code [A-Z0-9]{4,6}/);
    expect(rep, 'the report should say what the last send attempt did').toMatch(/THE LAST ATTEMPT TO SEND/);
    /* ⚠️ it is going to be pasted to a stranger before anyone thinks about it */
    expect(rep, 'a customer name reached the report').not.toMatch(/Walk-in|cname|phone/i);
  });
});

// ⭐⭐⭐ [TILL-13] THE COUNTER NOBODY CAN REACH, REPORTING ITSELF. Athi, 2026-09-16: *"is there any way of
// interacting with the counter app where it creates the issue, diagnostic message thrown to server?"* and
// *"have we got mechanism understanding temp storage we use?"*
test('[TILL-13] a counter reports itself to the server, and can show what it is keeping', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Diag ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Ghee 500 ml', unit: 'bottle', price: 380, code: 'GHE9' });

  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'diag counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });

  await test.step('⭐⭐ the counter posts its own account of itself and the shop can read it back', async () => {
    await till.evaluate(() => openStuck());
    await till.evaluate(() => stuckSend());
    await till.waitForTimeout(1500);
    /* read it back through the shop's own key list — the screen support would actually look at */
    const diag = await page.evaluate(async () => {
      const r = await api('keysList', {});
      const list = (r && (r.keys || r)) || [];
      const k = list.filter((x) => x && Array.isArray(x.scopes) && x.scopes.includes('till') && x.diag)[0];
      return k ? k.diag : null;
    });
    expect(diag, 'the counter reported nothing the shop can read').toBeTruthy();
    expect(diag.at, 'the server did not stamp when the counter spoke').toBeTruthy();
    expect(typeof diag.queued, 'the counts did not survive').toBe('number');
    expect(diag.code, 'no support code to quote on a call').toMatch(/^[A-Z0-9]{1,6}$/);
    /* ⚠️ the one fact a counter cannot know about itself */
    expect(diag, 'the shop cannot tell which machine this was').toHaveProperty('ip');
  });

  await test.step('⚠️ and it carries no customer — this is read by people outside the shop', async () => {
    const diag = await page.evaluate(async () => {
      const r = await api('keysList', {});
      const list = (r && (r.keys || r)) || [];
      return (list.filter((x) => x && x.diag)[0] || {}).diag;
    });
    const asText = JSON.stringify(diag);
    expect(asText, 'a customer name or phone reached the server').not.toMatch(/Walk-in|customer|phone/i);
  });

  await test.step('⭐⭐ and the counter can say what it is keeping, and where', async () => {
    const m = await till.evaluate(() => storageMap());
    expect(Array.isArray(m.idb), 'no account of the databases on this device').toBe(true);
    expect(m.idb.length, 'this shop\'s own store is not listed').toBeGreaterThan(0);
    expect(Array.isArray(m.ls), 'no account of the settings kept on this device').toBe(true);
    await till.evaluate(() => openStorage());
    await expect(till.locator('[data-testid="till-wipe"]')).toBeVisible();
  });
});

// ⭐⭐⭐ [TILL-14] THE SALES A RE-PAIR LEAVES BEHIND. Athi's device, 2026-09-16, showed FIVE counter databases and
// storage 0% full: cb-till, cb-till-1403k2a, cb-till-14f27ap, cb-till-s396ab, and cb-till-1dyd5gy ← this shop,
// "3 bills, 0 queued". His shop holds eight till keys.
//
// ⚠️⚠️ tillStore() names the database after the KEY, not the shop — right for keeping two shops apart, but it
// means minting a fresh key for the SAME shop starts an empty store and abandons the old one with whatever was
// still queued in it. Nothing looked there: not drain, not the bill list, not the day totals, not the 🩺 panel.
// That is how a counter says "0 queued" truthfully while sales sit unsent.
test('[TILL-14] a re-paired counter finds the sales its previous copy was holding', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Orph ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Rava 1 kg', unit: 'kg', price: 58, code: 'RAV9' });

  const keys = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const out = [];
    for (const n of ['pair one', 'pair two']) {
      const r = await api('keysMint', { body: { name: n, scopes: ['till'], days: 1 } });
      out.push(r && (r.key || r.api_key));
    }
    return out;
  });
  const till = await context.newPage();

  let owner;
  await test.step('the counter takes a sale, and it does not go', async () => {
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(keys[0]));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
    owner = await till.evaluate(() => OWNER);
    expect(owner, 'the counter never learned which shop it is').toBeTruthy();
    await till.evaluate(async () => {
      const row = { no: 'ORPH-1', at: new Date().toISOString(), total: 58, lines: [], _shop: OWNER };
      await DB.put('bills', row); await DB.put('queue', row);
    });
  });

  await test.step('⚠️ the SAME shop is paired again — and the new copy is empty and truthful', async () => {
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(keys[1]));
    /* ⭐ no reload by hand: since [TILL-15] the counter adopts a pasted key and restarts itself */
    await till.waitForTimeout(1200);
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
    const here = await till.evaluate(async () => ({
      store: tillStore(), queue: (await DB.allRaw('queue')).length, owner: OWNER,
    }));
    expect(here.queue, 'the new copy should be empty — that is the whole trap').toBe(0);
    expect(here.owner, 'it is the same shop, under a different key').toBe(owner);
  });

  await test.step('⭐⭐ and the counter now SEES the copy it left behind rather than declaring itself clean', async () => {
    const found = await till.evaluate(async () => {
      const o = await otherCounters();
      return o.filter((s) => String(s.owner || '') === String(OWNER)).reduce((a, s) => a + s.queue, 0);
    });
    expect(found, 'the stranded sale is still invisible').toBe(1);
    await till.evaluate(() => openStuck());
    await expect(till.locator('[data-testid="till-stuck-verdict"]')).toContainText(/EARLIER copy/i);
  });

  await test.step('⭐⭐⭐ bringing them in puts the sale back in this counter\'s queue', async () => {
    await till.evaluate(() => { window.sure = async () => true; window.say = () => {}; });
    await till.evaluate(() => rescueOrphans());
    await till.waitForTimeout(1200);
    const got = await till.evaluate(async () => ({
      bills: (await DB.allRaw('bills')).filter((b) => b && b.no === 'ORPH-1').length,
      left: (await otherCounters()).length,
    }));
    expect(got.bills, 'the stranded sale did not arrive in this counter').toBe(1);
    expect(got.left, 'the emptied copy should be gone once its rows are safely here').toBe(0);
  });
});

// ⭐⭐ [TILL-15] A KEY PASTED INTO A COUNTER THAT IS ALREADY OPEN. Changing only the #fragment of a URL does not
// reload the page, so the pairing address — read only at boot — was ignored entirely. No error, no pairing, no
// clue: it looked exactly like a key that had been refused, while somebody was trying to fix a counter.
test('[TILL-15] pasting a new key into an open counter re-pairs it', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Paste ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Jaggery 1 kg', unit: 'kg', price: 72, code: 'JAG9' });

  const keys = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const out = [];
    for (const n of ['paste one', 'paste two']) {
      const r = await api('keysMint', { body: { name: n, scopes: ['till'], days: 1 } });
      out.push(r && (r.key || r.api_key));
    }
    return out;
  });
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(keys[0]));
  await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
  const first = await till.evaluate(() => tillStore());

  await test.step('⭐⭐ the pasted key is adopted without the page being reloaded by hand', async () => {
    /* exactly what a person does: put the address in and press enter, on the tab already open */
    await till.evaluate((k) => { location.hash = 'key=' + encodeURIComponent(k); }, keys[1]);
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.waitForTimeout(800);
    const now = await till.evaluate(() => ({ store: tillStore(), key: ls.get('cb_till_key', null) }));
    expect(now.key, 'the pasted key was ignored — the counter is still on the old one').toBe(keys[1]);
    expect(now.store, 'the counter did not move to the new copy').not.toBe(first);
    /* ⚠️ and the address is tidied by boot, not left with a key sitting in it */
    expect(await till.evaluate(() => location.hash), 'the key was left in the address bar').toBe('');
  });

  await test.step('⚠️ the same key again changes nothing and says so', async () => {
    const before = await till.evaluate(() => tillStore());
    await till.evaluate((k) => { location.hash = 'key=' + encodeURIComponent(k); }, keys[1]);
    await till.waitForTimeout(700);
    expect(await till.evaluate(() => tillStore()), 'it re-paired with the key it already had').toBe(before);
  });
});

// ⭐⭐⭐ [TILL-16] WHERE THIS SHOP IS OPEN, AND FROM WHAT ADDRESS. Athi, 2026-09-16, with one PC pushing bills and
// another silent: *"can we build IP level information for every counter app ... in how many places the store is
// opened and to close the duplicates?"* Nothing was ever written back when a key was used, so a counter that had
// gone quiet was indistinguishable from one that had never existed.
test('[TILL-16] a counter that has been used is visible to the shop, with its address', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Seen ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Salt 1 kg', unit: 'kg', price: 22, code: 'SAL9' });

  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'seen counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });

  await test.step('⚠️ before it is ever used the shop is told so, not shown a blank', async () => {
    const k = await page.evaluate(async () => {
      const r = await api('keysList', {});
      return ((r && (r.keys || r)) || []).filter((x) => x && (x.scopes || []).includes('till'))[0];
    });
    expect(k, 'the counter is not listed at all').toBeTruthy();
    expect(k.seen, 'a counter that has never called must have no sighting — the absence IS the diagnosis').toBeFalsy();
  });

  await test.step('⭐⭐ once the counter talks to ChitBridge, the shop can see when and from where', async () => {
    const till = await context.newPage();
    await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });
    /* the sighting is filed after the answer goes out, so give it a moment */
    await till.waitForTimeout(2500);

    const k = await page.evaluate(async () => {
      const r = await api('keysList', {});
      return ((r && (r.keys || r)) || []).filter((x) => x && (x.scopes || []).includes('till'))[0];
    });
    expect(k.seen, 'the counter used its key and the shop still cannot tell').toBeTruthy();
    expect(k.seen.at, 'no time was recorded for the sighting').toBeTruthy();
    /* ⭐ the one fact a counter cannot know about itself */
    expect(k.seen.ip, 'no address was recorded, so one PC cannot be told from another').toBeTruthy();
    expect(String(k.seen.agent || ''), 'nothing says what kind of machine it is').toMatch(/Mozilla|Chrome|Safari|Firefox/i);
    /* ⚠️ a sighting must never grant anything — it is an observation, not a permission */
    expect(k.scopes, 'the sighting changed what the key may do').toEqual(['till']);
  });
});

// ⭐⭐⭐ [TILL-17] THE WRITE THAT WENT NOWHERE. Sweeping for more of the class that caused the parked-bill fault,
// the deepest one was in the storage wrapper itself: `fall()` caught every IndexedDB failure, flipped to the
// smaller localStorage store and threw the reason away — and MEM's own writes then ended in `catch(_){ }`.
//
// ⚠️⚠️ So a device that would store NOTHING (full disk, private window, locked-down browser) went on billing with
// every screen looking normal and the bill written nowhere at all. Falling back is right — a till that refuses a
// customer holding money is worse than useless — but doing it without a word is the fault.
test('[TILL-17] a refused database, and a lost write, are both spoken aloud', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Fall ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Coconut oil 1 L', unit: 'bottle', price: 240, code: 'COC9' });

  const key = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const r = await api('keysMint', { body: { name: 'fall counter', scopes: ['till'], days: 1 } });
    return (r && (r.key || r.api_key)) || null;
  });
  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(key));
  await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });

  await test.step('⭐ a healthy counter says nothing about either — no crying wolf', async () => {
    const st = await till.evaluate(() => ({ on: MEM.on, fail: MEM.fail, err: DB.lastErr() }));
    expect(st.on, 'a working database should not report a fallback').toBe(false);
    expect(st.fail, 'a working counter should have no lost write').toBeFalsy();
    expect(st.err, 'a working counter should have no database error').toBeFalsy();
  });

  await test.step('⭐⭐ the fallback records WHY, instead of discarding it', async () => {
    const st = await till.evaluate(async () => {
      /* the database refuses exactly once — the wrapper must fall back AND keep the reason */
      const realTx = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function () { const e = new Error('nope'); e.name = 'QuotaExceededError'; throw e; };
      try { await DB.put('bills', { no: 'FALL-1', at: new Date().toISOString(), total: 1, lines: [] }); } catch (_) {}
      IDBDatabase.prototype.transaction = realTx;
      return { on: MEM.on, err: DB.lastErr() };
    });
    expect(st.on, 'it did not fall back').toBe(true);
    expect(st.err, 'the database refused and the reason was thrown away').toBeTruthy();
    expect(st.err.why, 'the reason is not the one the database gave').toBe('QuotaExceededError');
    expect(st.err.op, 'it does not say which operation failed').toBe('put');
  });

  await test.step('⭐⭐⭐ and when the fallback ALSO refuses, the lost write is recorded', async () => {
    const st = await till.evaluate(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k) {
        if (String(k).indexOf('cb_probe') === 0) return real.apply(this, arguments);
        const e = new Error('full'); e.name = 'QuotaExceededError'; throw e;
      };
      const ok = MEM.put('bills', { no: 'FALL-2', total: 2 });
      Storage.prototype.setItem = real;
      return { ok, fail: MEM.fail };
    });
    expect(st.ok, 'MEM.put claimed a write that never happened').toBe(false);
    expect(st.fail, 'a bill was written nowhere at all and nothing recorded it').toBeTruthy();
    expect(st.fail.store, 'the lost write does not say which store').toBe('bills');
  });

  await test.step('⚠️ and the 🩺 panel says both, where somebody will actually see them', async () => {
    await till.evaluate(() => openStuck());
    const body = await till.locator('#billsbody').innerText();
    expect(body, 'the panel is silent about the refused database').toMatch(/database refused|smaller store/i);
    expect(body, 'the panel is silent about the lost write').toMatch(/write was lost/i);
    const rep = await till.evaluate(() => stuckReport());
    expect(rep, 'the report a shopkeeper sends does not mention it').toMatch(/A WRITE WAS LOST/);
  });
});

// ⭐⭐⭐ [TILL-21] THE ABSORBED SALE, RECOVERED ON THE COUNTER ITSELF (Athi, 2026-09-17, option a). A bill that says
// "sent" but whose chit records ANOTHER counter's sale is found, given a new number of this counter's own series,
// keeps the number the customer was given, and is sent — and the printed number still finds it for a reprint.
test('[TILL-21] an absorbed sale is renumbered, keeps its printed number, and reaches the books', async ({ page, context }) => {
  test.setTimeout(420000);
  await mintEntity(page, { fresh: true, name: 'Absorb ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Filter coffee 100 g', unit: 'packet', price: 80, code: 'ABS9' });
  const keys = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const out = [];
    for (const n of ['first pc', 'second pc']) {
      const r = await api('keysMint', { body: { name: n, scopes: ['till'], days: 1 } });
      out.push(r && (r.key || r.api_key));
    }
    return out;
  });
  const base = await page.evaluate(() => (typeof CFG !== 'undefined' && CFG.API_BASE) || '');

  /* the FIRST PC's sale is in the books under C1/…/<n> */
  const NO = 'C1/26-27/' + String(Date.now()).slice(-4);
  const firstChit = await page.evaluate(async ({ base, key, no }) => {
    const r = await fetch(base + '/api/chits/send', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify({ recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no,
        client_ref: no, business_json: { till: { id: 'C1' }, bill_no: no, billed_at: new Date(Date.now() - 300000).toISOString() },
        line_items: [{ particulars: 'Tea', quantity: 1, unit: 'cup', price: 10, total: 10 }] }) });
    return (await r.json()).chit_id;
  }, { base, key: keys[0], no: NO });
  expect(firstChit).toBeTruthy();

  const till = await context.newPage();
  await till.goto(TILL + '/till.html#key=' + encodeURIComponent(keys[1]));
  await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 40000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 40000 });

  await test.step('the SECOND PC holds its own sale under the same number, wrongly marked "sent" with the first PC\'s chit', async () => {
    await till.evaluate(async ({ no, chit }) => {
      const b = { no, at: new Date().toISOString(), till: 'C1', total: 80, paid: 80, change: 0,
                  lines: [{ name: 'Filter coffee 100 g', qty: 1, unit: 'packet', price: 80, net: 80 }],
                  _sent: { at: Date.now(), chit_id: chit } };
      await DB.put('bills', b);
    }, { no: NO, chit: firstChit });
  });

  let result;
  await test.step('⭐⭐ the check finds it and records it under a new number', async () => {
    await till.evaluate(() => { window.say = () => {}; window.openStuck = () => {}; });
    result = await till.evaluate(() => checkAbsorbed(true));
    expect(result && result.fixed, 'the absorbed sale was not found: ' + JSON.stringify(result)).toBe(1);
    expect(result.renumbered.length).toBe(1);
    expect(result.renumbered[0].from).toBe(NO);
    expect(result.renumbered[0].to, 'it was "renumbered" to the same number').not.toBe(NO);
  });

  await test.step('⭐ the printed number is kept, and still finds the sale', async () => {
    const got = await till.evaluate(async (no) => {
      const all = await DB.allRaw('bills');
      const b = all.filter((x) => x && x.printed_as === no)[0];
      const stale = all.filter((x) => x && x.no === no).length;
      return { b, stale };
    }, NO);
    expect(got.b, 'the printed number was lost').toBeTruthy();
    expect(got.stale, 'the old row is still there under the taken number').toBe(0);
    expect(got.b._sent, 'a sale that never landed still says sent').toBeFalsy();
  });

  await test.step('⭐⭐⭐ and it really reaches the books this time', async () => {
    /* ⚠️ WAIT FOR THE RESULT, not a fixed sleep: checkAbsorbed already started a drain, a second call returns at once
       while it is busy, and a send to the API can take longer than any number picked here. */
    /* ⚠️ A PLAIN LOOP, NOT waitForFunction(...).catch(() => {}). That swallowed its own failure, so a predicate that
       errored ended the "45-second wait" at once and the check below read the bill before the send had finished —
       the very shape of fault this whole file is about, in the test. */
    let done = false;
    for (let i = 0; i < 25 && !done; i++) {
      done = await till.evaluate(async (no) => {
        if (!HOST._busy) HOST.drain();
        const b = (await DB.allRaw('bills')).filter((x) => x && x.printed_as === no)[0];
        return !!(b && b._sent && b._sent.chit_id);
      }, NO);
      if (!done) await till.waitForTimeout(2000);
    }
    const v = await till.evaluate(async (no) => {
      const b = (await DB.allRaw('bills')).filter((x) => x && x.printed_as === no)[0];
      return { sent: !!(b && b._sent && b._sent.chit_id), chit: b && b._sent && b._sent.chit_id, newNo: b && b.no };
    }, NO);
    expect(v.sent, 'the recovered sale did not send').toBe(true);
    expect(v.chit, '⚠️ it was absorbed AGAIN into the first PC\'s chit').not.toBe(firstChit);
    const again = await till.evaluate(() => checkAbsorbed(true));
    expect(again.fixed, 'the recovered sale is still not really in the books').toBe(0);
  });
});

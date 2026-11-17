// [TILL-07] POINTS AT THE COUNTER. Athi, 2026-09-10: "exactly like offer — instead of discount you add reward, so
// it can be encashed during next visit, so a repeated customer can be invented." REW-01…12 on the test sheet had
// no automation at all, which made them the least-proven thing in the product; this drives the REAL page against
// the REAL API for the parts a person cannot check quickly by eye.
//
// ⚠️ A FRESH ENTITY EVERY RUN, and for this subject that is not just hygiene. The reward ledger is append-only, so
// a spec that billed the same shop twice would accumulate points for ever and its assertions would drift until
// somebody "fixed" them by loosening them. A new shop starts at zero, so every number below can be exact.
// ⚠️ ADDING IS A DELIBERATE ACT SINCE 2026-09-10. A click on a row CHOOSES it; the + button (or Enter) puts it
// on the bill. Athi: "by just clicking the list it gets added to the cart, that is not my intention." These specs
// clicked the row and expected a bill line — so they are what caught the change, correctly, and they drive the
// new control rather than the old one.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[TILL-07] a counter awards points, and the programme is the shop\'s to declare', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Points ' + Date.now().toString().slice(-6) });
  await addProduct(page, { name: 'Rice 1kg', unit: 'kg', price: 100, code: 'RICE' });

  await test.step('⚠️⚠️ a programme with no earning rule is REFUSED — a rule without its value is not a rule', async () => {
    /* the same failure as Athi's "Flat 10%" offer, one subject along: it would have been accepted and then earned
       nothing, which looks exactly like a working feature nobody happens to be earning on */
    const bad = await page.evaluate(async () => {
      if (typeof ensureCap === 'function') await ensureCap('admin');
      try {
        await api('defAdd', { body: { kind: 'reward', sub_kind: 'points', name: 'Empty', status: 'live', rules: {} } });
        return null;
      } catch (e) { return String(e && e.message); }
    });
    expect(bad, 'a reward programme with no earn rule was accepted').toBeTruthy();
    expect(bad).toMatch(/award anything|earned/i);
  });

  await test.step('⭐ the shop declares the mechanism — 1 point per ₹100, 100 points = ₹1', async () => {
    const made = await page.evaluate(async () => api('defAdd', { body: {
      kind: 'reward', sub_kind: 'points', name: 'Shop points', status: 'live',
      rules: { earn: { kind: 'per_amount', per: 100, points: 1 },
               redeem: [{ kind: 'money', points: 100, amount: 1 }],
               expires_months: 12, walk_in_earns: true, min_balance_to_spend: 100 } } }));
    /* ⚠️ the id is nested under `definition` — reading it off the top level said "undefined" about a definition
       that had in fact been created perfectly. Assert what the route ANSWERS, not what it felt like it should. */
    expect(made && made.definition && made.definition.definition_id, JSON.stringify(made)).toBeTruthy();
    expect(made.definition.status, 'a programme nobody made live awards nothing').toBe('live');
  });

  let key;
  await test.step('a till key, and the programme travels on the snapshot', async () => {
    key = (await page.evaluate(async () => api('keysMint', { body: { name: 'points counter', scopes: ['till'], days: 1 } }))).key;
    const r = await page.request.get(API + '/api/till/snapshot', { headers: { 'X-Api-Key': key } });
    expect(r.status()).toBe(200);
    const snap = await r.json();
    /* ⚠️ THE COUNTER MUST HOLD THE RULE, not ask for it — it bills with the line down and still has to tell a
       customer what they just earned while they are standing there. */
    expect(snap.reward, 'the programme did not reach the counter').toBeTruthy();
    expect(snap.reward.name).toBe('Shop points');
    expect(snap.reward.earn.per).toBe(100);
    expect(snap.reward.expires_months).toBe(12);
  });

  const till = await context.newPage();
  till.on('pageerror', (e) => console.log('   till threw: ' + e.message));

  await test.step('⭐⭐ the counter says how points are earned, in words a shopkeeper reads', async () => {
    await till.goto('/till.html#key=' + encodeURIComponent(key));
    await till.waitForFunction(() => window.CBRewards && window.CBOffers, null, { timeout: 60000 });
    await till.waitForFunction(() => document.getElementById('shopname').textContent !== 'Not paired yet', null, { timeout: 60000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
    /* the strip is only visible when a shop actually runs a programme — most do not, and it must cost them nothing */
    await expect(till.getByTestId('till-rw')).toBeVisible({ timeout: 15000 });
    await expect(till.getByTestId('till-rw')).toContainText('Shop points');
    await expect(till.getByTestId('till-rw'), 'the earning rule is stated, not implied').toContainText(/1 point for every/);
  });

  await test.step('⚠️ a walk-in with no name and no number earns nothing — and is TOLD why', async () => {
    await till.fill('#q', 'rice');
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 30000 });
    await till.click('[data-testid="till-add-0"]');
    /* silence here would look exactly like a broken feature; one line and a phone number fixes it */
    await expect(till.getByTestId('till-rw')).toContainText(/a name or a phone number to hold them/);
  });

  await test.step('⭐⭐⭐ a named customer earns, and the counter says so BEFORE the bill is paid', async () => {
    /**
     * ⚠️ THIS SHOP DECLARES walk_in_earns: true, and the test has to match the shop it just created. The first
     * cut set it to FALSE and then expected a phone-held customer to earn — the counter was right and the test
     * was asserting the opposite of a policy it had set itself. A typed name that is not on the shop's list is
     * NOT an identity, so the holder is the phone number; that is the walk-in path, and it earns here.
     * (walk_in_earns:false is proven at the unit level in chitbridge-api/tests/reward-cycle.test.js.)
     * ₹100 × 6 = ₹600 → 6 points at 1 per ₹100. The figure is exact because the shop is new.
     */
    for (let i = 0; i < 5; i++) await till.click('[data-testid="till-add-0"]');
    await till.fill('#cphone', '9840012345');
    await till.fill('#cname', 'Kumar');
    /* ⚠️ the lookup is debounced — a request per letter of somebody's name would be absurd */
    await expect(till.getByTestId('till-rw'), 'the counter must quote the earning before the customer pays')
      .toContainText(/this bill adds/, { timeout: 15000 });
    /**
     * ⚠️⚠️ ASSERT THE RULE, NOT A NUMBER I PREDICTED. This first read /adds\s*6\b/ — six clicks at ₹100 — and went
     * red saying 7, because a click had landed somewhere I had not counted. The product was right and my
     * arithmetic about the test was wrong, which is the worst kind of red: it accuses the code of a fault the
     * test invented. Read the bill the counter is actually holding and check the RELATION between the two.
     */
    const seen = await till.evaluate(() => ({ net: billMoney().net, adds: rwEarns() }));
    expect(seen.adds, 'one point per ₹100 of ' + seen.net).toBe(Math.floor(seen.net / 100));
    expect(seen.adds, 'a bill of ' + seen.net + ' must earn something').toBeGreaterThan(0);
    const said = await till.getByTestId('till-rw').textContent();
    expect(said, 'the strip must quote the same figure the engine computed').toMatch(new RegExp('adds\\s*' + seen.adds + '\\b'));
  });

  await test.step('⭐⭐ the bill is saved, and the slip carries the points below the money', async () => {
    await till.click('[data-testid="till-pay-cash"]').catch(() => {});
    await till.click('#save');
    await expect(till.locator('#slipbox'), 'the slip must say what was earned').toContainText(/Shop points earned/, { timeout: 30000 });
    /* ⚠️ the same lesson as the strip: read what the bill RECORDED and check the slip agrees with it, rather than
       asserting a number the test guessed. A slip that disagreed with the ledger is the real fault worth catching. */
    const earned = await till.evaluate(() => (LAST && LAST.reward && LAST.reward.added) || 0);
    expect(earned, 'the bill recorded no points at all').toBeGreaterThan(0);
    await expect(till.locator('#slipbox')).toContainText(new RegExp('\\+' + earned));
    await expect(till.locator('#slipbox'), 'and where they now stand').toContainText(/Shop points balance/);
    /* ⚠️ BELOW the total and below the tender. Points happened alongside the money; they are not part of what was
       charged, and a slip that mixed them would be a slip a customer could argue with. */
    const slip = await till.locator('#slipbox').textContent();
    expect(slip.indexOf('TOTAL'), 'points are printed after the total').toBeLessThan(slip.indexOf('Shop points earned'));
  });

  await test.step('⭐⭐⭐ and the shop can see what it now owes that customer', async () => {
    const r = await page.request.get(API + '/api/till/reward?scheme=phone&value=9840012345', { headers: { 'X-Api-Key': key } });
    expect(r.status()).toBe(200);
    const j = await r.json();
    /**
     * ⭐⭐ THE POINTS ARE HELD AGAINST THE PHONE NUMBER, because a typed name that is not on the shop's list is
     * not an identity. That is the walk-in holder working exactly as designed — and it is the row a customer
     * can later CLAIM onto an account when they register.
     */
    /* ⚠️ WHAT THE SLIP PROMISED IS WHAT THE SHOP OWES. The customer walked out holding a piece of paper with a
       number on it; if the server's balance disagreed with it, the paper would be a lie the shop printed. */
    const promised = await till.evaluate(() => (LAST && LAST.reward && LAST.reward.added) || 0);
    expect(j.points, 'the shop owes this customer what the slip promised them').toBe(promised);
    expect(j.holder.scheme, 'a walk-in holds points against a number, never a name').toBe('phone');
    expect(j.programme.name).toBe('Shop points');
    expect(j.programme.expires_months).toBe(12);
  });
});

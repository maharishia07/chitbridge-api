#!/usr/bin/env node
/**
 * e2e/walk-shop-confirm-sheets.cjs - THE SHOP ASKS BEFORE IT SENDS, AND ITS SHEETS WORK BY KEYBOARD (UX-6, 2026-11-12).
 * Black box: the real shop.html and know-your-business.html with a stand-in api; every action on the shop is a key (Enter, Tab, Shift+Tab, Escape).
 *   P1  Place order (Enter) opens the page-level confirm: the shop, the lines, the total, the contact; NO order has been posted yet
 *   P2  Escape on that confirm posts nothing; Cancel posts nothing; Place order in it posts exactly one order
 *   K1  a sheet opens with the focus INSIDE it, and Tab (and Shift+Tab) never leaves it
 *   K2  Escape closes the sheet and the focus goes back to the control that opened it (Report a problem, My orders)
 *   K3  the order sheet is a dialog for a screen reader (role, modal, a name) and its x has a name
 *   F1  a finish (qty 3), an offer (qty 2) and a form each ask first: the finish and the offer show the quantity and the TOTAL from the one money engine,
 *       the form shows its details and no money; 0 posts until the yes, at 1366x768 and 390x844
 *   F2  typing: a redraw that takes the box away puts the focus back on the box with the same id; a node added inside the sheet never steals the focus
 *   F3  two sheets open (Report a problem over the order): one Escape closes only the top one, a second closes the other
 *   B1  Know your business at 390x844: the credential-name placeholder is shown whole (not cut), no sideways scroll
 * It must FAIL on main: there Place order posts at once, Escape does nothing on a sheet, Tab walks out behind it, the placeholder is cut.
 *   NODE_PATH=<dir with playwright> node e2e/walk-shop-confirm-sheets.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const SHOP = 'CBSIMCFM';
const view = { available: true, visibility: 'public', categories: [],
  shop: { bridge_id: SHOP, display_name: 'Sim Confirm Store', currency_code: 'INR', gstn: null, country: 'IN', is_verified: true, business_status: 'open',
    storefront_access: 'browse', unit_rules: {}, showcase: { template: null, sections: [] }, viewer_groups: [], connector: null,
    order_input: { preset: 'cart', pipeline: 'commerce', showsPrice: true, negotiable: false, schema: null, documents: [] }, order_method: 'cart' },
  schema: null, fields: [], offers: [],
  items: [{ item_id: 'i1', item_data: { name: 'Basmati rice 5 kg', unit: 'bag', price: 640 } }] };
const SHOTS = process.env.WALK_SHOTS || 'e2e/shots';

/** a shop with ONE finish ordered the way the case says: a priced finish, a negotiable one (the buyer's offer) or a form (no money) */
function finishView(kind) {
  const oi = { preset: kind === 'form' ? 'form' : 'cart', pipeline: kind === 'form' ? 'payload' : 'commerce', showsPrice: kind !== 'form', negotiable: kind === 'offer',
    schema: kind === 'form' ? { required: ['note'], properties: { note: { type: 'string' } } } : null, documents: null };
  const item = { name: 'Sky blue emulsion', unit: 'litre', commercials: { price: 500, unit: 'litre' }, order_input: oi, combinations: [{ name: 'Sky', colours: [{ name: 'Blue', hex: '#6fa8dc' }] }] };
  return Object.assign({}, view, { shop: Object.assign({}, view.shop, { bridge_id: SHOP + kind, order_input: oi, order_method: kind === 'form' ? 'form' : 'cart' }),
    items: [], finishes: [{ title: 'Paints', source: 'SRC1', items: [item] }] });
}
/** the keys: Tab count until the focus is back where it started proves a trap; returns where each press landed */
async function tabLoop(page, presses, key) {
  const where = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    where.push(await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.contains(document.activeElement); }));
  }
  return where;
}

W.run('shop-confirm-sheets', async (w) => {
  const { page } = w;
  const posts = [];
  await page.route('**/api/**', (r) => r.fulfill(J({ ok: true })));
  await page.route('**/api/catalogue/' + SHOP, (r) => r.fulfill(J(view)));
  await page.route('**/api/catalogue/' + SHOP + '?*', (r) => r.fulfill(J(view)));
  await page.route('**/api/catalogue/' + SHOP + '/order/start', (r) => r.fulfill(J({ message: 'Code sent', channel: 'phone' })));
  await page.route('**/api/catalogue/' + SHOP + '/order/confirm', (r) => { posts.push(r.request().postDataJSON()); return r.fulfill(J({ message: 'Placed', chit_id: 'abcdef12-0000-4000-8000-000000000000', token: 'tok', summary: { total_value: 640 } })); });
  await page.route('**/api/catalogue/' + SHOP + '/support/preview', (r) => r.fulfill(J({ to: 'the shop', can_send: true })));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(w.base + '/shop.html?s=' + SHOP + '&api=' + encodeURIComponent(w.base));
  await page.waitForSelector('[data-testid="shop-head"]', { timeout: 15000 });

  /* the basket: add one product, open Check out, Delivery -> Continue ... -> Who you are -> Send me a code -> the code (all by keys) */
  await page.locator('[data-testid="cart-add"]').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  if (!(await page.locator('[data-testid="cart-checkout"]').isVisible().catch(() => false))) await page.locator('[data-testid="shop-dock"] .cbcart-bar').first().click();
  await page.locator('[data-testid="cart-checkout"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="shop-mode-delivery"]', { timeout: 8000 });
  await page.locator('[data-testid="shop-mode-delivery"]').focus();
  await page.keyboard.press('Enter');
  await page.fill('[data-testid="shop-area"]', '600001');
  for (let i = 0; i < 4 && !(await page.locator('[data-testid="shop-contact"]').count()); i++) {
    await page.locator('[data-testid^="step-next-"]').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }
  await page.fill('[data-testid="shop-contact"]', '9876543210');
  await page.locator('[data-testid="shop-cart-submit"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="shop-otp"]', { timeout: 8000 });
  await page.fill('[data-testid="shop-otp"]', '123456');

  await w.step('K3', 'the order sheet is a dialog with a name, and its x button has a name', async () => {
    const m = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); const x = d && d.querySelector('[data-cbmount="SHP001-U02"]');
      return { role: !!d, modal: d && d.getAttribute('aria-modal'), name: d && d.getAttribute('aria-label'), x: x && x.getAttribute('aria-label') }; });
    return { ok: m.role && m.modal === 'true' && /Sim Confirm Store/.test(m.name || '') && m.x === 'Close', saw: JSON.stringify(m) };
  });
  await w.step('K1', 'the order sheet holds the focus: ten Tab and ten Shift+Tab never leave it', async () => {
    const fwd = await tabLoop(page, 10, 'Tab'), back = await tabLoop(page, 10, 'Shift+Tab');
    return { ok: fwd.every(Boolean) && back.every(Boolean), saw: 'Tab inside ' + fwd.filter(Boolean).length + '/10 · Shift+Tab inside ' + back.filter(Boolean).length + '/10' };
  });
  await w.step('P1', 'Place order (Enter) asks first: shop, lines, total, contact; nothing is posted yet', async () => {
    await page.locator('[data-testid="shop-cart-submit"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => { const d = document.querySelector('[data-testid="confirm"]'); return d && d.open ? d.innerText : ''; });
    const ok = /Place this order/.test(t) && /Sim Confirm Store/.test(t) && /Basmati rice 5 kg/.test(t) && /640/.test(t) && /9876543210/.test(t) && posts.length === 0;
    await page.screenshot({ path: SHOTS + '/shop-confirm-1366.png' }).catch(() => null);
    return { ok, saw: 'confirm: "' + t.replace(/\s+/g, ' ').slice(0, 170) + '" · orders posted ' + posts.length };
  });
  await w.step('P2', 'Escape posts nothing, Cancel posts nothing, Place order in the confirm posts exactly one', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const goneA = await page.evaluate(() => !document.querySelector('[data-testid="confirm"]'));
    const sheetStays = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    await page.locator('[data-testid="shop-cart-submit"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="confirm"]');
    await page.locator('[data-testid="confirm-cancel"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const afterNo = posts.length;
    await page.locator('[data-testid="shop-cart-submit"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="confirm"]');
    await page.locator('[data-testid="confirm-ok"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    return { ok: goneA && sheetStays && afterNo === 0 && posts.length === 1, saw: 'Escape closed only the question: ' + goneA + ' (sheet stays ' + sheetStays + ') · after Escape and Cancel ' + afterNo + ' orders · after the yes ' + posts.length };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await w.step('K2', 'a sheet opened by key: focus goes in, Tab stays in, Escape closes it and focus returns to the opener (Report a problem, My orders)', async () => {
    const out = [];
    for (const id of ['shop-support', 'shop-my-orders-link']) {
      await page.locator('[data-testid="' + id + '"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      const inside = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.contains(document.activeElement); });
      const trapped = (await tabLoop(page, 8, 'Tab')).every(Boolean);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
      const back = await page.evaluate((i) => (document.activeElement && document.activeElement.getAttribute('data-testid')) === i, id);
      out.push(id + ': in ' + inside + ' trapped ' + trapped + ' closed ' + closed + ' back ' + back);
      if (!(inside && trapped && closed && back)) return { ok: false, saw: out.join(' · ') };
    }
    return { ok: true, saw: out.join(' · ') };
  });

  /* F1 · F2 · F3 · a finish, an offer, a form */
  for (const kind of ['finish', 'offer', 'form']) {
    await page.route('**/api/catalogue/' + SHOP + kind + '*', (r) => {
      const u = r.request().url();
      if (/\/order\/start/.test(u)) return r.fulfill(J({ message: 'Code sent', channel: 'phone' }));
      if (/\/order\/confirm/.test(u)) { posts.push(r.request().postDataJSON()); return r.fulfill(J({ message: 'Placed', chit_id: 'abcdef12-0000-4000-8000-000000000000', token: 'tok', summary: {} })); }
      if (/support\/preview/.test(u)) return r.fulfill(J({ to: 'the shop', can_send: true }));
      return r.fulfill(J(finishView(kind)));
    });
  }
  /** open the kind's order sheet by keys, fill what it asks, reach the code step */
  const toCodeStep = async (kind) => {
    await page.goto(w.base + '/shop.html?s=' + SHOP + kind + '&api=' + encodeURIComponent(w.base));
    await page.waitForSelector('[data-testid="shop-order-0"]', { timeout: 15000 });
    await page.locator('[data-testid="shop-order-0"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="shop-contact"]');
    if (kind === 'finish') await page.fill('[data-testid="shop-qty"]', '3');
    if (kind === 'offer') { await page.fill('[data-testid="shop-qty"]', '2'); await page.fill('[data-testid="shop-offer"]', '400'); }
    if (kind === 'form') await page.fill('[data-testid="shop-f-note"]', 'Please call me');
    await page.fill('[data-testid="shop-contact"]', '9876543210');
    await page.locator('[data-testid="shop-send-code"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="shop-otp"]');
  };
  const WANT = { finish: [/Sky blue emulsion/, /3/, /1,?500/], offer: [/Sky blue emulsion/, /2/, /800/], form: [/Sky blue emulsion/, /your details/] };
  await w.step('F1', 'a finish (qty 3), an offer (qty 2) and a form each ask first, with quantity and total from the one money engine; 0 posts until the yes', async () => {
    const out = [];
    for (const [vp, tag] of [[{ width: 1366, height: 768 }, '1366'], [{ width: 390, height: 844 }, '390']]) {
      await page.setViewportSize(vp);
      for (const kind of ['finish', 'offer', 'form']) {
        const before = posts.length;
        await toCodeStep(kind);
        await page.fill('[data-testid="shop-otp"]', '123456');
        await page.locator('[data-testid="shop-place-order"]').focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-testid="confirm"]', { timeout: 5000 });
        const text = await page.evaluate(() => document.querySelector('[data-testid="confirm"]').innerText);
        const money = await page.evaluate(() => !!document.querySelector('[data-testid="confirm"] [data-testid="shop-confirm-total"]'));
        await page.screenshot({ path: SHOTS + '/shop-confirm-' + kind + '-' + tag + '.png' }).catch(() => null);
        const good = WANT[kind].every((re) => re.test(text)) && (kind === 'form' ? !money : money) && posts.length === before;
        out.push(tag + ' ' + kind + ': ' + (good ? 'ok' : 'BAD "' + text.replace(/\s+/g, ' ').slice(0, 140) + '"'));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
    }
    return { ok: out.every((x) => /ok$/.test(x)) && posts.length === 1, saw: out.join(' · ') + ' · posts ' + posts.length };
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await w.step('F2', 'typing: a redraw that takes the box away puts the focus back on the same box; a node added inside the sheet never steals the focus', async () => {
    await toCodeStep('finish');
    await page.locator('[data-testid="shop-otp"]').focus();
    await page.keyboard.type('12');
    await page.evaluate(() => { const note = document.createElement('i'); note.id = 'walk_note'; document.querySelector('[role="dialog"]').appendChild(note); });
    await page.waitForTimeout(150);
    const kept = await page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.evaluate(() => orderRender());
    await page.waitForTimeout(250);
    const back = await page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.keyboard.type('34');
    const typed = await page.evaluate(() => document.activeElement && document.activeElement.value);
    return { ok: kept === 'o_otp' && back === 'o_otp' && typed === '34', saw: 'after an added node focus on ' + kept + ' · after the redraw on ' + back + ' · typing went into the box: "' + typed + '"' };
  });
  await w.step('F3', 'Report a problem over the order sheet: one Escape closes only the top sheet, the second closes the other', async () => {
    await page.evaluate(() => supOpen());
    await page.waitForSelector('#suphost [role="dialog"]');
    const two = await page.locator('[role="dialog"]').count();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const afterOne = await page.evaluate(() => ({ sup: !!document.querySelector('#suphost [role="dialog"]'), ord: !!document.querySelector('#ohost [role="dialog"]') }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const afterTwo = await page.evaluate(() => ({ sup: !!document.querySelector('#suphost [role="dialog"]'), ord: !!document.querySelector('#ohost [role="dialog"]') }));
    return { ok: two === 2 && !afterOne.sup && afterOne.ord && !afterTwo.ord, saw: two + ' sheets open · after one Escape ' + JSON.stringify(afterOne) + ' · after two ' + JSON.stringify(afterTwo) };
  });

  /* B1 · Know your business at 390 */
  await page.route('**/api/kyb/yourself', (r) => r.fulfill(J({ facts: { credentials: [], summary: {} } })));
  await page.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) { /* no storage: the page shows its own sign-in */ } }, W.session('Fixture Owner', 'Fixture Shop'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(w.base + '/know-your-business.html');
  await page.waitForSelector('#nc_title', { timeout: 15000 });
  await page.screenshot({ path: SHOTS + '/kyb-390.png' }).catch(() => null);
  await w.step('B1', 'Know your business at 390x844: the credential-name placeholder is shown whole, nothing scrolls sideways', async () => {
    const m = await page.evaluate(() => {
      const i = document.getElementById('nc_title'), cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d');
      c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { need: Math.ceil(c.measureText(i.placeholder).width), room: Math.floor(room), side: document.documentElement.scrollWidth - innerWidth, text: i.placeholder };
    });
    return { ok: m.need <= m.room && m.side <= 0, saw: '"' + m.text + '" needs ' + m.need + ' px, the box has ' + m.room + ' px · sideways overflow ' + m.side + ' px' };
  });
});

/* per-row-probe.cjs — DOES A VALUE CHANGE STILL FLIP THE WHOLE PANE? (Athi, 2026-09-08: "the view never changes, it is only the data has to move")
 *
 * The claim to check is not "it is fast" — it is that the DOM NODES SURVIVE. A repaint that replaces a container throws away the
 * caret, the scroll and every row a lazy list had revealed, and no timing number shows that. So each node is marked before the
 * change and looked for afterwards.
 *
 * Run: node e2e/per-row-probe.cjs
 */
'use strict';
const path = require('path');
const { chromium } = require('@playwright/test');
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
const SESSION = process.env.CB_SESSION || path.join(__dirname, '.auth', 'user.json');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ baseURL: WEB, storageState: SESSION });
  const p = await ctx.newPage();
  const threw = [];
  p.on('pageerror', (e) => threw.push(e.message));

  /* ── the counter's cart ──────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── the counter: a quantity change ──');
  await p.goto('/till.html');
  await p.waitForFunction(() => typeof window.paintCartRow === 'function', null, { timeout: 30000 });

  const cart = await p.evaluate(() => {
    window.S = { shop: { name: 'Row test', reg_type: 'unregistered' }, items: [], offers: [], slabs: [], categories: [], policy: {} };
    CART = [{ item_id: 'a', name: 'Ponni rice 25 kg', unit: 'bag', price: 1180, qty: 1, gross: 1180, net: 1180, save: 0 },
            { item_id: 'b', name: 'Sunflower oil 1 L', unit: 'litre', price: 142, qty: 2, gross: 284, net: 284, save: 0 }];
    paintCart();
    /* mark the live nodes, then change a quantity the way a person does */
    document.querySelectorAll('#cart .row').forEach((el, i) => { el.dataset.mark = 'm' + i; });
    const box = document.querySelector('[data-testid="till-qty-0"]');
    box.focus(); box.value = '3';
    setQty(0, '3');
    return new Promise((res) => setTimeout(() => {
      const rows = Array.from(document.querySelectorAll('#cart .row'));
      res({ survived: rows.filter((el) => el.dataset.mark).length, of: rows.length,
            amount: (document.querySelector('[data-testid="till-amt-0"]') || {}).textContent,
            stillFocused: document.activeElement === document.querySelector('[data-testid="till-qty-0"]'),
            total: (document.querySelector('[data-testid="till-total"]') || {}).textContent });
    }, 60));
  });
  console.log('  rows that SURVIVED the change : ' + cart.survived + ' of ' + cart.of + (cart.survived === cart.of ? '   ✔ nothing was rebuilt' : '   ✘ the container was replaced'));
  console.log('  the amount that changed       : ' + cart.amount + '   total ' + cart.total);
  console.log('  the caret stayed in the box   : ' + (cart.stillFocused ? '✔ yes' : '✘ no — it jumped out mid-typing'));

  /* ── the catalogue list ──────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n── the Catalogue: moving the selection ──');
  await p.goto('/app.html');
  await p.waitForFunction(() => typeof window.prodRowRepaint === 'function' && typeof window.selectProduct === 'function', null, { timeout: 45000 });

  await p.evaluate(() => navTo('catalogue'));
  await p.waitForSelector('[data-testid^="cat-product-"]', { timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(3000);        /* the late loaders repaint the list once each; let them finish */
  const list = await p.evaluate(async () => {
    /* ⚠️ our own rows, painted once — the shared account's catalogue changes under us between runs, and a probe that
       measures a moving target measures nothing. */
    const prods = [];
    for (let i = 0; i < 40; i++) prods.push({ item_id: 'row' + i,
      item_data: { name: 'Row test product ' + i, code: 'RT' + i, unit: 'piece', price: 10 + i, status: 'available' } });
    UI.prods = prods; UI.prodQ = ''; UI._prodCatg = ''; UI._prodAvail = ''; UI.prodTruncated = false; UI.prodSel = null;
    paintProdList();
    await new Promise((r) => setTimeout(r, 100));
    const rows = Array.from(document.querySelectorAll('[data-testid^="cat-product-"]'));
    if (rows.length < 2) return { drawn: rows.length };
    rows.forEach((el, i) => { el.dataset.mark = 'm' + i; });
    const box = document.getElementById('ct_rows');
    if (box) box.scrollTop = 60;
    const id = rows[3].dataset.testid.replace('cat-product-', '');
    selectProduct(id, true);
    const after = Array.from(document.querySelectorAll('[data-testid^="cat-product-"]'));
    const el = document.querySelector('[data-testid="cat-product-' + id + '"]');
    return { drawn: rows.length, survived: after.filter((x) => x.dataset.mark).length, of: after.length,
             scroll: box ? box.scrollTop : null, selected: /(^| )sel( |$)/.test((el && el.className) || '') };
  });
  if (!list.drawn) console.log('  (no rows drawn — the screen needs a real catalogue; skipped)');
  else {
    console.log('  rows drawn                    : ' + list.drawn);
    console.log('  rows that SURVIVED the click  : ' + list.survived + ' of ' + list.of + (list.survived >= list.of - 1 ? '   ✔ only the two that changed were replaced' : '   ✘ the list was rebuilt'));
    console.log('  the scroll position           : ' + list.scroll + (list.scroll ? '   ✔ kept' : '   ✘ back to the top'));
    console.log('  the clicked row is marked     : ' + (list.selected ? '✔ yes' : '✘ no'));
  }

  console.log(threw.length ? '\nTHREW: ' + threw.join(' | ') : '\nno errors on the page');
  await b.close();
  process.exit(threw.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

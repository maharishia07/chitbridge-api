'use strict';
/**
 * tests/shopwindow-truth.realstack.cjs — SHOP WINDOW TRUTH (API part), on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §11 "Shop window").
 *
 * MKT-12, API part only (the screen walk e2e/walk-shopwindow.cjs stays open: SW-01 gallery shows · SW-10 placeholders are W cases).
 * Principles: the window shows what the shop holds (price, stock equal to the counter) · public doors obey visibility · the look is a template choice
 * the shop saves · nothing goes public until the essentials are ready · an order from the window moves no stock.
 * SW-02 price on the window = the catalogue's, after a change · SW-03 stock on the window = the Stock statement · SW-04 a connector's stamped figure vs the ledger
 * is ONE figure · SW-05 a private catalogue is refused at the public doors (browse AND order) · SW-08 the look picker refuses with what is missing ·
 * SW-09 look and ordering face are both saved, the product override wins · SW-11 an order from the window reaches the shop and moves no stock.
 * BOX PASS 2026-10-24 (SW rows How = A): SW-02b a removed product leaves the window · SW-03b/c/d/e the window shows only what can be bought (status, zero stock
 * when the shop asks, back when it returns; the hidden COUNT to the owner is a gap) · SW-05c a closed shop is a shutter, not a demolition · SW-05d the owner still
 * previews a private shop · SW-05e a private shop answers like a shop that never existed · SW-05f capture-fields door (gap MKT-16) · SW-05g a sign-in-first shop
 * shows a stranger its card only · SW-07a/b the look is ONE registry-derived flag, sections are a saved subset · SW-09c the product override (gap W23/W25).
 * Not here (listed): SW-06 member-store offers (✓ network-storefront.test.cjs, network-offer-scope.test.cjs: a network build is not provable offline) ·
 * SW-07 pure unit half (✓ showcase-policy.test.cjs) · SW-01/SW-10 screens (W: W21/W22).
 * A `gap:` FAIL is a RECORDED finding (MARKETING-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY.
 * Break-tested 2026-10-19: each passing case was run once with its expected figure flipped to a wrong one and went red.
 * Run: node tests/shopwindow-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 11-crm-and-marketing/showcase
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, CUSTOMER_OTP, j, ok, pause, kase, expect, near, receipt, bill, freshShop, finish } = H;
const RUN = 'sw' + (Date.now() % 1e10).toString(36);
let pg = null;
const view = async (shop) => ok(await j('/api/catalogue/' + shop.bridge), 'public view').b;
const shown = (v, id) => (v.items || []).find((i) => i.item_id === id);
const stmtQty = async (shop, id) => { const b = ok(await j('/api/till/stock?detail=1', { token: shop.token }), 'stock').b.balances[id]; return b ? b.qty : null; };
const moves = async (shop, id) => (await pg.query('SELECT COUNT(*)::int AS n FROM stock_movement WHERE entity_id = $1 AND item_id = $2', [shop.entity, id])).rows[0].n;
const policy = async (shop, body) => j('/api/entities/policy', { method: 'PATCH', token: shop.token, body });

/* ── the box pass: one named function per group of cases, each on its own fresh shop (writes through routes, the database only read) ── */
const REGISTERED_LOOKS = require('../data/pages.json').pages.filter((r) => r.name.startsWith('showcase.')).map((r) => r.name + '@' + r.version);
const GAP_HIDDEN_COUNT = 'catalogue-view.js:335 says the OWNER is told how many items are not showing, but routes/catalogue.js publicResponseFor forwards only unpriced_hidden (MARKETING-BACKLOG MKT-12)';
const GAP_PRIVATE_DOORS = 'MKT-16: the capture-fields, order and support doors do not check catalogue_visibility; only browse does (SEC-97 covers the foreign-id answers separately)';
const GAP_ORDER_FACE = 'W23/W25 (MKT-12): no shop-level ordering-face flag and no product override exist yet; the look fixes the face';
const mkItem = async (shop, name, price) => {
  const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b;
  return { id: made.item.item_id, name, unit: 'piece', price };
};
const receive = async (shop, no, p, qty) => { ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: receipt(no, [[p, qty, 5]]) }), 'receipt ' + no); await pause(1500); };
const sell = async (shop, no, p, qty) => { ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: bill(no, [[p, qty]]) }), 'sale ' + no); await pause(1500); };
const setStatus = async (shop, p, status) => ok(await j('/api/products/' + p.id + '/status', { method: 'PUT', token: shop.token, body: { status } }), 'status ' + status);
const sameAnswer = (r) => [r.status, r.b.code, r.b.title, r.b.message, r.b.detail, r.b.error].join('|');

/** SW-02b a removed product leaves the window (the window shows what the shop holds) */
async function removedItemKase() {
  const G = await freshShop(RUN + 'd', 'Window removed'), keep = await mkItem(G, 'Tea', 120), gone = await mkItem(G, 'Soap', 40);
  await kase('SW-02b', 'a product the shop removes is gone from the window; the others stay', async () => {
    const before = await view(G);
    ok(await j('/api/products/' + gone.id, { method: 'DELETE', token: G.token }), 'remove');
    const after = await view(G);
    expect(shown(before, gone.id) && !shown(after, gone.id) && shown(after, keep.id), 'before ' + !!shown(before, gone.id) + ' · after removal ' + !!shown(after, gone.id) + ' · the kept item ' + !!shown(after, keep.id));
  });
}

/** SW-03b/d/e a product marked unavailable is not shown, the owner is told how many, and it returns with its status */
async function unavailableItemKases() {
  const G = await freshShop(RUN + 'g', 'Window status'), tea = await mkItem(G, 'Tea', 120), jam = await mkItem(G, 'Jam', 90);
  await setStatus(G, tea, 'unavailable');
  await kase('SW-03b', 'a product marked unavailable is not shown on the window; the available one is', async () => {
    const v = await view(G);
    expect(!shown(v, tea.id) && shown(v, jam.id), 'unavailable item shown ' + !!shown(v, tea.id) + ' · available item shown ' + !!shown(v, jam.id));
  });
  await kase('SW-03d', 'the owner previewing the window is told how many items are not showing (unavailable_hidden = 1)', async () => {
    const r = await j('/api/catalogue/' + G.bridge + '?preview=1', { token: G.token });
    expect(r.status === 200 && r.b.unavailable_hidden === 1, 'preview ' + r.status + ' · unavailable_hidden ' + r.b.unavailable_hidden);
  }, GAP_HIDDEN_COUNT);
  await setStatus(G, tea, 'available');
  await kase('SW-03e', 'marked available again, the product returns to the window', async () => {
    const v = await view(G);
    expect(!!shown(v, tea.id) && !!shown(v, jam.id), 'after available again: tea ' + !!shown(v, tea.id) + ' · jam ' + !!shown(v, jam.id));
  });
}

/** SW-03c zero stock is shown (sold out) until the shop asks to hide it, and returns the instant stock arrives */
async function zeroStockKase() {
  const Z = await freshShop(RUN + 'z', 'Window zero'), salt = await mkItem(Z, 'Salt', 10);
  await receive(Z, RUN + '-ZG', salt, 4); await sell(Z, RUN + '-Zb', salt, 4);
  await kase('SW-03c', 'zero on the ledger: shown by default, hidden when qty_zero_hides is on, back when stock arrives', async () => {
    const off = shown(await view(Z), salt.id);
    ok(await policy(Z, { qty_zero_hides: 'on' }), 'hide at zero');
    const on = shown(await view(Z), salt.id);
    await receive(Z, RUN + '-ZG2', salt, 5);
    const back = shown(await view(Z), salt.id);
    expect(off && near(off.item_data.avail.qty, 0) && !on && back && near(back.item_data.avail.qty, 5), 'default ' + JSON.stringify(off && off.item_data.avail) + ' · hide on ' + !!on + ' · restocked ' + JSON.stringify(back && back.item_data.avail));
  });
}

/** SW-05c closed is a shutter over the chosen visibility, never an overwrite of it */
async function closedShutterKase() {
  const X = await freshShop(RUN + 'x', 'Window closed'), rug = await mkItem(X, 'Rug', 500), mail = RUN + '-x@local.test';
  await kase('SW-05c', 'a closed shop shows nothing and takes no order; reopened, the window returns as chosen', async () => {
    const open = shown(await view(X), rug.id);
    ok(await j('/api/entities/profile', { method: 'PATCH', token: X.token, body: { business_status: 'closed' } }), 'close');
    const browse = await j('/api/catalogue/' + X.bridge), order = await j('/api/catalogue/' + X.bridge + '/order/start', { method: 'POST', body: { email: mail, name: 'Closed Shopper' } });
    ok(await j('/api/entities/profile', { method: 'PATCH', token: X.token, body: { business_status: 'open' } }), 'reopen');
    const back = shown(await view(X), rug.id);
    expect(open && browse.status === 404 && !JSON.stringify(browse.b).includes('Rug') && order.status === 403 && back, 'open ' + !!open + ' · closed browse ' + browse.status + ' · order ' + order.status + ' · reopened ' + !!back);
  });
}

/** SW-05d/e/f the doors of a private shop: the owner still sees it, a stranger cannot tell it from a shop that never existed */
async function privateDoorKases() {
  const R = await freshShop(RUN + 'r', 'Window hidden'); await mkItem(R, 'Lamp', 300);
  ok(await j('/api/entities/profile', { method: 'PATCH', token: R.token, body: { catalogue_visibility: 'private' } }), 'private');
  await kase('SW-05d', 'the owner previews their own private shop (200, says it is private); a stranger gets 404', async () => {
    const mine = await j('/api/catalogue/' + R.bridge + '?preview=1', { token: R.token }), stranger = await j('/api/catalogue/' + R.bridge);
    expect(mine.status === 200 && mine.b.preview && mine.b.preview.visibility === 'private' && stranger.status === 404, 'owner ' + mine.status + ' ' + JSON.stringify(mine.b.preview) + ' · stranger ' + stranger.status);
  });
  await kase('SW-05e', 'the browse door answers a private shop exactly as it answers a handle that never existed', async () => {
    const priv = await j('/api/catalogue/' + R.bridge), none = await j('/api/catalogue/' + RUN + 'nosuchshop');
    expect(priv.status === 404 && sameAnswer(priv) === sameAnswer(none), 'private ' + sameAnswer(priv) + ' · unknown ' + sameAnswer(none));
  });
  await kase('SW-05f', 'the capture-fields door refuses a private shop like the browse door does', async () => {
    const r = await j('/api/catalogue/' + R.bridge + '/capture-fields');
    expect(r.status === 404, 'capture-fields on a private shop answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 100));
  }, GAP_PRIVATE_DOORS);
}

/** SW-05g a sign-in-first shop shows a stranger its card only (a code the page branches on), and its owner everything */
async function signInFirstKase() {
  const L = await freshShop(RUN + 'l', 'Window login'), bowl = await mkItem(L, 'Bowl', 150);
  ok(await j('/api/entities/profile', { method: 'PATCH', token: L.token, body: { storefront_access: 'login' } }), 'sign in first');
  await kase('SW-05g', 'a stranger gets the card and the code sign_in_first, no items; the owner reads the shop', async () => {
    const stranger = await j('/api/catalogue/' + L.bridge), owner = await j('/api/catalogue/' + L.bridge, { token: L.token });
    expect(stranger.status === 200 && stranger.b.sign_in && stranger.b.sign_in.code === 'sign_in_first' && !stranger.b.items && !JSON.stringify(stranger.b).includes('Bowl') && !!shown(owner.b, bowl.id), 'stranger ' + stranger.status + ' ' + JSON.stringify(stranger.b.sign_in) + ' items ' + !!stranger.b.items + ' · owner sees the bowl ' + !!shown(owner.b, bowl.id));
  });
}

/** SW-07a/b the look is ONE registry-derived flag; sections are a saved subset that a look change does not blank */
async function lookFlagKases(A) {
  await kase('SW-07a', 'the policy offers exactly the registered looks, and each one saves and shows on the window', async () => {
    const offered = ok(await j('/api/entities/policy', { token: A.token }), 'policy').b.schema.showcase_template.options, bad = [];
    for (const t of REGISTERED_LOOKS.slice().reverse()) { const r = await policy(A, { showcase_template: t }); if (r.status !== 200 || (await view(A)).shop.showcase.template !== t) bad.push(t + ' ' + r.status); }
    expect(JSON.stringify(offered) === JSON.stringify(REGISTERED_LOOKS) && !bad.length, 'offered ' + JSON.stringify(offered) + ' · registry ' + JSON.stringify(REGISTERED_LOOKS) + ' · not saved ' + bad.join());
  });
  await kase('SW-07b', 'sections: a subset is saved and shown, junk is dropped, empty or not-a-list is refused, a look change keeps them', async () => {
    const good = await policy(A, { showcase_sections: ['strip', 'menu'] }), junk = await policy(A, { showcase_sections: ['strip', 'nope'] });
    const empty = await policy(A, { showcase_sections: [] }), text = await policy(A, { showcase_sections: 'strip' });
    ok(await policy(A, { showcase_sections: ['strip', 'menu'] }), 'restore'); ok(await policy(A, { showcase_template: 'showcase.food.menu@1.0' }), 'change look');
    const sh = (await view(A)).shop.showcase;
    expect(good.status === 200 && junk.status === 200 && junk.b.flags.showcase_sections.join() === 'strip' && empty.status === 400 && text.status === 400 && sh.template === 'showcase.food.menu@1.0' && sh.sections.join() === 'strip,menu', 'good ' + good.status + ' · junk ' + junk.status + ' · empty ' + empty.status + ' · text ' + text.status + ' · window ' + JSON.stringify(sh));
  });
}

/** SW-09c the product override wins over the shop's ordering face (not buildable until the flag exists: W23/W25) */
async function productOverrideKase(A) {
  await kase('SW-09c', 'a product that names its own ordering face wins over the shop-level face', async () => {
    const flags = ok(await j('/api/entities/policy', { token: A.token }), 'policy').b.flags;
    expect(Object.keys(flags).some((f) => /order.*(face|look|template|design)|(face|look).*order/i.test(f)), 'no shop-level ordering-face flag exists, so there is nothing for a product to override');
    expect(false, 'the flag now exists: write the product-override half (set it, override one product, read both on the window)');
  }, GAP_ORDER_FACE);
}

(async () => {
  console.log('\n── shop window truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    /* SW-08 first: a shop with nothing priced yet */
    const E = await freshShop(RUN + 'e', 'Window empty');
    await kase('SW-08', 'with no priced item the look picker refuses and names what is missing (not a silent 200)', async () => {
      const r = await policy(E, { showcase_template: 'showcase.designer.gallery@1.0' });
      expect(r.status >= 400 && /item|price|product/i.test(r.b.message || ''), 'picker answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 160) + ' for a shop with 0 products');
    }, 'W26: the picker is not gated; a shop with no priced item can choose a look (no ✓/✗ checklist from the server)');

    const A = await freshShop(RUN + 'a', 'Window shop');
    const made = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
    const P = { id: made.item.item_id, name: 'Rice', unit: 'piece', price: 60 };
    ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: receipt(RUN + '-G', [[P, 20, 40]]) }), 'receipt'); await pause(1500);
    ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(RUN + '-b', [[P, 2]]) }), 'sale'); await pause(1500);

    await kase('SW-02', 'the window shows the catalogue price, and follows a price change (60 → 75)', async () => {
      const before = shown(await view(A), P.id), was = before && before.item_data.price && before.item_data.price.amount;
      ok(await j('/api/products/' + P.id, { method: 'PATCH', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 75 } } }), 'change price');
      const now = shown(await view(A), P.id), got = now && now.item_data.price && now.item_data.price.amount;
      expect(was === 60 && got === 75, 'window price before ' + was + ' · after the change ' + got);
    });
    await kase('SW-03', 'the stock on the window is the Stock statement\'s figure (20 received − 2 sold = 18)', async () => {
      const s = shown(await view(A), P.id), qty = s && s.item_data.avail && s.item_data.avail.qty, st = await stmtQty(A, P.id);
      expect(near(qty, 18) && near(st, 18) && s.item_data.avail.source === 'ledger', 'window ' + JSON.stringify(s && s.item_data.avail) + ' · statement ' + st);
    });

    /* SW-11 an order from the window reaches the shop and moves no stock */
    const door = '/api/catalogue/' + A.bridge, email = RUN + '-c@local.test', movesBefore = await moves(A, P.id);
    ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Window Shopper' } }), 'order start');
    const order = ok(await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: P.id, quantity: 3 }] } }), 'order confirm').b;
    await pause(1200);
    await kase('SW-11', 'an order from the window is a chit the shop can read, and moves no stock', async () => {
      const c = await j('/api/chits/' + order.chit_id, { token: A.token });
      expect(c.status === 200 && JSON.stringify(c.b).includes('Window Shopper') && await moves(A, P.id) === movesBefore && near(await stmtQty(A, P.id), 18), 'read ' + c.status + ' · movements ' + movesBefore + ' → ' + await moves(A, P.id) + ' · on hand ' + await stmtQty(A, P.id));
    });

    await kase('SW-09a', 'the chosen look is saved (a registered template), and a junk look is refused with a sentence', async () => {
      const good = await policy(A, { showcase_template: 'showcase.designer.gallery@1.0' }), junk = await policy(A, { showcase_template: 'showcase.x.y@1.0' });
      const v = await view(A);
      expect(good.status === 200 && v.shop.showcase.template === 'showcase.designer.gallery@1.0' && junk.status === 400 && /invalid|unknown/i.test(junk.b.message || ''), 'good ' + good.status + ' · window template ' + JSON.stringify(v.shop.showcase) + ' · junk ' + junk.status + ' ' + JSON.stringify(junk.b).slice(0, 100));
    });
    await kase('SW-09b', 'the ordering face is its own saved choice, separate from the look (a policy flag for it exists)', async () => {
      const flags = Object.keys(ok(await j('/api/entities/policy', { token: A.token }), 'policy').b.flags);
      expect(flags.some((f) => /order.*(face|look|template|design)|(face|look).*order/i.test(f)), 'policy flags with showcase/order in the name: ' + flags.filter((f) => /showcase|order/i.test(f)).join(', '));
    }, 'W23/W25: the look is a flag; the ordering face is not saved by the server yet');

    /* SW-04: a connector owns stock → its stamped figure vs the ledger */
    const C = await freshShop(RUN + 'c', 'Window connector');
    const cm = ok(await j('/api/products', { method: 'POST', token: C.token, body: { item_data: { name: 'Dal', unit: 'piece', price: 80 } } }), 'product').b, D = { id: cm.item.item_id, name: 'Dal', unit: 'piece', price: 80 };
    ok(await j('/api/chits/send', { method: 'POST', token: C.token, body: receipt(RUN + '-CG', [[D, 20, 50]]) }), 'receipt'); await pause(1500);
    const own = await policy(C, { stream_owner: { stock: 'connector:truth' } });
    ok(await j('/api/products/' + D.id + '/availability', { method: 'PUT', token: C.token, body: { qty: 50, source: 'connector' } }), 'stamp');
    ok(await j('/api/chits/send', { method: 'POST', token: C.token, body: bill(RUN + '-cb', [[D, 2]]) }), 'sale'); await pause(1500);
    await kase('SW-04', 'a connector stamps 50 and the counter sells 2: the window and the Stock screen show ONE figure', async () => {
      const s = shown(await view(C), D.id), win = s && s.item_data.avail && s.item_data.avail.qty, st = await stmtQty(C, D.id);
      expect(own.status === 200 && near(win, st), 'stream_owner ' + own.status + ' · window ' + win + ' (' + (s && s.item_data.avail && s.item_data.avail.source) + ') · statement ' + st);
    }, 'ST-28 (availability.js:62): the connector figure wins on the window and the sale does not move it; the statement moves');

    /* SW-05: a private catalogue at the public doors */
    const Q = await freshShop(RUN + 'q', 'Window private');
    const qm = ok(await j('/api/products', { method: 'POST', token: Q.token, body: { item_data: { name: 'Oil', unit: 'piece', price: 90 } } }), 'product').b;
    ok(await j('/api/entities/profile', { method: 'PATCH', token: Q.token, body: { catalogue_visibility: 'private' } }), 'private');
    const qdoor = '/api/catalogue/' + Q.bridge, qmail = RUN + '-q@local.test';
    await kase('SW-05a', 'a private catalogue is refused at the browse door (404 "Shop not found")', async () => {
      const r = await j(qdoor); expect(r.status === 404 && !JSON.stringify(r.b).includes('Oil'), 'browse ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 100));
    });
    await kase('SW-05b', 'and at the ORDER door: a stranger cannot place an order with a private shop', async () => {
      await j(qdoor + '/order/start', { method: 'POST', body: { email: qmail, name: 'Stranger' } });
      const r = await j(qdoor + '/order/confirm', { method: 'POST', body: { email: qmail, otp: CUSTOMER_OTP, line_items: [{ item_id: qm.item.item_id, quantity: 1 }] } });
      expect(r.status >= 400, 'order/confirm on a private shop answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 80) + ' — the order was placed');
    }, 'the order doors (start, confirm, capture-fields, support/preview) do not check catalogue_visibility; only the browse door does');
    await lookFlagKases(A); await productOverrideKase(A);
    await removedItemKase(); await unavailableItemKases(); await zeroStockKase();
    await closedShutterKase(); await privateDoorKases(); await signInFirstKase();
  } finally { await pg.end(); }
  finish('shopwindow-truth', process.env.SHOPWINDOW_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('shop window truth could not run:', e && e.message); process.exit(2); });

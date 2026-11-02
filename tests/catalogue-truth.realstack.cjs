'use strict';
/**
 * tests/catalogue-truth.realstack.cjs — CATALOGUE TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §5 "Catalogue").
 *
 * TB-SELL-7 / CAT-5. CA-04 a price typed incl. keeps both sides + tax_basis · CA-05 above the MRP is refused · CA-12 one product, one price on every door ·
 * CA-15 a blank price is UNPRICED, never 0 / free · CA-01 product slab beats category slab, source named · CA-02 no slab = a "tax missing" code (gap, W27) · CA-03 the no-slab count is a figure ·
 * CA-07 a category with products is not retired under them (gap, W30) · CA-08 an own-use item is stocked, not sold (+ CA-08b the supplier-bill link, gap, 5b) · CA-09 a supply is never a product · CA-11 a clashing offer is refused in words.
 * NOT HERE: CA-06 (the cost gate for an employee: needs an actor sign-in on the stack, so it stays on tests/cost-never-to-employees.test.cjs, real routers with stubbed auth) · CA-10 and CA-13 (scans, How = S) · CA-14 (points.test.js: a type, no route).
 * A `gap:` FAIL is a RECORDED finding (CATALOGUE-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here.
 * CA-16 + CA-17 (CAT-211): a cashier's PUT to the category-rate door and to the shop-default door is refused 403 in the one problem shape.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/catalogue-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 06-catalogue-pim/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { j, ok, pause, kase, expect, near, freshShop, finish } = H;
const RUN = 'ca' + (Date.now() % 1e10).toString(36);
/** the first object anywhere in `o` whose item_id is `id` */
function find(o, id) { if (!o || typeof o !== 'object') return null; if (o.item_id === id) return o; for (const k of Object.keys(o)) { const f = find(o[k], id); if (f) return f; } return null; }
/** the sentence every rate door says (lib/rate-door.js RATE_ASK_OWNER) and the code the client branches on */
const RATE_SENTENCE = 'Ask the owner or a manager to set the tax rate.', RATE_CODE = 'TILL_RATE_OWNER_ONLY';
/** a co-assist of the shop that is NOT a manager (hat 'act', the counter's cashier): added by the owner, signed in with the local code (DEV_OTP) */
async function cashierOf(shop, tag) {
  const key = 'cash' + tag, username = key + '@' + shop.name.split(' ').pop();
  ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: 'Cashier ' + tag, actor_key: key, email: key + '@local.test', access_level: 'editor', hat: 'act' } }), 'add the cashier');
  ok(await j('/api/actors/check-login?username=' + encodeURIComponent(username)), 'ask for the cashier code');
  return ok(await j('/api/actors/login', { method: 'POST', body: { username, otp: H.ENTITY_OTP } }), 'cashier signs in').b.token;
}
/** the ONE refusal shape of a rate door: 403, code + message + may/why + the Problem fields, and nothing of the caller's value echoed */
function expectRateRefusal(r, echoed) {
  const b = r.b || {};
  expect(r.status === 403, 'HTTP ' + r.status + ' ' + JSON.stringify(b).slice(0, 200));
  expect(b.code === RATE_CODE && b.message === RATE_SENTENCE && b.may === false && b.why === RATE_SENTENCE, 'shape ' + JSON.stringify({ code: b.code, message: b.message, may: b.may, why: b.why }));
  expect(b.status === 403 && !!b.type && !!b.title && !!b.detail, 'not a Problem body: ' + JSON.stringify(Object.keys(b)));
  expect(!JSON.stringify(b).includes(echoed), 'the answer echoes the caller value ' + echoed);
}
const num = (v) => (v && typeof v === 'object') ? (v.amount != null ? Number(v.amount) : NaN) : (v == null || v === '' ? NaN : Number(v));

/* the constants every new case leans on (each fallback its own name) */
const FAKE_GSTIN = '27AAPFU0939F1ZV';   /* the checksum-valid sample the tests already use (lib/profile.taxIdRefusal) */
const SLAB_OWN_RATE = 12, SLAB_CATEGORY_RATE = 5, OWN_USE_QTY = 10, BILL_LINE_QTY = 6, SMUGGLED_PRICE = 99, UNIT_PRICE = 100;
const TAX_MISSING_CODE = /tax[_ ]missing|no[_ ]slab|no[_ ]rate|unrated/i;
/** one definition (slab, category, offer) written through its route; the id comes back */
const definition = async (shop, body) => ok(await j('/api/definitions', { method: 'POST', token: shop.token, body }), 'definition ' + body.name).b.definition.definition_id;
/** the tax slab each line resolves to (POST /api/tax/rate): { lines: [{ slab, source, gst_rate }] } */
const rate = async (shop, ids) => ok(await j('/api/tax/rate', { method: 'POST', token: shop.token, body: { lines: ids.map((id, key) => ({ key: String(key), item_id: id, qty: 1 })) } }), 'tax rate').b;
const productId = async (shop, item_data) => ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data } }), 'product ' + item_data.name).b.item.item_id;

(async () => {
  console.log('\n── catalogue truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN + 'a', 'Catalogue truth');

  /** a shop WITH a GSTIN and a slab shelf: one product citing its own slab, one that only sits in a category with a slab, one with neither (made once) */
  let gst = null;
  const gstFixture = () => gst || (gst = (async () => {
    const shop = await freshShop(RUN + 'b', 'Catalogue GST');
    ok(await j('/api/entities/profile', { method: 'PATCH', token: shop.token, body: { gstn: FAKE_GSTIN } }), 'gstin');
    const own = { name: 'GST ' + SLAB_OWN_RATE + '% ' + RUN }, inherited = { name: 'GST ' + SLAB_CATEGORY_RATE + '% ' + RUN };
    own.id = await definition(shop, { kind: 'tax', name: own.name, status: 'live', rules: { rate: SLAB_OWN_RATE } });
    inherited.id = await definition(shop, { kind: 'tax', name: inherited.name, status: 'live', rules: { rate: SLAB_CATEGORY_RATE } });
    const cat = await definition(shop, { kind: 'category', name: 'Grains ' + RUN, status: 'live', rules: { default_slab: inherited.id } });
    const item = (tag, extra) => productId(shop, Object.assign({ name: tag + ' ' + RUN, unit: 'piece', price: UNIT_PRICE }, extra));
    return { shop, slabOwn: own, slabCategory: inherited,
      both: await item('Both', { tax_slab: own.id, categories: [cat] }), viaCategory: await item('Via category', { categories: [cat] }), none: await item('No slab') };
  })());
  /** an own-use item bought through the supplies routes: its id, and the net stock moved (read from the movement log, never written) */
  const ownUse = async (name, tag) => {
    const sup = ok(await j('/api/supplies', { method: 'POST', token: A.token, body: { name, unit: 'piece', keep_stock: true } }), 'supply').b.supply, id = sup.supply_item_id || sup.item_id;
    ok(await j('/api/supplies/purchase', { method: 'POST', token: A.token, body: { ref: RUN + '-' + tag, lines: [{ name, unit: 'piece', qty: OWN_USE_QTY, cost: 5 }] } }), 'purchase');
    return { id, moved: await supplyMoved(id) };
  };
  const supplyMoved = async (id) => {
    const pg = new Client({ connectionString: H.DB }); await pg.connect();
    try { return (await pg.query(`SELECT coalesce(sum(qty), 0)::float AS n FROM stock_movement WHERE entity_id = $1 AND item_id = $2 AND item_kind = 'supply'`, [A.entity, id])).rows[0].n; }
    finally { await pg.end(); }
  };
  const supplierShop = async (tag) => {
    const email = tag + '@local.test';
    ok(await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'Catalogue Supplier ' + tag, user_id: tag } }), 'supplier register');
    const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: H.ENTITY_OTP } }), 'supplier verify').b;
    ok(await j('/api/governance/country-setup', { method: 'PUT', token: v.token, body: { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } } }), 'supplier country');
    return { token: v.token, bridge: v.entity.bridge_id };
  };
  /** a rail invoice from supplier S to shop B: the chit id the buyer reads */
  const billFrom = async (S, B, ref, name, qty) => ok(await j('/api/chits/send', { method: 'POST', token: S.token, body: { recipients: [{ display_name: B.name, bridge_id: B.bridge, kind: 'to' }],
    purpose: 'invoice', subject: 'Invoice ' + ref, manual_subject: 'Invoice ' + ref, client_ref: ref, business_json: { bill_no: ref, billed_at: new Date().toISOString() },
    line_items: [{ particulars: name, quantity: qty, unit: 'piece', price: 20, total: qty * 20 }] } }), 'supplier sends ' + ref).b.chit_id;
  const make = (item_data) => j('/api/products', { method: 'POST', token: A.token, body: { item_data } });
  await kase('CA-04', 'a price typed incl. 118 at 18% stores excl. 100 and tax_basis = included', async () => {
    const r = ok(await make({ name: 'Incl item', unit: 'piece', price: 118, tax_basis: 'included', gst_rate: 18 }), 'create').b, d = r.item.item_data || {};
    const excl = d.price_excl != null ? d.price_excl : d.price_excluding;
    expect(d.tax_basis === 'included' && near(num(excl), 100), 'stored ' + JSON.stringify({ price: d.price, price_excl: excl, tax_basis: d.tax_basis }));
  }, 'the price model (excl + incl + tax_basis) is not built (DECISIONS 18 Oct)');
  await kase('CA-05', 'an IN packaged item priced above its MRP is refused with a sentence', async () => {
    const r = await make({ name: 'Packed item', unit: 'piece', price: 105, mrp: 100 });
    expect(r.status >= 400 && r.status < 500 && !!(r.b.message || r.b.error), 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 160));
  }, 'MRP ceiling not built');
  await kase('CA-12', 'one product, one price: the products list and the public view agree', async () => {
    const id = ok(await make({ name: 'One price', unit: 'piece', price: 60 }), 'create').b.item.item_id;
    const mine = find(ok(await j('/api/products?limit=200', { token: A.token }), 'list').b, id);
    const pub = find(ok(await j('/api/catalogue/' + A.bridge), 'public view').b, id);
    expect(mine && pub, 'item missing: list ' + !!mine + ' · public ' + !!pub);
    const a = num((mine.item_data || mine).price), b = num((pub.item_data || pub).price);
    expect(near(a, 60) && near(b, 60), 'list ' + a + ' · public ' + b + ' (expected 60 on both)');
  });
  await kase('CA-15', 'a blank price is never stored as 0 (free): refused in words, or kept unpriced', async () => {
    const r = await make({ name: 'No price yet', unit: 'piece' });
    if (r.status >= 400) { expect(r.status < 500 && !!r.b.message, 'HTTP ' + r.status + ' with no sentence'); return 'refused: ' + r.b.message; }
    const id = r.b.item.item_id, mine = find(ok(await j('/api/products?limit=200', { token: A.token }), 'list').b, id);
    const pub = find(ok(await j('/api/catalogue/' + A.bridge), 'public view').b, id);
    const a = mine && num((mine.item_data || mine).price), b = pub && num((pub.item_data || pub).price);
    expect(mine && a !== 0 && b !== 0, 'list price ' + a + ' · public price ' + b + ' (a number 0 reads as free)');
  });
  const SEEDED = 'seed-slab-5', ASKED = 'asked-slab-18';
  await kase('CA-16', "a cashier's PUT /api/definitions/:id that changes a category's rate is refused 403 in the one shape, and the category is untouched", async () => {
    const owner = ok(await j('/api/definitions', { method: 'POST', token: A.token, body: { kind: 'category', name: 'Rate door ' + RUN, rules: { default_slab: SEEDED } } }), 'owner creates the category').b.definition;
    const cashier = await cashierOf(A, 'a');
    const r = await j('/api/definitions/' + owner.definition_id, { method: 'PUT', token: cashier, body: { rules: { default_slab: ASKED } } });
    expectRateRefusal(r, ASKED);
    const after = ok(await j('/api/definitions/' + owner.definition_id, { token: A.token }), 'read it back').b;
    expect(after.definition.current_version === owner.current_version && after.versions.length === 1, 'a version was written: ' + JSON.stringify(after.versions.map((v) => v.version)));
    const born = await j('/api/definitions', { method: 'POST', token: cashier, body: { kind: 'category', name: 'Cashier born ' + RUN, rules: { default_slab: ASKED } } });
    expectRateRefusal(born, ASKED);
  });
  await kase('CA-17', "a cashier's PUT /api/catalogue-face that changes the shop default rate is refused 403 in the one shape, and the face is untouched", async () => {
    ok(await j('/api/catalogue-face', { method: 'PUT', token: A.token, body: { face: { purpose: 'shop', tax: { default_slab: SEEDED } } } }), 'owner saves the face');
    const cashier = await cashierOf(A, 'b');
    const r = await j('/api/catalogue-face', { method: 'PUT', token: cashier, body: { face: { purpose: 'shop', tax: { default_slab: ASKED } } } });
    expectRateRefusal(r, ASKED);
    const after = ok(await j('/api/catalogue-face', { token: A.token }), 'read it back').b;
    expect(after.face && after.face.tax && after.face.tax.default_slab === SEEDED, 'the default moved: ' + JSON.stringify(after.face));
    const same = await j('/api/catalogue-face', { method: 'PUT', token: cashier, body: { face: { purpose: 'shop', tax: { default_slab: SEEDED }, note: 'edited by the cashier' } } });
    expect(same.status === 200, 'a save that leaves the rate alone should pass: HTTP ' + same.status);
  });

  /* ── CA-01 · CA-02 · CA-03: tax slabs, on a shop WITH a GSTIN (the tax shelf is read only for one: lib/tax-shelf.js "no GSTIN, no GST") ── */
  await kase('CA-01', 'a product with its own slab and one that only has a category slab: each resolves to its own, with the source named', async () => {
    const g = await gstFixture(), r = await rate(g.shop, [g.both, g.viaCategory]);
    const [own, inherited] = r.lines;
    expect(own.source === 'product' && own.slab === g.slabOwn.name && near(own.gst_rate, SLAB_OWN_RATE), 'product line: ' + JSON.stringify(own));
    expect(inherited.source === 'category' && inherited.slab === g.slabCategory.name && near(inherited.gst_rate, SLAB_CATEGORY_RATE), 'category line: ' + JSON.stringify(inherited));
  });
  await kase('CA-02', 'a GSTIN shop, an item with no slab: the tax answer carries a "tax missing" warning code, never a quiet 0%', async () => {
    const g = await gstFixture();
    const r = await j('/api/tax/compute', { method: 'POST', token: g.shop.token, body: { lines: [{ item_id: g.none, qty: 1 }] } });
    expect(TAX_MISSING_CODE.test(JSON.stringify(r.b)), 'HTTP ' + r.status + ' with no tax-missing code: ' + JSON.stringify(r.b).slice(0, 200));
  }, 'W27 / Q-W27 · ACCOUNTING-BACKLOG ACC-4 (5a): no "tax missing" code on a sale line with no slab; the summary row still reads Tax invoice');
  await kase('CA-03', 'the whole catalogue: the Home tax card serves the count of items with no slab as a figure', async () => {
    const g = await gstFixture(), card = ok(await j('/api/facts/tax-lab', { token: g.shop.token }), 'tax-lab card').b;
    const f = card.figures || {};
    expect(f.no_slab === 1 && f.products === 3, 'figures ' + JSON.stringify(f) + ' (expected 1 of 3 with no slab)');
  });

  /* ── CA-07 · CA-09 · CA-11: categories, supplies and offers, on the plain shop ── */
  await kase('CA-07', 'retiring a category that still holds a product: refused, or the product is moved first', async () => {
    const cat = await definition(A, { kind: 'category', name: 'Retire me ' + RUN, status: 'live' });
    const id = ok(await make({ name: 'Stays here ' + RUN, unit: 'piece', price: 10, categories: [cat] }), 'product').b.item.item_id;
    const gone = await j('/api/definitions/' + cat, { method: 'DELETE', token: A.token });
    if (gone.status >= 400) return 'refused: HTTP ' + gone.status;
    const cited = (find(ok(await j('/api/products?limit=200', { token: A.token }), 'list').b, id).item_data || {}).categories || [];
    expect(!(cited.length === 1 && cited[0] === cat), 'category retired (HTTP ' + gone.status + ') and the product still cites only it: ' + JSON.stringify(cited));
  }, 'W30 · CATALOGUE-BACKLOG CAT-3: DELETE /api/definitions/:id retires a category with products in it (only a tax slab is guarded, routes/definitions.js:452)');
  await kase('CA-08', 'an own-use item: bought, the stock row rises, and it is on neither the product list nor the public shop', async () => {
    const own = await ownUse('Flour ' + RUN, 'P8');
    expect(own.moved === OWN_USE_QTY, 'stock moved ' + own.moved + ' (expected ' + OWN_USE_QTY + ')');
    const seen = JSON.stringify(ok(await j('/api/products?limit=200', { token: A.token }), 'list').b) + JSON.stringify(ok(await j('/api/catalogue/' + A.bridge), 'public view').b);
    expect(!seen.includes(own.id) && !seen.includes('Flour ' + RUN), 'the supply shows on the product list or the public shop');
  });
  await kase('CA-08b', 'a supplier bill line, marked "use", links to the own-use item and its stock rises', async () => {
    const name = 'Oil ' + RUN, own = await ownUse(name, 'P8b'), S = await supplierShop(RUN + 's');
    const listed = await j('/api/relationships/suppliers', { method: 'POST', token: A.token, body: { supplier_bridge_id: S.bridge, supply_kind: 'own_use' } });
    if (listed.status !== 409) ok(listed, 'supplier on the list');
    const inv = await billFrom(S, A, RUN + '-B8', name, BILL_LINE_QTY), line = ((ok(await j('/api/chits/' + inv, { token: A.token }), 'read bill').b.detail || {}).line_items || [])[0];
    ok(await j('/api/chits/' + inv + '/use', { method: 'PUT', token: A.token, body: { use: 'use' } }), 'use');
    ok(await j('/api/chits/' + inv + '/deliver-lines', { method: 'POST', token: A.token, body: { rows: [{ line_id: line.line_id, quantity: BILL_LINE_QTY, unit: 'piece', client_ref: RUN + '-B8:0' }] } }), 'goods in');
    await pause(1500);
    const now = await supplyMoved(own.id);
    expect(now === OWN_USE_QTY + BILL_LINE_QTY, 'stock moved ' + now + ' (expected ' + (OWN_USE_QTY + BILL_LINE_QTY) + '): the bill line names no supply of mine');
  }, 'CATALOGUE-BACKLOG CAT-1 (5b) · ST-19: a received bill line carries no supply_item_id, so goods-in cannot raise an own-use item');
  await kase('CA-09', 'a supply item cannot be sold as a product: no price on it, not editable through the products route', async () => {
    const made = ok(await j('/api/supplies', { method: 'POST', token: A.token, body: { name: 'Mop ' + RUN, unit: 'piece', price: SMUGGLED_PRICE } }), 'supply').b.supply;
    expect(!('price' in made) && !('selling_price' in made), 'the supply carries a price: ' + JSON.stringify(made));
    const edit = await j('/api/products/' + (made.supply_item_id || made.item_id), { method: 'PATCH', token: A.token, body: { merge: true, item_data: { price: SMUGGLED_PRICE } } });
    expect(edit.status === 404, 'PATCH /api/products on a supply answered HTTP ' + edit.status);
  });
  await kase('CA-11', 'a live offer that clashes with another live offer is refused in words, and nothing is written', async () => {
    const shelf = 'tiffin-' + RUN, first = 'Tiffin 10% ' + RUN, scope = { scope: 'line', applies_to: { category: shelf } };
    await definition(A, { kind: 'offer', sub_kind: 'percent_off', name: first, status: 'live', confirmed: true, rules: Object.assign({ percent: 10 }, scope) });
    const second = { kind: 'offer', sub_kind: 'amount_off', name: 'Tiffin 5 off ' + RUN, rules: Object.assign({ amount: 5 }, scope) };
    const r = await j('/api/definitions', { method: 'POST', token: A.token, body: Object.assign({ status: 'live', confirmed: true }, second) });
    expect(r.status === 409 && r.b.code === 'OFFER_CLASH', 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect(r.b.message.includes('overlaps "' + first + '"') && /one discount at a time/.test(r.b.message), 'sentence: ' + r.b.message);
    ok(await j('/api/definitions', { method: 'POST', token: A.token, body: Object.assign({ status: 'draft' }, second) }), 'the refused name is free: nothing was stored');
  });

  finish('catalogue-truth', process.env.CATALOGUE_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('catalogue truth could not run:', e && e.message); process.exit(2); });

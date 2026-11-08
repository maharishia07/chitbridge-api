'use strict';
/**
 * tests/product-search-truth.realstack.cjs — CAT-313/314 over HTTP: GET /api/products?q= as the owner and as a cost-blind editor.
 *
 * PS-1 owner finds a product by its name, and sees its cost
 * PS-2 a cost-blind editor (co-assist, access_level editor, no "Sees costs") searching the EXACT hidden cost (4242.5, 4242.50, 4242) gets 0 rows, total 0
 * PS-3 the same editor finds the product by name and the row carries no cost (the list strip is unchanged)
 * PS-4 a field name ("cost", "unit_cost") finds nothing for the editor and for the owner
 * PS-5 q='%' and q='_' match only a product holding that literal
 * Shares tests/lib/truth-harness.cjs; the api and database are the local ones (CI: the integration S41 job's api on :3000). Run: node tests/product-search-truth.realstack.cjs
 * CARD 06-catalogue-pim/README
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'ps' + (Date.now() % 1e10).toString(36);
const SECRET = 4242.5;
const names = (r) => ((r.b && r.b.items) || []).map((item) => item.item_data && item.item_data.name);
const search = (token, q) => j('/api/products?q=' + encodeURIComponent(q), { token });

(async () => {
  console.log('\n── product search truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const shop = await freshShop(RUN, 'Search truth');
  const make = async (item_data) => ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data } }), 'product ' + item_data.name);
  const dosa = 'Masala Dosa ' + RUN, pure = '100% pure ghee ' + RUN, plain = 'Plain tea ' + RUN;
  await make({ name: dosa, sku: 'D-' + RUN, price: 70, cost: SECRET });
  await make({ name: pure, sku: 'G_1-' + RUN, price: 50 });
  await make({ name: plain, sku: 'T-' + RUN, price: 20 });
  const key = 'ed' + RUN, username = key + '@' + shop.name.split(' ').pop();
  ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: 'Editor ' + RUN, actor_key: key, email: key + '@local.test', access_level: 'editor', hat: 'act' } }), 'add the editor');
  ok(await j('/api/actors/check-login?username=' + encodeURIComponent(username)), 'ask for the editor code');
  const editor = ok(await j('/api/actors/login', { method: 'POST', body: { username, otp: H.ENTITY_OTP } }), 'editor signs in').b.token;

  await kase('PS-1', 'owner finds the product by name and sees its cost', async () => {
    const r = await search(shop.token, 'masala dosa ' + RUN);
    expect(names(r).join() === dosa, 'found ' + names(r).join());
    expect(JSON.stringify(r.b).includes('4242'), 'the owner should see the cost');
  });
  await kase('PS-2', 'a cost-blind editor searching the exact hidden cost gets 0 rows', async () => {
    for (const q of ['4242.5', '4242.50', '4242']) {
      const r = await search(editor, q);
      expect(r.status === 200 && names(r).length === 0 && r.b.total === 0, 'q=' + q + ' HTTP ' + r.status + ' rows ' + names(r).join() + ' total ' + r.b.total);
    }
  });
  await kase('PS-3', 'the editor finds it by name, and the row has no cost', async () => {
    const r = await search(editor, 'masala dosa ' + RUN);
    expect(names(r).join() === dosa, 'found ' + names(r).join());
    expect(!JSON.stringify(r.b).includes('4242'), 'the editor answer carries the cost');
  });
  await kase('PS-4', 'a field name matches nothing, for the editor and the owner', async () => {
    for (const token of [editor, shop.token]) for (const q of ['unit_cost', '"cost"', 'item_data']) expect(names(await search(token, q)).length === 0, 'q=' + q + ' matched');
  });
  await kase('PS-5', "q='%' and q='_' match only the product holding that literal", async () => {
    for (const q of ['%', '_']) expect(names(await search(shop.token, q)).join() === pure, 'q=' + q + ' found ' + names(await search(shop.token, q)).join());
  });

  finish('product-search-truth', process.env.PRODUCT_SEARCH_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('product search truth could not run:', e && e.message); process.exit(2); });

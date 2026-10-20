'use strict';
/**
 * tests/catalogue-truth.realstack.cjs — CATALOGUE TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §5 "Catalogue").
 *
 * TB-SELL-7 / CAT-5. CA-04 a price typed incl. keeps both sides + tax_basis · CA-05 above the MRP is refused · CA-12 one product, one price on every door ·
 * CA-15 a blank price is UNPRICED, never 0 / free. A `gap:` FAIL is a RECORDED finding (CATALOGUE-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/catalogue-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 06-catalogue-pim/README
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, near, freshShop, finish } = H;
const RUN = 'ca' + (Date.now() % 1e10).toString(36);
/** the first object anywhere in `o` whose item_id is `id` */
function find(o, id) { if (!o || typeof o !== 'object') return null; if (o.item_id === id) return o; for (const k of Object.keys(o)) { const f = find(o[k], id); if (f) return f; } return null; }
const num = (v) => (v && typeof v === 'object') ? (v.amount != null ? Number(v.amount) : NaN) : (v == null || v === '' ? NaN : Number(v));

(async () => {
  console.log('\n── catalogue truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN + 'a', 'Catalogue truth');
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
  finish('catalogue-truth', process.env.CATALOGUE_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('catalogue truth could not run:', e && e.message); process.exit(2); });

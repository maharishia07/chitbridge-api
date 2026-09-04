/* The retire guard: refused with counts while anything cites the slab; accepted with a takeover that re-points first. */
const assert = require('assert');
const C = require('../lib/slab-cites');
let n = 0, f = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; }, (e) => { f++; console.log('FAIL', name, e.message); });

/* a fake db that answers the three SQL shapes the module issues */
const fakeDb = (state) => ({
  query: async (sql, params) => {
    if (/count\(\*\)/.test(sql) && /catalogue_items/.test(sql)) return { rows: [{ n: state.products.filter((p) => p.tax_slab === params[0]).length }] };
    if (/count\(\*\)/.test(sql) && /definition_version/.test(sql)) return { rows: [{ n: state.categories.filter((c) => c.default_slab === params[0]).length }] };
    if (/UPDATE catalogue_items/.test(sql)) { const patch = JSON.parse(params[1]); let k = 0; state.products.forEach((p) => { if (p.tax_slab === params[0]) { Object.assign(p, patch); k++; } }); return { rowCount: k }; }
    if (/UPDATE definition_version/.test(sql)) { let k = 0; state.categories.forEach((c) => { if (c.default_slab === params[0]) { c.default_slab = params[1]; k++; } }); return { rowCount: k }; }
    throw new Error('unexpected sql ' + sql.slice(0, 40));
  },
});

(async () => {
  await t('nothing cites it → proceed', async () => {
    const g = await C.guard(fakeDb({ products: [], categories: [] }), 'old', null, async () => null);
    assert.strictEqual(g, null);
  });
  await t('cited, no takeover → 409 with the counts', async () => {
    const st = { products: [{ tax_slab: 'old' }, { tax_slab: 'old' }, { tax_slab: 'x' }], categories: [{ default_slab: 'old' }] };
    const g = await C.guard(fakeDb(st), 'old', null, async () => null);
    assert.strictEqual(g.status, 409); assert.strictEqual(g.body.products, 2); assert.strictEqual(g.body.categories, 1);
    assert.strictEqual(st.products[0].tax_slab, 'old', 'nothing moved');
  });
  await t('takeover = itself → 400', async () => {
    const g = await C.guard(fakeDb({ products: [{ tax_slab: 'old' }], categories: [] }), 'old', 'old', async () => null);
    assert.strictEqual(g.status, 400);
  });
  await t('takeover not live → 400, nothing moved', async () => {
    const st = { products: [{ tax_slab: 'old' }], categories: [] };
    const g = await C.guard(fakeDb(st), 'old', 'ghost', async () => null);
    assert.strictEqual(g.status, 400); assert.strictEqual(st.products[0].tax_slab, 'old');
  });
  await t('takeover live → every citer re-pointed with the travelling copy, then proceed', async () => {
    const st = { products: [{ tax_slab: 'old', gst_rate: 18 }, { tax_slab: 'keep' }], categories: [{ default_slab: 'old' }, { default_slab: 'keep' }] };
    const g = await C.guard(fakeDb(st), 'old', 'IN-GST-5', async (id) => ({ id, name: 'GST 5%', rate: 5 }));
    assert.strictEqual(g.status, 0);
    assert.deepStrictEqual(g.moved, { products: 1, categories: 1 });
    assert.strictEqual(st.products[0].tax_slab, 'IN-GST-5'); assert.strictEqual(st.products[0].gst_rate, 5); assert.strictEqual(st.products[0].tax_slab_name, 'GST 5%');
    assert.strictEqual(st.products[1].tax_slab, 'keep'); assert.strictEqual(st.categories[0].default_slab, 'IN-GST-5'); assert.strictEqual(st.categories[1].default_slab, 'keep');
  });
  console.log(`slab-cites: ${n} passed, ${f} failed`); process.exit(f ? 1 : 0);
})();

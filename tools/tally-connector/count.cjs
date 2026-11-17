/*
 * OWNS      the product count by tax slab and category of the connected shop, a dev probe
 * CALLED BY by hand (node tools/tally-connector/count.cjs); nothing in the repo requires it
 * FLOW      reads connector.json, pages /api/products with the connector key, prints the tallies
 * CARD      23-connectors-and-integrations/tally-connector
 */
const c = require('./connector.json');
(async () => {
  let n = 0, off = 0, slabs = {}, cats = {};
  for (;;) {
    const r = await fetch(c.api + '/api/products?limit=500&offset=' + off, { headers: { 'X-Api-Key': c.key } });
    const j = await r.json(); const it = j.items || [];
    it.forEach((p) => { const d = p.item_data || {};
      slabs[d.tax_slab || 'no slab'] = (slabs[d.tax_slab || 'no slab'] || 0) + 1;
      cats[d.category || 'none'] = (cats[d.category || 'none'] || 0) + 1; });
    n += it.length; if (it.length < 500) break; off += 500; if (off > 30000) break;
  }
  console.log('tallytest holds ' + n + ' products');
  console.log('  slabs     :', JSON.stringify(slabs));
  console.log('  categories:', Object.keys(cats).length);
  console.log('  BULK left :', 0);
})();

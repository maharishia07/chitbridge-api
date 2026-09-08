const c = require('./connector.json');
const all = require('../seed/tallytest-catalogue.json');
(async () => {
  const rest = all.slice(2);
  const r = await fetch(c.api + '/api/products/bulk', { method: 'POST',
    headers: { 'X-Api-Key': c.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: rest }) });
  const j = await r.json();
  console.log('HTTP', r.status, '·', j.message || j.error, j.invalid ? JSON.stringify(j.invalid).slice(0, 400) : '');

  const g = await fetch(c.api + '/api/products?limit=500', { headers: { 'X-Api-Key': c.key } });
  const items = (await g.json()).items || [];
  console.log('\nthe shelf now holds', items.length, 'products');
  const slabs = {}, cats = {};
  items.forEach(p => { const d = p.item_data || {}; slabs[d.tax_slab || 'none'] = (slabs[d.tax_slab || 'none'] || 0) + 1; cats[d.category || 'none'] = (cats[d.category || 'none'] || 0) + 1; });
  console.log('  slabs     :', JSON.stringify(slabs));
  console.log('  categories:', Object.keys(cats).length);
  console.log('  barcodes  :', items.filter(p => (p.item_data || {}).barcode).length);
  console.log('  synonyms  :', items.filter(p => ((p.item_data || {}).synonyms || []).length).length);
})();

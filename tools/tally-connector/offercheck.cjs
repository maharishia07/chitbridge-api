const c = require('./connector.json');
(async () => {
  /* real rows from the shop, one per offer category */
  const wanted = ['Spices', 'Edible oil', 'Biscuits', 'Rice & grains'];
  const lines = [];
  for (const cat of wanted) {
    const r = await fetch(c.api + '/api/products?q=' + encodeURIComponent(cat === 'Rice & grains' ? 'Ponni raw rice' : cat === 'Edible oil' ? 'Gingelly oil' : cat === 'Biscuits' ? 'Marie biscuit' : 'Sambar powder') + '&limit=20',
      { headers: { 'X-Api-Key': c.key } });
    const items = (await r.json()).items || [];
    const hit = items.find((p) => (p.item_data || {}).category === cat);
    if (!hit) { console.log('no product found in ' + cat); continue; }
    const d = hit.item_data;
    const price = (d.price && typeof d.price === 'object') ? d.price.amount : d.price;
    lines.push({ key: String(lines.length), item_id: hit.item_id, sku: d.code, name: d.name,
                 categories: [d.category], qty: cat === 'Biscuits' ? 3 : cat === 'Rice & grains' ? 5 : 2, unitPrice: price });
  }
  console.log('basket:');
  lines.forEach((l) => console.log('  ' + l.qty + ' x ' + l.name + '  @ Rs ' + l.unitPrice));

  const r = await fetch(c.api + '/api/offers/explain', { method: 'POST',
    headers: { 'X-Api-Key': c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) });
  const j = await r.json();
  console.log('\noffers the shop now has: ' + j.offers_considered);
  console.log('subtotal Rs ' + j.subtotal + '  ->  total Rs ' + j.total);
  (j.explain || []).forEach((a) => console.log('   - ' + a.label + ': ' + a.amount + '   (' + a.why + ')'));
  if (!(j.explain || []).length) console.log('   NOTHING FIRED');
})();

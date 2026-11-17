/*
 * OWNS      the count of products sitting exactly on their category price ceiling in the connected shop, a dev probe
 * CALLED BY by hand (node tools/tally-connector/pricecheck.cjs); nothing in the repo requires it
 * FLOW      reads connector.json, pages /api/products 500 at a time, groups the prices by category, prints the maximum and how many products sit on it
 * CARD      23-connectors-and-integrations/tally-connector
 */
const c = require('./connector.json');
(async () => {
  let all = [], off = 0;
  for (;;) { const r = await fetch(c.api + '/api/products?limit=500&offset=' + off, { headers: { 'X-Api-Key': c.key } });
    const it = (await r.json()).items || []; all = all.concat(it); if (it.length < 500) break; off += 500; }
  const price = (d) => (d.price && typeof d.price === 'object') ? d.price.amount : d.price;
  const byCat = {};
  all.forEach((p) => { const d = p.item_data || {}; (byCat[d.category] = byCat[d.category] || []).push(price(d)); });
  console.log('how many products sit exactly ON the category ceiling (my clamp saturating):');
  Object.keys(byCat).sort().forEach((c2) => {
    const v = byCat[c2], max = Math.max(...v), at = v.filter((x) => x === max).length;
    console.log('  ' + (c2 + '                ').slice(0, 16) + ' max Rs ' + String(max).padStart(6) + '   ' + String(at).padStart(4) + ' of ' + String(v.length).padStart(5) + ' at the ceiling');
  });
})();

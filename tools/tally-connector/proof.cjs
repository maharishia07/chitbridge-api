const c = require('./connector.json');
const H = { 'X-Api-Key': c.key };
const get = async (qs) => (await fetch(c.api + '/api/products' + qs, { headers: H })).json();
(async () => {
  const first = await get('?limit=500');
  console.log('page 1 : items=' + (first.items || []).length + '  total=' + first.total + '  truncated=' + first.truncated);

  /* something that is NOT in the first 500 — take one from the far end of the shelf */
  const far = await get('?limit=5&offset=9000');
  const target = (far.items || [])[0];
  const d = target.item_data || {};
  console.log('\na product at offset 9000: "' + d.name + '"  code=' + d.code);

  const inPage1 = (first.items || []).some((p) => (p.item_data || {}).code === d.code);
  console.log('is it in the first 500?  ' + (inPage1 ? 'yes (pick another)' : 'NO — so the browser cannot have it'));

  const hit = await get('?q=' + encodeURIComponent(d.name) + '&limit=50');
  const found = (hit.items || []).some((p) => (p.item_data || {}).code === d.code);
  console.log('server search by name  : ' + (hit.items || []).length + ' hit(s), contains it? ' + (found ? 'YES' : 'NO'));

  const byCode = await get('?q=' + encodeURIComponent(d.code) + '&limit=50');
  console.log('server search by code  : ' + (byCode.items || []).length + ' hit(s), contains it? '
    + ((byCode.items || []).some((p) => (p.item_data || {}).code === d.code) ? 'YES' : 'NO'));

  const bc = d.barcode ? await get('?q=' + encodeURIComponent(d.barcode) + '&limit=50') : { items: [] };
  console.log('server search by barcode: ' + (bc.items || []).length + ' hit(s)');

  const tamil = await get('?q=' + encodeURIComponent('thakkali') + '&limit=5');
  console.log('server search "thakkali": ' + (tamil.items || []).length + ' hit(s) — ' + ((tamil.items || [])[0] || {} ).item_data?.name);
})();

const c = require('./connector.json');
const all = require('../seed/tallytest-catalogue.json');
(async () => {
  const r = await fetch(c.api + '/api/products/bulk', { method: 'POST',
    headers: { 'X-Api-Key': c.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: all.slice(0, 2) }) });
  const t = await r.text();
  console.log('HTTP', r.status);
  console.log(t.slice(0, 900));
})();

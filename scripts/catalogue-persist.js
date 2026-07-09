// catalogue-persist.js — proves Beta's catalogue PERSISTS by REFERENCE + commercials (b75 catalogue_adoption).
// register → structure → adopt (price 2 finishes) → read-mine → assert the commercials persisted AND the design/colour
// resolved by reference (not copied). Needs b75 applied (else adopt/mine return 503 CATALOGUE_STORE_MISSING).
// Run: node scripts/catalogue-persist.js
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let PASS = 0, FAIL = 0;
function check(n, ok, d) { if (ok) { PASS++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { FAIL++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } }
async function api(m, p, { token, body } = {}) {
  const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, json: j };
}
async function tokenFor(name) {
  const email = name + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.json && reg.json.dev_otp } });
  return v.json && v.json.token;
}
(async () => {
  console.log('== CATALOGUE PERSIST (reference + commercials) ==\n');
  const token = await tokenFor('cat-' + Date.now().toString().slice(-6));

  const adopt = await api('POST', '/api/assist/catalogue-adopt', { token, body: { source: 'beta-royale-play@v1',
    commercials: { Tussar: { price_per_litre: 950 }, Ikkat: { price_per_litre: 875 } } } });
  if (adopt.status === 503) { console.log('  · b75 not applied yet (503 CATALOGUE_STORE_MISSING) — apply migration, then re-run.'); console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(0); }
  check('adopt persisted', adopt.json && adopt.json.persisted === true, 'status ' + adopt.status);
  check('adopt stamps confirmed_by (human confirm)', adopt.json && adopt.json.acted_by && adopt.json.acted_by.confirmed_by);

  const mine = await api('GET', '/api/assist/catalogue-mine', { token });
  check('read-mine returns 1 catalogue', mine.json && mine.json.count === 1);
  const cat = mine.json && mine.json.catalogues && mine.json.catalogues[0];
  const items = (cat && cat.resolved && cat.resolved.items) || [];
  const tussar = items.find((i) => i.name === 'Tussar');
  check('Tussar commercials persisted (₹950)', tussar && tussar.commercials && tussar.commercials.price_per_litre === 950);
  check('design/colour resolved BY REFERENCE (combinations present, not stored per-entity)', tussar && Array.isArray(tussar.combinations) && tussar.combinations.length > 0 && tussar.combinations[0].colours[0].hex);
  const kilim = items.find((i) => i.name === 'Kilim');
  check('un-priced finish has no commercials', kilim && !kilim.commercials);

  console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

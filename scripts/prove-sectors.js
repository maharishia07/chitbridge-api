// prove-sectors.js — LIVE proof the tool is GENERIC: switching the SECTOR (vertical) re-resolves sector-specific
// certifications/clearances (b95: food/textiles/electronics), same engine as chemical. Run AFTER b95.
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }

(async () => {
  console.log('== PROVE SECTORS (generic, not chemical-only) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'sec-' + ts + '@test.com';
  const r1 = await api('POST', '/api/entities/register', { body: { email } }).catch(()=>({}));
  const reg = await (await fetch(B + '/api/entities/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) })).json();
  const ver = await (await fetch(B + '/api/entities/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, otp: reg.dev_otp }) })).json();
  const token = ver.token; chk('login', !!token);

  async function lane(vertical, dest) {
    const rd = await api('GET', '/api/governance/readiness?destination=' + dest + '&vertical=' + vertical + '&origin=IN', { token });
    const keys = (rd.j && rd.j.standards) || [];
    const titles = ((rd.j && rd.j.clearances) || []).map(c => c.title);
    return { keys, titles };
  }
  const has = (a, k) => a.indexOf(k) >= 0;

  const chem = await lane('paint', 'EU');
  chk('CHEMICAL → REACH/SDS present (baseline still works)', has(chem.keys,'reach') && has(chem.keys,'sds'), chem.keys.join(','));

  const food = await lane('food', 'EU');
  chk('FOOD → HACCP + FSSAI (Certification) resolve', has(food.keys,'haccp') && has(food.keys,'fssai'), food.keys.join(','));
  chk('FOOD → EU health cert (per-shipment) resolves for EU', has(food.keys,'eu-health'));
  chk('FOOD does NOT leak chemical standards (no REACH)', !has(food.keys,'reach'), food.keys.join(','));

  const tex = await lane('textiles', 'US');
  chk('TEXTILES → OEKO-TEX + GOTS resolve', has(tex.keys,'oeko-tex') && has(tex.keys,'gots'), tex.keys.join(','));
  chk('TEXTILES → flammability resolves for US', has(tex.keys,'flammability'));

  const elec = await lane('electronics', 'EU');
  chk('ELECTRONICS → CE/RoHS + WEEE resolve for EU', has(elec.keys,'ce-rohs') && has(elec.keys,'weee'), elec.keys.join(','));

  // universal thread runs through every sector
  chk('ISO 9001 (universal) appears in ALL sectors', has(chem.keys,'iso-9001') && has(food.keys,'iso-9001') && has(tex.keys,'iso-9001') && has(elec.keys,'iso-9001'));

  console.log('\n  food certs:', food.titles.join(' · '));
  console.log('  textiles certs:', tex.titles.join(' · '));
  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });

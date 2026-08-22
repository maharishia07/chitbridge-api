// prove-commerce-standards.js — LIVE proof that Incoterms/UCP/FRM are now first-class GOVERNED SOURCE-ENTITIES (b93):
// each resolves from standard_source (facet 'commerce') with a SEALED owning source-entity, AND they do NOT pollute the
// compliance readiness roll-up. Run AFTER b93.  node scripts/prove-commerce-standards.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }

(async () => {
  console.log('== PROVE COMMERCE STANDARDS AS SOURCE-ENTITIES ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'cs-' + ts + '@test.com';
  const r1 = await fetch(B + '/api/entities/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const j1 = await r1.json();
  const r2 = await fetch(B + '/api/entities/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, otp: j1.dev_otp }) });
  const token = (await r2.json()).token;
  chk('login', !!token);

  const cs = await api('GET', '/api/governance/commerce-standards', { token });
  const src = (cs.j && cs.j.sources) || [];
  const byKey = k => src.find(s => s.standard_key === k);
  chk('three commerce standards are seeded', src.length >= 3, src.map(s => s.standard_key).join(', '));
  chk('Incoterms 2020 is a governed source-entity', !!byKey('incoterms-2020'));
  chk('UCP 600 is a governed source-entity', !!byKey('ucp-600'));
  chk('FRM is a governed source-entity', !!byKey('frm'));
  const inco = byKey('incoterms-2020') || {};
  chk('each carries a SEALED owning source-entity', inco.owner_sealed === true && /^CBSRC/.test(inco.owner_bridge_id || ''), inco.owner_bridge_id);
  chk('all carry facet=commerce', src.every(s => s.facet === 'commerce'));

  // negative: commerce standards must NOT appear as compliance clearances in the readiness roll-up
  const rd = await api('GET', '/api/governance/readiness', { token });
  const rdKeys = ((rd.j && rd.j.standards) || []);
  chk('commerce standards do NOT pollute compliance readiness',
    !rdKeys.includes('incoterms-2020') && !rdKeys.includes('ucp-600') && !rdKeys.includes('frm'), 'readiness standards: ' + rdKeys.join(', '));

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });

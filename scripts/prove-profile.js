// prove-profile.js — LIVE proof of the ENTITY TRADE PROFILE (individual-specific). A domestic-only trader holding only
// ISO 9001 sees exactly ISO 9001 (adopted) + no export standards; switching to export EU + adopting nothing pulls in the
// mandatory regulatory set. Run AFTER b96.  node scripts/prove-profile.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const keys = (rd) => [...new Set(((rd.j && rd.j.clearances) || []).map(c => c.standard))];

(async () => {
  console.log('== PROVE ENTITY TRADE PROFILE ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'prof-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token; chk('login', !!token);

  // 1 · DOMESTIC-only, general trader, adopts ONLY ISO 9001 → sees exactly ISO 9001, no export standards
  await api('PUT', '/api/governance/profile', { token, body: { trade_mode: 'domestic', sectors: ['paint'], adopted: ['iso-9001'] } });
  let rd = await api('GET', '/api/governance/profile/readiness', { token });
  const k1 = keys(rd);
  chk('domestic + adopt ISO 9001 → ISO 9001 present', k1.indexOf('iso-9001') >= 0, k1.join(','));
  chk('a NON-adopted voluntary cert (ISO 14001) is NOT shown', k1.indexOf('iso-14001') < 0, k1.join(','));
  chk('export-only standard (export policy) is NOT shown for domestic', k1.indexOf('exim-policy') < 0, k1.join(','));
  chk('every shown item is tiered mandatory|adopted', ((rd.j && rd.j.clearances) || []).every(c => c.tier === 'mandatory' || c.tier === 'adopted'));

  // 2 · switch to EXPORT to the EU → the mandatory regulatory set appears (export policy, and REACH for chemical)
  await api('PUT', '/api/governance/profile', { token, body: { trade_mode: 'export', markets: ['EU'], sectors: ['paint'], adopted: ['iso-9001'] } });
  rd = await api('GET', '/api/governance/profile/readiness', { token });
  const k2 = keys(rd);
  chk('export EU → export policy now REQUIRED (mandatory)', k2.indexOf('exim-policy') >= 0, k2.join(','));
  chk('export EU chemical → REACH is REQUIRED (mandatory)', k2.indexOf('reach') >= 0, k2.join(','));
  chk('ISO 9001 still shown (adopted)', k2.indexOf('iso-9001') >= 0);

  // 3 · the PATH — a forward roadmap over destinations, current market marked
  const path = await api('GET', '/api/governance/profile/path', { token });
  const lanes = (path.j && path.j.lanes) || [];
  chk('path returns per-destination roadmap', lanes.length >= 3, lanes.length + ' destinations');
  chk('EU is marked as in the profile', lanes.some(l => l.dest_key === 'EU' && l.in_profile === true));
  chk('path lists adoptable voluntary certs', path.j && Array.isArray(path.j.adoptable) && path.j.adoptable.length >= 1, (path.j && path.j.adoptable || []).join(','));

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

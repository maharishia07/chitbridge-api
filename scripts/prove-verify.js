// prove-verify.js — LIVE proof of the TRUST LADDER: declared → documented → verified (registry-checked). Run AFTER
// b92.  node scripts/prove-verify.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const rungOf = (rd, doc) => { const it = ((rd.j && rd.j.clearances) || []).find(c => c.doc === doc); return it && it.rung; };

(async () => {
  console.log('== PROVE TRUST LADDER / MACHINE-VERIFY ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'ver-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token;
  chk('login', !!token);

  // 1 · VERIFIED — machine-check a valid IEC (10 alphanumeric) for exim-policy/iec_code
  const v = await api('POST', '/api/governance/verify', { token, body: { standard_key: 'exim-policy', doc_key: 'iec_code', id_type: 'iec', id_value: 'AAACR1234B' } });
  chk('valid IEC verifies against the registry (hook)', v.status === 200, 'verified ' + (v.j && v.j.verified));
  let rd = await api('GET', '/api/governance/readiness', { token });
  chk('iec_code rung is VERIFIED (registry-checked)', rungOf(rd, 'iec_code') === 'verified', rungOf(rd, 'iec_code'));

  // 2 · a bad ID is refused (not silently "met")
  const bad = await api('POST', '/api/governance/verify', { token, body: { standard_key: 'exim-policy', doc_key: 'hs_code', id_type: 'iec', id_value: '123' } });
  chk('invalid registry ID is REFUSED (422)', bad.status === 422, 'status ' + bad.status);

  // 3 · DOCUMENTED — a gathered doc backed by a chit is one rung below verified
  await api('POST', '/api/governance/compliance', { token, body: { standard_key: 'exim-policy', doc_key: 'hs_code', evidence_ref: '11111111-2222-3333-4444-555555555555', status: 'gathered' } });
  rd = await api('GET', '/api/governance/readiness', { token });
  chk('a document-backed clearance is DOCUMENTED', rungOf(rd, 'hs_code') === 'documented', rungOf(rd, 'hs_code'));

  // 4 · DECLARED — a bare claim (no document) is the lowest rung
  await api('POST', '/api/governance/compliance', { token, body: { standard_key: 'exim-policy', doc_key: 'incoterms', evidence_ref: 'FOB', status: 'gathered' } });
  rd = await api('GET', '/api/governance/readiness', { token });
  chk('a bare claim is DECLARED (lowest rung)', rungOf(rd, 'incoterms') === 'declared', rungOf(rd, 'incoterms'));

  // 5 · the summary counts the rungs
  chk('summary reports verified/documented counts', rd.j && rd.j.summary && rd.j.summary.verified >= 1 && rd.j.summary.documented >= 1,
    'verified=' + (rd.j && rd.j.summary && rd.j.summary.verified) + ' documented=' + (rd.j && rd.j.summary && rd.j.summary.documented));

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

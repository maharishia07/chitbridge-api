/** @covers FR-T2 — a well-formed registry ID is not treated as verified without a provider */
// prove-verify.js — LIVE proof of HONEST verification. Without a KYB provider connected (prod default), a well-formed ID
// is accepted but is NOT "verified" — it is a format-checked claim (rung 'declared'). A malformed ID is refused (422).
// The 'verified' rung is reserved for a real registry confirmation (set CB_KYB_PROVIDER + keys to make it real).
// Run AFTER b92.  node scripts/prove-verify.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const rungOf = (rd, doc) => { const it = ((rd.j && rd.j.clearances) || []).find(c => c.doc === doc); return it && it.rung; };

(async () => {
  console.log('== PROVE HONEST VERIFICATION ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'ver-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token;
  chk('login', !!token);

  // 1 · a well-formed IEC is ACCEPTED — but NOT verified when no registry is connected (the honest default)
  const v = await api('POST', '/api/governance/verify', { token, body: { standard_key: 'exim-policy', doc_key: 'iec_code', id_type: 'iec', id_value: 'AAACR1234B' } });
  chk('well-formed IEC is accepted (200)', v.status === 200, 'method=' + (v.j && v.j.verdict && v.j.verdict.method));
  chk('with NO registry connected it is method=format (honest)', v.j && v.j.verdict && v.j.verdict.method === 'format');
  let rd = await api('GET', '/api/governance/readiness', { token });
  chk('→ rung is NOT verified — it is a DECLARED claim', rungOf(rd, 'iec_code') === 'declared', rungOf(rd, 'iec_code'));

  // 2 · a malformed ID is REFUSED (not silently accepted)
  const bad = await api('POST', '/api/governance/verify', { token, body: { standard_key: 'exim-policy', doc_key: 'hs_code', id_type: 'iec', id_value: '123' } });
  chk('malformed registry ID is REFUSED (422)', bad.status === 422, 'status ' + bad.status);

  // 3 · DOCUMENTED — a gathered doc backed by a chit id is a rung above a bare claim
  await api('POST', '/api/governance/compliance', { token, body: { standard_key: 'exim-policy', doc_key: 'hs_code', evidence_ref: '11111111-2222-3333-4444-555555555555', status: 'gathered' } });
  rd = await api('GET', '/api/governance/readiness', { token });
  chk('a document-backed clearance is DOCUMENTED', rungOf(rd, 'hs_code') === 'documented', rungOf(rd, 'hs_code'));

  // 4 · DECLARED — a bare claim (no document) is the lowest rung
  await api('POST', '/api/governance/compliance', { token, body: { standard_key: 'exim-policy', doc_key: 'incoterms', evidence_ref: 'FOB', status: 'gathered' } });
  rd = await api('GET', '/api/governance/readiness', { token });
  chk('a bare claim is DECLARED (lowest rung)', rungOf(rd, 'incoterms') === 'declared', rungOf(rd, 'incoterms'));

  // 5 · nothing is falsely counted as verified while no registry is connected
  chk('summary reports ZERO verified (no false "verified")', rd.j && rd.j.summary && rd.j.summary.verified === 0,
    'verified=' + (rd.j && rd.j.summary && rd.j.summary.verified) + ' documented=' + (rd.j && rd.j.summary && rd.j.summary.documented));
  console.log('\n  (connect CB_KYB_PROVIDER + keys → the same IEC call returns method=registry → rung "verified".)');

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });

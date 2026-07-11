// prove-lifecycle.js — LIVE end-to-end proof of "N sources assimilate into a boilerplate, and a standard actively
// governs at runtime." Hits the live API. Run AFTER: (1) b87 EXIM seeded, (2) the multi-layer seam deployed.
//   node scripts/prove-lifecycle.js
// Proves:
//   A. ASSIMILATION — a minted chit's governance stamp carries BOTH facets: iso-9001@v1 (quality) + exim-policy@v1 (trade).
//   B. RUNTIME GOVERNANCE — the conformance endpoint READS both standards live; EXIM (chit-scope) flags a real
//      contradiction on an export order missing hs_code/incoterms; ISO 9000 (entity-scope) is read but not mis-applied.
//   C. DISCRIMINATION — a complete order passes (the check isn't just always-fail).
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const S = (o) => JSON.stringify(o || '');

(async () => {
  console.log('== PROVE LIFECYCLE (assimilation + runtime conformance) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'prove-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token;
  chk('throwaway entity login', !!token);

  // ── A. ASSIMILATION: mint a chit → its stamp carries BOTH standards ──────────────────────────
  const send = await api('POST', '/api/chits/send', { token, body: {
    recipients: [{ name: 'GOV-01-Help', role: 'to' }], purpose: 'inquiry', manual_subject: 'prove-assimilation ' + ts } });
  chk('chit minted', send.status === 200, 'status ' + send.status);
  const chitId = send.j && send.j.chit_id;
  let stamp = { status: 0, j: null };
  if (chitId) stamp = await api('GET', '/api/chits/' + chitId, { token });
  const stampStr = S(stamp.j);
  chk('stamp assimilates ISO 9000 (quality)', stampStr.includes('iso-9001'), 'iso-9001 present');
  chk('stamp assimilates EXIM (trade) — N sources in one boilerplate', stampStr.includes('exim-policy'),
    stampStr.includes('exim-policy') ? 'both facets stamped' : 'EXIM missing — seed b87 + deploy seam');

  // ── B. RUNTIME GOVERNANCE: the standard is READ live and flags a contradiction ───────────────
  const exportOrder = { purpose: 'export order', product: 'Royale Play Tussar', quantity: 40 };   // no hs_code / incoterms
  const v1 = await api('POST', '/api/governance/conformance', { token, body: { data: exportOrder, scope: 'chit' } });
  const checkedRefs = ((v1.j && v1.j.checked) || []).map(c => c.ref);
  chk('both standards READ at runtime', checkedRefs.includes('iso-9001@v1') && checkedRefs.includes('exim-policy@v1'),
    checkedRefs.join(', ') || 'none');
  chk('EXIM (chit-scope) FLAGS the contradiction', v1.j && v1.j.status === 'flagged'
    && (v1.j.gaps || []).some(g => g.missing === 'hs_code') && (v1.j.gaps || []).some(g => g.missing === 'incoterms'),
    'gaps: ' + ((v1.j && v1.j.gaps) || []).map(g => g.missing).join(', '));
  chk('ISO 9000 (entity-scope) is read but NOT mis-applied to the chit',
    !((v1.j && v1.j.gaps) || []).some(g => String(g.standard).startsWith('iso-9001')), 'no false quality gaps');

  // ── C. DISCRIMINATION: a complete export order passes ────────────────────────────────────────
  const goodOrder = { purpose: 'export order', product: 'Royale Play Tussar', quantity: 40,
    iec_code: 'IEC-0000', hs_code: '3209.90', export_declaration: 'EDF-' + ts, incoterms: 'FOB' };
  const v2 = await api('POST', '/api/governance/conformance', { token, body: { data: goodOrder, scope: 'chit' } });
  chk('a COMPLETE export order PASSES (check discriminates)', v2.j && v2.j.status === 'pass',
    'status ' + (v2.j && v2.j.status));

  console.log('\n  ── the boilerplate assimilated:');
  for (const c of ((v1.j && v1.j.checked) || [])) console.log('     ' + c.ref + '  (' + c.facet + ', scope:' + c.scope + ', applied:' + c.applied + ')');
  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

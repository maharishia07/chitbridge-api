// prove-lanes.js — LIVE proof of GENERIC, origin-aware, destination-resolved readiness (b91). Requirements are DERIVED
// (home rules ∪ destination rules ∪ universal), never enumerated. Run AFTER b91.  node scripts/prove-lanes.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const stds = (rd) => ((rd.j && rd.j.standards) || []).slice().sort();

(async () => {
  console.log('== PROVE TRADE LANES (generic · origin-aware) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'lane-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token;
  chk('login', !!token);

  // 1 · the MATRIX — readiness per destination (the eye-opener), all derived
  const mx = await api('GET', '/api/governance/lanes?vertical=paint&origin=IN', { token });
  const lanes = (mx.j && mx.j.lanes) || [];
  chk('matrix returns destinations', lanes.length >= 3, lanes.map(l => l.dest_key + ':' + l.total).join(' · '));
  const counts = {}; lanes.forEach(l => counts[l.dest_key] = l.total);
  chk('different destinations require DIFFERENT sets (not enumerated, derived)', counts.EU !== counts.US || counts.EU !== counts.IN,
    'EU=' + counts.EU + ' US=' + counts.US + ' IN=' + counts.IN);

  // 2 · EU (from IN) — chemical→EU pulls REACH; US-only TSCA must NOT appear
  const eu = await api('GET', '/api/governance/readiness?destination=EU&vertical=paint&origin=IN', { token });
  chk('EU lane derives REACH (dest EU + chemical)', stds(eu).includes('reach'), stds(eu).join(', '));
  chk('EU lane excludes TSCA (US-only rule)', !stds(eu).includes('tsca'));
  chk('EU lane includes universal ISO 9001 + export policy', stds(eu).includes('iso-9001') && stds(eu).includes('exim-policy'));

  // 3 · US (from IN) — the mirror: TSCA in, REACH out
  const us = await api('GET', '/api/governance/readiness?destination=US&vertical=paint&origin=IN', { token });
  chk('US lane derives TSCA, excludes REACH', stds(us).includes('tsca') && !stds(us).includes('reach'), stds(us).join(', '));

  // 4 · ORIGIN matters — an EU supplier selling INTO the EU is domestic → export policy drops out
  const euFromEU = await api('GET', '/api/governance/readiness?destination=EU&vertical=paint&origin=EU', { token });
  chk('EU→EU is domestic → export policy NOT required (origin bridge works)',
    !stds(euFromEU).includes('exim-policy') && stds(euFromEU).includes('reach'), stds(euFromEU).join(', '));

  // 5 · guidance on gaps (guide the rest)
  const gap = ((eu.j && eu.j.clearances) || []).find(c => c.status !== 'gathered' && c.guidance);
  chk('gaps carry GUIDANCE (go as far as we can, guide the rest)', !!gap, gap ? ('e.g. ' + gap.standard + ': ' + String(gap.guidance).slice(0, 60)) : '');

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });

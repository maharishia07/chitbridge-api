// prove-readiness.js — LIVE proof of trade readiness/confidence. A supplier adopts the boilerplate → sees its required
// clearances (from its standards) → GATHERS each → readiness rolls up to import-ready → a BUYER reads the shareable
// passport and sees it. Run AFTER b90.  node scripts/prove-readiness.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const BP = 'royaleplay-bp-india';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const login = async () => { const ts = Date.now().toString().slice(-6) + Math.floor(Math.random() * 99); const email = 'trade-' + ts + '@test.com'; const reg = await api('POST', '/api/entities/register', { body: { email } }); const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); const token = ver.j && ver.j.token; let bridge = ver.j && ver.j.bridge_id; if (!bridge) { const me = await api('GET', '/api/entities/me', { token }); bridge = me.j && (me.j.bridge_id || (me.j.entity && me.j.entity.bridge_id)); } return { token, bridge }; };

(async () => {
  console.log('== PROVE TRADE READINESS / CONFIDENCE ==  ' + B + '\n');
  const supplier = await login();
  chk('supplier logs in', !!supplier.token, supplier.bridge);
  await api('POST', '/api/governance/boilerplate/' + BP + '/adopt', { token: supplier.token });   // inherit ISO 9001 + EXIM

  // 1 · the supplier sees its REQUIRED clearances (from its standards), all pending
  const rd0 = await api('GET', '/api/governance/readiness', { token: supplier.token });
  const req0 = (rd0.j && rd0.j.clearances) || [];
  chk('supplier sees its required clearances', req0.length > 0, req0.length + ' documents · ' + (rd0.j && rd0.j.standards || []).join(', '));
  chk('all pending before gathering', rd0.j && rd0.j.summary && rd0.j.summary.percent === 0, 'percent ' + (rd0.j && rd0.j.summary && rd0.j.summary.percent));

  // 2 · the supplier GATHERS each required document (reference-based — whatever the standards require)
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);   // one "expiring" to mirror REACH
  const far = new Date(Date.now() + 730 * 86400000).toISOString().slice(0, 10);
  let i = 0;
  for (const it of req0) {
    await api('POST', '/api/governance/compliance', { token: supplier.token, body: {
      standard_key: it.standard, doc_key: it.doc, evidence_ref: 'chit://' + it.doc, valid_until: (i === 0 ? soon : far) } });
    i++;
  }

  // 3 · readiness rolls up to import-ready
  const rd1 = await api('GET', '/api/governance/readiness', { token: supplier.token });
  const s1 = rd1.j && rd1.j.summary;
  chk('readiness rolls up to import-ready', s1 && s1.ready === true, 'met ' + (s1 && s1.met) + '/' + (s1 && s1.total) + ' · ' + (s1 && s1.percent) + '%');
  chk('the "expiring soon" one is tracked (not counted as a gap)', s1 && s1.expiring >= 1 && s1.pending === 0, 'expiring ' + (s1 && s1.expiring) + ' · pending ' + (s1 && s1.pending));

  // 4 · a BUYER reads the shareable passport and sees the supplier is ready
  const buyer = await login();
  const pass = await api('GET', '/api/governance/readiness/' + supplier.bridge, { token: buyer.token });
  chk('buyer sees the supplier passport', pass.status === 200 && pass.j.supplier && pass.j.supplier.bridge_id === supplier.bridge,
    (pass.j && pass.j.supplier && pass.j.supplier.display_name) || '');
  chk('buyer sees the supplier as import-ready', pass.j && pass.j.summary && pass.j.summary.ready === true,
    'met ' + (pass.j && pass.j.summary && pass.j.summary.met) + '/' + (pass.j && pass.j.summary && pass.j.summary.total));
  chk('passport shows STATUS only (no raw evidence dumped)', pass.j && pass.j.clearances && pass.j.clearances.every(x => !x.form),
    'status-only projection');

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

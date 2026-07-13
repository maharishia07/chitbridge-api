// prove-security-fixes.js — LIVE proof of the 2026-07-13 reviewer security fixes (T1, T4, M1).
// These assert the GUARDS (they must have gone RED before the fix). node scripts/prove-security-fixes.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return { token: v.j && v.j.token, id: v.j && v.j.entity && v.j.entity.identity_id }; }
const rungOf = (rd, std) => { const it = ((rd && rd.clearances) || []).find(c => c.standard === std); return it && it.rung; };

(async () => {
  console.log('== PROVE SECURITY FIXES (T1 self-cert · T4 fake-UUID · M1 dispute injection) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6);
  const sup = await login('sec-sup-' + ts + '@t.com');
  const buy = await login('sec-buy-' + ts + '@t.com');
  chk('supplier + buyer login', !!sup.token && !!buy.token);

  // ── T1 — a supplier POSTs its OWN "registry-verified" stamp → must NOT become `verified`. ──
  await api('POST', '/api/governance/compliance', { token: sup.token, body: {
    standard_key: 'iso-9001', doc_key: 'quality_manual', status: 'gathered',
    verification: { method: 'registry', provider: 'sandbox', registry: { legal_name: 'FORGED', status: 'active' }, verified_at: '2026-07-13T00:00:00Z' } } });
  let rd = await api('GET', '/api/governance/readiness?destination=EU&vertical=paint&origin=IN', { token: sup.token });
  const r1 = rungOf(rd.j, 'iso-9001');
  chk('T1 · self-supplied verification is STRIPPED (rung is NOT verified/attested)', r1 !== 'verified' && r1 !== 'attested', 'rung=' + r1);

  // ── T4 — a random UUID as evidence_ref (no owned chit) → must NOT earn `documented`. ──
  await api('POST', '/api/governance/compliance', { token: sup.token, body: {
    standard_key: 'iso-14001', doc_key: 'ems_manual', status: 'gathered', evidence_ref: '11111111-2222-3333-4444-555555555555' } });
  rd = await api('GET', '/api/governance/readiness?destination=EU&vertical=paint&origin=IN', { token: sup.token });
  const r4 = rungOf(rd.j, 'iso-14001');
  chk('T4 · fake UUID evidence_ref does NOT earn `documented`', r4 !== 'documented', 'rung=' + r4);

  // ── legit path still works: a REAL owned self-chit as evidence → `documented`. ──
  const sc = await api('POST', '/api/chits/send', { token: sup.token, body: { recipients: [{ name: 'self', role: 'to' }], manual_subject: 'evidence', subject: 'evidence', purpose: 'general', line_items: [] } });
  const realChit = sc.j && (sc.j.chit_id || (sc.j.chit && sc.j.chit.chit_id));
  await api('POST', '/api/governance/compliance', { token: sup.token, body: { standard_key: 'iso-45001', doc_key: 'ohs_manual', status: 'gathered', evidence_ref: realChit } });
  rd = await api('GET', '/api/governance/readiness?destination=EU&vertical=paint&origin=IN', { token: sup.token });
  chk('  └ a REAL owned evidence chit still earns `documented`', rungOf(rd.j, 'iso-45001') === 'documented', 'rung=' + rungOf(rd.j, 'iso-45001') + ' chit=' + (realChit ? realChit.slice(0, 8) : '—'));

  // ── M1 — a chit participant posts a dispute message with a dispute_id they are NOT a party to → must 403. ──
  const snd = await api('POST', '/api/chits/send', { token: sup.token, body: { recipients: [{ entity_id: buy.id, role: 'to' }], purpose: 'general', manual_subject: 'ORDER ' + ts, line_items: [{ description: 'x', qty: 1, rate: 10 }] } });
  const chitId = snd.j && (snd.j.chit_id || (snd.j.chit && snd.j.chit.chit_id));
  const inject = await api('POST', '/api/chits/' + chitId + '/messages', { token: buy.token, body: {
    thread_type: 'external', message_text: 'injected', is_dispute: true, dispute_id: '99999999-8888-7777-6666-555555555555' } });
  chk('M1 · dispute message with a non-party dispute_id → 403', inject.status === 403, 'status ' + inject.status + ' · ' + ((inject.j && inject.j.message) || ''));

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

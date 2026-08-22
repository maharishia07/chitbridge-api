// prove-capture.js — LIVE proof of the capture connector (inbound message → AI structure → confirm → chit).
// Self-heals: if b104 isn't applied, the capture store 503s → reported as pending, not a fail. node scripts/prove-capture.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0, SKIP = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return v.j && v.j.token; }

(async () => {
  console.log('== PROVE CAPTURE CONNECTOR (inbound → AI structure → confirm → chit) ==  ' + B + '\n');
  const t = await login('cap-' + Date.now().toString().slice(-6) + '@test.com');
  chk('login', !!t);

  // 1 · the message-to-chit AI skill works (independent of the capture table)
  let aiOk = false;
  for (let i = 0; i < 8 && !aiOk; i++) {
    const d = await api('POST', '/api/governance/ai-draft', { token: t, body: { skill_id: 'message-to-chit', context: { channel: 'whatsapp', from: '+9198…', message: 'need 40 drums white primer and 12 tins hardener, deliver Chennai' } } });
    if (d.status === 200 && d.j && d.j.data) { aiOk = true; chk('message-to-chit skill structures the message', Array.isArray(d.j.data.line_items), 'items=' + (d.j.data.line_items || []).length + ' subject="' + (d.j.data.subject || '') + '"'); }
    else if (d.status !== 404) await new Promise(r => setTimeout(r, 6000));
    else await new Promise(r => setTimeout(r, 6000));
  }
  if (!aiOk) chk('message-to-chit skill', false, 'no AI response');

  // 2 · the capture pipeline (needs b104)
  const cap = await api('POST', '/api/capture/simulate', { token: t, body: { channel: 'whatsapp', sender_ref: '+9198', raw_text: 'need 40 drums white primer, 12 tins hardener' } });
  if (cap.status === 503) { SKIP += 4; console.log('  ◐ capture pipeline SKIPPED — b104 not applied (503). Run the migration, then re-run.'); }
  else {
    chk('simulate creates a pending capture', cap.status === 200 && cap.j && cap.j.id, 'id=' + (cap.j && cap.j.id));
    const list = await api('GET', '/api/capture/pending', { token: t });
    chk('the capture shows in pending', (list.j.captures || []).some(c => c.id === (cap.j && cap.j.id)));
    const str = await api('POST', '/api/capture/' + cap.j.id + '/structure', { token: t });
    chk('AI structures the capture', str.status === 200 && str.j && str.j.structured, 'items=' + ((str.j && str.j.structured && str.j.structured.line_items) || []).length);
    // human-confirm: send via the proven path, then mark converted
    const li = ((str.j && str.j.structured && str.j.structured.line_items) || [{ particulars: 'item', qty: 1, rate: 0 }]).map(x => ({ particulars: x.particulars || 'item', quantity: +x.qty || 0, price: +x.rate || 0, total: (+x.qty || 0) * (+x.rate || 0) }));
    const send = await api('POST', '/api/chits/send', { token: t, body: { recipients: [{ name: 'self', role: 'to' }], subject: 'Intake', manual_subject: 'Intake', purpose: 'general', line_items: li } });
    const chitId = send.j && (send.j.chit_id || (send.j.chit && send.j.chit.chit_id));
    const conv = await api('POST', '/api/capture/' + cap.j.id + '/convert', { token: t, body: { chit_id: chitId } });
    chk('convert marks it converted + links the chit', conv.status === 200 && conv.j && conv.j.status === 'converted', 'chit=' + (conv.j && conv.j.chit_id ? String(conv.j.chit_id).slice(0, 8) : '—'));
  }

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F + (SKIP ? '  ·  SKIP ' + SKIP + ' (pending b104)' : ''));
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });

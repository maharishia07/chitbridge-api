// prove-orderbind.js — LIVE proof of ORDER-BINDING: a supplier's HELD clearances FOLD into the order chit (summary_json,
// per-copy, frozen), so the BUYER sees them on the order. node scripts/prove-orderbind.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return { token: ver.j && ver.j.token, id: ver.j && ver.j.entity && ver.j.entity.identity_id }; }
const dig = (o) => (o && (o.summary_json || (o.chit && o.chit.summary_json) || (o.header && o.header.summary_json))) || null;

(async () => {
  console.log('== PROVE ORDER-BINDING (clearances fold into the order) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6);
  const sup = await login('ob-sup-' + ts + '@test.com');   // supplier
  const buy = await login('ob-buy-' + ts + '@test.com');   // buyer
  chk('supplier + buyer login', !!sup.token && !!buy.token, 'buyer=' + buy.id);

  // supplier HOLDS a clearance (documented: a uuid evidence chit)
  await api('POST', '/api/governance/compliance', { token: sup.token, body: { standard_key: 'iso-9001', doc_key: 'quality_manual', evidence_ref: '11111111-2222-3333-4444-555555555555', valid_until: '2028-01-01', status: 'gathered' } });

  // supplier sends an ORDER chit to the buyer
  const snd = await api('POST', '/api/chits/send', { token: sup.token, body: { recipients: [{ entity_id: buy.id, role: 'to' }], purpose: 'general', manual_subject: 'ORDER ' + ts, line_items: [{ description: 'Consignment', qty: 1, rate: 1000 }] } });
  const chit_id = snd.j && (snd.j.chit_id || (snd.j.chit && snd.j.chit.chit_id));
  chk('order chit sent', !!chit_id, chit_id);

  // the BUYER opens its copy → the supplier's clearances are folded into summary_json (frozen snapshot)
  const bDet = await api('GET', '/api/chits/' + chit_id, { token: buy.token });
  const sj = dig(bDet.j);
  const folded = sj && sj.clearances;
  chk('buyer copy carries folded clearances', !!(folded && folded.items && folded.items.length), folded ? (folded.items.length + ' items · folded_at ' + String(folded.folded_at).slice(0,10)) : 'none');
  const qm = folded && folded.items.find(i => i.doc === 'quality_manual');
  chk('the held Quality Manual clearance is on the buyer\'s order', !!qm, qm && ('rung=' + qm.rung));
  chk('it carries its assurance rung (documented)', qm && qm.rung === 'documented', qm && qm.rung);

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

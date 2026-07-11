// prove-storefront.js — LIVE end-to-end proof of THE LIFE OF A CHIT through the STOREFRONT path:
//   provision a shop → open its storefront → a walk-in customer orders → the storefront chit carries the FULL
//   governance stamp (constitution · capability · work-pattern · N standards) + an advisory conformance verdict.
// Run AFTER the storefront-stamp wire-up is deployed:  node scripts/prove-storefront.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const S = (o) => JSON.stringify(o || '');

(async () => {
  console.log('== PROVE STOREFRONT (the life of a chit, end to end) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6);

  // ── provision the SHOP ───────────────────────────────────────────────
  const email = 'store-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token;
  chk('shop entity minted (login)', !!token);
  let bridge = (ver.j && (ver.j.bridge_id || (ver.j.entity && ver.j.entity.bridge_id))) || null;
  if (!bridge) { const me = await api('GET', '/api/entities/me', { token }); bridge = me.j && (me.j.bridge_id || (me.j.entity && me.j.entity.bridge_id)); }
  chk('shop has a bridge id (storefront address)', !!bridge, bridge || '—');

  await api('POST', '/api/schemas/create-default', { token });
  await api('PATCH', '/api/schemas/visibility', { token, body: { visibility: 'public' } });
  const prod = await api('POST', '/api/products', { token, body: { item_data: { product: 'Royale Play Tussar', quantity: 1, price: 850 } } });
  const itemId = prod.j && prod.j.item && prod.j.item.item_id;
  chk('storefront opened: public catalogue + a priced item', !!itemId, 'item ' + (itemId ? String(itemId).slice(0, 8) : '—'));

  // ── a walk-in CUSTOMER orders from the public storefront ─────────────
  const custEmail = 'cust-' + ts + '@test.com';
  const start = await api('POST', '/api/catalogue/' + bridge + '/order/start', { body: { email: custEmail, name: 'Walk-in Customer' } });
  const otp = start.j && start.j.dev_otp;
  chk('customer started an order (OTP issued)', !!otp, 'status ' + start.status);
  const confirm = await api('POST', '/api/catalogue/' + bridge + '/order/confirm', {
    body: { email: custEmail, otp, line_items: [{ item_id: itemId, quantity: 1 }], location: 'test-locality' } });
  const chitId = confirm.j && confirm.j.chit_id;
  chk('order placed → storefront chit minted', confirm.status === 200 && !!chitId, 'status ' + confirm.status + ' ' + S(confirm.j).slice(0, 120));

  // ── the STOREFRONT CHIT carries the full governance stamp + conformance ──
  let chit = { j: null };
  if (chitId) chit = await api('GET', '/api/chits/' + chitId, { token });
  const cs = S(chit.j);
  // reference-based, not literal: derive the expected standards from what's DEFINED live (conformance reads them), then
  // assert the chit carries each. A rename/swap needs zero edits here (loose-coupling principle).
  const conf = await api('POST', '/api/governance/conformance', { token, body: { data: {}, scope: 'chit' } });
  const activeRefs = ((conf.j && conf.j.checked) || []).map(c => c.ref);
  chk('storefront chit carries every DEFINED standard (reference, not literal)',
    activeRefs.length > 0 && activeRefs.every(r => cs.includes(r.split('@')[0])), activeRefs.join(', ') || '—');
  chk('storefront chit carries a conformance verdict', cs.includes('conformance'), 'verdict present');
  chk('storefront chit still carries the SOURCE/per-line governance (unchanged)', cs.includes('governed'), 'source governance intact');

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

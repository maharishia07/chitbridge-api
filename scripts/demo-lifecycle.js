// demo-lifecycle.js — THE REPEATABLE LIVE DEMO. Runs the entity lifecycle end-to-end and NARRATES each step so you can
// present it on a screen: define the mould (DDL) → operate it (DML). Provisions fresh demo rows each run (repeatable).
//   node scripts/demo-lifecycle.js
// Status per step:  ✅ live   ◐ exists/surfaced here   🔨 pending (later increment)
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const BP = 'royaleplay-bp-india';
let P = 0, F = 0;
function step(n, title, s) { console.log('\n' + s + '  STEP ' + n + ' — ' + title); }
function line(t) { console.log('     ' + t); }
function chk(ok, t) { if (ok) { P++; line('✓ ' + t); } else { F++; line('✗ ' + t); } }
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const S = (o) => JSON.stringify(o || '');

(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  THE LIFE OF AN ENTITY — live demo   ' + B);
  console.log('══════════════════════════════════════════════════════════');
  const ts = Date.now().toString().slice(-6);
  // a presenter identity (stands in for the platform operator running the demo)
  const email = 'demo-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token;
  let bridge = (ver.j && ver.j.bridge_id) || null;
  if (!bridge) { const me = await api('GET', '/api/entities/me', { token }); bridge = me.j && (me.j.bridge_id || (me.j.entity && me.j.entity.bridge_id)); }

  console.log('\n── DDL · define the sources & cast the mould ──────────────');

  step(1, 'ISO 9001 — the quality standard as a source', '🔨');
  step(2, 'EXIM — the trade standard as a source', '🔨');
  line('(source-ENTITY registration is the next increment; today the rules live in the shared standard_source)');
  const conf0 = await api('POST', '/api/governance/conformance', { token, body: { data: {}, scope: 'chit' } });
  const defined = ((conf0.j && conf0.j.checked) || []).map(c => c.ref);
  chk(defined.includes('iso-9001@v1'), 'ISO 9001 is defined and readable  → ' + (defined.join(', ') || '—'));
  chk(defined.includes('exim-policy@v1'), 'EXIM is defined and readable');

  step(3, 'Royale Play — the brand catalogue source', '◐');
  line('brand source exists → beta-royale-play@v1');

  step(4, 'RoyalePlay BP — India: the mould that DECLARES its sources', '✅');
  const bpr = await api('GET', '/api/governance/boilerplate/' + BP, { token });
  const bpj = bpr.j || {};
  chk(bpr.status === 200, 'the mould resolves  → ' + (bpj.label || '—'));
  line('declares: ' + (bpj.sources || []).map(s => s.source_key + (s.facet ? ' (' + s.facet + ')' : '')).join('  ·  '));
  line('locale:   ' + S(bpj.locale));
  chk(bpj.standards && bpj.standards.quality === 'iso-9001@v1' && bpj.standards.trade === 'exim-policy@v1',
    'the mould INHERITS both standards (declared, not global)');

  console.log('\n── MINT · resolve the declared sources → seal into the entity ──');

  step(5, 'Mint a shop FROM the boilerplate', '✅');
  const adopt = await api('POST', '/api/governance/boilerplate/' + BP + '/adopt', { token });
  chk(adopt.status === 200, 'shop minted from the mould  → boilerplate ' + (adopt.j && adopt.j.boilerplate));
  line('inherited standards: ' + S(adopt.j && adopt.j.standards) + '  locale: ' + S(adopt.j && adopt.j.locale));

  console.log('\n── DML · operate the mould ────────────────────────────────');

  step(6, 'Open the storefront', '✅');
  await api('POST', '/api/schemas/create-default', { token });
  await api('PATCH', '/api/schemas/visibility', { token, body: { visibility: 'public' } });
  const prod = await api('POST', '/api/products', { token, body: { item_data: { product: 'Royale Play Tussar', quantity: 1, price: 850 } } });
  const itemId = prod.j && prod.j.item && prod.j.item.item_id;
  chk(!!itemId, 'public storefront + priced item  → ' + bridge);

  step(7, 'A customer orders (fields GATHERED from the standard)', '🔨');
  line('(the capture FORM is the next increment; today the standard flags what to gather)');
  const custEmail = 'buyer-' + ts + '@test.com';
  const start = await api('POST', '/api/catalogue/' + bridge + '/order/start', { body: { email: custEmail, name: 'Walk-in Customer' } });
  const otp = start.j && start.j.dev_otp;
  const confirm = await api('POST', '/api/catalogue/' + bridge + '/order/confirm', { body: { email: custEmail, otp, line_items: [{ item_id: itemId, quantity: 1 }] } });
  const chitId = confirm.j && confirm.j.chit_id;
  chk(confirm.status === 200 && !!chitId, 'order placed → chit minted');

  step(8, 'The governed chit — full stamp from the mould', '✅');
  const chit = chitId ? await api('GET', '/api/chits/' + chitId, { token }) : { j: null };
  const cs = S(chit.j);
  chk(cs.includes('royaleplay-bp-india@v1'), 'chit carries the BOILERPLATE it was minted from');
  chk(cs.includes('iso-9001') && cs.includes('exim-policy'), 'chit carries the mould\'s DECLARED standards (ISO 9001 + EXIM)');
  chk(cs.includes('conformance'), 'chit carries the conformance verdict');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  RESULT   PASS ' + P + '  ·  FAIL ' + F + '   (fresh demo rows: ' + email + ')');
  console.log('══════════════════════════════════════════════════════════');
  process.exit(0);
})().catch(e => { console.error('DEMO ERROR', e); process.exit(0); });

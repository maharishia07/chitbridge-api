// sealed-guard.js — P0-1: a PROTECTED (sealed) entity must not leak through the directory or the storefront, and
// stays reachable by NAME for the help-desk send. Targets the real sealed entity GOV-01-Help (bridge CBHELPSRC01).
// Run: node scripts/sealed-guard.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
function chk(n, ok, d) { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } }
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
const has = (o, s) => JSON.stringify(o || '').includes(s);
(async () => {
  console.log('== SEALED GUARD (P0-1) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'seal-' + ts + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } });
  const token = ver.j && ver.j.token;
  chk('throwaway entity login', !!token);

  // 1 · directory search must NOT surface the sealed Help entity
  const s = await api('GET', '/api/entities/search?q=' + encodeURIComponent('GOV-01-Help'), { token });
  chk('directory search EXCLUDES the sealed entity', s.status === 200 && !has(s.j, 'GOV-01-Help'), 'status ' + s.status);

  // 2 · storefront resolution must NOT resolve the sealed entity's bridge_id
  const store = await api('GET', '/api/catalogue/CBHELPSRC01');
  chk('storefront resolve REFUSES the sealed entity', store.status !== 200 || !has(store.j, 'GOV-01-Help'), 'status ' + store.status);

  // 3 · but the help-desk SEND still works — GOV-01-Help stays addressable by NAME (must not over-reach)
  const send = await api('POST', '/api/chits/send', { token, body: { recipients: [{ name: 'GOV-01-Help', role: 'to' }], purpose: 'inquiry', manual_subject: 'sealed-guard ' + ts } });
  chk('help-desk send by NAME still succeeds (reachability preserved)', send.status === 200, 'status ' + send.status + ' ' + JSON.stringify(send.j).slice(0, 120));

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });

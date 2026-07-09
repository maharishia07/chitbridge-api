// entity-vertical.js — proves PER-ENTITY / VERTICAL minting: each entity's signal chit records the entity's OWN
// minted constitution. Beta Traders is minted onto 'service-desk@v1' (b73); Alpha (unstamped) falls back to 'base@v1'.
// Same rail, same capability, DIFFERENT vertical per entity. Run: node scripts/entity-vertical.js
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let PASS = 0, FAIL = 0;
function check(n, ok, d) { if (ok) { PASS++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { FAIL++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } }
async function api(m, p, { token, key, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  if (key) h['X-Bridge-Key'] = key;
  const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, json: j };
}
async function login(name) {
  const r = await api('POST', '/api/entities/register', { body: { email: name } });
  const v = await api('POST', '/api/entities/verify', { body: { email: r.json.email, otp: r.json && r.json.dev_otp } });
  return v.json.token;
}
// fire one signal for a logged-in entity and return the chit's full detail JSON (as a string blob)
async function fireSignal(token) {
  const c = await api('POST', '/api/connectors', { token, body: { display_name: 'VERT ' + Date.now().toString().slice(-5), type: 'iot', config: { mode: 'push' } } });
  const connId = c.json && c.json.connector && c.json.connector.identity_id;
  const key = c.json && c.json.provision_key;
  await api('POST', '/api/connectors/' + connId + '/connections', { token, body: { ref: 'Gate', direction: 'in', config: { folder: 'Vert', device_id: 'gw' } } });
  const conns = await api('GET', '/api/connectors/' + connId + '/connections', { token });
  const bridge = ((conns.json && conns.json.connections) || [])[0] && ((conns.json && conns.json.connections) || [])[0].bridge_id;
  const ing = await api('POST', '/api/connectors/ingest', { key, body: { bridge_id: bridge, signal: 'vehicle', value: '1' } });
  const det = await api('GET', '/api/chits/' + (ing.json && ing.json.chit_id), { token });
  return JSON.stringify(det.json || {});
}
(async () => {
  console.log('== PER-ENTITY / VERTICAL minting ==\n');
  const A = await login('Alpha Timbers');
  const B = await login('Beta Traders');

  const aBlob = await fireSignal(A);
  check('Alpha (unstamped) → chit governed by DEFAULT constitution base@v1', aBlob.indexOf('base@v1') >= 0, aBlob.indexOf('base@v1') >= 0 ? '' : '(b72/b73 applied?)');
  check('Alpha chit is NOT on the service-desk vertical', aBlob.indexOf('service-desk@v1') < 0);

  const bBlob = await fireSignal(B);
  check('Beta (minted) → chit governed by its VERTICAL constitution service-desk@v1', bBlob.indexOf('service-desk@v1') >= 0, bBlob.indexOf('service-desk@v1') >= 0 ? '' : '(b73 minted Beta?)');
  check('both still carry the same capability + pattern (only the vertical differs)', aBlob.indexOf('connector@v1') >= 0 && bBlob.indexOf('connector@v1') >= 0 && bBlob.indexOf('iot-signal@v1') >= 0);

  done();
})().catch(e => { console.error(e); done(); });
function done() { console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(0); }

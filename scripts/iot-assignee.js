// iot-assignee.js — proves the RESOLUTION SEAM + default-assignee for IoT signals (the visibility fix):
// a device with a per-device default_assignee → the emitted signal chit is ASSIGNED to that co-assist.
// Also exercises the cascade (a device with none falls back to the entity default). Run: node scripts/iot-assignee.js
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
  const o = r.json && r.json.dev_otp;
  const v = await api('POST', '/api/entities/verify', { body: { email: r.json.email, otp: o } });
  return v.json.token;
}
async function bridgeOf(token, connId, ref) {
  const c = await api('GET', '/api/connectors/' + connId + '/connections', { token });
  const d = ((c.json && c.json.connections) || []).find(x => x.ref === ref);
  return d && d.bridge_id;
}
(async () => {
  console.log('== IoT default-assignee (resolution seam) ==\n');
  const A = await login('Alpha Timbers');
  const c = await api('POST', '/api/connectors', { token: A, body: { display_name: 'ASG ' + Date.now().toString().slice(-5), type: 'iot', config: { mode: 'push' } } });
  const connId = c.json && c.json.connector && c.json.connector.identity_id;
  const key = c.json && c.json.provision_key;
  check('connector created', !!connId && !!key);
  if (!connId) return done();

  // an actor to be the assignee
  const nm = 'Handler ' + Date.now().toString().slice(-4);
  const ac = await api('POST', '/api/actors', { token: A, body: { display_name: nm, actor_key: ('h' + Date.now().toString().slice(-5)), hat: 'act' } });
  const assigneeId = ac.json && ((ac.json.actor && ac.json.actor.identity_id) || ac.json.identity_id || (ac.json.actor && ac.json.actor.id) || ac.json.id);
  check('assignee co-assist created', !!assigneeId, assigneeId);
  if (!assigneeId) return done();

  // device WITH a per-device default_assignee
  await api('POST', '/api/connectors/' + connId + '/connections', { token: A, body: { ref: 'Gate A', direction: 'in', config: { folder: 'Gate log', device_id: 'gw-asg', default_assignee: assigneeId } } });
  const bridge = await bridgeOf(A, connId, 'Gate A');
  check('device added (bridge_id)', !!bridge, bridge);
  if (!bridge) return done();

  const ing = await api('POST', '/api/connectors/ingest', { key, body: { bridge_id: bridge, signal: 'vehicle', value: '1' } });
  check('signal ingested → chit', ing.status === 200 && !!(ing.json && ing.json.chit_id), 'status ' + ing.status);
  check('signal filed into the folder', !!(ing.json && ing.json.filed));
  check('signal ASSIGNED to the per-device assignee (seam resolved it)', ing.json && ing.json.assigned === assigneeId, 'assigned=' + (ing.json && ing.json.assigned));

  // verify the chit carries the MINTED blueprint reference in its governed audit stamp (proves b70 + the seam read it)
  const det = await api('GET', '/api/chits/' + (ing.json && ing.json.chit_id), { token: A });
  const blob = JSON.stringify(det.json || {});
  check('chit stamped with MINTED blueprint iot-signal@v1 (from work_pattern)', blob.indexOf('iot-signal@v1') >= 0, blob.indexOf('iot-signal@v1') >= 0 ? 'governed.pattern' : 'not found (fallback? migration applied?)');
  check('chit records its parent CAPABILITY connector@v1 (middle rung)', blob.indexOf('connector@v1') >= 0, blob.indexOf('connector@v1') >= 0 ? 'governed.capability' : 'not found (b71 applied?)');
  check('chit records the governing CONSTITUTION base@v1 (top rung)', blob.indexOf('base@v1') >= 0, blob.indexOf('base@v1') >= 0 ? 'governed.constitution' : 'not found (b72 applied?)');

  // device WITHOUT a per-device assignee → cascade falls through (entity default, or none)
  await api('POST', '/api/connectors/' + connId + '/connections', { token: A, body: { ref: 'Gate B', direction: 'in', config: { folder: 'Gate log B', device_id: 'gw-noasg' } } });
  const bridge2 = await bridgeOf(A, connId, 'Gate B');
  const ing2 = await api('POST', '/api/connectors/ingest', { key, body: { bridge_id: bridge2, signal: 'vehicle', value: '2' } });
  check('device without a per-device assignee still ingests (cascade to entity default / none)', ing2.status === 200, 'assigned=' + (ing2.json && ing2.json.assigned));

  done();
})().catch(e => { console.error(e); done(); });
function done() { console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(0); }

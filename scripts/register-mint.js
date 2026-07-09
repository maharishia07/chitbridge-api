// register-mint.js — proves AUTO-MINT at entity creation: a registrant CHOOSES a vertical at verify and the entity is
// minted onto it (else defaults to base). Also checks the public chooser endpoint. Run: node scripts/register-mint.js
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let PASS = 0, FAIL = 0;
function check(n, ok, d) { if (ok) { PASS++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { FAIL++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } }
async function api(m, p, { body } = {}) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, json: j };
}
async function registerVerify(name, constitution) {
  const reg = await api('POST', '/api/entities/register', { body: { email: name } });
  const otp = reg.json && reg.json.dev_otp;
  const body = { email: (reg.json && reg.json.email) || name, otp };
  if (constitution) body.constitution = constitution;
  return api('POST', '/api/entities/verify', { body });
}
(async () => {
  console.log('== AUTO-MINT at registration ==\n');
  // public chooser
  const list = await api('GET', '/api/entities/constitutions');
  const keys = ((list.json && list.json.constitutions) || []).map(c => c.key);
  check('public chooser lists the verticals', keys.indexOf('base') >= 0 && keys.indexOf('service-desk') >= 0, keys.join(', '));

  // choose a vertical → minted onto it
  const v = await registerVerify('vmint-sd-' + Date.now().toString().slice(-6), 'service-desk');
  check('registrant CHOSE service-desk → entity minted service-desk@v1', v.json && v.json.constitution === 'service-desk@v1', 'constitution=' + (v.json && v.json.constitution));

  // no choice → defaults to base
  const d = await registerVerify('vmint-base-' + Date.now().toString().slice(-6), null);
  check('no choice → entity minted the DEFAULT base@v1', d.json && d.json.constitution === 'base@v1', 'constitution=' + (d.json && d.json.constitution));

  // an unknown vertical falls back to the default (never breaks registration)
  const u = await registerVerify('vmint-unk-' + Date.now().toString().slice(-6), 'does-not-exist');
  check('unknown vertical → safe fallback to base@v1 (verify still succeeds)', u.status === 200 && u.json && u.json.constitution === 'base@v1', 'status ' + u.status + ' constitution=' + (u.json && u.json.constitution));

  done();
})().catch(e => { console.error(e); done(); });
function done() { console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(0); }

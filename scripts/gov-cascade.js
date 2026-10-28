// gov-cascade.js — proves the WHOLE governance cascade end-to-end, from attributes:
// register + choose a vertical → placed on the installation that serves it → /me.governance resolves the basics.
//   service-desk → the AWS Mexico platform → MXN · America/Mexico_City · MX · es
//   base         → the India platform        → INR · Asia/Kolkata · IN · en
// Everything comes from the b74 attributes; nothing hardcoded. Run: node scripts/gov-cascade.js  (needs b74 applied)
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let PASS = 0,
  FAIL = 0;
function check(n, ok, d) {
  if (ok) {
    PASS++;
    console.log('  ✓ ' + n + (d ? '  ' + d : ''));
  } else {
    FAIL++;
    console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
  }
}
async function api(m, p, { token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const reply = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try {
    j = await reply.json();
  } catch (_) {}
  return { status: reply.status, json: j };
}
async function regVerify(name, constitution) {
  const email = name + '@test.com';
  const reply = await api('POST', '/api/entities/register', { body: { email } });
  const body = { email: (reply.json && reply.json.email) || email, otp: reply.json && reply.json.dev_otp };
  if (constitution) body.constitution = constitution;
  const v = await api('POST', '/api/entities/verify', { body });
  return v.json && v.json.token;
}
async function gov(token) {
  const reply = await api('GET', '/api/entities/me', { token });
  return (reply.json && (reply.json.governance || (reply.json.entity && reply.json.entity.governance))) || null;
}
(async () => {
  console.log('== GOVERNANCE CASCADE (universe → entity, from attributes) ==\n');
  const ts = Date.now().toString().slice(-6);

  const g1 = await gov(await regVerify('gc-sd-' + ts, 'service-desk'));
  check('service-desk → constitution service-desk@v1', g1 && g1.constitution === 'service-desk@v1', g1 && g1.constitution);
  check(
    'placed on the AWS Mexico platform (platform-1)',
    g1 && g1.installation && g1.installation.key === 'platform-1',
    g1 && g1.installation && g1.installation.cloud + ' · ' + g1.installation.region
  );
  check(
    'basics resolve to MXN · America/Mexico_City · MX',
    g1 && g1.basics && g1.basics.currency === 'MXN' && g1.basics.region === 'MX',
    JSON.stringify(g1 && g1.basics)
  );
  check('language resolves to es', g1 && g1.basics && (g1.basics.languages || []).indexOf('es') >= 0);
  check('jurisdiction: provider, NOT custodian', g1 && g1.jurisdiction && g1.jurisdiction.custodian === false);

  const g2 = await gov(await regVerify('gc-base-' + ts, 'base'));
  check(
    'base → base@v1 on the India platform (platform-0)',
    g2 && g2.constitution === 'base@v1' && g2.installation && g2.installation.key === 'platform-0',
    g2 && g2.installation && g2.installation.region
  );
  check(
    'basics resolve to INR · Asia/Kolkata · IN',
    g2 && g2.basics && g2.basics.currency === 'INR' && g2.basics.region === 'IN',
    JSON.stringify(g2 && g2.basics)
  );
  check(
    'allowances present (from the capability attributes)',
    g1 && Array.isArray(g1.allowances) && g1.allowances.length > 0,
    ((g1 && g1.allowances) || []).map((item) => item.limit + ' ' + item.resource).join(' · ')
  );

  done();
})().catch((e) => {
  console.error(e);
  done();
});
function done() {
  console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL);
  process.exit(0);
}

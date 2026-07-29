'use strict';
/**
 * seed-test-entities.js — recreate a small, known cast after scripts/reset-2-wipe.sql.
 *
 * Athi: "we can create alpha, beta, gamma and Delta and so on for few of the test cases and then remove most."
 *
 * Four entities, chosen so that between them they exercise EVERY pipeline and preset we have built — rather than
 * four identical stores with different names:
 *
 *    ALPHA   paint distributor   commerce · cart      adopts Royale Play; the original reference-catalogue path
 *    BETA    veg market          commerce · cart      per-product units (kg · count · litre in one catalogue)
 *    GAMMA   document services   payload  · form      forms + carried proof (the ITR-2 / Form 16 path)
 *    DELTA   trade / export      commerce · qtyprice  negotiation — the buyer names a price
 *
 * Creates them through the REAL public API (register → dev OTP → verify), so it exercises the same code path a
 * human would, and works against any environment.
 *
 *   Run:  node scripts/seed-test-entities.js
 *         API=http://localhost:3000 node scripts/seed-test-entities.js
 *
 * ⚠️ Writes to the live database. All four use @test-cb.com, so cleanup-test-entities.sql sweeps them later.
 */
const API = process.env.API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';

const B = (s) => '\x1b[1m' + s + '\x1b[0m', G = (s) => '\x1b[32m' + s + '\x1b[0m', R = (s) => '\x1b[31m' + s + '\x1b[0m';
const Y = (s) => '\x1b[33m' + s + '\x1b[0m';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function signIn(email, display_name) {
  const reg = await call('POST', '/api/entities/register', { body: { email, display_name } });
  if (reg.status >= 400) throw new Error(`register ${reg.status}: ${JSON.stringify(reg.json)}`);
  const ver = await call('POST', '/api/entities/verify', { body: { email, otp: (reg.json && reg.json.dev_otp) || OTP } });
  if (ver.status >= 400) throw new Error(`verify ${ver.status}: ${JSON.stringify(ver.json)}`);
  const j = ver.json || {}, e = j.entity || j;
  return { token: j.token, bridge_id: e.bridge_id, id: e.identity_id, name: e.display_name, email };
}

// each entity's DECLARED input contract — what it receives, and therefore which pipeline it runs
const CAST = [
  { key: 'alpha', email: 'alpha@test-cb.com', name: 'Alpha Paints',
    role: 'paint distributor — adopts Royale Play (reference catalogue)',
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' },
            units: ['litre'], vertical: 'paint', catalogue: { product: 'Finishes' } },
    adopt: 'beta-royale-play@v1' },

  { key: 'beta', email: 'beta@test-cb.com', name: 'Beta Fresh',
    role: 'veg market — per-product units in one catalogue',
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' },
            units: ['kg', 'count', 'litre'], vertical: 'veg', catalogue: { product: 'Produce' } } },

  { key: 'gamma', email: 'gamma@test-cb.com', name: 'Gamma Document Services',
    role: 'forms — declared fields + a required proof',
    face: { method: 'form', vertical: 'documents', units: [], catalogue: { product: 'Templates' },
            order_input: { preset: 'form',
              schema: { properties: { reference: { type: 'string', maxLength: 40 },
                                      notes: { type: 'string', maxLength: 500 } }, required: ['reference'] },
              documents: { max: 2, accept: ['application/pdf'], required: true, label: 'Supporting document' } } } },

  { key: 'delta', email: 'delta@test-cb.com', name: 'Delta Trade',
    role: 'export — negotiable, the buyer names a price',
    face: { method: 'qtyprice', order_input: { preset: 'qtyprice', pipeline: 'commerce' },
            units: ['tonne'], vertical: 'trade', catalogue: { product: 'Goods' } } },
];

(async () => {
  console.log('═'.repeat(78));
  console.log(B('  SEED — Alpha · Beta · Gamma · Delta'));
  console.log('  API: ' + API);
  console.log('═'.repeat(78));

  const made = [];
  for (const c of CAST) {
    process.stdout.write('\n' + B(c.name.padEnd(26)) + c.role + '\n');
    try {
      const ent = await signIn(c.email, c.name);
      console.log('  ' + G('✓') + ' entity      ' + ent.bridge_id + '   ' + c.email);

      const f = await call('PUT', '/api/catalogue-face', { token: ent.token, body: { face: c.face } });
      if (f.status < 400) {
        const oi = c.face.order_input;
        console.log('  ' + G('✓') + ' declared    preset=' + oi.preset + ' pipeline=' + (oi.pipeline || 'payload')
          + (c.face.units.length ? ' units=' + c.face.units.join('/') : '')
          + (oi.documents ? ' proof=' + (oi.documents.required ? 'REQUIRED' : 'optional') : ''));
      } else console.log('  ' + R('✗') + ' face save failed ' + f.status + ': ' + JSON.stringify(f.json));

      if (c.adopt) {
        const a = await call('POST', '/api/assist/catalogue-adopt', { token: ent.token, body: { source: c.adopt, commercials: {} } });
        console.log('  ' + (a.status < 400 ? G('✓') + ' adopted     ' + c.adopt : R('✗') + ' adopt failed ' + a.status + ' — is ' + c.adopt + ' still seeded?'));
      }
      made.push({ ...ent, role: c.role });
    } catch (e) { console.log('  ' + R('✗') + ' ' + e.message); }
  }

  console.log('\n' + '─'.repeat(78));
  console.log(B('  THE CAST'));
  made.forEach((m) => console.log('   ' + m.bridge_id + '  ' + m.name.padEnd(26) + m.email));
  console.log('\n  Storefronts (note the param is ?bridge= , not ?b= ):');
  made.forEach((m) => console.log('   ' + m.name.padEnd(26)
    + API.replace('-api-production.up.railway.app', '-web.vercel.app') + '/shop.html?bridge=' + m.bridge_id));
  console.log('\n  ' + Y('Log in to any of them with its email + dev OTP ' + OTP + '.'));
  console.log('  ' + Y('All are @test-cb.com, so cleanup-test-entities.sql sweeps them when you are done.'));
  console.log('═'.repeat(78));
})().catch((e) => { console.error(R('seed crashed: ') + (e && e.stack || e)); process.exit(1); });

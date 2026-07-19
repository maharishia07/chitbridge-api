// tests/seed-traceability-demo.js — seed a demo traceability chain for the on-screen recall drama.
// Run:  TEST_URL=https://chitbridge-api-production.up.railway.app node tests/seed-traceability-demo.js
//
// Creates a real pharma-shaped chain (Aurex API batch → Meridian tablets → 3 distributors → pharmacies + a
// govt hospital → a 380-patient ward), all mandated-co-held by ONE OPERATOR you can sign into. Prints the
// operator login + the origin chit id to flag. Sign in as the operator in the app → 🧭 Traceability →
// paste the origin id → 🚨 Recall set ▸. NOTE: this writes real rows to the live DB (demo data).
require('dotenv').config();
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const OPERATOR_EMAIL = process.env.OP_EMAIL || 'trace-operator@demo-cb.com';   // stable, so you always log into the same operator

const C = { g:'\x1b[32m', c:'\x1b[36m', y:'\x1b[33m', z:'\x1b[0m', bold:'\x1b[1m' };

async function api(method, path, body, token) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers: { 'Content-Type':'application/json', ...(token && { Authorization:`Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  let data = {}; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
async function login(email, name) {
  const reg = await api('POST','/api/entities/register',{ display_name: name, email });
  const otp = reg.data.dev_otp || '123456';
  const ver = await api('POST','/api/entities/verify',{ email, otp });
  if (ver.status !== 200) throw new Error(`login ${email} failed: ${ver.data.message||ver.status}`);
  return { id: ver.data.entity.identity_id, token: ver.data.token, name, email, otp };
}
async function mint(name) {
  const email = `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${Date.now()}-${Math.floor(Math.random()*1e5)}@demo-cb.com`;
  return login(email, name);
}
// edge: {parents?, is_origin?, product, qty, unit}
async function handoff(from, to, edge, op) {
  const r = await api('POST','/api/chits/send', {
    receivers: [{ entity_id: to.id }], purpose: 'delivery_note', manual_subject: `${from.name} → ${to.name}: ${edge.product}`,
    line_items: [{ name: edge.product, quantity: edge.qty, unit: edge.unit, price: 0, total: 0 }],
    trace: { parents: edge.parents, is_origin: edge.is_origin, product: edge.product, qty: edge.qty, unit: edge.unit, network: { id:'demo-net', operator: op } },
  }, from.token);
  if (r.status !== 200) throw new Error(`handoff ${from.name}→${to.name} failed: ${r.status} ${r.data.message||''}`);
  return r.data.chit_id;
}

async function main() {
  console.log(`${C.bold}${C.c}Seeding traceability demo chain${C.z}  (server: ${BASE_URL})`);
  if ((await api('GET','/health')).status !== 200) throw new Error('server not healthy');

  const OP = await login(OPERATOR_EMAIL, 'Recall Operator (demo)');
  const op = OP.id;

  // transacting parties (ephemeral — you never log into these; the operator co-holds every edge)
  const aurex = await mint('Aurex API'), meridian = await mint('Meridian Formulator'),
        distM = await mint('Distributor Mumbai'), distC = await mint('Distributor Chennai'), distD = await mint('Distributor Delhi'),
        pharmM = await mint('Pharmacy Mumbai'), hospMad = await mint('Govt Hospital Madurai'), pharmD = await mint('Pharmacy Delhi'),
        ward = await mint('380-Patient Ward Madurai');

  const rows = [];
  const O  = await handoff(aurex,   meridian, { is_origin:true, product:'API-PC-24K19', qty:24, unit:'kg' }, op); rows.push(['O ','Aurex API → Meridian','API-PC-24K19','24 kg', O]);
  const c1 = await handoff(meridian, distM,   { parents:[O], product:'FG-PC-6621', qty:8, unit:'kg' }, op);      rows.push(['c1','Meridian → Dist Mumbai','FG-PC-6621','8 kg', c1]);
  const c2 = await handoff(meridian, distC,   { parents:[O], product:'FG-PC-6621', qty:8, unit:'kg' }, op);      rows.push(['c2','Meridian → Dist Chennai','FG-PC-6621','8 kg', c2]);
  const c3 = await handoff(meridian, distD,   { parents:[O], product:'FG-PC-6621', qty:8, unit:'kg' }, op);      rows.push(['c3','Meridian → Dist Delhi','FG-PC-6621','8 kg', c3]);
  const c4 = await handoff(distM,    pharmM,  { parents:[c1], product:'FG-PC-6621', qty:4, unit:'kg' }, op);     rows.push(['c4','Dist Mumbai → Pharmacy Mumbai','FG-PC-6621','4 kg', c4]);
  const c5 = await handoff(distC,    hospMad, { parents:[c2], product:'FG-PC-6621', qty:6, unit:'kg' }, op);     rows.push(['c5','Dist Chennai → Govt Hospital Madurai','FG-PC-6621','6 kg', c5]);
  const c6 = await handoff(distD,    pharmD,  { parents:[c3], product:'FG-PC-6621', qty:4, unit:'kg' }, op);     rows.push(['c6','Dist Delhi → Pharmacy Delhi','FG-PC-6621','4 kg', c6]);
  const c7 = await handoff(hospMad,  ward,    { parents:[c5], product:'FG-PC-6621', qty:6, unit:'kg' }, op);     rows.push(['c7','Govt Hospital → 380-Patient Ward','FG-PC-6621','6 kg', c7]);

  console.log(`\n${C.bold}${C.g}════ DEMO CHAIN SEEDED (8 edges · 3 hops · fan-out 3) ════${C.z}`);
  console.log(`${C.bold}Operator login:${C.z}  ${C.y}${OP.email}${C.z}   ${C.bold}OTP:${C.z} ${C.y}${OP.otp}${C.z}`);
  console.log(`${C.bold}Flag this batch (origin O):${C.z}  ${C.y}${O}${C.z}`);
  console.log(`\n${C.bold}Chain map${C.z} (product · qty · chit id):`);
  for (const [tag, hop, prod, qty, id] of rows) console.log(`  ${tag}  ${hop.padEnd(38)} ${prod}  ${qty.padEnd(6)}  ${id}`);
  console.log(`\n${C.c}Demo:${C.z} app → sign in as the operator (email + OTP above) → ${C.bold}🧭 Traceability${C.z} → paste the origin id → ${C.bold}🚨 Recall set ▸${C.z}`);
  console.log(`  Expect: ${C.bold}8 nodes, 3 hops${C.z}, exposure endpoints = Pharmacy Mumbai, Pharmacy Delhi, ${C.bold}380-Patient Ward${C.z}.`);
  console.log(`  Then ${C.bold}◂ To source${C.z} from ${C.y}${c7}${C.z} (the ward) → provenance back to Aurex in 3 hops.`);
  console.log(`  ₹ saved (defaults 200 blanket × ₹5000) ≈ ${C.bold}₹960,000${C.z}.\n`);
}

main().catch(e => { console.error(`\x1b[31mseed failed:\x1b[0m ${e.message}`); process.exit(1); });

// seed-2026-08-05.js — the cast, rebuilt on a clean database so every price is BORN stamped.
//
//   node scripts/seed-2026-08-05.js --phase1   create all six entities; seed the four INR catalogues
//   node scripts/seed-2026-08-05.js --phase2   seed Gamma (USD) and Delta (AED) AFTER their currency is set
//   node scripts/seed-2026-08-05.js --verify   check only, change nothing
//
// ── WHY TWO PHASES ─────────────────────────────────────────────────────────────────────────────────────────────
// A price is stamped with the OWNING ENTITY's currency at write time. `currency_code` is not settable through the
// API — deliberately, since it is a governance field rather than a profile preference — so Gamma and Delta start
// as INR like everyone else. Seeding their catalogues before their currency is corrected would stamp INR onto
// prices that are meant to be USD and AED, and stamping is the whole point of doing this on a clean database.
//
// So: phase 1 → one small SQL (printed at the end) → phase 2. The awkwardness is the feature working.
'use strict';

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const MODE = process.argv.includes('--phase2') ? 'phase2' : process.argv.includes('--verify') ? 'verify' : 'phase1';

const B = (s) => '\x1b[1m' + s + '\x1b[0m', G = (s) => '\x1b[32m' + s + '\x1b[0m';
const R = (s) => '\x1b[31m' + s + '\x1b[0m', Y = (s) => '\x1b[33m' + s + '\x1b[0m', D = (s) => '\x1b[2m' + s + '\x1b[0m';
let PASS = 0, FAIL = 0;
const ok  = (m) => { PASS++; console.log('   ' + G('✓') + ' ' + m); };
const bad = (m) => { FAIL++; console.log('   ' + R('✗') + ' ' + m); };
const step = (n, t) => console.log('\n' + B(n + ' · ' + t));

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
  return { token: j.token, bridge_id: e.bridge_id, id: e.identity_id, email };
}

// ── the document template: ONE catalogue entry = ONE form, with what it can READ declared alongside ────────────
const ITR2 = {
  preset: 'form',
  schema: { properties: {
    pan:                { type: 'string', maxLength: 10 },
    assessment_year:    { type: 'string', enum: ['2025-26', '2026-27'] },
    income_from_salary: { type: 'number' },
    deduction_80c:      { type: 'number' },
    bank_account_ifsc:  { type: 'string', maxLength: 11 },
  }, required: ['pan', 'assessment_year', 'income_from_salary', 'bank_account_ifsc'] },
  documents: { max: 2, accept: ['application/pdf'], required: true, label: 'Form 16' },
  // Label-anchored, never a regex: the reader escapes the label and builds the pattern, so a shop cannot ship
  // catastrophic backtracking to its own customers.
  sources: [{ key: 'form_16', label: 'Form 16', accept: ['application/pdf'], fields: [
    { after: 'PAN of the Employee', type: 'code', to: 'pan' },
    { after: 'Assessment Year', type: 'year', to: 'assessment_year' },
    { after: 'Income chargeable under the head Salaries', type: 'number', to: 'income_from_salary' },
    { after: 'section 80C', type: 'number', to: 'deduction_80c' },
  ] }],
};

const CAST = [
  { phase: 1, email: 'alpha@test-cb.com', name: 'Alpha Paints', currency: 'INR',
    role: 'cart · priced goods — the ordinary path (Track A1)',
    publish: { source_key: 'alpha-paints@v1', title: 'Alpha Paints — interior finishes', collection: 'Finishes',
      for_vertical: 'paint', items: [{ name: 'Tussar', unit: 'litre' }, { name: 'Ikkat', unit: 'litre' }] },
    commercials: { Tussar: { price: 950, unit: 'litre' }, Ikkat: { price: 875, unit: 'litre' } },
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['litre'], vertical: 'paint' } },

  { phase: 1, email: 'beta@test-cb.com', name: 'Beta Fresh', currency: 'INR',
    role: 'cart · produce — a second seller, for multi-party (Track B1/B3)',
    publish: { source_key: 'beta-fresh@v2', title: 'Beta Fresh — daily produce', collection: 'Produce',
      for_vertical: 'grocery', items: [{ name: 'Tomato', unit: 'kg' }, { name: 'Milk', unit: 'litre' }] },
    commercials: { Tomato: { price: 40, unit: 'kg' }, Milk: { price: 62, unit: 'litre' } },
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['kg', 'litre'], vertical: 'grocery' } },

  { phase: 1, email: 'epsilon@test-cb.com', name: 'Epsilon Help Desk', currency: null,
    role: 'enquiry · payload — NON-MONETARY, must carry no currency at all (Track A3)',
    publish: { source_key: 'epsilon-helpdesk@v2', title: 'Epsilon Help Desk', collection: 'Support',
      for_vertical: 'support', items: [{ name: 'Raise a ticket', unit: 'ticket' }] },
    commercials: {},
    face: { method: 'enquiry', order_input: { preset: 'enquiry', pipeline: 'payload' }, vertical: 'support' } },

  { phase: 1, email: 'zeta@test-cb.com', name: 'Zeta Documents', currency: 'INR',
    role: 'form · documents — the document path (Track A2)',
    publish: { source_key: 'zeta-documents@v1', title: 'Zeta Documents — filing templates', collection: 'Templates',
      for_vertical: 'services', items: [{ name: 'ITR-2 filing', unit: 'return' }] },
    commercials: { 'ITR-2 filing': { price: 2500, unit: 'return' } },
    face: { method: 'form', order_input: ITR2, vertical: 'services' } },

  { phase: 2, email: 'gamma@test-cb.com', name: 'Gamma Exports', currency: 'USD',
    role: 'range · buyer names a price — and the SECOND CURRENCY (Track B4)',
    publish: { source_key: 'gamma-exports@v1', title: 'Gamma Exports — commodities', collection: 'Commodities',
      for_vertical: 'trade', items: [{ name: 'Cold-rolled coil', unit: 'tonne' }] },
    commercials: { 'Cold-rolled coil': { price: 580, price_min: 540, price_max: 620, unit: 'tonne' } },
    face: { method: 'qtyprice', order_input: { preset: 'range', pipeline: 'commerce' }, units: ['tonne'], vertical: 'trade' } },

  { phase: 2, email: 'delta@test-cb.com', name: 'Delta Trading', currency: 'AED',
    role: 'qtyprice · band — the THIRD CURRENCY, so B4 is meaningful',
    publish: { source_key: 'delta-trading@v1', title: 'Delta Trading — metals', collection: 'Metals',
      for_vertical: 'trade', items: [{ name: 'Teak log', unit: 'tonne' }] },
    commercials: { 'Teak log': { price: 4200, price_min: 3800, price_max: 4600, unit: 'tonne' } },
    face: { method: 'qtyprice', order_input: { preset: 'qtyprice', pipeline: 'commerce' }, units: ['tonne'], vertical: 'trade' } },
];

async function seedOne(c) {
  console.log('   ' + B(c.name.padEnd(20)) + D(c.role));
  const ent = await signIn(c.email, c.name);

  const keys = {};
  c.publish.items.forEach((it) => Object.keys(it).forEach((k) => { if (k !== 'name') keys[k] = true; }));
  const p = await call('PUT', '/api/assist/catalogue-source', { token: ent.token, body: {
    source_key: c.publish.source_key, version: 'v1', for_vertical: c.publish.for_vertical,
    title: c.publish.title, collection: c.publish.collection,
    schema: { name: c.publish.collection, fields: [{ key: 'name', label: 'Name', type: 'text' }]
      .concat(Object.keys(keys).map((k) => ({ key: k, label: k.replace(/_/g, ' '), type: 'text' }))) },
    items: c.publish.items, commercials_fields: [{ key: 'price', label: 'Price', type: 'money' }],
    experience: { note: c.publish.title }, formatting: {} } });
  if (p.status >= 400) throw new Error(`publish ${p.status}: ${JSON.stringify(p.json).slice(0, 160)}`);

  const a = await call('POST', '/api/assist/catalogue-adopt', {
    token: ent.token, body: { source: c.publish.source_key, commercials: c.commercials } });
  if (a.status >= 400) throw new Error(`adopt ${a.status}: ${JSON.stringify(a.json).slice(0, 160)}`);

  await call('PUT', '/api/catalogue-face', { token: ent.token, body: { face: c.face } });
  await call('PATCH', '/api/entities/profile', { token: ent.token, body: { catalogue_visibility: 'public' } });
  ok(`${c.name.padEnd(20)} ${ent.bridge_id}  ${c.email}`);
  return { ...ent, name: c.name, currency: c.currency, role: c.role };
}

/** Read a storefront back and report what the price ACTUALLY looks like on the wire. */
async function inspect(m) {
  const r = await call('GET', `/api/catalogue/${encodeURIComponent(m.bridge_id)}`);
  const j = r.json || {};
  // Commercials are merged onto EACH ITEM (`item.commercials.price`), not held on the finish. My first version
  // read `finish.commercials` and reported "no prices found" for shops that were in fact correctly stamped —
  // a false negative, which on a verification step is the worst kind of wrong.
  const prices = [];
  for (const f of j.finishes || []) for (const it of f.items || []) {
    const c = it.commercials || {};
    if (c.price !== undefined) prices.push({ item: it.name, price: c.price });
  }
  for (const it of j.items || []) if (it.item_data && it.item_data.price !== undefined) prices.push({ item: it.item_data.name, price: it.item_data.price });
  return { status: r.status, shop: (j.shop || {}).display_name, currency_code: (j.shop || {}).currency_code, prices };
}

(async () => {
  console.log(B('\nSEED — ' + MODE + '   ' + API));

  const want = MODE === 'phase2' ? CAST.filter((c) => c.phase === 2)
             : MODE === 'phase1' ? CAST.filter((c) => c.phase === 1) : CAST;

  const made = [];
  if (MODE !== 'verify') {
    // PHASE 1 MUST CREATE ALL SIX, even though it only seeds four.
    //
    // v1 filtered phase-2 entities out of creation as well as seeding, so gamma@ and delta@ did not exist when the
    // "now run this SQL" instruction was followed — both UPDATEs matched ZERO rows, silently, and phase 2 then
    // stamped INR onto prices meant to be USD and AED. The header comment said "create all six" all along; the
    // code did not. An UPDATE that matches nothing reports success, which is what made it silent.
    if (MODE === 'phase1') {
      step(0, 'Register all six (so the currency SQL has rows to match)');
      for (const c of CAST.filter((x) => x.phase === 2)) {
        try { const e = await signIn(c.email, c.name); ok(`${c.name.padEnd(20)} ${e.bridge_id}  ${c.email}   ${Y('currency pending')}`); }
        catch (e) { bad(`${c.name}: ${e.message}`); }
      }
    }
    step(1, `Create + seed (${want.length})`);
    for (const c of want) {
      try { made.push(await seedOne(c)); } catch (e) { bad(`${c.name}: ${e.message}`); }
    }
  }

  step(2, 'Inspect — is every price BORN stamped?');
  for (const c of (MODE === 'verify' ? CAST : want)) {
    const m = made.find((x) => x.email === c.email) || { bridge_id: null, name: c.name };
    if (!m.bridge_id) { const s = await signIn(c.email, c.name).catch(() => null); if (s) m.bridge_id = s.bridge_id; }
    if (!m.bridge_id) { bad(`${c.name}: could not resolve`); continue; }
    const got = await inspect(m);
    if (!got.prices.length) {
      if (c.currency === null) ok(`${c.name.padEnd(20)} no prices — correct for a non-monetary shop`);
      else bad(`${c.name.padEnd(20)} no prices found`);
      continue;
    }
    const bare = got.prices.filter((p) => typeof p.price !== 'object');
    const stamped = got.prices.filter((p) => p.price && typeof p.price === 'object' && p.price.currency);
    const wrongCur = stamped.filter((p) => c.currency && p.price.currency !== c.currency);
    if (bare.length)      bad(`${c.name.padEnd(20)} ${bare.length} BARE price(s): ${JSON.stringify(bare[0])}`);
    else if (wrongCur.length) bad(`${c.name.padEnd(20)} stamped ${wrongCur[0].price.currency}, expected ${c.currency}`);
    else ok(`${c.name.padEnd(20)} ${stamped.length} price(s), all ${stamped[0].price.currency}  e.g. ${stamped[0].item}=${stamped[0].price.amount}`);
  }

  if (MODE === 'phase1') {
    console.log('\n' + B('NEXT — run this ONE SQL, then: node scripts/seed-2026-08-05.js --phase2'));
    console.log(D('   currency_code is not settable via the API (it is governance, not a preference),'));
    console.log(D('   so Gamma and Delta get theirs directly. Their catalogues are seeded AFTER, so'));
    console.log(D('   their prices are stamped USD and AED rather than INR.\n'));
    console.log("UPDATE identities SET currency_code = 'USD' WHERE email = 'gamma@test-cb.com';");
    console.log("UPDATE identities SET currency_code = 'AED' WHERE email = 'delta@test-cb.com';");
  }

  console.log('\n' + B(`${PASS} passed, ${FAIL} failed`) + '\n');
  if (made.length) {
    console.log(B('Storefronts:'));
    made.forEach((m) => console.log(`   https://chitbridge-web.vercel.app/shop.html?bridge=${m.bridge_id}   ${m.name}`));
    console.log();
  }
  process.exit(FAIL ? 1 : 0);
})();

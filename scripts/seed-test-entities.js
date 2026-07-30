'use strict';
/**
 * seed-test-entities.js — rebuild a known, POPULATED cast after scripts/reset-2-wipe.sql.
 *
 * Athi: "we can create all as new and feed some data as per plan — helpdesk, paint catalogue and so on."
 *
 * Five entities, each carrying real data so its storefront is browsable and orderable immediately. They are
 * deliberately different: between them they exercise EVERY pipeline and preset built this week, so a regression in
 * any one of them shows up as a broken storefront rather than as a silent gap.
 *
 *   ALPHA    paint distributor   commerce · cart      adopts the shared Royale Play blueprint (reference catalogue)
 *   BETA     veg market          commerce · cart      per-product units — kg · count · litre in ONE catalogue
 *   GAMMA    document services   payload  · form      two templates, each with its OWN fields + a required proof
 *   DELTA    trade / export      commerce · qtyprice  negotiation — the buyer names a price, seller's band bounds it
 *   EPSILON  help desk           payload  · form      one field: a question. The whole "helpdesk = a form" case.
 *
 * Everything goes through the REAL public API (register → dev OTP → verify → publish → adopt → declare), so it
 * exercises the same path a human would and works against any environment.
 *
 *   Run:  node scripts/seed-test-entities.js
 *         API=http://localhost:3000 node scripts/seed-test-entities.js
 *
 * ⚠️ Writes to the live database. All five use @test-cb.com, so cleanup-test-entities.sql sweeps them later.
 */
const API = process.env.API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const WEB = API.replace('-api-production.up.railway.app', '-web.vercel.app');

const B = (s) => '\x1b[1m' + s + '\x1b[0m', G = (s) => '\x1b[32m' + s + '\x1b[0m';
const R = (s) => '\x1b[31m' + s + '\x1b[0m', Y = (s) => '\x1b[33m' + s + '\x1b[0m';

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

// ── one form declaration per template, because ONE CATALOGUE ENTRY = ONE FORM ──
const ITR2 = { preset: 'form',
  schema: { properties: {
    pan:                { type: 'string', maxLength: 10 },
    assessment_year:    { type: 'string', enum: ['2025-26', '2026-27'] },
    income_from_salary: { type: 'number' },
    deduction_80c:      { type: 'number' },
    bank_account_ifsc:  { type: 'string', maxLength: 11 },
  }, required: ['pan', 'assessment_year', 'income_from_salary', 'bank_account_ifsc'] },
  documents: { max: 2, accept: ['application/pdf'], required: true, label: 'Form 16' },
  // WHAT THIS TEMPLATE CAN READ. Label-anchored, never a regex — the browser escapes the label and builds the
  // pattern, so a shop cannot ship catastrophic backtracking to its own customers.
  sources: [{ key: 'form_16', label: 'Form 16', accept: ['application/pdf'], fields: [
    { field: 'pan',    after: 'PAN of the Employee', type: 'code',   to: 'pan' },
    { field: 'ay',     after: 'Assessment Year',     type: 'year',   to: 'assessment_year' },
    { field: 'salary', after: 'Income chargeable under the head Salaries', type: 'number', to: 'income_from_salary' },
    { field: 'c80c',   after: 'section 80C',         type: 'number', to: 'deduction_80c' },
  ] }] };

const INVOICE = { preset: 'form',
  schema: { properties: {
    buyer_name:        { type: 'string', maxLength: 120 },
    po_number:         { type: 'string', maxLength: 40 },
    incoterm:          { type: 'string', enum: ['FOB', 'CIF', 'EXW'] },
    goods_description: { type: 'string', maxLength: 200 },
    total_value:       { type: 'number' },
    currency:          { type: 'string', enum: ['USD', 'EUR', 'INR', 'AED'] },
  }, required: ['buyer_name', 'total_value', 'currency'] },
  documents: { max: 1, accept: ['application/pdf'], required: false, label: 'Purchase Order' } };

const QUESTION = { preset: 'form',
  schema: { properties: {
    question: { type: 'string', maxLength: 2000 },
    order_ref: { type: 'string', maxLength: 40 },
  }, required: ['question'] } };

const CAST = [
  { key: 'alpha', email: 'alpha@test-cb.com', name: 'Alpha Paints',
    role: 'paint distributor — adopts the shared Royale Play blueprint',
    adopt: { source: 'beta-royale-play@v1', commercials: { Tussar: { price: 950, unit: 'litre' }, Ikkat: { price: 875, unit: 'litre' } } },
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' },
            units: ['litre'], vertical: 'paint', catalogue: { product: 'Finishes', story: 'Designer wall finishes' } } },

  { key: 'beta', email: 'beta@test-cb.com', name: 'Beta Fresh',
    role: 'veg market — three different units in ONE catalogue',
    publish: { source_key: 'beta-fresh@v1', title: 'Beta Fresh — daily produce', collection: 'Produce', for_vertical: 'veg',
      items: [ { name: 'Tomato', unit: 'kg',    category: 'vegetable', local_names: ['Thakkali', 'Tamatar'], botanical_name: 'Solanum lycopersicum' },
               { name: 'Egg',    unit: 'count', category: 'poultry',   local_names: ['Muttai', 'Anda'] },
               { name: 'Milk',   unit: 'litre', category: 'dairy',     local_names: ['Paal', 'Doodh'] } ] },
    adopt: { commercials: { Tomato: { price: 40, unit: 'kg' }, Egg: { price: 7, unit: 'count' }, Milk: { price: 62, unit: 'litre' } } },
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' },
            units: ['kg', 'count', 'litre'], vertical: 'veg', catalogue: { product: 'Produce', story: 'Daily fresh produce' } } },

  { key: 'gamma', email: 'gamma@test-cb.com', name: 'Gamma Document Services',
    role: 'forms — two templates, each with its own fields and its own proof rule',
    publish: { source_key: 'gamma-documents@v1', title: 'Gamma Document Services — filing templates', collection: 'Templates', for_vertical: 'documents',
      items: [ { name: 'ITR-2 (income tax return)',  doc_type: 'tax-return', jurisdiction: 'IN',
                 note: 'Salary, deductions and TDS. Bring your Form 16.',   order_input: ITR2 },
               { name: 'Commercial Invoice (export)', doc_type: 'trade-doc', jurisdiction: 'ANY',
                 note: 'Buyer, goods, value and incoterm. Bring your PO.',  order_input: INVOICE } ] },
    adopt: { commercials: {} },
    face: { method: 'form', vertical: 'documents', units: [], catalogue: { product: 'Templates', story: 'Fill online, attach your source document' },
            order_input: { preset: 'form', schema: { properties: { notes: { type: 'string', maxLength: 500 } } } } } },

  { key: 'delta', email: 'delta@test-cb.com', name: 'Delta Trade',
    role: 'export — negotiable; the buyer names a price inside the seller\'s band',
    publish: { source_key: 'delta-trade@v1', title: 'Delta Trade — commodities', collection: 'Goods', for_vertical: 'trade',
      items: [ { name: 'Cold-rolled coil', unit: 'tonne', grade: 'CRC-1', origin: 'IN' },
               { name: 'Teak log',         unit: 'tonne', grade: 'FAS',   origin: 'MM' } ] },
    adopt: { commercials: { 'Cold-rolled coil': { price: 48250, unit: 'tonne', price_min: 45000, price_max: 52000 },
                            'Teak log':         { price: 3200,  unit: 'tonne', price_min: 2800,  price_max: 3600 } } },
    face: { method: 'qtyprice', order_input: { preset: 'range', pipeline: 'commerce' },
            units: ['tonne'], vertical: 'trade', catalogue: { product: 'Goods', story: 'Commodities, negotiated' } } },

  { key: 'epsilon', email: 'epsilon@test-cb.com', name: 'Epsilon Help Desk',
    role: 'help desk — a form with one field; the question becomes a chit',
    publish: { source_key: 'epsilon-helpdesk@v1', title: 'Epsilon Help Desk', collection: 'Support', for_vertical: 'support',
      items: [ { name: 'Ask a question', note: 'Describe the issue. We reply on the same record.', order_input: QUESTION } ] },
    adopt: { commercials: {} },
    face: { method: 'form', vertical: 'support', units: [], catalogue: { product: 'Support', story: 'Ask us anything' },
            order_input: { preset: 'form', schema: { properties: { question: { type: 'string', maxLength: 2000 } }, required: ['question'] } } } },
];

(async () => {
  console.log('═'.repeat(80));
  console.log(B('  SEED — Alpha · Beta · Gamma · Delta · Epsilon, with data'));
  console.log('  API: ' + API);
  console.log('═'.repeat(80));

  const made = [];
  for (const c of CAST) {
    console.log('\n' + B(c.name) + '  — ' + c.role);
    try {
      const ent = await signIn(c.email, c.name);
      console.log('  ' + G('✓') + ' entity     ' + ent.bridge_id + '  ' + c.email);

      // publish its own blueprint (Alpha reuses the shared Royale Play one)
      let sourceKey = c.adopt && c.adopt.source;
      if (c.publish) {
        const keys = {};
        c.publish.items.forEach((it) => Object.keys(it).forEach((k) => { if (k !== 'name') keys[k] = true; }));
        const body = { source_key: c.publish.source_key, version: 'v1', for_vertical: c.publish.for_vertical,
          title: c.publish.title, collection: c.publish.collection,
          schema: { name: c.publish.collection, fields: [{ key: 'name', label: 'Name', type: 'text' }]
            .concat(Object.keys(keys).map((k) => ({ key: k, label: k.replace(/_/g, ' '), type: 'text' }))) },
          items: c.publish.items, commercials_fields: [{ key: 'price', label: 'Price', type: 'money' }],
          experience: { note: c.publish.title }, formatting: {} };
        const p = await call('PUT', '/api/assist/catalogue-source', { token: ent.token, body });
        console.log('  ' + (p.status < 400 ? G('✓') + ' published  ' + c.publish.source_key + '  (' + c.publish.items.length + ' item(s))'
                                           : R('✗') + ' publish failed ' + p.status + ': ' + JSON.stringify(p.json)));
        sourceKey = c.publish.source_key;
      }

      // adopt it, with prices where the pipeline needs them
      if (sourceKey) {
        const a = await call('POST', '/api/assist/catalogue-adopt',
          { token: ent.token, body: { source: sourceKey, commercials: (c.adopt && c.adopt.commercials) || {} } });
        const n = Object.keys((c.adopt && c.adopt.commercials) || {}).length;
        console.log('  ' + (a.status < 400 ? G('✓') + ' adopted    ' + sourceKey + (n ? '  (' + n + ' priced)' : '')
                                           : R('✗') + ' adopt failed ' + a.status + ' — is ' + sourceKey + ' seeded? ' + JSON.stringify(a.json)));
      }

      // declare what it receives, and make the catalogue publicly visible (b114 defaults new entities to private)
      const f = await call('PUT', '/api/catalogue-face', { token: ent.token, body: { face: c.face } });
      const oi = c.face.order_input;
      console.log('  ' + (f.status < 400
        ? G('✓') + ' declared   preset=' + oi.preset + ' pipeline=' + (oi.pipeline || 'payload')
          + (c.face.units.length ? ' units=' + c.face.units.join('/') : '')
          + (oi.documents ? ' proof=' + (oi.documents.required ? 'REQUIRED' : 'optional') : '')
        : R('✗') + ' face save failed ' + f.status));

      const v = await call('PATCH', '/api/entities/profile', { token: ent.token, body: { catalogue_visibility: 'public' } });
      console.log('  ' + (v.status < 400 ? G('✓') + ' visible    catalogue_visibility=public (b114)'
                                         : Y('·') + ' visibility not set (' + v.status + ') — b114 may not be applied yet; pre-b114 default is public anyway'));

      made.push({ ...ent, role: c.role });
    } catch (e) { console.log('  ' + R('✗') + ' ' + e.message); }
  }

  console.log('\n' + '─'.repeat(80));
  console.log(B('  THE CAST'));
  made.forEach((m) => console.log('   ' + m.bridge_id + '  ' + m.name.padEnd(26) + m.email));
  console.log('\n  ' + B('Storefronts') + '  (the param is ?bridge= , not ?b=)');
  made.forEach((m) => console.log('   ' + m.name.padEnd(26) + WEB + '/shop.html?bridge=' + m.bridge_id));
  console.log('\n  ' + Y('Log into any of them with its email + dev OTP ' + OTP + '.'));
  console.log('  ' + Y('All @test-cb.com — cleanup-test-entities.sql sweeps them when you are done.'));
  console.log('═'.repeat(80));
})().catch((e) => { console.error(R('seed crashed: ') + (e && e.stack || e)); process.exit(1); });

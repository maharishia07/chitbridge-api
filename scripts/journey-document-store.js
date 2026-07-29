'use strict';
/**
 * journey-document-store.js — THE TRAVEL PATH, end to end, against the LIVE API.
 *
 * Athi, 2026-07-29: "create a store called document, load a couple of different templates, and show me the travel path
 * from the storefront… I upload the document, filling happens, I see what has been filled, send it across, and the
 * filled document should be visible in the document entity."
 *
 * This is the live-run nobody has done. It creates REAL entities through the public API (dev OTP), so:
 *   ⚠️ It writes to the live database. Every identity it makes uses a @test-cb.com email, so
 *      scripts/cleanup-test-entities.sql sweeps them.
 *
 *   Run:  node scripts/journey-document-store.js
 *         API=https://… node scripts/journey-document-store.js     (defaults to production)
 *
 * STRUCTURAL NOTE discovered while writing this: the storefront's orderable list is built ONLY from `finishes`
 * (the adopted reference catalogue). `items` (a store's own catalogue_items) render read-only with NO order button.
 * So a form must travel the blueprint → adopt path to be submittable. That is what steps 2-3 do.
 */
const API = process.env.API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';

const B = (s) => '\x1b[1m' + s + '\x1b[0m';
const G = (s) => '\x1b[32m' + s + '\x1b[0m';
const R = (s) => '\x1b[31m' + s + '\x1b[0m';
const Y = (s) => '\x1b[33m' + s + '\x1b[0m';
const hr = (c) => console.log((c || '─').repeat(80));

let step = 0, failed = 0;
function head(t) { step++; console.log('\n' + B(`STEP ${step} · ${t}`)); }
function ok(m)   { console.log('   ' + G('✓ ') + m); }
function bad(m)  { console.log('   ' + R('✗ ') + m); failed++; }
function note(m) { console.log('   ' + Y('· ') + m); }

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

// register → verify → token. Re-registering an existing email just re-issues the OTP, so this is re-runnable.
async function signIn(email, display_name) {
  const reg = await call('POST', '/api/entities/register', { body: { email, display_name } });
  if (reg.status >= 400) throw new Error(`register ${reg.status}: ${JSON.stringify(reg.json)}`);
  const otp = (reg.json && reg.json.dev_otp) || OTP;
  const ver = await call('POST', '/api/entities/verify', { body: { email, otp } });
  if (ver.status >= 400) throw new Error(`verify ${ver.status}: ${JSON.stringify(ver.json)}`);
  const j = ver.json || {};
  const ent = j.entity || j;
  return { token: j.token, bridge_id: ent.bridge_id, id: ent.identity_id, name: ent.display_name };
}

// ── ONE CATALOGUE ENTRY = ONE FORM. Each template carries its OWN declaration, so the customer sees the fields of
// the template they picked — not one catalogue-wide set. Two deliberately unrelated domains. ──
const TEMPLATES = [
  { name: 'ITR-2 (income tax return)', doc_type: 'tax-return', jurisdiction: 'IN',
    note: 'Salary, deductions and TDS. Bring your Form 16.',
    order_input: { preset: 'form',
      schema: { properties: {
          pan:                { type: 'string', maxLength: 10 },
          assessment_year:    { type: 'string', enum: ['2025-26', '2026-27'] },
          income_from_salary: { type: 'number' },
          deduction_80c:      { type: 'number' },
          bank_account_ifsc:  { type: 'string', maxLength: 11 },
        }, required: ['pan', 'assessment_year', 'income_from_salary', 'bank_account_ifsc'] },
      documents: { max: 2, accept: ['application/pdf'], required: true, label: 'Form 16' } } },

  { name: 'Commercial Invoice (export)', doc_type: 'trade-doc', jurisdiction: 'ANY',
    note: 'Buyer, goods, value and incoterm. Bring your Purchase Order.',
    order_input: { preset: 'form',
      schema: { properties: {
          buyer_name:       { type: 'string', maxLength: 120 },
          po_number:        { type: 'string', maxLength: 40 },
          incoterm:         { type: 'string', enum: ['FOB', 'CIF', 'EXW'] },
          goods_description:{ type: 'string', maxLength: 200 },
          total_value:      { type: 'number' },
          currency:         { type: 'string', enum: ['USD', 'EUR', 'INR', 'AED'] },
        }, required: ['buyer_name', 'total_value', 'currency'] },
      documents: { max: 1, accept: ['application/pdf'], required: false, label: 'Purchase Order' } } },
];

// The CATALOGUE-level declaration is only a fallback — each entry above overrides it (RFC 7386, item wins).
const ORDER_INPUT = { preset: 'form', schema: { properties: { notes: { type: 'string', maxLength: 500 } } } };

(async () => {
  hr('═'); console.log(B('  TRAVEL PATH — a DOCUMENT store, its templates, and a filled return coming back'));
  console.log('  API: ' + API); hr('═');

  let store, customer, sourceKey, chitId;

  // ─────────────────────────────────────────────────────────────────────────────
  head('Create the DOCUMENT store (a real entity)');
  try {
    store = await signIn('document.store@test-cb.com', 'Document Services');
    ok(`entity "${store.name}"  ·  bridge_id ${B(store.bridge_id)}`);
    // shop.html reads the param `bridge` — NOT `b`. An earlier version of this line printed ?b= and the link silently
    // loaded an empty shop, which cost real time to diagnose.
    note(`storefront: ${API.replace('-api-production.up.railway.app', '-web.vercel.app')}/shop.html?bridge=${store.bridge_id}`);
  } catch (e) { bad('could not create the store — ' + e.message); return finish(); }

  // ─────────────────────────────────────────────────────────────────────────────
  head('Publish the templates as a BLUEPRINT (this is what makes them callable by others)');
  sourceKey = 'document-services@v1';
  {
    const body = {
      source_key: sourceKey, version: 'v1', for_vertical: 'documents',
      title: 'Document Services — filing templates', collection: 'Templates',
      schema: { name: 'Template', fields: [{ key: 'name', label: 'Template', type: 'text' },
                                           { key: 'doc_type', label: 'Type', type: 'text' },
                                           { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
                                           { key: 'note', label: 'What to bring', type: 'text' }] },
      items: TEMPLATES,
      commercials_fields: [{ key: 'price', label: 'Fee', type: 'money' }],
      experience: { note: 'Filing templates — fill online, attach your source document.' }, formatting: {},
    };
    const r = await call('PUT', '/api/assist/catalogue-source', { token: store.token, body });
    if (r.status < 400) ok(`published "${sourceKey}" with ${TEMPLATES.length} templates: ` + TEMPLATES.map((t) => t.name).join(' · '));
    else bad(`publish failed ${r.status}: ${JSON.stringify(r.json)}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  head('The store ADOPTS its own blueprint so the templates appear on its storefront');
  {
    const r = await call('POST', '/api/assist/catalogue-adopt', { token: store.token, body: { source: sourceKey, commercials: {} } });
    if (r.status < 400) ok('adopted — templates are now on the storefront');
    else bad(`adopt failed ${r.status}: ${JSON.stringify(r.json)}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  head('DECLARE what the store receives — the form fields AND the required proof');
  {
    const face = { method: 'form', order_input: ORDER_INPUT, units: [], vertical: 'documents',
                   facets: {}, catalogue: { product: 'Templates', story: 'Filing templates' }, items: [] };
    const r = await call('PUT', '/api/catalogue-face', { token: store.token, body: { face } });
    if (r.status < 400) {
      ok('catalogue-level fallback declared; each TEMPLATE overrides it with its own form:');
      TEMPLATES.forEach((tpl) => {
        const s = tpl.order_input.schema, d = tpl.order_input.documents;
        note(`${tpl.name} → ${Object.keys(s.properties).length} fields, ${(s.required || []).length} required`
           + `, proof: ${d.required ? 'REQUIRED ' : 'optional '}${d.label} (${d.accept.join('/')}, max ${d.max})`);
      });
    } else bad(`face save failed ${r.status}: ${JSON.stringify(r.json)}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  head('THE STOREFRONT — what a visitor (e.g. from Alpha Timbers) actually sees');
  {
    const r = await call('GET', `/api/catalogue/${encodeURIComponent(store.bridge_id)}`);
    if (r.status >= 400) { bad(`storefront ${r.status}: ${JSON.stringify(r.json)}`); }
    else {
      const oi = (r.json.shop || {}).order_input || {};
      const fin = (r.json.finishes || []).flatMap((f) => f.items || []);
      ok(`shop "${r.json.shop.display_name}" is live`);
      ok(`order_input reached the storefront → preset=${B(oi.preset)} pipeline=${B(oi.pipeline)}`);
      if (oi.pipeline !== 'payload') bad('expected the PAYLOAD pipeline for a form catalogue');
      if (fin.length) ok(`templates visible: ${fin.map((i) => i.name).join('  ·  ')}`);
      else bad('no templates visible on the storefront');
      // ONE ENTRY = ONE FORM: each template must carry its OWN declaration to the storefront, or the customer would
      // be shown the wrong fields for whichever one they pick.
      let perItem = 0;
      fin.forEach((i) => {
        const d = i.order_input;
        if (!d) { bad(`"${i.name}" carries NO declaration — the customer would see the wrong form`); return; }
        perItem++;
        const props = Object.keys((d.schema && d.schema.properties) || {}).length;
        note(`${i.name} → ${props} fields` + (d.documents ? `, proof: ${d.documents.required ? 'REQUIRED ' : 'optional '}${d.documents.label}` : ', no proof required'));
      });
      if (perItem === fin.length && fin.length) ok(`every template carries its own form (${perItem}/${fin.length})`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  head('The customer FILLS the form and ATTACHES the Form 16 — then sends it across');
  {
    const email = 'alphatimbers.buyer@test-cb.com';
    const start = await call('POST', `/api/catalogue/${encodeURIComponent(store.bridge_id)}/order/start`,
      { body: { identifier: email, name: 'Alpha Timbers (buyer)' } });
    if (start.status >= 400) { bad(`order/start ${start.status}: ${JSON.stringify(start.json)}`); return finish(); }
    ok('identity verified by OTP (the customer needs no account beforehand)');

    const pdf = Buffer.from('%PDF-1.4\nForm 16 — AY 2026-27 — illustrative test document\n%%EOF').toString('base64');
    const payload = { pan: 'ABCDE1234F', assessment_year: '2026-27', income_from_salary: 1718600,
                      deduction_80c: 150000, bank_account_ifsc: 'HDFC0001234', notes: 'Filed via Alpha Timbers' };
    const confirm = await call('POST', `/api/catalogue/${encodeURIComponent(store.bridge_id)}/order/confirm`, {
      body: { identifier: email, name: 'Alpha Timbers (buyer)', otp: (start.json && start.json.dev_otp) || OTP, location: 'Bengaluru',
              line_items: [{ kind: 'payload', finish: TEMPLATES[0].name, name: TEMPLATES[0].name, payload,
                             documents: [{ name: 'form16.pdf', mime: 'application/pdf', data_base64: pdf }] }] },
    });
    if (confirm.status >= 400) { bad(`order/confirm ${confirm.status}: ${JSON.stringify(confirm.json)}`); return finish(); }
    chitId = confirm.json.chit_id;
    ok('submitted — chit ' + B(chitId));
    if (confirm.json.documents_stored === true) ok('the Form 16 was stored per-copy (both parties hold their own)');
    else if (confirm.json.documents_stored === false) bad('proof sealed on the chit, but the BLOB write failed');
    else bad('no documents_stored in the response — the document did not travel');
    (confirm.json.documents || []).forEach((d) => note(`proof: ${d.name} → sha256 ${d.sha256.slice(0, 24)}…`));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  head('THE FILLED DOCUMENT, seen from inside the DOCUMENT ENTITY');
  {
    const r = await call('GET', `/api/chits/${encodeURIComponent(chitId)}`, { token: store.token });
    if (r.status >= 400) { bad(`chit read ${r.status}: ${JSON.stringify(r.json)}`); }
    else {
      const c = r.json.chit || r.json;
      const lines = (c.line_items || (c.detail && c.detail.line_items) || []);
      const li = lines[0] || {};
      ok('the document store can open the submission it received');
      if (li.payload) {
        ok('FILLED VALUES visible to the store:');
        Object.entries(li.payload).forEach(([k, v]) => console.log('        ' + k.padEnd(20) + ' = ' + v));
      } else bad('no payload on the line item — the filled form did not arrive');
      if (li.documents && li.documents.length) {
        ok('PROOF attached and sealed:');
        li.documents.forEach((d) => console.log(`        ${d.name}  ${d.mime}  ${d.size}B  sha256 ${d.sha256.slice(0, 24)}…`));
      } else bad('no document metadata on the line item');
    }
  }

  finish();

  function finish() {
    hr('─');
    if (failed) console.log(R(`  ${failed} step(s) failed — see above.`));
    else console.log(G('  THE WHOLE PATH WORKS: store → templates → storefront → fill + attach → sealed chit → visible to the store.'));
    console.log(Y('  Entities created use @test-cb.com; sweep with scripts/cleanup-test-entities.sql when done.'));
    hr('═');
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(R('journey crashed: ') + (e && e.stack || e)); process.exit(1); });

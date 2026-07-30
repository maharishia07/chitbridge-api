'use strict';
/**
 * reset-and-seed.js — ONE COMMAND: backup → wipe → migrate → seed → verify.
 *
 * Athi: "can't we run as a script or something in one go? otherwise I'll take the whole day."
 *
 *   node scripts/reset-and-seed.js --dry-run          ← ALWAYS start here. Touches nothing.
 *   node scripts/reset-and-seed.js --go               ← does it
 *   node scripts/reset-and-seed.js --go --skip-wipe   ← just migrate + seed (keep existing data)
 *
 * ── ONE-TIME SETUP (why this is needed) ───────────────────────────────────────────────────────────────────────
 * The wipe has to DELETE across tables that are FORCE ROW LEVEL SECURITY, and the app role `cb_app` is
 * deliberately least-privilege (b65) — it cannot bypass RLS. So this needs the ADMIN connection string, the same
 * privilege the Supabase SQL Editor runs with.
 *
 *   Supabase → Project Settings → Database → Connection string → URI   (the `postgres` user)
 *   Put it in chitbridge-api/.env as:      ADMIN_DATABASE_URL=postgresql://postgres:…@…:5432/postgres
 *
 * `.env` is gitignored, so it stays on your disk. Nothing here ever prints the password.
 * If ADMIN_DATABASE_URL is absent, the script still runs --skip-wipe (migrate + seed via the API) and tells you.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const DRY = has('--dry-run') || !has('--go');
const SKIP_WIPE = has('--skip-wipe');
const API = process.env.API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const WEB = API.replace('-api-production.up.railway.app', '-web.vercel.app');
const ADMIN_URL = (process.env.ADMIN_DATABASE_URL || '').trim();

const B = (s) => '\x1b[1m' + s + '\x1b[0m', G = (s) => '\x1b[32m' + s + '\x1b[0m';
const R = (s) => '\x1b[31m' + s + '\x1b[0m', Y = (s) => '\x1b[33m' + s + '\x1b[0m', D = (s) => '\x1b[2m' + s + '\x1b[0m';
const hr = (c) => console.log((c || '─').repeat(80));
const step = (n, t) => console.log('\n' + B(`${n} · ${t}`));
const ok = (m) => console.log('   ' + G('✓ ') + m);
const bad = (m) => console.log('   ' + R('✗ ') + m);
const note = (m) => console.log('   ' + Y('· ') + m);

// ── the cast, with data (same definitions as seed-test-entities.js, kept here so this file runs standalone) ──
const ITR2 = { preset: 'form',
  schema: { properties: { pan: { type: 'string', maxLength: 10 }, assessment_year: { type: 'string', enum: ['2025-26', '2026-27'] },
    income_from_salary: { type: 'number' }, deduction_80c: { type: 'number' }, bank_account_ifsc: { type: 'string', maxLength: 11 } },
    required: ['pan', 'assessment_year', 'income_from_salary', 'bank_account_ifsc'] },
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
  schema: { properties: { buyer_name: { type: 'string', maxLength: 120 }, po_number: { type: 'string', maxLength: 40 },
    incoterm: { type: 'string', enum: ['FOB', 'CIF', 'EXW'] }, goods_description: { type: 'string', maxLength: 200 },
    total_value: { type: 'number' }, currency: { type: 'string', enum: ['USD', 'EUR', 'INR', 'AED'] } },
    required: ['buyer_name', 'total_value', 'currency'] },
  documents: { max: 1, accept: ['application/pdf'], required: false, label: 'Purchase Order' } };
const QUESTION = { preset: 'form',
  schema: { properties: { question: { type: 'string', maxLength: 2000 }, order_ref: { type: 'string', maxLength: 40 } },
    required: ['question'] } };

const CAST = [
  { email: 'alpha@test-cb.com', name: 'Alpha Paints', role: 'paint · cart · adopts the shared Royale Play blueprint',
    adopt: { source: 'beta-royale-play@v1', commercials: { Tussar: { price: 950, unit: 'litre' }, Ikkat: { price: 875, unit: 'litre' } } },
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['litre'], vertical: 'paint',
            catalogue: { product: 'Finishes', story: 'Designer wall finishes' } } },
  { email: 'beta@test-cb.com', name: 'Beta Fresh', role: 'veg · cart · three units in ONE catalogue',
    publish: { source_key: 'beta-fresh@v1', title: 'Beta Fresh — daily produce', collection: 'Produce', for_vertical: 'veg',
      items: [{ name: 'Tomato', unit: 'kg', category: 'vegetable', local_names: ['Thakkali', 'Tamatar'], botanical_name: 'Solanum lycopersicum' },
              { name: 'Egg', unit: 'count', category: 'poultry', local_names: ['Muttai', 'Anda'] },
              { name: 'Milk', unit: 'litre', category: 'dairy', local_names: ['Paal', 'Doodh'] }] },
    adopt: { commercials: { Tomato: { price: 40, unit: 'kg' }, Egg: { price: 7, unit: 'count' }, Milk: { price: 62, unit: 'litre' } } },
    face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['kg', 'count', 'litre'], vertical: 'veg',
            catalogue: { product: 'Produce', story: 'Daily fresh produce' } } },
  { email: 'gamma@test-cb.com', name: 'Gamma Document Services', role: 'forms · payload · two templates, each with its own proof rule',
    publish: { source_key: 'gamma-documents@v1', title: 'Gamma Document Services — filing templates', collection: 'Templates', for_vertical: 'documents',
      items: [{ name: 'ITR-2 (income tax return)', doc_type: 'tax-return', jurisdiction: 'IN', note: 'Bring your Form 16.', order_input: ITR2 },
              { name: 'Commercial Invoice (export)', doc_type: 'trade-doc', jurisdiction: 'ANY', note: 'Bring your PO.', order_input: INVOICE }] },
    adopt: { commercials: {} },
    face: { method: 'form', vertical: 'documents', units: [], catalogue: { product: 'Templates', story: 'Fill online, attach your source document' },
            order_input: { preset: 'form', schema: { properties: { notes: { type: 'string', maxLength: 500 } } } } } },
  { email: 'delta@test-cb.com', name: 'Delta Trade', role: 'trade · range · seller band, buyer names a price',
    publish: { source_key: 'delta-trade@v1', title: 'Delta Trade — commodities', collection: 'Goods', for_vertical: 'trade',
      items: [{ name: 'Cold-rolled coil', unit: 'tonne', grade: 'CRC-1', origin: 'IN' },
              { name: 'Teak log', unit: 'tonne', grade: 'FAS', origin: 'MM' }] },
    adopt: { commercials: { 'Cold-rolled coil': { price: 48250, unit: 'tonne', price_min: 45000, price_max: 52000 },
                            'Teak log': { price: 3200, unit: 'tonne', price_min: 2800, price_max: 3600 } } },
    face: { method: 'qtyprice', order_input: { preset: 'range', pipeline: 'commerce' }, units: ['tonne'], vertical: 'trade',
            catalogue: { product: 'Goods', story: 'Commodities, negotiated' } } },
  { email: 'epsilon@test-cb.com', name: 'Epsilon Help Desk', role: 'help desk · payload · ONE field: a question',
    publish: { source_key: 'epsilon-helpdesk@v1', title: 'Epsilon Help Desk', collection: 'Support', for_vertical: 'support',
      items: [{ name: 'Ask a question', note: 'Describe the issue. We reply on the same record.', order_input: QUESTION }] },
    adopt: { commercials: {} },
    face: { method: 'form', vertical: 'support', units: [], catalogue: { product: 'Support', story: 'Ask us anything' },
            order_input: { preset: 'form', schema: { properties: { question: { type: 'string', maxLength: 2000 } }, required: ['question'] } } } },
];

// ── API helpers ──
async function call(method, p, { token, body } = {}) {
  const res = await fetch(API + p, { method,
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

(async () => {
  hr('═');
  console.log(B('  RESET AND SEED') + (DRY ? Y('   — DRY RUN, nothing will be changed') : R('   — LIVE')));
  console.log('  API   ' + API);
  console.log('  admin ' + (ADMIN_URL ? G('ADMIN_DATABASE_URL is set') : R('ADMIN_DATABASE_URL missing — wipe/migrate will be skipped')));
  hr('═');

  let db = null;
  const wipeWanted = !SKIP_WIPE;
  if (ADMIN_URL) {
    if (/\[YOUR-REF\]|CHANGE|example\.com/i.test(ADMIN_URL)) { bad('ADMIN_DATABASE_URL still looks like a placeholder — refusing.'); process.exit(1); }
    db = new Client({ connectionString: ADMIN_URL, ssl: { rejectUnauthorized: false } });
    try { await db.connect(); } catch (e) { bad('could not connect with ADMIN_DATABASE_URL: ' + e.message); process.exit(1); }
  }

  // ── 1 · WHERE WE ARE ──
  step(1, 'Where we are');
  if (db) {
    const c = await db.query(`SELECT
        (SELECT count(*) FROM identities)                              AS identities,
        (SELECT count(*) FROM identities WHERE identity_type='entity') AS entities,
        (SELECT count(*) FROM chit_header)                             AS chits,
        (SELECT count(*) FROM catalogue_source)                        AS blueprints`);
    const r = c.rows[0];
    ok(`${r.identities} identities (${r.entities} entities) · ${r.chits} chits · ${r.blueprints} blueprints`);
    const who = await db.query('SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass');
    const canWipe = who.rows[0].bypass === true || who.rows[0].u === 'postgres';
    console.log('   ' + D(`connected as ${who.rows[0].u}, bypassrls=${who.rows[0].bypass}`));
    if (!canWipe) { bad('this role cannot bypass RLS — the wipe would silently delete nothing. Use the postgres/admin URI.'); if (wipeWanted) process.exit(1); }
  } else note('no DB connection — skipping steps 2 and 3');

  // ── 2 · BACKUP (always, before anything) ──
  if (db) {
    step(2, 'Backup the blueprints');
    const b = await db.query('SELECT * FROM catalogue_source ORDER BY source_key');
    const file = path.join(__dirname, '..', '..', `backup-catalogue-sources-${new Date().toISOString().slice(0, 10)}.json`);
    if (DRY) note(`would write ${b.rows.length} blueprint(s) → ${file}`);
    else {
      fs.writeFileSync(file, JSON.stringify(b.rows, null, 2));
      ok(`${b.rows.length} blueprint(s) → ${file}`);
      b.rows.forEach((s) => console.log('   ' + D('  ' + s.source_key + '  ' + (s.title || ''))));
    }
    note('catalogue_source has no entity_id, so blueprints survive the wipe anyway — this is belt and braces');
  }

  // ── 3 · WIPE ──
  if (db && wipeWanted) {
    step(3, 'Wipe every identity and all entity-scoped data');
    const cols = await db.query(`SELECT table_name FROM information_schema.columns
      WHERE column_name='entity_id' AND table_schema='public' AND table_name <> 'identities' ORDER BY table_name`);
    if (DRY) {
      note(`would clear ${cols.rows.length} entity-scoped table(s), then all identities`);
      note('YOUR OWN LOGIN IS DELETED TOO — you re-register afterwards (dev OTP ' + OTP + ')');
    } else {
      await db.query('BEGIN');
      try {
        await db.query('SET LOCAL row_security = off');
        try { await db.query('DELETE FROM schema_fields'); } catch (_) {}
        for (const { table_name } of cols.rows) await db.query(`DELETE FROM public."${table_name}"`);
        await db.query('DELETE FROM identities WHERE parent_entity_id IS NOT NULL');
        await db.query('DELETE FROM identities');
        await db.query('UPDATE catalogue_source SET owner_entity_id = NULL WHERE owner_entity_id IS NOT NULL');
        await db.query('COMMIT');
        ok(`cleared ${cols.rows.length} entity-scoped table(s) + all identities; blueprints kept, now unowned`);
      } catch (e) { await db.query('ROLLBACK'); bad('wipe rolled back: ' + e.message); process.exit(1); }
    }
  } else if (db) note('--skip-wipe: existing data left alone');

  // ── 4 · MIGRATION b114 ──
  if (db) {
    step(4, 'Apply b114 (catalogue visibility)');
    const f = path.join(__dirname, '..', 'migrations', 'b114_catalogue_visibility.sql');
    if (!fs.existsSync(f)) bad('migration file not found: ' + f);
    else if (DRY) note('would apply migrations/b114_catalogue_visibility.sql');
    else {
      try { await db.query(fs.readFileSync(f, 'utf8')); ok('b114 applied'); }
      catch (e) { bad('b114 failed: ' + e.message); }
    }
  }

  // ── 5 · SEED ──
  step(5, 'Seed the cast');
  const made = [];
  for (const c of CAST) {
    if (DRY) { note(`would create ${c.name.padEnd(26)} ${c.role}`); continue; }
    console.log('   ' + B(c.name) + '  ' + D(c.role));
    try {
      const ent = await signIn(c.email, c.name);
      let sourceKey = c.adopt && c.adopt.source;
      if (c.publish) {
        const keys = {}; c.publish.items.forEach((it) => Object.keys(it).forEach((k) => { if (k !== 'name') keys[k] = true; }));
        const p = await call('PUT', '/api/assist/catalogue-source', { token: ent.token, body: {
          source_key: c.publish.source_key, version: 'v1', for_vertical: c.publish.for_vertical, title: c.publish.title,
          collection: c.publish.collection,
          schema: { name: c.publish.collection, fields: [{ key: 'name', label: 'Name', type: 'text' }]
            .concat(Object.keys(keys).map((k) => ({ key: k, label: k.replace(/_/g, ' '), type: 'text' }))) },
          items: c.publish.items, commercials_fields: [{ key: 'price', label: 'Price', type: 'money' }],
          experience: { note: c.publish.title }, formatting: {} } });
        if (p.status >= 400) bad(`  publish failed ${p.status}: ${JSON.stringify(p.json)}`);
        sourceKey = c.publish.source_key;
      }
      if (sourceKey) {
        const a = await call('POST', '/api/assist/catalogue-adopt', { token: ent.token, body: { source: sourceKey, commercials: (c.adopt && c.adopt.commercials) || {} } });
        if (a.status >= 400) bad(`  adopt ${sourceKey} failed ${a.status}: ${JSON.stringify(a.json)}`);
      }
      await call('PUT', '/api/catalogue-face', { token: ent.token, body: { face: c.face } });
      await call('PATCH', '/api/entities/profile', { token: ent.token, body: { catalogue_visibility: 'public' } });
      ok(`  ${ent.bridge_id}  ${c.email}`);
      made.push({ ...ent, role: c.role });
    } catch (e) { bad('  ' + e.message); }
  }

  // ── 6 · VERIFY ──
  if (!DRY) {
    step(6, 'Verify — is each storefront actually live?');
    for (const m of made) {
      const r = await call('GET', `/api/catalogue/${encodeURIComponent(m.bridge_id)}`);
      const j = r.json || {};
      const items = (j.finishes || []).flatMap((f) => f.items || []).length + (j.items || []).length;
      const oi = (j.shop || {}).order_input || {};
      if (r.status === 200 && items) ok(`${m.name.padEnd(26)} ${items} item(s) · ${oi.preset}/${oi.pipeline}`);
      else bad(`${m.name.padEnd(26)} storefront ${r.status} · ${items} items — check the publish/adopt output above`);
    }
    if (db) {
      const v = await db.query(`SELECT catalogue_visibility, count(*) FROM identities WHERE identity_type='entity' GROUP BY 1 ORDER BY 1`);
      v.rows.forEach((row) => note(`catalogue_visibility=${row.catalogue_visibility}: ${row.count}`));
    }
  }

  hr('─');
  if (DRY) {
    console.log(Y('  DRY RUN — nothing changed. Re-run with --go when the plan above looks right.'));
    if (!ADMIN_URL) console.log(Y('  Set ADMIN_DATABASE_URL in .env first, or pass --skip-wipe to seed only.'));
  } else {
    console.log(B('  DONE.') + '  Storefronts (the param is ?bridge= , not ?b=):');
    made.forEach((m) => console.log('   ' + m.name.padEnd(26) + WEB + '/shop.html?bridge=' + m.bridge_id));
    console.log('\n  ' + Y('Re-register your own login in the app — dev OTP ' + OTP + '.'));
  }
  hr('═');
  if (db) await db.end();
  process.exit(0);
})().catch((e) => { console.error(R('crashed: ') + (e && e.stack || e)); process.exit(1); });

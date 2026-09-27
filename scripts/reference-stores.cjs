'use strict';
/**
 * scripts/reference-stores.cjs — A REFERENCE LIST LIVES IN A STORE (2026-09-27)
 *
 * Athi: *"we have to create store and load the table, that is all. only thing is while we adopt, we can only
 * adopt the product details, not currency"* · *"use chitbridge.com for the store emails"* · user IDs
 * cbref<list>, one owner email per list (so one list can be handed to someone who knows it).
 *
 * The decided shape (BACKLOG "A REFERENCE CATALOGUE IS A STORE"): one ordinary entity per list, linked under
 * cbincroot by registration like every entity, `entity_visibility = 'internal'` so it never inflates a count,
 * catalogue private. ⚠️ SHADOW ONLY: Product Lab and the counter keep reading BLUEPRINTS until `check` has
 * stayed clean long enough to trust.
 *
 *   node scripts/reference-stores.cjs register                        sign up the six (HTTP, dev OTP) — idempotent
 *   railway run --service chitbridge-api -- node scripts/reference-stores.cjs load    fill each EMPTY store
 *   railway run --service chitbridge-api -- node scripts/reference-stores.cjs check   parity, store vs constant
 *   railway run --service chitbridge-api -- node scripts/reference-stores.cjs internal   mark them internal + private
 *
 * ⚠️ `load` WRITES THROUGH THE SAME TWO WRITERS ADOPT USES — categories.ensureCategories, then
 * catalogue-write.writeItems — so a reference store holds exactly what any shop's catalogue holds. It does NOT
 * go through /lists/adopt, because adopt flattens the language packs into one `synonyms` list per shop; a
 * reference store has to keep every pack by language (`names`), since it is what shops adopt FROM.
 * ⚠️ `load` refuses a store that already has products. Loading twice would double the list, and parity would
 * then report every row twice — so reloading is a deliberate delete first, never a quiet append.
 * ⚠️ railway run is cb_app WITH RLS; every query here goes through withEntity for exactly one store.
 */

const BP = require('../lib/catalogue-blueprint');
const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';

const LABEL = { veg: 'Vegetables & fruit', fish: 'Fish & seafood', chicken: 'Chicken', meat: 'Meat', egg: 'Eggs', hotel: 'Hotel' };
const STORES = Object.keys(BP.BLUEPRINTS).map((k) => ({
  /* ⚠️ 'cbrefhotel' is refused: cb + exactly 8 characters is reserved as bridge-id shaped (lib/handle.js
     LOOKS_LIKE_BRIDGE). Athi chose 'cbrefhotels' (2026-09-27). The other five are other lengths, so they pass. */
  key: k, user_id: k === 'hotel' ? 'cbrefhotels' : 'cbref' + k, email: 'ref-' + k + '@chitbridge.com',
  display_name: 'Reference · ' + (LABEL[k] || BP.blueprint(k).label),
}));

async function call(method, path, body, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, j };
}

async function register() {
  for (const s of STORES) {
    const reg = await call('POST', '/api/entities/register', { email: s.email, display_name: s.display_name, user_id: s.user_id });
    if (reg.status >= 400) { console.log('  ✗ ' + s.user_id + '  register ' + reg.status + ' ' + JSON.stringify(reg.j).slice(0, 200)); continue; }
    /* ⚠️ the code is NOT echoed back (lib/dev-otp.js echoOptIn — the 2026-07-29 security fix), and nothing
       needs it to be: while DEV_OTP is armed the entity code is the documented constant. CB_OTP overrides it
       for an environment armed with a different value; a sealed one will simply refuse, which is correct. */
    const otp = (reg.j && reg.j.dev_otp) || process.env.CB_OTP || require('../lib/dev-otp').DEFAULTS.entity;
    const ver = await call('POST', '/api/entities/verify', { email: s.email, otp });
    const e = (ver.j && (ver.j.entity || ver.j.identity || ver.j)) || {};
    console.log((ver.j && ver.j.token ? '  ✓ ' : '  ✗ ') + s.user_id.padEnd(13) + ' ' + s.email.padEnd(27)
      + ' ' + (e.identity_id || '?') + '  ' + (e.bridge_id || '') + (ver.j && ver.j.token ? '' : '  ' + JSON.stringify(ver.j).slice(0, 160)));
  }
}

/* ── the DB half: runs under railway, as cb_app, one entity at a time ── */
function db() { return require('../db'); }
async function idOf(user_id) {
  const r = await db().query('SELECT identity_id FROM identities WHERE LOWER(user_id) = $1', [user_id]);
  return r.rows.length ? r.rows[0].identity_id : null;
}
async function itemsOf(entity_id) {
  const r = await db().withEntity(entity_id, (c) => c.query('SELECT item_data FROM catalogue_items WHERE entity_id = $1', [entity_id]));
  return r.rows;
}

async function load() {
  const cats = require('../lib/categories');
  const catwrite = require('../lib/catalogue-write');
  for (const s of STORES) {
    const id = await idOf(s.user_id);
    if (!id) { console.log('  ✗ ' + s.user_id + '  not registered — run `register` first'); continue; }
    const have = await itemsOf(id);
    if (have.length) { console.log('  · ' + s.user_id + '  already holds ' + have.length + ' products — left alone'); continue; }
    const rows = BP.storeRows(s.key);
    const ids = await cats.ensureCategories(id, rows.map((r) => r.categoryName), { withEntity: db().withEntity, by: null });
    const items = rows.map((r) => {
      const out = Object.assign({}, r);
      const cid = r.categoryName ? ids.get(r.categoryName) : null;
      delete out.categoryName;
      if (cid) out.categories = [cid];
      return out;
    });
    const w = await catwrite.writeItems({ entity_id: id, items });
    console.log((w.ok ? '  ✓ ' : '  ✗ ') + s.user_id.padEnd(13) + (w.ok ? w.rows.length + ' products · ' + ids.size + ' categories · ' + BP.pin(BP.blueprint(s.key))
      : w.status + ' ' + w.message + ' ' + JSON.stringify(w.invalid || '').slice(0, 200)));
  }
}

async function check() {
  const cats = require('../lib/categories');
  let clean = 0;
  for (const s of STORES) {
    const id = await idOf(s.user_id);
    if (!id) { console.log('  ✗ ' + s.user_id + '  not registered'); continue; }
    const names = await cats.categoryNames(id, { withEntity: db().withEntity });
    const rows = BP.fromStore(s.key, await itemsOf(id), (cid) => names.get(String(cid)));
    const p = BP.parity(s.key, rows);
    if (p.ok) clean++;
    console.log((p.ok ? '  ✓ ' : '  ✗ ') + s.user_id.padEnd(13) + p.list.padEnd(12) + ' list ' + p.rows.list + ' · store ' + p.rows.store
      + (p.ok ? ' · identical' : ' · missing ' + p.missing.length + ' · extra ' + p.extra.length + ' · changed ' + p.changed.length
        + '\n      ' + JSON.stringify(p.changed.slice(0, 3).concat(p.missing.slice(0, 2), p.extra.slice(0, 2)))));
    if (JSON.stringify(rows).includes('"currency"')) console.log('      ⚠️ a currency leaked out of fromStore');
  }
  console.log('\n  ' + clean + ' of ' + STORES.length + ' lists identical in their store');
}

async function internal() {
  /* ⚠️ catalogue visibility is TWO flags that must agree (ACCESS-MATRIX §"Catalogue visibility") — both set */
  for (const s of STORES) {
    const id = await idOf(s.user_id);
    if (!id) { console.log('  ✗ ' + s.user_id + '  not registered'); continue; }
    try {
      await db().withEntity(id, async (c) => {
        await c.query(`UPDATE identities SET entity_visibility = 'internal', catalogue_visibility = 'private' WHERE identity_id = $1`, [id]);
        await c.query(`UPDATE entity_schemas SET visibility = 'private' WHERE entity_id = $1`, [id]);
      });
      const r = await db().query('SELECT entity_visibility, catalogue_visibility FROM identities WHERE identity_id = $1', [id]);
      console.log('  ✓ ' + s.user_id.padEnd(13) + JSON.stringify(r.rows[0]));
    } catch (e) { console.log('  ✗ ' + s.user_id + '  ' + e.message); }
  }
}

const MODES = { register, load, check, internal };
const mode = process.argv[2];
if (!MODES[mode]) { console.log('usage: reference-stores.cjs ' + Object.keys(MODES).join(' | ')); process.exit(1); }
MODES[mode]().then(() => process.exit(0)).catch((e) => { console.error('FAILED', e); process.exit(1); });

'use strict';
/**
 * tests/net-98-differential.realstack.cjs — NET-98 (S1) the public view of 3 and of 39 members on a REAL Postgres, pinned byte for byte.
 *
 * WHY REAL POSTGRES (critic MUST 2): a stub db cannot show readBatch's literal typing (ARRAY['..'] is text[]; a bound-param SQL needs ::uuid[]) nor RLS, and
 * the view stamps `new Date()` (availability.withLedger), so the answer is compared with the CLOCK FROZEN. The database is a throwaway
 * `CREATE DATABASE … TEMPLATE cb_local` copy (the local stack, port 55432); the view reads it as cb_app (NOBYPASSRLS, RLS on); fixtures are seeded as the owner.
 *
 * WHAT IT PROVES: the answer of buildPublicView (per member) and the assembled network front, for a 3-member and a 39-member network, equals the
 * GOLDEN file tests/fixtures/net-98-golden.json, which was written by the code of api origin/main BEFORE the S1 split (--root <export of origin/main> --write).
 * So S1 (pure reducers, no `pre`) provably changes no answer; S2 (the bulk read) runs the same compare with the bundle path.
 * Fixtures (cycled over 39): public · private · closed · adopted source shared by two members (shared-object aliasing) · network tier · qty-zero-hides with a zero
 * ledger balance · offers + categories + tax slab · no GSTIN · a DUE schedule row · null policy_flags · a foreign-owned adoption · a retired item.
 *
 * Run (stop the local api first: a TEMPLATE copy needs cb_local idle):
 *   node tests/net-98-differential.realstack.cjs                 compare against the golden
 *   node tests/net-98-differential.realstack.cjs --write         write the golden (run it on origin/main's code: --root <dir> picks the checkout whose lib/ is exercised)
 * Allow list: localhost:55432 only. The copy is dropped at the end.
 * CARD      06-catalogue-pim/README
 */
const path = require('path'), fs = require('fs');
const argv = process.argv.slice(2);
const ROOT = path.resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : path.join(__dirname, '..'));
const WRITE = argv.includes('--write');
const GOLDEN = path.join(__dirname, 'fixtures', 'net-98-golden.json');
const OWNER_BASE = process.env.NET98_OWNER_URL || 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local';
if (!/^postgres:\/\/postgres:[^@]*@127\.0\.0\.1:55432\/cb_local$/.test(OWNER_BASE)) { console.error('REFUSED: only the local stack (127.0.0.1:55432/cb_local)'); process.exit(3); }

/* the clock stands still for `new Date()` (no argument); Date.now stays real so pools and timers behave */
const FROZEN = '2026-11-01T00:00:00.000Z';
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FROZEN); } };
global.Date.now = RealDate.now.bind(RealDate);

const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const RUN = 'n98' + (RealDate.now() % 1e9).toString(36);
/* deterministic uuid: kind (2 digits) + n (4 digits) → 98KKNNNN-0000-4000-8000-000000000000 */
const uid = (kind, n) => '98' + String(kind).padStart(2, '0') + String(n).padStart(4, '0') + '-0000-4000-8000-000000000000';
const E = (n) => uid(1, n), ITEM = (n, k) => uid(2, n * 10 + k), DEF = (n, k) => uid(3, n * 10 + k), SCH = (n) => uid(4, n), SRC = (name) => 'n98-' + name;

const ITEM_BASE = (n, k, extra) => Object.assign({ name: 'Item ' + n + '.' + k, price: { amount: 10 * (k + 1), currency: 'INR' }, unit: 'pc', category: 'Cat' + (k % 2) }, extra || {});
/** the variant of member n (0-based) */
const VARIANTS = ['public', 'private', 'closed', 'adopt-shared-a', 'adopt-shared-b', 'network-tier', 'qty-zero', 'offers-tax', 'no-gstn', 'due-schedule', 'null-policy', 'foreign-adopt', 'retired'];
const variantOf = (n) => VARIANTS[n % VARIANTS.length];

async function seedMember(c, n) {
  const v = variantOf(n), e = E(n);
  const vis = v === 'private' ? 'private' : v === 'network-tier' ? 'network' : 'public';
  const gstn = v === 'no-gstn' ? null : '29ABCDE1234F1Z' + (n % 10);
  const flags = v === 'null-policy' ? '{}' : JSON.stringify(v === 'qty-zero' ? { qty_zero_hides: 'on' } : {});
  await c.query(`INSERT INTO identities (identity_id, bridge_id, display_name, identity_type, status, country, currency_code, catalogue_visibility, business_status, gstn, policy_flags, user_id)
                 VALUES ($1, $2, $3, 'entity', 'active', 'IN', 'INR', $4, $5, $6, $7::jsonb, $8)`,
    [e, 'N98M' + String(n).padStart(3, '0'), 'Member ' + n, vis, v === 'closed' ? 'closed' : 'open', gstn, flags, 'n98user' + n]);
  await c.query(`INSERT INTO entity_schemas (schema_id, entity_id, schema_name, schema_type, status, is_default, visibility) VALUES ($1, $2, 'Products', 'product', 'active', true, 'public')`, [uid(5, n), e]);
  const kinds = v === 'retired' ? 4 : 3;
  for (let k = 0; k < kinds; k++) {
    const extra = k === 2 && v !== 'qty-zero' ? { status: 'unavailable' } : v === 'offers-tax' ? (k === 0 ? { tax_slab: DEF(n, 2) } : { gst_rate: 12 }) : {};
    await c.query(`INSERT INTO catalogue_items (item_id, entity_id, schema_id, item_data, is_active, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [ITEM(n, k), e, uid(5, n), JSON.stringify(ITEM_BASE(n, k, extra)), !(v === 'retired' && k === 3), new RealDate(Date.UTC(2026, 9, 1, 12, k + 1)).toISOString()]);
  }
  if (v === 'qty-zero') {
    /* item 1: a counted ZERO (hidden by qty_zero_hides); item 0: stock over two lots (foldSheet sums and sorts them, the ledger fills avail) */
    const bal = `INSERT INTO stock_balance (entity_id, item_id, location, qty, value, avg_cost, unit, last_at, moves, lot, item_kind, expires_at) VALUES ($1, $2, 'default', $3, $4, 1, 'pc', '2026-10-30T00:00:00Z', 1, $5, 'catalogue', $6)`;
    await c.query(bal, [e, ITEM(n, 1), 0, 0, '', null]);
    await c.query(bal, [e, ITEM(n, 0), 2, 20, 'L2', '2026-12-01']);
    await c.query(bal, [e, ITEM(n, 0), 3, 30, 'L1', '2026-11-15']);
  }
  if (v === 'offers-tax') {
    await c.query(`INSERT INTO definition (definition_id, entity_id, kind, sub_kind, name, status, current_version) VALUES ($1,$2,'category',NULL,'Cat0','live',1), ($3,$2,'offer','percent_off','Ten off','live',1), ($4,$2,'tax',NULL,'GST 5','live',1)`, [DEF(n, 0), e, DEF(n, 1), DEF(n, 2)]);
    await c.query(`INSERT INTO definition_version (definition_id, version, entity_id, rules) VALUES ($1,1,$4,'{}'::jsonb), ($2,1,$4,'{"percent":10}'::jsonb), ($3,1,$4,'{"rate":5,"id":"gst-5"}'::jsonb)`, [DEF(n, 0), DEF(n, 1), DEF(n, 2), e]);
  }
  if (v === 'due-schedule') await c.query(`INSERT INTO catalogue_item_schedule (schedule_id, entity_id, item_id, effective_at, patch) VALUES ($1, $2, $3, '2026-10-15T00:00:00Z', '{"price":{"amount":99,"currency":"INR"}}'::jsonb)`, [SCH(n), e, ITEM(n, 0)]);
  const adopt = v === 'adopt-shared-a' || v === 'adopt-shared-b' ? SRC('shared') : v === 'foreign-adopt' ? SRC('brand') : null;
  if (adopt) await c.query(`INSERT INTO catalogue_adoption (entity_id, source_key, version, commercials, visible) VALUES ($1, $2, '1', '{}'::jsonb, true)`, [e, adopt]);
}
async function seedSources(c, brandId) {
  const items = (p) => JSON.stringify([{ name: p + ' Rice', category: 'Grain', unit: 'kg', price: 60 }, { name: p + ' Dal', category: 'Grain', unit: 'kg', price: 90 }]);
  await c.query(`INSERT INTO catalogue_source (source_key, version, title, collection, schema, items, commercials_fields, active, owner_entity_id) VALUES ($1,'1','Shared list','Shared','{}'::jsonb,$2::jsonb,'[]'::jsonb,true,NULL)`, [SRC('shared'), items('Shared')]);
  await c.query(`INSERT INTO catalogue_source (source_key, version, title, collection, schema, items, commercials_fields, active, owner_entity_id) VALUES ($1,'1','Brand list','Brand','{}'::jsonb,$2::jsonb,'[]'::jsonb,true,$3)`, [SRC('brand'), items('Brand'), brandId]);
}

/** the view of one member, exactly as routes/catalogue.js publicViewFor asks for it (anonymous reader) */
async function viewOf(req, entity) {
  const { buildPublicView } = req('lib/catalogue-view');
  const { query, withEntity } = req('db');
  return buildPublicView({
    entity, query, withEntity,
    catalogueBuild: req('lib/catalogue-build'), orderInput: req('lib/order-input'), identity: req('lib/identity'),
    catalogueRead: req('lib/catalogue-read'), container: req('lib/container'), visibilityCap: req('lib/visibility-cap'),
    asOwner: false, viewer: undefined
  });
}

async function runNetwork(app, owner, count) {
  const req = (rel) => require(path.join(ROOT, rel));
  const rows = (await owner.query(`SELECT identity_id, display_name, bridge_id, user_id, currency_code, gstn, is_verified, logo_url, address, business_status, population FROM identities WHERE bridge_id LIKE 'N98M%' ORDER BY bridge_id`)).rows;
  const out = { members: {}, front: null, count };
  const departments = [];
  for (const ent of rows) {
    const view = await viewOf(req, ent);
    out.members[ent.bridge_id] = view;
    if (view && view.available && !view.sign_in && ent.bridge_id !== 'N98M000') departments.push({ entity: ent, view });
  }
  out.front = req('lib/network-view').assemble({ network: { bridge_id: 'N98M000', display_name: 'Member 0' }, departments });
  return JSON.parse(JSON.stringify(out));
}

/** one network size, in THIS process (each size is its own process: the lib modules hold the db module they first loaded) */
async function one(count) {
  const admin = new Client({ connectionString: OWNER_BASE.replace('/cb_local', '/postgres') });
  await admin.connect();
  const dbName = RUN + 'c' + count;
  try { await admin.query('CREATE DATABASE ' + dbName + ' TEMPLATE cb_local'); }
  catch (e) { console.error('Could not copy cb_local (stop the local api: it holds a connection): ' + e.message); process.exit(2); }
  const owner = new Client({ connectionString: OWNER_BASE.replace('/cb_local', '/' + dbName) });
  await owner.connect();
  try {
    await seedSources(owner, E(0));
    /* the 3-member network is: a public brand, a member adopting the shared list, a private member */
    const members = count === 3 ? [0, 3, 1] : Array.from({ length: count }, (_, i) => i);
    for (const n of members) await seedMember(owner, n);
    process.env.DATABASE_URL = 'postgres://cb_app:cblocal@127.0.0.1:55432/' + dbName; /* the app reads as cb_app on the copy */
    process.env.NODE_ENV = 'test';
    const db = require(path.join(ROOT, 'db'));
    const res = await runNetwork(db, owner, count);
    await db.pool.end().catch(() => {});
    return res;
  } finally {
    await owner.end().catch(() => {});
    await admin.query('DROP DATABASE IF EXISTS ' + dbName + ' WITH (FORCE)').catch(() => {});
    await admin.end().catch(() => {});
  }
}

(async () => {
  if (argv.includes('--one')) {
    const count = Number(argv[argv.indexOf('--one') + 1]);
    fs.writeFileSync(argv[argv.indexOf('--out') + 1], JSON.stringify(await one(count)));
    process.exit(0);
  }
  const { spawnSync } = require('child_process');
  const result = {};
  for (const count of [3, 39]) {
    const out = path.join(require('os').tmpdir(), RUN + '-' + count + '.json');
    const r = spawnSync(process.execPath, [__filename, '--root', ROOT, '--one', String(count), '--out', out], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) { console.error('the ' + count + '-member run failed (exit ' + r.status + ')'); process.exit(r.status || 1); }
    result['m' + count] = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.unlinkSync(out);
  }
  const text = JSON.stringify(result, null, 1);
  if (WRITE) { fs.mkdirSync(path.dirname(GOLDEN), { recursive: true }); fs.writeFileSync(GOLDEN, text); console.log('golden written: ' + GOLDEN + ' (' + text.length + ' bytes, root ' + ROOT + ')'); process.exit(0); }
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  let bad = 0;
  for (const key of Object.keys(result)) {
    const g = gold[key];
    for (const bridge of Object.keys(result[key].members)) {
      if (JSON.stringify(result[key].members[bridge]) !== JSON.stringify(g.members[bridge])) { bad++; console.log('  FAIL ' + key + ' ' + bridge + ' differs from the golden'); }
    }
    if (JSON.stringify(result[key].front) !== JSON.stringify(g.front)) { bad++; console.log('  FAIL ' + key + ' the assembled network front differs'); }
    else console.log('  ok   ' + key + ': ' + Object.keys(result[key].members).length + ' members and the network front equal the golden');
  }
  console.log(bad ? 'net-98-differential: ' + bad + ' differences' : 'net-98-differential: identical');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

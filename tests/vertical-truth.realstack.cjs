'use strict';
/**
 * tests/vertical-truth.realstack.cjs — VERTICAL BOX TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §19 "Vertical box").
 *
 * VERT-2. Principles: ONE answer to "what trade is this shop" (govresolve.verticalOf over the constitution row) · a box may READ its slot and never
 * tests the vertical key · the vertical changes config only (defaults, labels, switches, starter data), never the money · the shop overrides at layer 7.
 * VB-01 a shop on a trade constitution with a declared sector: every reader that shows the trade shows the SAME key ·
 * VB-02 no box file (api lib, routes, till) tests a vertical key outside govresolve and the starter-data files ·
 * VB-04 the key sets of starter-fields, blueprints, goods packs, showcase, web starter categories and the constitution rows are ONE set ·
 * VB-05 a sale of an item with a BOM posts component movements, switched on by the vertical's `consumes` primitive (same fact as NW-07, seen from the vertical) ·
 * VB-06 the shop's own unit set wins over the vertical's lists: the starter lists offer the shop only units it has kept ·
 * VB-07 the same data under the base and under a trade constitution gives the same stock, books and CRM numbers ·
 * VB-08a (found on the way, the API part of the W case) applying a starter list adds its items.
 * Setup: the only trade constitution on the local stack is `service-desk` (VB5 has not seeded hotel/pharma/veg), so it stands in for "a trade";
 * a shop picks it at verify (routes/signin.js `constitution`) and declares sectors through PUT /api/governance/profile.
 * A `gap:` FAIL is a RECORDED finding (VERTICAL-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY; the database is only read.
 * Break-tested 2026-10-19: each passing case was run once with its expectation flipped and went red.
 * Run: node tests/vertical-truth.realstack.cjs   (one realstack file at a time on :3100; CB_WEB_DIR for VB-04, default C:/dev/chitbridge-web)
 * CARD vertical/README
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
/* ACC-198: tax registration is never assumed - an unknown shop's sales wait with the question; these shops sell untaxed, so they SAY not registered */
const NOT_REGISTERED = { tax: { registered: false } };
const { DB, ENTITY_OTP, j, ok, pause, kase, expect, near, bill, receipt, freshShop, finish } = H;
const RUN = 'vertx' + (Date.now() % 1e8).toString(36);
const API_DIR = path.join(__dirname, '..');
const WEB = process.env.CB_WEB_DIR || 'C:/dev/chitbridge-web';
let pg = null;

/** a shop that picked the trade constitution `service-desk` at verify (the one trade row the local stack holds), country India, public */
async function tradeShop(tag) {
  const email = tag + '@local.test';
  ok(await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'Trade ' + tag, user_id: tag } }), 'register');
  const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: ENTITY_OTP, constitution: 'service-desk' } }), 'verify').b;
  const shop = { token: v.token, bridge: v.entity.bridge_id, entity: v.entity.identity_id || v.entity.entity_id, products: {} };
  ok(await j('/api/entities/profile', { method: 'PATCH', token: shop.token, body: { catalogue_visibility: 'public' } }), 'publish');
  ok(await j('/api/governance/country-setup', { method: 'PUT', token: shop.token, body: { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } } }), 'country');
  return shop;
}
/** every .js/.html file under these dirs (relative to the api) whose lines match, as `file:line`, minus the files the rule allows */
function scan(dirs, re, allowed) {
  const hits = [];
  const walk = (dir) => fs.readdirSync(path.join(API_DIR, dir), { withFileTypes: true }).forEach((e) => {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); return; }
    if (!/\.(js|html)$/.test(e.name) || allowed.includes(rel)) return;
    fs.readFileSync(path.join(API_DIR, rel), 'utf8').split('\n').forEach((t, i) => { if (re.test(t)) hits.push(rel + ':' + (i + 1)); });
  });
  dirs.forEach(walk);
  return hits;
}
/** a line that tests the trade: `vertical === 'x'`, `sector == "x"`, or any compare of a value against a trade word */
const TESTS_THE_TRADE = /\b(vertical|sector|verticalKey)[A-Za-z_]*\)?\s*[!=]==?\s*['"][a-z-]+['"]|[!=]==?\s*['"](hotel|restaurant|pharma|veg|paint|service-desk)['"]/;

(async () => {
  console.log('\n── vertical truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const T = await tradeShop(RUN + 'd');
    ok(await j('/api/governance/profile', { method: 'PUT', token: T.token, body: { sectors: ['pharma'], trade_mode: 'domestic' } }), 'declare sectors');

    await kase('VB-01', 'a shop on the trade constitution that declared sector pharma: the product lists, the readiness path and the lanes all show the SAME trade key (the constitution\'s)', async () => {
      const stamp = (await pg.query("SELECT c.vertical FROM entity_governance g JOIN constitution c ON c.constitution_key = g.constitution_key AND c.active = true WHERE g.entity_id = $1", [T.entity])).rows[0];
      const lists = ok(await j('/api/products/lists', { token: T.token }), 'lists').b.vertical;
      const pathKey = ok(await j('/api/governance/profile/path', { token: T.token }), 'path').b.sector;
      const lanes = ok(await j('/api/governance/lanes', { token: T.token }), 'lanes').b.vertical;
      expect(stamp && stamp.vertical === 'service-desk', 'premise: the shop should be stamped service-desk, saw ' + JSON.stringify(stamp));
      expect(lists === 'service-desk' && pathKey === 'service-desk' && lanes === 'service-desk', 'the readers answer lists ' + lists + ' · path ' + pathKey + ' · lanes ' + lanes + ' (the sector pharma must not win over the constitution)');
    });

    await kase('VB-02', 'no box file tests a vertical key: no `vertical === \'x\'` / `=== \'hotel\'` in api lib, routes, src, middleware or the till, outside govresolve and the starter-data files', async () => {
      const sample = ["if (vertical === 'hotel') {", "if (shop.sector == 'pharma')", "return k === 'service-desk';"];
      expect(sample.every((s) => TESTS_THE_TRADE.test(s)) && !TESTS_THE_TRADE.test('const trade_mode = p.trade_mode === "export"'), 'premise: the scan pattern must catch a trade test and spare trade_mode');
      const hits = scan(['lib', 'routes', 'src', 'middleware', 'tools/tally-connector'], TESTS_THE_TRADE, ['lib/govresolve.js', 'lib/starter-fields.js', 'lib/catalogue-blueprint.js']);
      expect(hits.length === 0, hits.length + ' lines test a trade: ' + hits.slice(0, 6).join(', '));
    });

    await kase('VB-04', 'the key sets agree: starter-fields, blueprints, goods packs, showcase pages, web starter categories and the constitution rows are ONE set', async () => {
      const sets = {};
      sets.constitution = (await pg.query('SELECT DISTINCT vertical FROM constitution WHERE active AND vertical IS NOT NULL')).rows.map((x) => x.vertical);
      sets.starterFields = Object.keys(require(path.join(API_DIR, 'lib', 'starter-fields.js')).VERTICALS);
      sets.blueprints = Object.keys(require(path.join(API_DIR, 'lib', 'catalogue-blueprint.js')).BLUEPRINTS);
      sets.showcase = [...new Set(require(path.join(API_DIR, 'data', 'pages.json')).pages.filter((r) => r.name.startsWith('showcase.')).map((r) => r.name.split('.')[1]))];
      const web = path.join(WEB, 'public', 'app', 'catalogue-starter-categories.js');
      if (fs.existsSync(web)) { const box = {}; vm.runInNewContext(fs.readFileSync(web, 'utf8') + '\nthis.CB = CB_STARTER_CATEGORIES;', box); sets.webCategories = Object.keys(box.CB || {}); }
      const names = Object.keys(sets), union = [...new Set(names.flatMap((n) => sets[n]))].sort();
      const lacking = names.map((n) => n + ' lacks ' + union.filter((k) => !sets[n].includes(k)).length + ' of ' + union.length);
      expect(names.every((n) => sets[n].length === union.length), 'five key sets, ' + union.length + ' keys between them: ' + lacking.join(' · ') + ' · ' + names.map((n) => n + '=' + JSON.stringify(sets[n])).join(' '));
    }, 'VB6: each list is keyed its own way (8 starter fields, 6 blueprints, 4 showcase families, the web categories, 1 trade constitution); no key set comes from the vertical row');

    await kase('VB-05', 'a sale of an item with a BOM posts component movements, switched by the vertical\'s `consumes` primitive', async () => {
      const prim = (await pg.query("SELECT constitution_key, governance->'primitives' AS p FROM constitution WHERE active")).rows;
      const T = await tradeShop(RUN + 'h');   /* its own shop: T declared sector pharma, whose goods pack refuses a receipt with no batch */
      const comp = ok(await j('/api/products', { method: 'POST', token: T.token, body: { item_data: { name: 'Flour comp', unit: 'piece', price: 5 } } }), 'component').b;
      const C = { id: comp.item.item_id, name: 'Flour comp', unit: 'piece', price: 5 };
      const made = ok(await j('/api/products', { method: 'POST', token: T.token, body: { item_data: { name: 'Bread made', unit: 'piece', price: 40, bom: [{ item_id: C.id, qty: 2 }] } } }), 'made').b;
      ok(await j('/api/chits/send', { method: 'POST', token: T.token, body: receipt(RUN + '-r', [[C, 10, 3]]) }), 'receive');
      ok(await j('/api/chits/send', { method: 'POST', token: T.token, body: bill(RUN + '-s', [[{ id: made.item.item_id, name: 'Bread made', unit: 'piece', price: 40 }, 3]]) }), 'sell');
      await pause(2500);
      const left = (await pg.query('SELECT COALESCE(sum(qty),0)::float AS q FROM stock_movement WHERE entity_id = $1 AND item_id = $2', [T.entity, C.id])).rows[0].q;
      expect(prim.some((r) => r.p && r.p.consumes !== undefined) && near(left, 4), 'constitutions with a primitives.consumes: ' + prim.filter((r) => r.p && r.p.consumes !== undefined).length + ' of ' + prim.length + ' · component left ' + left + ' (expected 10 − 3 × 2 = 4)');
    }, 'VB3: no `consumes` primitive on any constitution and a BOM sale moves only the item itself (BACKLOG:2636); the same fact as NW-07');

    await kase('VB-06', 'the shop keeps only kg and piece: its own choice is read back, and the starter lists offer it only those units', async () => {
      const O = await freshShop(RUN + 'u', 'Units', NOT_REGISTERED);
      ok(await j('/api/entities/policy', { method: 'PATCH', token: O.token, body: { units: ['kg', 'piece'] } }), 'set units');
      const kept = ok(await j('/api/entities/policy', { token: O.token }), 'policy').b.flags.units;
      expect(JSON.stringify(kept) === '["kg","piece"]', 'the shop\'s own set reads back as ' + JSON.stringify(kept));
      const lists = ok(await j('/api/products/lists', { token: O.token }), 'lists').b.lists;
      const outside = lists.map((l) => l.key + ':' + l.units.filter((u) => !kept.includes(u)).join('/')).filter((s) => !s.endsWith(':'));
      expect(!outside.length, 'lists still offer units the shop switched off: ' + outside.join(' · '));
    }, 'the starter lists (lib/catalogue-blueprint.js units) ignore policy_flags.units; only the product form honours it — decide with cb-catalogue whether lists must narrow to the shop');

    await kase('VB-07', 'the same data under the base constitution and under a trade constitution gives the same stock, the same books and the same CRM numbers', async () => {
      const base = await freshShop(RUN + 'e', 'Same data', NOT_REGISTERED), trade = await tradeShop(RUN + 'f');
      const out = [];
      for (const S of [base, trade]) {
        ok(await j('/api/books/enable', { method: 'POST', token: S.token }), 'books on');
        const r = ok(await j('/api/products', { method: 'POST', token: S.token, body: { item_data: { name: 'Same item', unit: 'piece', price: 60 } } }), 'product').b;
        const P = { id: r.item.item_id, name: 'Same item', unit: 'piece', price: 60 };
        const lead = ok(await j('/api/crm/leads', { method: 'POST', token: S.token, body: { name: 'Same Customer', phone: '98765000' + (S === base ? '11' : '12') } }), 'lead').b.party;
        ok(await j('/api/chits/send', { method: 'POST', token: S.token, body: receipt('r' + S.entity.slice(0, 8), [[P, 10, 30]]) }), 'receive');
        const b = bill('b' + S.entity.slice(0, 8), [[P, 3]]); b.business_json.customer = { name: lead.display_name, party_id: lead.party_id };
        ok(await j('/api/chits/send', { method: 'POST', token: S.token, body: b }), 'bill');
        await pause(2000);
        const stock = Object.values(ok(await j('/api/till/stock?detail=1', { token: S.token }), 'stock').b.balances).map((x) => [x.qty, x.avg_cost]);
        const tb = ok(await j('/api/books/trial-balance', { token: S.token }), 'tb').b;
        const crm = ok(await j('/api/crm/segments', { token: S.token }), 'segments').b;
        out.push(JSON.stringify({ stock, tb: tb.rows.map((x) => [x.code, x.dr_minor, x.cr_minor]), tbTotals: [tb.total_dr_minor, tb.total_cr_minor], customers: crm.customers }));
      }
      expect(out[0] === out[1], 'base: ' + out[0] + ' · trade: ' + out[1]);
    });

    await kase('VB-08a', 'applying a starter list adds its items (the API half of "meat / veg blueprint: apply → its starter set")', async () => {
      const S = await freshShop(RUN + 'g', 'Apply', NOT_REGISTERED);
      const r = await j('/api/products/lists/adopt', { method: 'POST', token: S.token, body: { list: 'veg' } });
      const n = (ok(await j('/api/products', { token: S.token }), 'products').b.items || []).length;
      expect(r.status < 300 && n > 0, 'adopt veg answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200) + ' · products after: ' + n);
    }, 'every starter list is refused whole: the blueprint rows carry `image` (withPictures) and lib/catalogue-columns.js now refuses `image` as SERVER_OWNED, so no list can be applied (400 on veg, egg, chicken, fish, meat, hotel)');
  } finally { await pg.end(); }
  finish('vertical-truth', process.env.VERTICAL_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('vertical truth could not run:', e && e.message); process.exit(2); });

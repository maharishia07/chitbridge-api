/**
 * tests/page-name.test.cjs — EVERY CHIT SAYS WHICH DETAIL PAGE IT WAS MADE WITH (N03, decisions M-D6 / M-D7).
 *
 * Grammar `<kind>.<vertical>.<face>@<major.minor>`; base `chit.base.detail@1.0`. POST /api/chits/send stamps
 * business_json.page on every copy's header at mint; nothing writes it afterwards.
 *
 *   1  the registry: data/pages.json is a byte copy of chitbridge-web/public/app/pages.json (when the web is checked out
 *      next door, or CB_WEB points at it); no two rows for one name@version; every row fits the grammar and names a script;
 *      the base is a row; a reserved name has no row
 *   2  mint.page(): nothing → base · a name → its newest version · name@version → that row · anything else PAGE_UNKNOWN
 *   3  the real route (db, auth and delivery stubbed): a minted chit carries `page` on every copy, the sender's other
 *      business keys untouched; an unknown name, a reserved one, an old version or a non-string is refused 400 PAGE_UNKNOWN
 *      before anything is written; a promoted draft keeps its page
 *   4  never changed after send: every later business_json write in routes/ and lib/ is a merge-patch of its OWN key —
 *      none names `page`, none replaces business_json whole
 * Run: node tests/page-name.test.cjs   · no DB, no network.
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* ── 1 · the registry ─────────────────────────────────────────────────────────────────────────────────────── */
console.log('\n══ N03 · NAMED, VERSIONED DETAIL PAGES ══\n');
const COPY = path.join(API, 'data', 'pages.json');
const raw = fs.readFileSync(COPY, 'utf8');
const REG = require(COPY);   /* the SAME object mint.page() reads (the require cache) — so the in-memory 1.1 below is seen by it */
const RE = new RegExp(REG.grammar);
const MASTER = process.env.CB_WEB ? path.join(process.env.CB_WEB, 'public', 'app', 'pages.json')
  : path.join(API, '..', 'chitbridge-web', 'public', 'app', 'pages.json');
const lf = (t) => t.split(String.fromCharCode(13)).join('');   /* the same bytes, whatever line endings each checkout chose */
if (fs.existsSync(MASTER)) ok('data/pages.json is a byte copy of the master (' + MASTER + ')', lf(fs.readFileSync(MASTER, 'utf8')) === lf(raw), 'stale copy — cp the web\'s public/app/pages.json to data/pages.json');
else console.log('   --   skipped: the master is not here (' + MASTER + ') — set CB_WEB to the web checkout to compare');
const ids = REG.pages.map((r) => r.name + '@' + r.version);
ok('the registry has no two rows for one name@version', new Set(ids).size === ids.length, JSON.stringify(ids));
ok('every row fits the grammar and names its script', REG.pages.every((r) => RE.test(r.name + '@' + r.version) && typeof r.script === 'string' && r.script.length > 0), JSON.stringify(REG.pages));
ok('the base page (' + REG.base + ') is a row', ids.indexOf(REG.base) >= 0);
ok('a reserved name has no row (sale.restaurant.table, service.repair.job)', (REG.reserved || []).length === 2 && REG.reserved.every((n) => !REG.pages.some((r) => r.name === n)), JSON.stringify(REG.reserved));
ok('the grammar refuses a page with no version, a one-part version, or capitals', ['chit.base.detail', 'chit.base.detail@1', 'Chit.base.detail@1.0', 'chit.base@1.0'].every((x) => !RE.test(x)));

/* the page ref is a thing@version — the ONE parser (lib/versionref) knows major.minor, and a party is still a party */
{
  const vr = require(path.join(API, 'lib', 'versionref'));
  const p = vr.parse(REG.base);
  ok('lib/versionref reads ' + REG.base + ' as { key, version: 1.0 }', p && p.key === 'chit.base.detail' && p.version === '1.0', JSON.stringify(p));
  ok('…and a person at a business is still not a version (ravi@acmetraders · ravi@acmetraders.clothing · ravi@12345678.9)', !vr.is('ravi@acmetraders') && !vr.is('ravi@acmetraders.clothing') && !vr.is('ravi@12345678.9'));
  const r = require(path.join(API, 'lib', 'resolveuserid'));
  ok('…the resolver classifies a page ref as a version_ref, never sendable', r.classify(REG.base).kind === 'version_ref' && r.isSendable(REG.base) === false, JSON.stringify(r.classify(REG.base)));
}

/* ── 2 · mint.page() ──────────────────────────────────────────────────────────────────────────────────────── */
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const ROWS = {
  [SHOP]: { identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Mayur Traders', country: 'IN', status: 'active' },
  [CUST]: { identity_id: CUST, bridge_id: 'CB-CUST', display_name: 'Chola Auto Care', country: 'IN', status: 'active' },
};
let SQL = [], DRAFT = null;
function rowsFor(sql, p) {
  const s = String(sql);
  SQL.push(s.replace(/\s+/g, ' ').trim());
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/SELECT role, business_json->>'page' AS page FROM chit_header/.test(s)) return DRAFT ? [DRAFT] : [];
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p && p[0]]; return r ? [r] : []; }
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p) }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-SHOP', display_name: 'Mayur Traders' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };

const mint = require(path.join(API, 'lib', 'mint'));
const P = (a) => mint.page(a);
ok('mint.page(): nothing asked → the base page', P(undefined).page === REG.base && P(null).page === REG.base && P('').page === REG.base);
ok('mint.page(): a registered name → its newest version', P('chit.base.detail').page === 'chit.base.detail@1.0', JSON.stringify(P('chit.base.detail')));
ok('mint.page(): name@version that is registered → exactly that', P('chit.base.detail@1.0').page === 'chit.base.detail@1.0');
for (const [asked, why] of [['sale.foo.bar@1.0', 'an unknown name'], ['sale.restaurant.table@1.0', 'a reserved name (no page yet)'], ['service.repair.job', 'a reserved bare name'],
  ['chit.base.detail@0.9', 'an old version this install does not have'], ['chit.base.detail@1', 'a version that is not major.minor'], [7, 'a number'], [{ name: 'x' }, 'an object']]) {
  const r = P(asked);
  ok('mint.page(): ' + why + ' → PAGE_UNKNOWN, with words', r.ok === false && r.code === 'PAGE_UNKNOWN' && typeof r.message === 'string' && r.message.length > 10, JSON.stringify(r));
}

let COPIES = null;
mint.deliver = async (sender, chit_id, copies) => { COPIES = copies; return { ok: true }; };
try { require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({}); } catch (_) {}
try { require(path.join(API, 'lib', 'meter')).meter = async () => {}; } catch (_) {}
try { require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null; } catch (_) {}
try { require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] }); } catch (_) {}

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

/* ── 4 · static: nothing writes `page` after the send ─────────────────────────────────────────────────────── */
function laterWrites() {
  const out = [];
  for (const dir of ['routes', 'lib']) for (const f of fs.readdirSync(path.join(API, dir)).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(API, dir, f), 'utf8');
    for (const m of src.matchAll(/UPDATE\s+chit_header\s+SET\s+business_json\s*=\s*([^`]*?)(?:\s+WHERE|`)/gi)) out.push({ file: dir + '/' + f, rhs: m[1].replace(/\s+/g, ' ') });
    for (const m of src.matchAll(/jsonb_set\(\s*business_json[^)]*/gi)) out.push({ file: dir + '/' + f, rhs: m[0] });
    for (const m of src.matchAll(/business_json\.page\s*=(?!=)/g)) out.push({ file: dir + '/' + f, rhs: m[0], assign: true });
  }
  return out;
}

const srv = app.listen(0, '127.0.0.1', async () => {
  const send = async (body) => {
    COPIES = null; SQL = [];
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await new Promise((res) => setTimeout(res, 30));
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const order = (bj, extra) => Object.assign({ purpose: 'order', manual_subject: 'Brake pads', recipients: [{ entity_id: CUST, name: 'Chola Auto Care', role: 'to' }],
    line_items: [{ particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59, total: 118 }] }, bj === undefined ? {} : { business_json: bj }, extra || {});
  const pages = () => (COPIES || []).map((c) => c.business_json && c.business_json.page);
  const wrote = () => SQL.some((s) => /INSERT INTO chit_header|chit_deliver\(/i.test(s)) || COPIES !== null;
  try {
    console.log('\n── the route: POST /api/chits/send ──');
    const a = await send(order(undefined));
    ok('a chit sent with no business_json is minted (200)', a.status === 200, a.status + ' ' + JSON.stringify(a.body).slice(0, 240));
    ok('…every copy carries page = the base page (sender and receiver)', COPIES && COPIES.length >= 2 && pages().every((p) => p === REG.base), JSON.stringify(pages()));

    const b = await send(order({ schema_values: { deliver_to: 'Bay 3' }, page: 'chit.base.detail' }));
    ok('a chit naming the base page by name is minted, stamped at its version', b.status === 200 && pages().length >= 2 && pages().every((p) => p === 'chit.base.detail@1.0'), b.status + ' ' + JSON.stringify(pages()));
    ok('…the sender\'s own business keys ride untouched beside it (a merge, not a rewrite)', (COPIES || []).every((c) => c.business_json.schema_values && c.business_json.schema_values.deliver_to === 'Bay 3'), JSON.stringify((COPIES || []).map((c) => c.business_json)));

    for (const [pg, why] of [['sale.foo.bar@1.0', 'an unknown name'], ['sale.restaurant.table@1.0', 'a reserved name'], ['chit.base.detail@0.9', 'an old version'], [12, 'a number']]) {
      const r = await send(order({ page: pg }));
      ok('…' + why + ' (' + JSON.stringify(pg) + ') is refused 400 PAGE_UNKNOWN, nothing written', r.status === 400 && r.body.code === 'PAGE_UNKNOWN' && !wrote(), r.status + ' ' + JSON.stringify(r.body) + ' wrote=' + wrote());
    }

    /* a second version installed (in memory): a bare name takes the newest; a draft keeps the version it was made with */
    REG.pages.push({ name: 'chit.base.detail', version: '1.1', script: 'test-only' });
    const c = await send(order({ page: 'chit.base.detail' }));
    ok('with 1.0 and 1.1 installed, a bare name is stamped at the newest (1.1)', c.status === 200 && pages().every((p) => p === 'chit.base.detail@1.1'), JSON.stringify(pages()));
    DRAFT = { role: 'Draft', page: 'chit.base.detail@1.0' };
    const d = await send(order({ schema_values: { note: 'resumed' } }, { promote_draft_id: '99999999-9999-4999-8999-999999999999' }));
    ok('a promoted draft that does not name a page keeps the draft\'s (1.0, not the newest)', d.status === 200 && pages().length > 0 && pages().every((p) => p === 'chit.base.detail@1.0'), d.status + ' ' + JSON.stringify(d.body).slice(0, 200) + ' ' + JSON.stringify(pages()));
    const e = await send(order({ page: 'chit.base.detail@1.1' }, { promote_draft_id: '99999999-9999-4999-8999-999999999999' }));
    ok('…and one that names a page gets the page it names', e.status === 200 && pages().length > 0 && pages().every((p) => p === 'chit.base.detail@1.1'), e.status + ' ' + JSON.stringify(e.body).slice(0, 200) + ' ' + JSON.stringify(pages()));
    DRAFT = null; REG.pages.pop();

    console.log('\n── never changed after send ──');
    const W = laterWrites();
    ok('there are later business_json writes to check (' + W.length + ' found)', W.length >= 5, JSON.stringify(W));
    const bad = W.filter((w) => w.assign || /'page'|\{page\}/.test(w.rhs) || !/^(\(\s*)?COALESCE\(\s*business_json/i.test(w.rhs.trim()));
    ok('…every one is a merge-patch of its own key onto COALESCE(business_json…) — none names page, none replaces it whole', bad.length === 0, JSON.stringify(bad));
    const route = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
    ok('no route offers a PATCH on a chit (the header is written once, at send)', !/router\.patch\(/.test(route));
    const stamps = (route.match(/page:\s*pageStamp\.page/g) || []).length;
    ok('the send stamps the page in ONE place', stamps === 1, 'found ' + stamps);
  } catch (err) { fail++; console.log('   FAIL the test ran   ' + (err && err.stack)); }
  srv.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
});

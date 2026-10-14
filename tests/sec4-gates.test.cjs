/**
 * tests/sec4-gates.test.cjs — SEC4: THE SERVER CHECKS WHAT THE PAGE GREYS (docs/critique/SEC4.md).
 *
 * The REAL middleware/auth.js (and the hat gate inside it), the REAL routes/chits.js and routes/catalogue.js. Only the database,
 * the delivery writer and the catalogue view are stand-ins.
 *
 *   A  POST /chits/:id/deliver-lines — a viewer / commenter is refused 403 with the rail's `why` (at the hat gate, and at the
 *      route's own workflow.can('deliver_line') when the hat gate is not in front); nothing is written, not even the bill's `use`;
 *      a stranger is the 404 it always was; an editor holding the copy records.
 *   B  GET /catalogue/:bridge_id of a sign-in-first shop — anonymous, another shop's customer and another business are refused 401
 *      code SIGNIN_REQUIRED with the shop card alone; this shop's customer and the owner's preview read it; a browse shop is open;
 *      the CTP pull (publicResponseFor) gets the same card; embed.html branches on the same code.
 *   C  enquiries — an external question rings the owner's bell (events.notifyAfter), an internal note does not; GET /enquiry/inbox
 *      is paged (top-level total · page · limit, limit capped) and reads the caller's own copies.
 *   D  guards — the gate precedes every write in deliver-lines; /enquiry/inbox is declared before /enquiry/:item_id.
 *
 * Run: node tests/sec4-gates.test.cjs · no DB, no network beyond 127.0.0.1.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-sec4';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');

const R = 'bbbbbbbb-0000-4000-8000-00000000000b';      // holds C1 (received)
const X = 'eeeeeeee-0000-4000-8000-00000000000e';      // holds nothing
const SHOP = '5bbb0000-0000-4000-8000-000000000001';   // the sign-in-first shop
const OPEN = '5bbb0000-0000-4000-8000-000000000002';   // a browse-first shop
const ITEM = '17e00000-0000-4000-8000-000000000001';
const C1 = '0000c417-0000-4000-8000-0000000000c1';
const ACTORS = {
  'a-vw':  { parent: R, access_level: 'viewer', whole_entity: false, hat: 'view_only' },
  'a-cmt': { parent: R, access_level: 'commenter', whole_entity: false, hat: 'view_only' },
  'a-ed':  { parent: R, access_level: 'editor', whole_entity: false, hat: 'act' },
};
const SQL = [];
function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  p = p || [];
  SQL.push({ s, p });
  if (/break_status/.test(s) && /FROM identities/.test(s)) { const a = ACTORS[p[0]]; return a ? [{ break_status: 'active', hat: a.hat, access_level: a.access_level, whole_entity: a.whole_entity }] : []; }
  if (/FROM chit_header h/.test(s) && /h.chit_id = \$1 AND h.entity_id = \$2/.test(s)) {
    return (p[0] === C1 && p[1] === R) ? [{ chit_id: C1, sender_entity_id: X, purpose: 'order', all_recipients: [{ entity_id: R }], current_status: 'pending', direction: 'received' }] : [];
  }
  if (/FROM identities/.test(s) && /bridge_id = \$1 OR LOWER\(user_id\)/.test(s)) {
    if (p[0] === 'shop-login') return [{ identity_id: SHOP, display_name: 'Login Shop', bridge_id: 'shop-login', business_status: 'open' }];
    if (p[0] === 'shop-open') return [{ identity_id: OPEN, display_name: 'Open Shop', bridge_id: 'shop-open', business_status: 'open' }];
    return [];
  }
  if (/SELECT entity_id FROM catalogue_items WHERE item_id = \$1/.test(s)) return p[0] === ITEM ? [{ entity_id: SHOP }] : [];
  if (/FROM identities WHERE identity_id = \$1/.test(s) && /catalogue_visibility/.test(s)) return [{ identity_id: SHOP, bridge_id: 'shop-login', plan: 'free', params_override: {}, catalogue_visibility: 'public' }];
  if (/enquiry_message_deliver/.test(s)) return [{ created_at: '2026-10-14T00:00:00.000Z' }];
  if (/WITH g AS/.test(s) && /subject_type = 'product'/.test(s)) {
    return [{ item_id: ITEM, from_entity_id: X, from_name: 'Asker', messages: 2, last_at: '2026-10-14T00:00:00.000Z', last_text: 'Is it in stock?', item_name: 'Rice', total: 7 }];
  }
  return [];
}
const q = async (sql, p) => { const rows = rowsFor(sql, p); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => true; sc.hasTable = async () => false;

/* the writes deliver-lines makes — counted, never performed */
let WRITES = [];
const dl = require(path.join(API, 'lib', 'deliverline'));
dl.record = async (eid, cid, rows) => { WRITES.push('record'); return { delivered: [].concat(rows || []).map((r) => ({ quantity: r.quantity })) }; };
dl.progress = async () => new Map();
const bu = require(path.join(API, 'lib', 'bill-use'));
bu.set = async () => { WRITES.push('use'); return { ok: true, use: 'resale' }; };
/* the bell — heard, not sent */
let RUNG = [];
const ev = require(path.join(API, 'lib', 'events'));
ev.notifyAfter = (res, ids, e) => { RUNG.push({ ids, e }); };
ev.emit = () => 0;
/* the catalogue view — the trim and the gate are under test, not the read */
const VIEWS = {
  [SHOP]: { available: true, visibility: 'public', items: [{ item_id: ITEM, item_data: { name: 'Rice', price: 100 } }], offers: [{ id: 'o1' }],
    shop: { bridge_id: 'shop-login', display_name: 'Login Shop', storefront_access: 'login', upi_id: 'shop@upi', gstn: 'G1', business_status: 'open', is_verified: true } },
  [OPEN]: { available: true, visibility: 'public', items: [{ item_id: 'i2', item_data: { name: 'Dal' } }], offers: [],
    shop: { bridge_id: 'shop-open', display_name: 'Open Shop', storefront_access: 'browse', business_status: 'open' } },
};
require(path.join(API, 'lib', 'catalogue-view')).buildPublicView = async (o) => Object.assign({}, VIEWS[o.entity.identity_id]);
const origErr = console.error; console.error = () => {};

const chits = require(path.join(API, 'routes', 'chits'));
const catalogue = require(path.join(API, 'routes', 'catalogue'));
const APP = express(); APP.use(express.json()); APP.use('/api/chits', chits); APP.use('/api/catalogue', catalogue);

const tok = (id, type, parent) => jwt.sign(Object.assign({ identity_id: id, identity_type: type, display_name: 'who-' + id.slice(0, 5) },
  parent ? { parent_entity_id: parent } : {}), process.env.JWT_SECRET, { algorithm: 'HS256' });
const actor = (id) => tok(id, 'actor', ACTORS[id].parent);

function call(method, url, token, body) {
  return new Promise((done) => {
    const srv = APP.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; });
        res.on('end', () => { srv.close(); let j = null; try { j = JSON.parse(b); } catch (_) {} done({ status: res.statusCode, body: j || {} }); });
      });
      r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {} }); });
      r.end(data);
    });
  });
}
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const show = (r) => r.status + ' ' + JSON.stringify(r.body).slice(0, 200);

(async () => {
  const DELIVER = '/api/chits/' + C1 + '/deliver-lines';
  const BODY = { rows: [{ line_id: 'l1', quantity: 2 }], use: 'resale' };

  console.log('\n— A · deliver-lines asks the verdict the page greys with —');
  WRITES = [];
  let r = await call('POST', DELIVER, actor('a-vw'), BODY);
  t('a viewer is refused 403', r.status === 403, show(r));
  t('…with the rail\'s word: why = read_only', r.body.why === 'read_only', show(r));
  t('…and nothing is written (no delivery, no use)', WRITES.length === 0, WRITES.join(','));
  r = await call('POST', DELIVER, actor('a-cmt'), BODY);
  t('a commenter is refused 403 with why = comment_only', r.status === 403 && r.body.why === 'comment_only', show(r));
  r = await call('POST', DELIVER, tok(X, 'entity'), BODY);
  t('a business holding no copy gets the 404 it always got, why = not_participant', r.status === 404 && r.body.why === 'not_participant', show(r));
  t('…and nothing is written', WRITES.length === 0, WRITES.join(','));
  r = await call('POST', DELIVER, actor('a-ed'), BODY);
  t('an editor co-assist holding the copy records', r.status === 200 && WRITES.includes('record'), show(r) + ' writes=' + WRITES.join(','));
  WRITES = [];
  r = await call('POST', DELIVER, tok(R, 'entity'), BODY);
  t('the owner records (use first, then the lines)', r.status === 200 && WRITES.join(',') === 'use,record', show(r) + ' writes=' + WRITES.join(','));

  /* the route's OWN gate, with the hat gate stood aside: the backstop must refuse by itself */
  const hgPath = require.resolve(path.join(API, 'middleware', 'hat-gate'));
  const realHg = require.cache[hgPath];
  require.cache[hgPath] = { id: hgPath, filename: hgPath, loaded: true, exports: (req, res, next) => next() };
  WRITES = [];
  r = await call('POST', DELIVER, actor('a-vw'), BODY);
  t('hat gate aside: the route itself refuses a viewer 403 why = read_only, in the rail\'s sentence', r.status === 403 && r.body.why === 'read_only'
    && r.body.message === require(path.join(API, 'lib', 'rail')).WHY.read_only, show(r));
  t('…before any write', WRITES.length === 0, WRITES.join(','));
  r = await call('POST', DELIVER, actor('a-cmt'), BODY);
  t('hat gate aside: a commenter 403 why = comment_only', r.status === 403 && r.body.why === 'comment_only', show(r));
  require.cache[hgPath] = realHg;
  const wf = require(path.join(API, 'lib', 'workflow'));
  t('the route and the page read ONE verdict: workflow.can(deliver_line) for a viewer is read_only',
    wf.can({ held: true }, { level: 'viewer' }, 'deliver_line').why === 'read_only');

  console.log('\n— B · a sign-in-first shop answers the card alone until a customer of THIS shop signs in —');
  const CARD_ONLY = (b) => b.code === 'SIGNIN_REQUIRED' && b.signin_required === true && b.shop && b.shop.display_name === 'Login Shop'
    && !('items' in b) && !('offers' in b) && !('finishes' in b) && !('upi_id' in b.shop) && !('gstn' in b.shop);
  r = await call('GET', '/api/catalogue/shop-login');
  t('anonymous → 401 code SIGNIN_REQUIRED', r.status === 401 && r.body.code === 'SIGNIN_REQUIRED', show(r));
  t('…the shop card alone (no items, offers, finishes, payment id, tax id)', CARD_ONLY(r.body), show(r));
  r = await call('GET', '/api/catalogue/shop-login', tok('c0000000-0000-4000-8000-000000000009', 'customer', OPEN));
  t('another shop\'s customer → 401 card', r.status === 401 && CARD_ONLY(r.body), show(r));
  r = await call('GET', '/api/catalogue/shop-login', tok(X, 'entity'));
  t('another business → 401 card', r.status === 401 && CARD_ONLY(r.body), show(r));
  r = await call('GET', '/api/catalogue/shop-login', 'not-a-token');
  t('a bad token is anonymous → 401 card', r.status === 401 && CARD_ONLY(r.body), show(r));
  r = await call('GET', '/api/catalogue/shop-login', tok('c0000000-0000-4000-8000-000000000001', 'customer', SHOP));
  t('this shop\'s signed-in customer reads the catalogue', r.status === 200 && Array.isArray(r.body.items) && r.body.items.length === 1, show(r));
  r = await call('GET', '/api/catalogue/shop-login?preview=1', tok(SHOP, 'entity'));
  t('the owner\'s preview reads it', r.status === 200 && r.body.items && r.body.preview, show(r));
  r = await call('GET', '/api/catalogue/shop-login', tok(SHOP, 'entity'));
  t('the owner WITHOUT preview is a visitor → 401 card', r.status === 401 && CARD_ONLY(r.body), show(r));
  r = await call('GET', '/api/catalogue/shop-open');
  t('a browse-first shop stays open to anyone', r.status === 200 && r.body.items && r.body.items.length === 1, show(r));
  const peer = catalogue.publicResponseFor(Object.assign({}, VIEWS[SHOP]), false);
  t('the CTP pull (publicResponseFor, never signed in) gets the same card', CARD_ONLY(peer), JSON.stringify(peer).slice(0, 200));
  const EMBED = path.join(API, '..', 'chitbridge-web', 'public', 'embed.html');
  if (!fs.existsSync(EMBED)) console.log('  SKIPPED embed.html check — chitbridge-web is not beside this repo');
  else {
    const embed = fs.readFileSync(EMBED, 'utf8');
    t('embed.html reads the same route and branches on code SIGNIN_REQUIRED (never on prose)',
      /\/api\/catalogue\/'\s*\+\s*encodeURIComponent\(BRIDGE\)/.test(embed) && /code === 'SIGNIN_REQUIRED'/.test(embed));
  }

  console.log('\n— C · enquiries ring the owner\'s bell, and list paged —');
  RUNG = [];
  r = await call('POST', '/api/catalogue/enquiry/' + ITEM, tok(X, 'entity'), { message_text: 'Is it in stock?', thread_type: 'external' });
  t('an external enquiry is sent (201)', r.status === 201, show(r));
  t('…and rings the OWNER\'s bell: kind enquiry, the item, the asker', RUNG.length === 1 && RUNG[0].ids[0] === SHOP && RUNG[0].e.kind === 'enquiry'
    && RUNG[0].e.id === ITEM && RUNG[0].e.who, JSON.stringify(RUNG));
  RUNG = [];
  r = await call('POST', '/api/catalogue/enquiry/' + ITEM, tok(X, 'entity'), { message_text: 'note to self', thread_type: 'internal' });
  t('an internal note rings nobody', r.status === 201 && RUNG.length === 0, show(r) + ' ' + JSON.stringify(RUNG));
  SQL.length = 0;
  r = await call('GET', '/api/catalogue/enquiry/inbox?page=2&limit=500', tok(SHOP, 'entity'));
  t('GET /enquiry/inbox answers 200 with enquiries + top-level total · page · limit', r.status === 200 && Array.isArray(r.body.enquiries)
    && r.body.total === 7 && r.body.page === 2 && r.body.limit === 100, show(r));
  t('…a row carries no per-row `total`', r.body.enquiries && r.body.enquiries[0] && !('total' in r.body.enquiries[0]) && r.body.enquiries[0].item_name === 'Rice', show(r));
  const inboxSql = SQL.filter((x) => /WITH g AS/.test(x.s));
  t('…one statement, the caller\'s own copies, limit capped at 100, offset from the page', inboxSql.length === 1
    && inboxSql[0].p[0] === SHOP && inboxSql[0].p[1] === 100 && inboxSql[0].p[2] === 100, JSON.stringify(inboxSql.map((x) => x.p)));
  r = await call('GET', '/api/catalogue/enquiry/inbox');
  t('…and needs a login (401 anonymous)', r.status === 401, show(r));

  console.log('\n— D · guards —');
  const chitsSrc = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
  const route = chitsSrc.slice(chitsSrc.indexOf("router.post('/:chit_id/deliver-lines'"), chitsSrc.indexOf('/* ═══ DELIVER-LINES\' NAMED STEPS'));
  const gateAt = route.indexOf("'deliver_line'"), useAt = route.indexOf('deliverUse('), recAt = route.indexOf('deliverline.record(');
  t('deliver-lines asks workflow.can(deliver_line) BEFORE deliverUse and deliverline.record', gateAt > 0 && gateAt < useAt && gateAt < recAt, [gateAt, useAt, recAt].join(' '));
  const catSrc = fs.readFileSync(path.join(API, 'routes', 'catalogue.js'), 'utf8');
  t('/enquiry/inbox is declared before /enquiry/:item_id', catSrc.indexOf("router.get('/enquiry/inbox'") > 0
    && catSrc.indexOf("router.get('/enquiry/inbox'") < catSrc.indexOf("router.get('/enquiry/:item_id'"));
  t('GET /:bridge_id refuses through publicResponseFor (the one trim) — no second gate', /publicResponseFor\(view, asOwner, customerOf\(req, entity\)\)/.test(catSrc));
  const hg = fs.readFileSync(path.join(API, 'middleware', 'hat-gate.js'), 'utf8');
  t('the hat gate\'s refusal carries the rail\'s word (byLevel), not a word of its own', /why: require\('\.\.\/lib\/rail'\)\.byLevel\(lvl/.test(hg));

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });

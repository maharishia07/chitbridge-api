/**
 * tests/sec4-server-gates.test.cjs — SEC4 · THE SERVER CHECKS WHAT THE PAGE GREYS (docs/critique/SEC4.md).
 *
 * The REAL middleware/auth.js, routes/chits.js, routes/catalogue.js and the adopted rail engine. Only the database (and the catalogue
 * build, which is a whole engine of its own) are stand-ins.
 *
 *   A  POST /chits/:id/deliver-lines — a viewer is refused 403: by the hat gate (as before) AND, with the gate stepped aside, by the
 *      route itself in the rail's word (read_only) before anything is read or written; a commenter → comment_only; a stranger → 404
 *      not_participant; an editor holding a copy reaches the delivery.
 *   B  a sign-in-first shop: GET /catalogue/:bridge_id answers a stranger with the card + code `sign_in_first` and NO items; the same
 *      for a customer of ANOTHER shop; this shop's customer and its owner get the catalogue; a browse-first shop is unchanged. The CTP
 *      pull and the embed read the same function (publicViewFor / the same route); the network lens filters sign-in-first shops.
 *   C  enquiries: an external question about another business's product rings the owner's bell (lib/events, kind 'enquiry'); an
 *      internal note or a question about my own item rings nothing; GET /catalogue/enquiry is paged (total · page · limit, top level)
 *      and is not swallowed by /:bridge_id.
 *
 * Run: node tests/sec4-server-gates.test.cjs · no DB, no network beyond 127.0.0.1.
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

/* ── the cast ── */
const S = 'aaaaaaaa-0000-4000-8000-00000000000a';   // sends C1; owns the shop + the item
const R = 'bbbbbbbb-0000-4000-8000-00000000000b';   // receives C1; asks about S's item
const X = 'eeeeeeee-0000-4000-8000-00000000000e';   // holds nothing
const C1 = '0000c417-0000-4000-8000-0000000000c1';
const ITEM = '17e17e17-0000-4000-8000-000000000017', MY_ITEM = '17e17e17-0000-4000-8000-000000000018';
const ACTORS = {
  'a-vw':  { parent: R, access_level: 'viewer', whole_entity: false, hat: 'view_only' },
  'a-cmt': { parent: R, access_level: 'commenter', whole_entity: false, hat: 'audit' },
  'a-ed':  { parent: R, access_level: 'editor', whole_entity: false, hat: 'act' },
};
const HEADER = [
  { chit_id: C1, entity_id: S, direction: 'sent', sender_entity_id: S, purpose: 'order', current_status: 'delivered' },
  { chit_id: C1, entity_id: R, direction: 'received', sender_entity_id: S, purpose: 'order', current_status: 'pending' },
];
let SF = 'login';   // the shop's storefront_access
const SQL = [];

function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  p = p || [];
  SQL.push(s);
  if (/break_status/.test(s) && /FROM identities/.test(s)) { const a = ACTORS[p[0]]; return a ? [{ break_status: 'active', hat: a.hat, access_level: a.access_level, whole_entity: a.whole_entity }] : []; }
  if (/FROM chit_header h LEFT JOIN chit_detail/.test(s) && /h.chit_id = \$1 AND h.entity_id = \$2/.test(s)) return HEADER.filter((h) => h.chit_id === p[0] && h.entity_id === p[1]);
  if (/FROM identities WHERE \(bridge_id = \$1 OR LOWER\(user_id\)/.test(s)) return p[0] === 'shop-s' ? [{ identity_id: S, display_name: 'Shop S', bridge_id: 'shop-s', currency_code: 'INR' }] : [];
  if (/SELECT entity_id FROM catalogue_items WHERE item_id = \$1/.test(s)) return p[0] === ITEM ? [{ entity_id: S }] : p[0] === MY_ITEM ? [{ entity_id: R }] : [];
  if (/SELECT identity_id, bridge_id, plan, params_override, catalogue_visibility FROM identities/.test(s)) return [{ identity_id: p[0], bridge_id: 'shop-s' }];
  if (/enquiry_message_deliver/.test(s)) return [{ created_at: '2026-10-14T00:00:00.000Z' }];
  if (/FROM chit_messages WHERE entity_id = \$1 AND subject_type = 'product'/.test(s)) {
    return [{ total: 3, rows: [{ item_id: ITEM, item_name: 'Rice 25kg', about_mine: true, messages: 2, askers: 1, last_text: 'Is it in stock?', last_from_name: 'R', last_from_me: false, last_at: '2026-10-14T00:00:00Z' }] }];
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

/* the hat gate, real — with a switch so section A can also prove the ROUTE's own refusal behind it */
const hatPath = require.resolve(path.join(API, 'middleware', 'hat-gate'));
const realGate = require(hatPath);
let HAT_ON = true;
require.cache[hatPath].exports = function (req, res, next) { return HAT_ON ? realGate(req, res, next) : next(); };

/* the delivery itself — counted, never run (its definer is the db's business) */
let RECORDED = 0;
const dl = require(path.join(API, 'lib', 'deliverline'));
dl.record = async () => { RECORDED++; return { delivered: [] }; };
dl.progress = async () => new Map();
/* the catalogue build — a whole engine; here only what the gate reads */
const cv = require(path.join(API, 'lib', 'catalogue-view'));
cv.buildPublicView = async () => ({ available: true, visibility: 'public', items: [{ item_id: ITEM, item_data: { name: 'Rice 25kg', price: 1200 } }],
  lines: [], offers: [], categories: [], finishes: [],
  shop: { bridge_id: 'shop-s', display_name: 'Shop S', currency_code: 'INR', storefront_access: SF, upi_id: 'shop@upi', units: { kg: {} } } });
/* the bell — counted */
const BELL = [];
const ev = require(path.join(API, 'lib', 'events'));
ev.notifyAfter = (res, ids, e) => { BELL.push({ ids, e }); };
const origErr = console.error; console.error = () => {};

const rail = require(path.join(API, 'lib', 'rail'));
const chits = require(path.join(API, 'routes', 'chits'));
const cat = require(path.join(API, 'routes', 'catalogue'));
const app = express(); app.use(express.json()); app.use('/api/chits', chits); app.use('/api/catalogue', cat);

const tok = (id, type, parent) => jwt.sign(Object.assign({ identity_id: id, identity_type: type, display_name: 'who-' + id.slice(0, 5) },
  parent ? { parent_entity_id: parent } : {}), process.env.JWT_SECRET, { algorithm: 'HS256' });
const actor = (id) => tok(id, 'actor', ACTORS[id].parent);

function call(method, url, token, body) {
  return new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
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
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '\n       ' + extra : '')); } };
const show = (r) => r.status + ' ' + JSON.stringify(r.body).slice(0, 200);

(async () => {
  const DELIVER = '/api/chits/' + C1 + '/deliver-lines', ROWS = { rows: [{ line_id: 'l1', quantity: 1 }] };

  console.log('\n— A · deliver-lines: the server refuses what the page greys —');
  HAT_ON = true; RECORDED = 0;
  let r = await call('POST', DELIVER, actor('a-vw'), ROWS);
  t('a viewer co-assist is refused 403 at the door (the hat gate, unchanged)', r.status === 403 && r.body.access_level === 'viewer', show(r));
  HAT_ON = false;
  r = await call('POST', DELIVER, actor('a-vw'), ROWS);
  t('…and with the gate stepped aside, the ROUTE refuses it: 403, why read_only, the rail\'s sentence', r.status === 403 && r.body.why === 'read_only' && r.body.message === rail.WHY.read_only, show(r));
  r = await call('POST', DELIVER, actor('a-cmt'), ROWS);
  t('a commenter → 403 comment_only', r.status === 403 && r.body.why === 'comment_only', show(r));
  t('…nothing was recorded for either', RECORDED === 0, 'recorded ' + RECORDED);
  r = await call('POST', DELIVER, tok(X, 'entity'), ROWS);
  t('a business holding no copy → 404 not_participant (an id in the URL learns nothing)', r.status === 404 && r.body.why === 'not_participant', show(r));
  t('…nothing recorded', RECORDED === 0);
  r = await call('POST', DELIVER, actor('a-ed'), ROWS);
  t('an editor co-assist holding the copy reaches the delivery', r.status === 200 && RECORDED === 1, show(r));
  r = await call('POST', DELIVER, tok(S, 'entity'), ROWS);
  t('the sender (owner) holding its copy reaches the delivery', r.status === 200 && RECORDED === 2, show(r));
  HAT_ON = true;
  const RA = require(path.join(API, 'lib', 'rail-actions'));
  t('canDeliver answers only the engine\'s words', ['viewer', 'commenter', 'editor'].every((lv) => { const v = RA.canDeliver({ held: false }, { level: lv }); return Object.prototype.hasOwnProperty.call(rail.WHY, v.why); }));
  t('…and an unknown level fails closed (viewer)', RA.canDeliver({ held: true }, { level: 'boss' }).why === 'read_only');

  console.log('\n— B · a sign-in-first shop answers a stranger with its card —');
  SF = 'login';
  r = await call('GET', '/api/catalogue/shop-s', null);
  t('anonymous → 200 with the card and code sign_in_first', r.status === 200 && r.body.sign_in && r.body.sign_in.code === 'sign_in_first' && r.body.shop && r.body.shop.display_name === 'Shop S', show(r));
  t('…and NOTHING else: no items, lines, offers, finishes, schema', Object.keys(r.body).sort().join(',') === 'shop,sign_in', Object.keys(r.body).join(','));
  t('…the card carries no payment id and no unit rules (only who the shop is)', r.body.shop && r.body.shop.upi_id === undefined && r.body.shop.units === undefined);
  r = await call('GET', '/api/catalogue/shop-s', 'not-a-token');
  t('a bad token is anonymous → the card', r.status === 200 && r.body.sign_in && !r.body.items, show(r));
  r = await call('GET', '/api/catalogue/shop-s', tok(R, 'customer', X));
  t('a customer of ANOTHER shop → the card', r.status === 200 && r.body.sign_in && !r.body.items, show(r));
  r = await call('GET', '/api/catalogue/shop-s', tok(R, 'customer', S));
  t('this shop\'s signed-in customer → the catalogue', r.status === 200 && !r.body.sign_in && Array.isArray(r.body.items) && r.body.items.length === 1, show(r));
  r = await call('GET', '/api/catalogue/shop-s', tok(S, 'entity'));
  t('the shop\'s own owner → the catalogue', r.status === 200 && !r.body.sign_in && r.body.items.length === 1, show(r));
  SF = 'browse';
  r = await call('GET', '/api/catalogue/shop-s', null);
  t('a browse-first shop, anonymous → the catalogue, unchanged', r.status === 200 && !r.body.sign_in && r.body.items.length === 1, show(r));
  SF = 'login';
  const ent = { identity_id: S, bridge_id: 'shop-s', display_name: 'Shop S' };
  const pv = await cat.publicViewFor(ent, {});
  const ctp = cat.publicResponseFor(pv, false);
  t('the CTP pull (publicViewFor with neither owner nor viewer) → the card only', !!ctp.sign_in && !ctp.items && Object.keys(ctp).sort().join(',') === 'shop,sign_in', Object.keys(ctp).join(','));
  t('a signed-in business reading as a viewer (enquiry, B2B) → the catalogue', !(await cat.publicViewFor(ent, { viewer: 'other-shop' })).sign_in);
  const CTP_SRC = fs.readFileSync(path.join(API, 'routes', 'ctp.js'), 'utf8');
  t('routes/ctp.js answers a peer through publicViewFor + publicResponseFor (the same cut)', /catalogue\.publicViewFor\(ent, \{\}\)/.test(CTP_SRC) && /catalogue\.publicResponseFor\(view, false\)/.test(CTP_SRC));
  const CAT_SRC = fs.readFileSync(path.join(API, 'routes', 'catalogue.js'), 'utf8');
  t('the network storefront skips a sign-in-first department', /if \(view\.sign_in\) continue;/.test(CAT_SRC));
  SQL.length = 0;
  await call('GET', '/api/catalogue/network-store/shop-s', null);
  t('the network lens (network-store) filters sign-in-first shops in its one statement', SQL.some((s) => /FROM catalogue_items ci/.test(s) && /storefront_access' = 'login'/.test(s)));

  console.log('\n— C · enquiries ring the supplier\'s bell, and there is a list —');
  BELL.length = 0;
  r = await call('POST', '/api/catalogue/enquiry/' + ITEM, tok(R, 'entity'), { message_text: 'Is it in stock?' });
  t('R asks about S\'s product → 201', r.status === 201, show(r));
  t('…S\'s bell rings once: kind enquiry, the item id, who asked', BELL.length === 1 && BELL[0].ids.join() === S && BELL[0].e.kind === 'enquiry' && BELL[0].e.id === ITEM && !!BELL[0].e.who, JSON.stringify(BELL));
  BELL.length = 0;
  await call('POST', '/api/catalogue/enquiry/' + ITEM, tok(R, 'entity'), { message_text: 'note to self', thread_type: 'internal' });
  t('an internal note rings nothing', BELL.length === 0, JSON.stringify(BELL));
  await call('POST', '/api/catalogue/enquiry/' + MY_ITEM, tok(R, 'entity'), { message_text: 'testing my own item' });
  t('asking about my own item rings nothing', BELL.length === 0, JSON.stringify(BELL));
  r = await call('GET', '/api/catalogue/enquiry?page=1&limit=2', tok(S, 'entity'));
  t('GET /catalogue/enquiry → paged list: enquiries[] + top-level total · page · limit', r.status === 200 && Array.isArray(r.body.enquiries) && r.body.total === 3 && r.body.page === 1 && r.body.limit === 2, show(r));
  t('…not swallowed by /:bridge_id (no "Shop not found")', r.body.error === undefined);
  r = await call('GET', '/api/catalogue/enquiry?limit=5000', tok(S, 'entity'));
  t('…limit is capped at 100', r.body.limit === 100, show(r));
  r = await call('GET', '/api/catalogue/enquiry', null);
  t('…and needs a signed-in business (401 anonymous)', r.status === 401, show(r));

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();

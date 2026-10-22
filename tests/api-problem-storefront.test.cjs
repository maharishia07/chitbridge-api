/**
 * tests/api-problem-storefront.test.cjs — API-1 SLICE 1e: EVERY ANSWER OF THE PUBLIC STOREFRONT IS A PROBLEM THAT KEEPS ITS OLD KEYS.
 *
 * OWNS      the scenarios behind the error_tests column of the 11 routes of routes/catalogue.js that anyone may call with no sign-in
 *           (the shop, the network fronts, order start/confirm, support, the shopper's sign-in), and their rows of
 *           docs/contracts/api-error-tests.json. The storefront reads `error` and `message` (and `code`, `details`); every refusal keeps
 *           them word for word (frozen in docs/contracts/api-legacy.json) beside the Problem fields.
 *           Also lib/storefront-contract.js as a unit: the operations, the old validation body, a 5xx fail-closed.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/catalogue.js, lib/otp.js and lib/network-membership's
 *           answers over a stand-in db, catalogue view, notifier, conformance and offers.
 * FLOW      scenario → real route → body → Problem fields present · frozen legacy keys equal · no cause on a 5xx · statuses → manifest
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/api-problem-storefront.test.cjs               check
 *   node tests/api-problem-storefront.test.cjs --write       rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-storefront.test.cjs --capture F   record every answer to F (run on the code BEFORE the change, to freeze its keys)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const HERE = path.join(__dirname, '..');
const API = process.env.API_ROOT ? path.resolve(process.env.API_ROOT) : HERE;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-storefront';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence.json');
const EVIDENCE_ABOUT =
  "Evidence for the two columns a static read cannot prove (API-STANDARD S34, S35). routes['METHOD /path'] = { output_allowlist: true } once a contract test has shown the answer holds only schema_out fields; { foreign_id_404: true } once a test has shown another shop's id gets the same 404 as an unknown id. Written by the area's test, never by hand. Empty today.";
/* what this run proved, per route: every 200 it saw was closed (output_allowlist), a hidden shop answered as an unknown one (foreign_id_404) */
const proved = {};
const prove = (route, column, held) => {
  const row = (proved[route] = proved[route] || {});
  row[column] = row[column] !== false && held;
};
const C = '/api/catalogue';
/* this file's rows: the public storefront routes of routes/catalogue.js */
const PUBLIC_ROUTES = [
  'GET /api/catalogue/network-store/:networkId',
  'POST /api/catalogue/network-store/:networkId/order',
  'GET /api/catalogue/network/:bridge_id',
  'GET /api/catalogue/:bridge_id',
  'GET /api/catalogue/:bridge_id/capture-fields',
  'POST /api/catalogue/:bridge_id/order/start',
  'GET /api/catalogue/:bridge_id/support/preview',
  'POST /api/catalogue/:bridge_id/support/start',
  'POST /api/catalogue/:bridge_id/support',
  'POST /api/catalogue/:bridge_id/order/confirm',
  'POST /api/catalogue/:bridge_id/login/verify'
];
const MINE = (route) => PUBLIC_ROUTES.includes(route);
const argv = process.argv.slice(2);
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/* ── the cast ── */
const SHOP_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const MEMBER_ID = 'bbbbbbbb-0000-4000-8000-00000000000b';
const BUYER_ID = 'cccccccc-0000-4000-8000-00000000000c';
const ITEM_ID = 'dddddddd-0000-4000-8000-00000000000d';
const SECRET_SQL = 'relation "catalogue_items" does not exist -- SELECT secret FROM vault';
const GOOD_CODE = '654321';
const FRESH = {
  shop: true,
  sealed: false,
  closed: false,
  dbFails: false,
  itemsFail: false,
  adoptionFails: false,
  buyer: true,
  attempts: 0,
  members: [MEMBER_ID],
  tree: null,
  treeFails: false,
  items: [],
  operator: true,
  view: { available: true, shop: { name: 'Shop S' } },
  orderInput: { pipeline: 'commerce' },
  notifyFails: false,
  captureFails: false,
  raised: true,
  keyHeld: null
};
const world = Object.assign({}, FRESH);
const readFailed = () => Object.assign(new Error('network read failed'), { code: 'NETWORK_READ_FAILED' });

/* the idempotency_key rows (middleware/idempotency.js dbStore) by (entity, key): what a double tap meets */
const keyRows = new Map();
const statements = []; /* every statement run, in order: how a test counts what a request did */
function keyStatement(s, params) {
  const slot = (key) => params[0] + '\n' + key;
  if (/^SELECT/.test(s)) {
    if (world.keyHeld) return [Object.assign({ idem_key: 'held', req_hash: null, status: null, response: null, expired: false }, world.keyHeld)];
    const held = keyRows.get(slot(/idem_key = \$3/.test(s) ? params[2] : params[1]));
    return held ? [Object.assign({ expired: false }, held)] : [];
  }
  if (/^INSERT/.test(s)) {
    if (keyRows.has(slot(params[1]))) return [];
    keyRows.set(slot(params[1]), { idem_key: params[1], req_hash: params[4], state: 'in_progress', status: null, response: null });
    return [{ idem_key: params[1] }];
  }
  if (/^UPDATE/.test(s)) Object.assign(keyRows.get(slot(params[1])) || {}, { state: 'done', status: params[2], response: JSON.parse(params[3]) });
  if (/^DELETE/.test(s)) keyRows.delete(slot(params[1]));
  return [];
}

/** the rows a statement gets */
function rowsFor(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  statements.push(s);
  if (/idempotency_key/.test(s)) return keyStatement(s, params || []);
  if (world.dbFails) throw new Error(SECRET_SQL);
  if (/FROM identities WHERE \(bridge_id = \$1 OR LOWER\(user_id\)/.test(s)) {
    /* the stand-in honours resolveEntity's own filter: a sealed or inactive shop is dropped only if the statement really asks for that */
    if (world.sealed && /status = 'active'/.test(s) && /COALESCE\(sealed, false\) = false/.test(s)) return [];
    return world.shop
      ? [
          {
            identity_id: SHOP_ID,
            display_name: 'Shop S',
            bridge_id: 'shop-s',
            user_id: 'shop-s',
            currency_code: 'INR',
            business_status: world.closed ? 'closed' : 'active',
            population: 'live'
          }
        ]
      : [];
  }
  if (/otp_code, otp_expires_at, otp_attempts FROM identities WHERE email = \$1/.test(s)) {
    return world.buyer
      ? [
          {
            identity_id: BUYER_ID,
            bridge_id: 'BUYER01',
            display_name: 'Buyer',
            otp_code: GOOD_CODE,
            otp_expires_at: new Date(Date.now() + 600000).toISOString(),
            otp_attempts: world.attempts
          }
        ]
      : [];
  }
  /* the code is spent once, on the order's own transaction (lib/otp spendShopperOtp: one row back = spent now) */
  if (/AND otp_code = \$2 RETURNING identity_id/.test(s)) return [{ identity_id: BUYER_ID }];
  /* the operator's governed money (lib/regional currencyFor) */
  if (/SELECT currency_code, country FROM identities WHERE identity_id = \$1/.test(s)) return [{ currency_code: 'INR', country: 'IN' }];
  if (/FROM catalogue_adoption/.test(s) && world.adoptionFails) throw new Error(SECRET_SQL);
  if (/FROM catalogue_items/.test(s)) {
    if (world.itemsFail) throw new Error(SECRET_SQL);
    return world.items;
  }
  if (/SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = ANY/.test(s)) {
    return world.operator ? [{ identity_id: SHOP_ID, bridge_id: 'shop-s', display_name: 'Shop S' }] : [];
  }
  return [];
}

const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
function installStubs() {
  const q = async (sql, params) => {
    const rows = rowsFor(sql, params);
    return { rows, rowCount: rows.length };
  };
  const tx = { query: q };
  const db = {
    query: q,
    pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
    withEntity: async (id, run) => run(tx),
    withTransaction: async (run) => run(tx),
    onEntity: async (id, client, run) => run(tx),
    readBatch: async () => ({}),
    trySavepoint: async (client, run, fallback) => {
      try {
        return await run(client);
      } catch (failure) {
        return fallback;
      }
    }
  };
  mock('db', db);
  mock('db/index', db);
  const membership = require(path.join(API, 'lib', 'network-membership'));
  mock(
    'lib/network-membership',
    Object.assign({}, membership, {
      members: async () => {
        if (world.treeFails) throw readFailed();
        return world.members;
      },
      treeOf: async () => {
        if (world.treeFails) throw readFailed();
        return world.tree || ['shop-s'];
      }
    })
  );
  const view = require(path.join(API, 'lib', 'catalogue-view'));
  mock(
    'lib/catalogue-view',
    Object.assign({}, view, {
      buildPublicView: async () => world.view,
      getOrderInput: async () => {
        if (world.orderInput instanceof Error) throw world.orderInput;
        return world.orderInput;
      }
    })
  );
  const notify = require(path.join(API, 'lib', 'notify'));
  mock(
    'lib/notify',
    Object.assign({}, notify, {
      sendOtp: async () => {
        if (world.notifyFails) throw new Error('EACCES: ' + SECRET_SQL);
        return { sent: true };
      }
    })
  );
  mock('lib/conformance', {
    captureFieldsForEntity: async () => {
      if (world.captureFails) throw new Error(SECRET_SQL);
      return [];
    }
  });
  mock('lib/raiseticket', {
    URGENCY: [['Sev-3', 'normal']],
    raise: async () => (world.raised ? { raised: true, chit_id: 'chit-1', routed: {} } : { raised: false, why: 'Nobody at the shop takes these yet.' })
  });
}

const customer = (parent, extra) =>
  'Bearer ' +
  jwt.sign(
    Object.assign(
      { identity_id: BUYER_ID, identity_type: 'customer', display_name: 'Buyer', bridge_id: 'BUYER01' },
      parent ? { parent_entity_id: parent } : {},
      extra || {}
    ),
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256'
    }
  );
const IN_NETWORK = { authorization: customer(MEMBER_ID) };
const PHONE = { phone: '9876543210' };
const CONFIRM = (patch) => Object.assign({ phone: '9876543210', otp: GOOD_CODE, line_items: [{ name: 'Nothing here', qty: 1 }] }, patch || {});
/* the second tap of one order: lib/otp spendOrderCode's refusal, which lib/knownerr answers as a 409 in words */
const ALREADY_SENT = Object.assign(new Error('This order was already sent — check My orders before sending it again.'), { code: 'code_already_used' });
const SHOP_VIEW = {
  available: true,
  shop: { bridge_id: 'shop-s', display_name: 'Shop S' },
  items: [{ item_id: ITEM_ID, item_data: { name: 'Rice', price: 10, category: 'Food' } }],
  offers: [],
  categories: ['Food']
};
const SIGN_IN_VIEW = { available: true, shop: { bridge_id: 'shop-s', display_name: 'Shop S', storefront_access: 'login' }, items: [] };
/* one priced item the shop sells: the pricing step and the network order read it from catalogue_items */
const PRICED_ITEM = {
  item_id: ITEM_ID,
  entity_id: SHOP_ID,
  item_data: { name: 'Rice', price: 10, unit: 'kg', category: 'Food' },
  updated_at: '2026-10-01T00:00:00Z'
};

/* ── the scenarios: every error answer of the 11 public routes ── */
const NETWORK_ON = { networkOrders: true };
const SCENARIOS = [
  { id: 'nstore-unknown', route: 'GET /api/catalogue/network-store/:networkId', url: C + '/network-store/shop-s', status: 404, setup: { shop: false } },
  { id: 'nstore-read-fails', route: 'GET /api/catalogue/network-store/:networkId', url: C + '/network-store/shop-s', status: 503, setup: { treeFails: true } },
  { id: 'nstore-items-fail', route: 'GET /api/catalogue/network-store/:networkId', url: C + '/network-store/shop-s', status: 500, setup: { itemsFail: true } },
  {
    id: 'norder-off',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 403,
    body: { items: [{ product_id: ITEM_ID }] }
  },
  {
    id: 'norder-no-shopper',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 401,
    setup: NETWORK_ON,
    body: { items: [{ product_id: ITEM_ID }] }
  },
  {
    id: 'norder-no-items',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 400,
    setup: NETWORK_ON,
    headers: IN_NETWORK,
    body: {}
  },
  {
    id: 'norder-unknown',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 404,
    setup: Object.assign({ shop: false }, NETWORK_ON),
    headers: IN_NETWORK,
    body: { items: [{ product_id: ITEM_ID }] }
  },
  {
    id: 'norder-other-network',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 403,
    setup: NETWORK_ON,
    headers: { authorization: customer('ffffffff-0000-4000-8000-00000000000f') },
    body: { items: [{ product_id: ITEM_ID }] }
  },
  {
    id: 'norder-no-products',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 404,
    setup: NETWORK_ON,
    headers: IN_NETWORK,
    body: { items: [{ product_id: ITEM_ID }] }
  },
  {
    id: 'norder-no-operator',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 409,
    setup: Object.assign({ operator: false, items: [{ item_id: ITEM_ID, entity_id: MEMBER_ID, item_data: { name: 'Rice', price: 10 } }] }, NETWORK_ON),
    headers: IN_NETWORK,
    body: { items: [{ product_id: ITEM_ID }] }
  },
  {
    id: 'norder-fails',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 500,
    setup: Object.assign({ itemsFail: true }, NETWORK_ON),
    headers: IN_NETWORK,
    body: { items: [{ product_id: ITEM_ID }] }
  },
  { id: 'network-unknown', route: 'GET /api/catalogue/network/:bridge_id', url: C + '/network/shop-s', status: 404, setup: { shop: false } },
  { id: 'network-no-members', route: 'GET /api/catalogue/network/:bridge_id', url: C + '/network/shop-s', status: 404, setup: { tree: [] } },
  { id: 'network-no-departments', route: 'GET /api/catalogue/network/:bridge_id', url: C + '/network/shop-s', status: 404 },
  { id: 'network-read-fails', route: 'GET /api/catalogue/network/:bridge_id', url: C + '/network/shop-s', status: 503, setup: { treeFails: true } },
  {
    id: 'network-fails',
    route: 'GET /api/catalogue/network/:bridge_id',
    url: C + '/network/shop-s',
    status: 500,
    setup: { tree: ['shop-s', 'dept-1'], dbFails: true }
  },
  { id: 'shop-unknown', route: 'GET /api/catalogue/:bridge_id', url: C + '/shop-s', status: 404, setup: { shop: false } },
  { id: 'shop-private', route: 'GET /api/catalogue/:bridge_id', url: C + '/shop-s', status: 404, setup: { view: { available: false } } },
  { id: 'shop-fails', route: 'GET /api/catalogue/:bridge_id', url: C + '/shop-s', status: 500, setup: { dbFails: true } },
  { id: 'fields-unknown', route: 'GET /api/catalogue/:bridge_id/capture-fields', url: C + '/shop-s/capture-fields', status: 404, setup: { shop: false } },
  { id: 'fields-fail', route: 'GET /api/catalogue/:bridge_id/capture-fields', url: C + '/shop-s/capture-fields', status: 500, setup: { captureFails: true } },
  {
    id: 'start-unknown',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 404,
    setup: { shop: false },
    body: PHONE
  },
  {
    id: 'start-closed',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 403,
    setup: { closed: true },
    body: PHONE
  },
  { id: 'start-no-contact', route: 'POST /api/catalogue/:bridge_id/order/start', url: C + '/shop-s/order/start', status: 422, body: {} },
  {
    id: 'start-send-fails',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 500,
    setup: { notifyFails: true },
    body: PHONE
  },
  { id: 'preview-unknown', route: 'GET /api/catalogue/:bridge_id/support/preview', url: C + '/shop-s/support/preview', status: 404, setup: { shop: false } },
  { id: 'preview-fails', route: 'GET /api/catalogue/:bridge_id/support/preview', url: C + '/shop-s/support/preview', status: 500, setup: { dbFails: true } },
  {
    id: 'sstart-unknown',
    route: 'POST /api/catalogue/:bridge_id/support/start',
    url: C + '/shop-s/support/start',
    status: 404,
    setup: { shop: false },
    body: PHONE
  },
  {
    id: 'sstart-no-contact',
    route: 'POST /api/catalogue/:bridge_id/support/start',
    url: C + '/shop-s/support/start',
    status: 422,
    body: { phone: '9876543210', email: 'a@b.co' }
  },
  {
    id: 'sstart-send-fails',
    route: 'POST /api/catalogue/:bridge_id/support/start',
    url: C + '/shop-s/support/start',
    status: 500,
    setup: { notifyFails: true },
    body: PHONE
  },
  { id: 'support-nothing-sent', route: 'POST /api/catalogue/:bridge_id/support', url: C + '/shop-s/support', status: 400, body: {} },
  {
    id: 'support-unknown',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 404,
    setup: { shop: false },
    body: { phone: '9876543210', otp: GOOD_CODE, observed: 'It broke' }
  },
  {
    id: 'support-no-contact',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 422,
    body: { otp: GOOD_CODE, observed: 'It broke' }
  },
  {
    id: 'support-no-code-asked',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 400,
    setup: { buyer: false },
    body: { phone: '9876543210', otp: GOOD_CODE, observed: 'It broke' }
  },
  {
    id: 'support-wrong-code',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 400,
    body: { phone: '9876543210', otp: '111111', observed: 'It broke' }
  },
  {
    id: 'support-locked',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 429,
    setup: { attempts: 99 },
    body: { phone: '9876543210', otp: GOOD_CODE, observed: 'It broke' }
  },
  {
    id: 'support-not-raised',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 502,
    setup: { raised: false },
    body: { phone: '9876543210', otp: GOOD_CODE, observed: 'It broke' }
  },
  {
    id: 'support-fails',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 500,
    setup: { dbFails: true },
    body: { phone: '9876543210', otp: GOOD_CODE, observed: 'It broke' }
  },
  { id: 'confirm-nothing-sent', route: 'POST /api/catalogue/:bridge_id/order/confirm', url: C + '/shop-s/order/confirm', status: 400, body: {} },
  {
    id: 'confirm-empty-order',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 400,
    body: { otp: GOOD_CODE, line_items: [] }
  },
  {
    id: 'confirm-unknown',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 404,
    setup: { shop: false },
    body: CONFIRM()
  },
  {
    id: 'confirm-closed',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 403,
    setup: { closed: true },
    body: CONFIRM()
  },
  {
    id: 'confirm-no-contact',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 422,
    body: CONFIRM({ phone: undefined })
  },
  {
    id: 'confirm-not-started',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 400,
    setup: { buyer: false },
    body: CONFIRM()
  },
  {
    id: 'confirm-wrong-code',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 400,
    body: CONFIRM({ otp: '111111' })
  },
  {
    id: 'confirm-locked',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 429,
    setup: { attempts: 99 },
    body: CONFIRM()
  },
  { id: 'confirm-not-in-catalogue', route: 'POST /api/catalogue/:bridge_id/order/confirm', url: C + '/shop-s/order/confirm', status: 422, body: CONFIRM() },
  {
    id: 'confirm-reprice-fails',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 500,
    setup: { itemsFail: true },
    body: CONFIRM()
  },
  {
    id: 'confirm-too-many-forms',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 422,
    setup: { orderInput: { pipeline: 'payload' } },
    body: CONFIRM({ line_items: [{}, {}, {}, {}, {}, {}] })
  },
  {
    id: 'confirm-template-unread',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 503,
    setup: { orderInput: { pipeline: 'payload' }, adoptionFails: true },
    body: CONFIRM({ line_items: [{ name: 'Form A' }] })
  },
  {
    id: 'confirm-fails',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 500,
    setup: { orderInput: null },
    body: CONFIRM()
  },
  {
    id: 'confirm-already-sent',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 409,
    setup: { orderInput: ALREADY_SENT },
    body: CONFIRM()
  },
  /* strict input (API-3): a key the door does not read is refused in the old validation words, never dropped */
  {
    id: 'confirm-unknown-key',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 400,
    body: CONFIRM({ delivery_address: '9 Market street' })
  },
  {
    id: 'start-unknown-key',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 400,
    body: { phone: '9876543210', coupon: 'FREE' }
  },
  {
    id: 'sstart-unknown-key',
    route: 'POST /api/catalogue/:bridge_id/support/start',
    url: C + '/shop-s/support/start',
    status: 400,
    body: { phone: '9876543210', role: 'admin' }
  },
  {
    id: 'support-unknown-key',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 400,
    body: { phone: '9876543210', otp: GOOD_CODE, observed: 'It broke', to_bridge_id: 'other' }
  },
  {
    id: 'login-unknown-key',
    route: 'POST /api/catalogue/:bridge_id/login/verify',
    url: C + '/shop-s/login/verify',
    status: 400,
    body: { phone: '9876543210', otp: GOOD_CODE, identity_type: 'entity' }
  },
  {
    id: 'norder-unknown-key',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 400,
    setup: NETWORK_ON,
    headers: IN_NETWORK,
    body: { items: [{ product_id: ITEM_ID }], total: 0 }
  },
  /* the 200s: each body holds only the keys its operation lists (API-3 output allow-list) */
  { id: 'nstore-ok', route: 'GET /api/catalogue/network-store/:networkId', url: C + '/network-store/shop-s', status: 200 },
  {
    id: 'network-ok',
    route: 'GET /api/catalogue/network/:bridge_id',
    url: C + '/network/shop-s',
    status: 200,
    setup: { tree: ['shop-s', 'dept-1'], view: SHOP_VIEW }
  },
  { id: 'shop-ok', route: 'GET /api/catalogue/:bridge_id', url: C + '/shop-s', status: 200, setup: { view: SHOP_VIEW } },
  { id: 'shop-sign-in-first', route: 'GET /api/catalogue/:bridge_id', url: C + '/shop-s', status: 200, setup: { view: SIGN_IN_VIEW } },
  { id: 'fields-ok', route: 'GET /api/catalogue/:bridge_id/capture-fields', url: C + '/shop-s/capture-fields', status: 200 },
  {
    id: 'start-no-key',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 400,
    keyless: true,
    body: { identifier: '9876543210', name: 'Buyer' }
  },
  {
    id: 'start-key-in-progress',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 409,
    setup: { keyHeld: { state: 'in_progress' } },
    body: { identifier: '9876543210', name: 'Buyer' }
  },
  {
    id: 'start-key-other-body',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 422,
    setup: { keyHeld: { state: 'done', req_hash: 'another body', status: 200, response: {} } },
    body: { identifier: '9876543210', name: 'Buyer' }
  },
  {
    id: 'confirm-no-key',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 400,
    keyless: true,
    setup: { items: [PRICED_ITEM] },
    body: CONFIRM({ line_items: [{ item_id: ITEM_ID, name: 'Rice', qty: 2 }] })
  },
  {
    id: 'confirm-key-in-progress',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 409,
    setup: { items: [PRICED_ITEM], keyHeld: { state: 'in_progress' } },
    body: CONFIRM({ line_items: [{ item_id: ITEM_ID, name: 'Rice', qty: 2 }] })
  },
  {
    id: 'confirm-key-other-body',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 422,
    setup: { items: [PRICED_ITEM], keyHeld: { state: 'done', req_hash: 'another body', status: 200, response: {} } },
    body: CONFIRM({ line_items: [{ item_id: ITEM_ID, name: 'Rice', qty: 2 }] })
  },
  {
    id: 'start-ok',
    route: 'POST /api/catalogue/:bridge_id/order/start',
    url: C + '/shop-s/order/start',
    status: 200,
    body: { identifier: '9876543210', name: 'Buyer' }
  },
  { id: 'preview-ok', route: 'GET /api/catalogue/:bridge_id/support/preview', url: C + '/shop-s/support/preview', status: 200 },
  { id: 'sstart-ok', route: 'POST /api/catalogue/:bridge_id/support/start', url: C + '/shop-s/support/start', status: 200, body: { identifier: 'a@b.co' } },
  {
    id: 'support-ok',
    route: 'POST /api/catalogue/:bridge_id/support',
    url: C + '/shop-s/support',
    status: 200,
    body: { identifier: '9876543210', otp: ' ' + GOOD_CODE + ' ', observed: 'It broke', severity: 'Sev-3' }
  },
  {
    id: 'login-ok',
    route: 'POST /api/catalogue/:bridge_id/login/verify',
    url: C + '/shop-s/login/verify',
    status: 200,
    body: { identifier: '9876543210', otp: GOOD_CODE }
  },
  {
    id: 'confirm-ok',
    route: 'POST /api/catalogue/:bridge_id/order/confirm',
    url: C + '/shop-s/order/confirm',
    status: 200,
    setup: { items: [PRICED_ITEM] },
    body: CONFIRM({ line_items: [{ item_id: ITEM_ID, name: 'Rice', qty: 2 }] })
  },
  {
    id: 'norder-ok',
    route: 'POST /api/catalogue/network-store/:networkId/order',
    url: C + '/network-store/shop-s/order',
    status: 200,
    setup: Object.assign({ items: [PRICED_ITEM] }, NETWORK_ON),
    headers: IN_NETWORK,
    body: { items: [{ product_id: ITEM_ID, qty: 2 }] }
  },
  { id: 'login-nothing-sent', route: 'POST /api/catalogue/:bridge_id/login/verify', url: C + '/shop-s/login/verify', status: 400, body: {} },
  {
    id: 'login-unknown',
    route: 'POST /api/catalogue/:bridge_id/login/verify',
    url: C + '/shop-s/login/verify',
    status: 404,
    setup: { shop: false },
    body: { phone: '9876543210', otp: GOOD_CODE }
  },
  { id: 'login-no-contact', route: 'POST /api/catalogue/:bridge_id/login/verify', url: C + '/shop-s/login/verify', status: 422, body: { otp: GOOD_CODE } },
  {
    id: 'login-no-account',
    route: 'POST /api/catalogue/:bridge_id/login/verify',
    url: C + '/shop-s/login/verify',
    status: 400,
    setup: { buyer: false },
    body: { phone: '9876543210', otp: GOOD_CODE }
  },
  {
    id: 'login-wrong-code',
    route: 'POST /api/catalogue/:bridge_id/login/verify',
    url: C + '/shop-s/login/verify',
    status: 400,
    body: { phone: '9876543210', otp: '111111' }
  },
  {
    id: 'login-locked',
    route: 'POST /api/catalogue/:bridge_id/login/verify',
    url: C + '/shop-s/login/verify',
    status: 429,
    setup: { attempts: 99 },
    body: { phone: '9876543210', otp: GOOD_CODE }
  },
  {
    id: 'login-fails',
    route: 'POST /api/catalogue/:bridge_id/login/verify',
    url: C + '/shop-s/login/verify',
    status: 500,
    setup: { dbFails: true },
    body: { phone: '9876543210', otp: GOOD_CODE }
  }
];

/* API-3 S36: every send to a money door is a new attempt with its own key, unless the scenario is about the key itself */
let attempt = 0;
const headersOf = (scenario) =>
  Object.assign(/\/order\/(start|confirm)$/.test(scenario.url) && !scenario.keyless ? { 'idempotency-key': 'attempt-' + ++attempt } : {}, scenario.headers);

function send(port, method, urlPath, body, headers) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const options = {
      port,
      path: urlPath,
      method,
      headers: Object.assign(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}, headers)
    };
    const request = http.request(options, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          type: String(response.headers['content-type'] || ''),
          text,
          json: safeParse(text),
          replay: response.headers['x-idempotent-replay']
        })
      );
    });
    request.setTimeout(5000, () => {
      request.destroy();
      resolve({ status: 0, type: '', text: '', json: null });
    });
    request.on('error', () => {});
    if (data) request.write(data);
    request.end();
  });
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
}

const legacyOf = (key, scenario) =>
  (JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

function checkProblemBody(label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': request_id is the id the server minted', answer.json && answer.json.request_id === 'req-test', answer.json && answer.json.request_id);
  check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
}

function checkLegacy(label, answer, frozen) {
  if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
  check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
  const missing = Object.keys(frozen.fixture).filter((name) => !sameValue(answer.json[name], frozen.fixture[name]));
  check(
    label + ': every frozen legacy key is still there, byte for byte',
    missing.length === 0,
    missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name]))
  );
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

async function checkRoutes(port, recording) {
  console.log('\n-- routes/catalogue.js, the public storefront: every refusal is a Problem and keeps its old keys --');
  const tested = {};
  for (const scenario of SCENARIOS) {
    Object.assign(world, FRESH, scenario.setup);
    if (world.networkOrders) process.env.NETWORK_STORE_ORDERS = 'true';
    else delete process.env.NETWORK_STORE_ORDERS;
    const answer = await send(port, scenario.route.split(' ')[0], scenario.url, scenario.body, headersOf(scenario));
    (recording[scenario.route] = recording[scenario.route] || {})[scenario.id] = { status: answer.status, body: answer.json };
    (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (argv.includes('--capture')) continue;
    const label = scenario.id;
    check(label + ': answers ' + scenario.status, answer.status === scenario.status, [answer.status, answer.json]);
    if (scenario.status < 300) {
      checkAllowList(label, scenario.route, answer);
      continue;
    }
    checkProblemBody(label, answer);
    checkLegacy(label, answer, legacyOf(scenario.route, scenario.id));
    if (scenario.status >= 500)
      check(label + ': a 5xx says nothing of its cause', !/catalogue_items|SELECT|vault|relation|EACCES/.test(answer.text), answer.text);
  }
  if (!argv.includes('--capture')) await checkHiddenShops(port, recording);
  if (!argv.includes('--capture')) await checkOnceOnly(port);
  delete process.env.NETWORK_STORE_ORDERS;
  checkSameNotFound(recording);
  return tested;
}

/* API-3 foreign_id_404: on every door, a shop that exists but may not be seen (sealed, inactive) answers byte for byte what an unknown one does */
async function checkHiddenShops(port, recording) {
  console.log('\n-- a hidden shop answers exactly as an unknown one, on every door --');
  const unknowns = SCENARIOS.filter((scenario) => /-unknown$/.test(scenario.id));
  for (const scenario of unknowns) {
    Object.assign(world, FRESH, scenario.setup, { shop: true, sealed: true });
    if (world.networkOrders) process.env.NETWORK_STORE_ORDERS = 'true';
    else delete process.env.NETWORK_STORE_ORDERS;
    const answer = await send(port, scenario.route.split(' ')[0], scenario.url, scenario.body, headersOf(scenario));
    const unknown = recording[scenario.route][scenario.id];
    const same =
      answer.status === 404 && sameValue(Object.assign({}, answer.json, { request_id: null }), Object.assign({}, unknown.body, { request_id: null }));
    check(scenario.route + ': a sealed shop gets the same 404 as ' + scenario.id, same, [answer.status, answer.json]);
    prove(scenario.route, 'foreign_id_404', same);
  }
}

/* ⭐ API-3 S36 (laptop1, 23 Oct): a double tap makes ONE order, and a retry gets the same answer. The key decides, not timing:
   the two taps go together, and what they ran is counted against what one request runs. */
async function checkOnceOnly(port) {
  console.log('\n-- one key, one run: a double tap and a retry on the two money doors --');
  const DOES = { 'start-ok': /SET otp_code = \$1/, 'confirm-ok': /chit_deliver\(/ }; /* a code issued · an order delivered (both copies, one statement) */
  for (const id of Object.keys(DOES)) {
    const scenario = SCENARIOS.find((item) => item.id === id);
    const runs = () => statements.filter((sql) => DOES[id].test(sql)).length;
    Object.assign(world, FRESH, scenario.setup);
    statements.length = 0;
    await send(port, 'POST', scenario.url, scenario.body, { 'idempotency-key': 'one-' + id });
    const single = runs();
    statements.length = 0;
    const tapped = { 'idempotency-key': 'tap-' + id };
    const taps = await Promise.all([1, 2].map(() => send(port, 'POST', scenario.url, scenario.body, tapped)));
    check(id + ': one request does its work (the yardstick)', single > 0, single);
    check(id + ': a double tap does it once', runs() === single, [runs(), single]);
    const first = taps.find((tap) => tap.status === 200);
    const other = taps.find((tap) => tap !== first);
    const otherIsSafe =
      other && (other.status === 409 ? other.json.code === 'IDEMPOTENCY_IN_PROGRESS' : other.status === 200 && sameValue(other.json, first.json));
    check(
      id + ': one tap is answered 200; the other is the same 200 or 409 IDEMPOTENCY_IN_PROGRESS',
      Boolean(first && otherIsSafe),
      taps.map((tap) => [tap.status, tap.json])
    );
    statements.length = 0;
    const retry = await send(port, 'POST', scenario.url, scenario.body, tapped);
    check(
      id + ': a retry gets the same answer, marked a replay',
      Boolean(first) && retry.status === 200 && sameValue(retry.json, first.json) && retry.replay === 'true',
      [retry.status, retry.replay]
    );
    check(
      id + ': the retry ran nothing but the shop read and the key lookup',
      statements.every((sql) => /idempotency_key|FROM identities WHERE \(bridge_id/.test(sql)),
      statements
    );
  }
}

/* API-3 output allow-list: a 200 holds only the keys its operation lists (the schemas say additionalProperties: false) */
const contractOf = () => require(path.join(HERE, 'lib', 'storefront-contract.js'));
function checkAllowList(label, route, answer) {
  const operation = contractOf().OPERATIONS[route.replace(C, '')];
  const schema = operation.responses[200].content['application/json'].schema;
  const fits = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine.compile(schema);
  const closedAnswer = schema.additionalProperties === false && fits(answer.json);
  check(label + ': the 200 holds only the keys its operation lists', closedAnswer, fits.errors);
  prove(route, 'output_allowlist', closedAnswer);
}

/* API-3: a shop that is private, has no public department or is gone answers exactly as one that never existed — nothing tells them apart */
function checkSameNotFound(recording) {
  const bodyOf = (route, scenario) => Object.assign({}, recording[route][scenario].body, { request_id: null });
  const pairs = [
    ['GET /api/catalogue/:bridge_id', 'shop-unknown', 'shop-private'],
    ['GET /api/catalogue/network/:bridge_id', 'network-unknown', 'network-no-members'],
    ['GET /api/catalogue/network/:bridge_id', 'network-unknown', 'network-no-departments']
  ];
  pairs.forEach(([route, unknown, hidden]) =>
    check(hidden + ': the same 404, byte for byte, as ' + unknown, sameValue(bodyOf(route, unknown), bodyOf(route, hidden)))
  );
}

/* ── lib/storefront-contract.js as a unit: the operations, the old validation body, the 5xx bodies ── */
function checkContract() {
  console.log('\n-- lib/storefront-contract.js: the operations and the old words --');
  const contract = contractOf();
  const { SAFE_SENTENCE } = require(path.join(HERE, 'lib', 'respond.js'));
  const operations = Object.entries(contract.OPERATIONS);
  check(
    '11 operations, one per public route',
    operations.length === 11 &&
      sameValue(
        Object.keys(contract.OPERATIONS)
          .map((key) => key.replace(' ', ' ' + C))
          .sort(),
        PUBLIC_ROUTES.slice().sort()
      ),
    operations.length
  );
  operations.forEach(([key, operation]) =>
    check(
      key + ': declares the 500 every route can answer, and a closed 200',
      !!operation.responses[500] && operation.responses[200].content['application/json'].schema.additionalProperties === false
    )
  );
  operations
    .filter(([, operation]) => operation.requestBody)
    .forEach(([key, operation]) =>
      check(
        key + ': strict input — the body refuses a key it does not list',
        operation.requestBody.content['application/json'].schema.additionalProperties === false
      )
    );
  const refusal = contract.refusalFor([['otp'], ['observed', 'Say what went wrong']]);
  check('a body the schema refuses stays the old 400 "Validation failed", never a 422', refusal.status === 400);
  const failures = [
    { field: 'observed', code: 'MISSING_FIELD' },
    { field: 'otp', code: 'WRONG_VALUE' },
    { field: 'otp', code: 'MISSING_FIELD' },
    { field: 'coupon', code: 'UNKNOWN_FIELD' }
  ];
  check(
    '…one entry per field, in the old chain order, in its old words ("Invalid value" where the chain had none, "Not accepted here" for an unknown key)',
    sameValue(refusal.legacy(failures), {
      error: 'Validation failed',
      details: [
        { field: 'otp', message: 'Invalid value' },
        { field: 'observed', message: 'Say what went wrong' },
        { field: 'coupon', message: 'Not accepted here' }
      ]
    }),
    refusal.legacy(failures)
  );
  check(
    'fail closed: a 5xx keeps its old keys and never says its cause',
    Object.values(contract.FAILED).every((body) => body.message === SAFE_SENTENCE)
  );
  check('a missing shop is said the one old way', sameValue(contract.NO_SHOP, { error: 'Not found', message: 'Shop not found' }));
  const request = { body: { otp: 654321, observed: '  It broke ', name: ' Kept ' } };
  contract.trimmed('otp', 'observed')(request, {}, () => {});
  check(
    'trimmed(): the old chain’s trim() — text, trimmed, only the fields it names',
    sameValue(request.body, { otp: '654321', observed: 'It broke', name: ' Kept ' }),
    request.body
  );
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  app.use(C, require(path.join(API, 'routes', 'catalogue.js')));
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, recording);
  server.close();
  if (argv.includes('--capture')) {
    fs.writeFileSync(argv[argv.indexOf('--capture') + 1], JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' routes');
    process.exit(0);
  }
  checkContract();
  /* the hardening evidence: this file owns its routes' rows of docs/contracts/api-hardening-evidence.json, and writes only what it proved */
  const evidenceOnDisk = fs.existsSync(EVIDENCE_FILE) ? JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')) : { about: EVIDENCE_ABOUT, routes: {} };
  const evidence = Object.fromEntries(
    Object.keys(proved)
      .sort()
      .map((route) => [route, Object.fromEntries(Object.entries(proved[route]).filter(([, held]) => held === true))])
      .filter(([, columns]) => Object.keys(columns).length)
  );
  const evidenceMine = Object.fromEntries(
    Object.keys(evidenceOnDisk.routes)
      .filter(MINE)
      .sort()
      .map((route) => [route, evidenceOnDisk.routes[route]])
  );
  if (argv.includes('--write')) {
    const routes = Object.assign(
      Object.fromEntries(
        Object.keys(evidenceOnDisk.routes)
          .filter((route) => !MINE(route))
          .map((route) => [route, evidenceOnDisk.routes[route]])
      ),
      evidence
    );
    const ordered = Object.fromEntries(
      Object.keys(routes)
        .sort()
        .map((route) => [route, routes[route]])
    );
    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify({ about: evidenceOnDisk.about || EVIDENCE_ABOUT, routes: ordered }, null, 1) + '\n');
  } else
    check('docs/contracts/api-hardening-evidence.json holds exactly what these scenarios proved for the public storefront', sameValue(evidenceMine, evidence), {
      onDisk: evidenceMine,
      proved: evidence
    });
  const errorsOnly = (statuses) => [...statuses].filter((status) => status >= 400).sort((a, b) => a - b);
  const coverage = Object.fromEntries(
    Object.keys(tested)
      .sort()
      .map((route) => [route, errorsOnly(tested[route])])
      .filter(([, statuses]) => statuses.length)
  );
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(
    Object.keys(onDisk)
      .filter(MINE)
      .sort()
      .map((route) => [route, onDisk[route]])
  );
  if (argv.includes('--write')) {
    const others = Object.fromEntries(
      Object.keys(onDisk)
        .filter((route) => !MINE(route))
        .map((route) => [route, onDisk[route]])
    );
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(
      TESTED_FILE,
      JSON.stringify(
        Object.fromEntries(
          Object.keys(merged)
            .sort()
            .map((route) => [route, merged[route]])
        ),
        null,
        1
      ) + '\n'
    );
  } else
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the public storefront', sameValue(mine, coverage), {
      onDisk: mine,
      covered: coverage
    });
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();

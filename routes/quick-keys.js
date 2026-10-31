/**
 * /api/quick-keys — Level 1 (permanent, manager-side) quick-key groups. Back-office only: a till key marks
 * items sold out and picks which groups show (routes/till.js's /quick-keys/* — Level 2); it does not author
 * groups, exactly like a till key cannot rewrite a product (handoff §1: "back-office behaviour (maintenance)").
 *
 * GET    /groups                      -> [{id,name,color,sort_order,window_from,window_to,suggest_on_start,version,items:[...]}]
 * POST   /groups                      { name, color?, sort_order?, window_from?, window_to?, suggest_on_start? }
 * PATCH  /groups/:id                  { ...fields, version }        -> 409 {error:'conflict', message, current} if stale
 * DELETE /groups/:id                  { version }                   -> soft delete
 * POST   /groups/:id/items            { product_id, position? }
 * DELETE /groups/:id/items/:productId
 * PATCH  /groups/:id/items            { items: [{product_id, position}] }   -> rewrite the group's whole order
 * GET    /screen-config/default       -> the shop-wide default a new counter starts from
 * PUT    /screen-config/default       { config }
 *
 * OWNS      the nine Level-1 quick-key routes (/api/quick-keys): the manager's groups, their keys and order, and the shop-wide screen default.
 * CALLED BY server.js (the mount) · the authoring screen (planned) · tests/api-problem-quick-keys.test.cjs.
 * CARD      28-platform-and-operations/quick-keys-routes
 * CONTRACT  the operation of each route and the words of its refusals are lib/quick-keys-contract.js (API-4 sweep).
 * FLOW      auth → sessionOnly (a key is refused before anything is looked up) → schema check → handler → res.json | problem(req, res, quickKeyFault(e, req))
 * CALLERS   none yet in the shipped screens (the authoring screen is planned, PM/ENDPOINT-USAGE-2026-10-23.md 5.4 row 6); the e2e spec till-shopgroups.spec.js posts a group and its keys.
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { contract, schemaOptions, words, quickKeyFault } = require('../lib/quick-keys-contract'); // the contract (each route's operation) and the words of a refusal
const qk = require('../lib/quick-keys');
const { UUID_RE } = require('../lib/trace');

const sessionOnly = (req, res, next) => {
  if (req.api_key) return problem(req, res, { status: 403, ...words.sessionOnly() });
  next();
};

/* CTR-172 — a group (or product) id in the address that is not a uuid names nothing this shop holds: answered 404 here, before the database puts its own words into a 500. One guard for every route of this file. */
const noSuchGroup = (req, res, next, id) => (UUID_RE.test(String(id)) ? next() : problem(req, res, { status: 404, ...words.notFound() }));
router.param('id', noSuchGroup);
router.param('productId', noSuchGroup); // a product id that is not a uuid is a key that is not on the group

const userOf = (req) => req.identity.identity_id;

/** the schema check of one route (its own operation in lib/quick-keys-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions)] : [];
}

router.get('/groups', auth, sessionOnly, ...checked('GET /groups'), async (req, res) => {
  try {
    const groups = await withEntity(auth.entityOf(req), (db) => qk.listGroups(db, auth.entityOf(req)));
    res.json({ groups });
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.post('/groups', auth, sessionOnly, ...checked('POST /groups'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const group = await withEntity(entity_id, (db) => qk.createGroup(db, entity_id, req.body, userOf(req)));
    res.status(201).json({ group });
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.patch('/groups/:id', auth, sessionOnly, ...checked('PATCH /groups/:id'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { version, ...patch } = req.body || {};
    const group = await withEntity(entity_id, (db) => qk.updateGroup(db, entity_id, req.params.id, patch, version, userOf(req)));
    res.json({ group });
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.delete('/groups/:id', auth, sessionOnly, ...checked('DELETE /groups/:id'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const version = req.body && req.body.version;
    const group = await withEntity(entity_id, (db) => qk.deleteGroup(db, entity_id, req.params.id, version, userOf(req)));
    res.json({ group });
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.post('/groups/:id/items', auth, sessionOnly, ...checked('POST /groups/:id/items'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { product_id, position } = req.body || {};
    if (!product_id) return problem(req, res, { status: 400, ...words.productRequired() });
    const item = await withEntity(entity_id, (db) => qk.addItem(db, entity_id, req.params.id, product_id, position, userOf(req)));
    res.status(201).json({ item });
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.delete('/groups/:id/items/:productId', auth, sessionOnly, ...checked('DELETE /groups/:id/items/:productId'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) => qk.removeItem(db, entity_id, req.params.id, req.params.productId, userOf(req)));
    res.json(r);
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.patch('/groups/:id/items', auth, sessionOnly, ...checked('PATCH /groups/:id/items'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) => qk.reorderItems(db, entity_id, req.params.id, (req.body || {}).items, userOf(req)));
    res.json(r);
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.get('/screen-config/default', auth, sessionOnly, ...checked('GET /screen-config/default'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const cfg = await withEntity(entity_id, (db) => qk.getScreenConfig(db, entity_id, null));
    res.json(cfg);
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.put('/screen-config/default', auth, sessionOnly, ...checked('PUT /screen-config/default'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const cfg = await withEntity(entity_id, (db) => qk.setScreenConfig(db, entity_id, null, (req.body || {}).config, userOf(req)));
    res.json(cfg);
  } catch (e) {
    problem(req, res, quickKeyFault(e, req));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;

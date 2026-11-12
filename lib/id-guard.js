// @stage tested
// @stage-note API-25: the router-level path-id guard; proved by tests/path-id-guard.test.cjs.
// CARD 28-platform-and-operations/api-standard
// owns: the ONE place a path id that must be a uuid is checked for every router that did not check it itself: a malformed id answers 404 NOT_FOUND, never the database's 22P02 as a 500.
// called by: server.js (guardRouters(app), once, after every router is mounted).
// FLOW  mounted routers → guardRouters → router.param(name, guard) for each uuid name the router has not guarded → request → UUID.test(id) → next() | 404 problem+json
'use strict';
/**
 * lib/id-guard.js — A PATH ID THAT IS NOT A UUID NAMES NO ROW (API-25, 12 Nov 2026).
 *
 * Before: each route file adopted lib/problem.js uuidParam by hand (K-1), so a file that had not yet adopted it let "abc" reach a ::uuid cast and answered 500 (22P02).
 * Now: the names below are uuid columns everywhere they appear in an address, and every mounted router that has not guarded a name itself gets the same guard for it. A route
 * file that guards a name itself (uuidParam, with its own frozen words) is left alone, so no existing answer moves.
 *
 * UUID_PARAMS    the path parameter names that are a uuid in every router (a name that is a bridge id, a handle, a key or a scheme is NOT here)
 * UUID_ID_FILES  the route files whose plain `:id` is a uuid and which had no guard of their own
 * ⚠ A name is added here only after its column is read: a text id guarded as a uuid would refuse real callers.
 */
const path = require('path');
const { problem, textParam } = require('./problem');
const { UUID } = require('./namedentity');
const { NOT_A_UUID_WORDS } = require('./knownerr');

const UUID_PARAMS = ['chit_id', 'raida_id', 'proposal_id', 'subject_id', 'pause_id', 'rule_id', 'message_id'];
/* a text value in the address: a NUL byte in it is 400 INVALID_INPUT naming the field (textParam), never the database's 22021 as a 500 (NET-92 /network-store/%00, ACC-217 /accruals/%00/reverse) */
const TEXT_PARAMS = ['networkId', 'ref'];
const UUID_ID_FILES = ['routes/attachments.js'];
const WORDS = { status: 404, code: 'NOT_FOUND', detail: NOT_A_UUID_WORDS, legacy: { error: 'Not found', message: NOT_A_UUID_WORDS } };

/** the guard itself: a uuid passes, anything else is a 404 in the one error shape (the same answer as a row that is not there, so it tells a stranger nothing) */
const idGuard = (req, res, next, id) => (UUID.test(String(id)) ? next() : problem(req, res, WORDS));

/** the route file (relative, with /) whose module exports this router, or null */
function fileOf(router) {
  const root = path.join(__dirname, '..');
  const found = Object.values(require.cache).find((entry) => entry && entry.exports === router);
  return found ? path.relative(root, found.filename).split(path.sep).join('/') : null;
}

/** add `guard` for each name this router has not guarded itself; returns how many it added */
function addMissing(router, names, guard) {
  let added = 0;
  for (const name of names) {
    if (router.params && router.params[name] && router.params[name].length) continue;
    router.param(name, guard);
    added += 1;
  }
  return added;
}

/** guard every router under `stack` (an express layer list), nested routers included; returns how many (router, name) guards it added */
function guardStack(stack) {
  let added = 0;
  for (const layer of stack) {
    const router = layer.handle;
    if (!router || !router.stack || typeof router.param !== 'function') continue;
    added += addMissing(router, UUID_PARAMS.concat(UUID_ID_FILES.includes(fileOf(router)) ? ['id'] : []), idGuard);
    added += addMissing(router, TEXT_PARAMS, textParam());
    added += guardStack(router.stack);
  }
  return added;
}

/** guardRouters(app) — call once, after the last router is mounted */
const guardRouters = (app) => guardStack(app._router.stack);

module.exports = { guardRouters, idGuard, UUID_PARAMS, TEXT_PARAMS, UUID_ID_FILES };

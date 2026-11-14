// OWNS      /api/books-actions: MAKER-CHECKER for an adviser firm acting in a store's books (ACC-176b) — the firm's team PREPARES, a colleague REVIEWS, the OWNER ACCEPTS and the existing writers post; the queue; every step stamped with the person, the firm, the role.
// CALLED BY server.js (mounted at /api/books-actions), the adviser's and the owner's action queues (cb-network, cb-reports).
// FLOW      the grant front (middleware/books-grant: X-Books-For + X-Books-Role: adviser → the live grant, the log row, the synthetic identity of the store) → auth → noKey → the ledger is on → the role gate → the store check (store_id = the grant's store)
//           → schema check (lib/books-actions-contract) → lib/books-action → the answer; a refusal → problem(req, res, refusal in words)
// CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
// ⚠️ The adviser has NO direct write on the books: the doors that run under an adviser grant are the allow-list ADVISER_DOORS of the grant front, and this file's prepare, review and return are the only writes among them (each writes a STEP, never a book row).
// ⚠️ ACCEPT is the owner's own door: the owner signs in as himself (no X-Books-For), so no grant is involved and no firm person can reach it.
const express = require('express');
const router = express.Router();
router.use(require('../middleware/books-grant'));
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const { problem } = require('../lib/problem');
const { refusalOf } = require('../lib/books-contract');
const { isOwner } = require('../lib/owner');
const B = require('../lib/books');
const actions = require('../lib/books-action');
const contract = require('../lib/books-actions-contract');

const storeOf = (req) => auth.entityOf(req);
const refuse = (req, res, status, code, words) => problem(req, res, { status, code, detail: words, legacy: { error: words, message: words } });
/** a refusal of the action store is a typed answer in words; the books' own refusals go through the ledger's mapper */
function answer(req, res, err) {
  if (err && err.words) return refuse(req, res, err.status, err.code, err.words);
  return problem(req, res, refusalOf(err, req));
}
/** a key is not a person: nothing here is done by a device key */
function noKey(req, res, next) {
  if (!req.api_key) return next();
  return refuse(req, res, 403, 'SIGN_IN_FOR_LEDGER', 'Sign in to work on the books.');
}
/** the ledger must be on (the same 404-quiet rule as the books router); the store's setting is read once for the composer */
async function ledgerOn(req, res, next) {
  try {
    const store = storeOf(req);
    const setting = await withEntity(store, (h) => B.settingOf(h, store));
    if (!setting || !setting.enabled) return refuse(req, res, 404, 'LEDGER_OFF', 'This shop has not switched the ledger on.');
    req.books = setting;
    return next();
  } catch (err) {
    return answer(req, res, err);
  }
}
const actingAdviser = (req) => !!req.acting_for_grant && req.identity && req.identity.acting_preset === 'adviser';
/** the firm's team only (prepare, review): a person acting under a live ADVISER grant, never the owner and never an auditor */
function firmOnly(req, res, next) {
  if (actingAdviser(req)) return next();
  return refuse(req, res, 403, 'ACTION_FIRM_ONLY', 'Only the adviser firm prepares and reviews. The owner accepts.');
}
/** the firm's team or the owner of the books (the queue, one action, a return) */
function firmOrOwner(req, res, next) {
  if (actingAdviser(req) || (!req.acting_for_grant && isOwner(req))) return next();
  return refuse(req, res, 403, 'ACTION_NOT_FOR_YOU', 'Only the owner and the adviser firm work on these actions.');
}
/** accept: the store's owner, signed in as himself */
function ownerOnly(req, res, next) {
  if (!req.acting_for_grant && isOwner(req)) return next();
  return refuse(req, res, 403, 'OWNER_ONLY', 'Only the owner accepts an action.');
}
/** the open page's store must be the store the request is scoped to (the grant's, or the owner's own): a stale tab of another store is refused and nothing is stored */
function rightStore(req, res, next) {
  const carried = String((req.body && req.body.store_id) || '').toLowerCase();
  if (carried === String(storeOf(req)).toLowerCase()) return next();
  return refuse(req, res, 409, 'STORE_MISMATCH', 'This page is open on another store than the one you are working in. Nothing was saved. Open the store again.');
}
const firmActor = (req) => ({ identity_id: req.identity.identity_id, name: req.identity.display_name, firm_name: req.acting_firm_name, grant_id: req.acting_for_grant });
const ownerActor = (req) => ({ identity_id: req.identity.identity_id, name: req.identity.display_name });
/** one handler: run `work`, answer its result, or the refusal in words */
const door = (status, work) => async (req, res) => {
  try {
    res.status(status).json(await work(req));
  } catch (err) {
    answer(req, res, err);
  }
};

router.get('/', auth, noKey, ledgerOn, firmOrOwner, ...contract.checked('GET /'), door(200, (req) => actions.listActions(storeOf(req), req.query || {}, req.identity)));
router.get('/:id', auth, noKey, ledgerOn, firmOrOwner, ...contract.checked('GET /:id'), door(200, (req) => actions.getAction(storeOf(req), req.params.id)));
router.post('/', auth, noKey, ledgerOn, firmOnly, ...contract.checked('POST /'), rightStore, door(201, (req) => actions.prepareAction(storeOf(req), firmActor(req), req.body, req.books)));
router.post('/:id/review', auth, noKey, ledgerOn, firmOnly, ...contract.checked('POST /:id/review'), rightStore, door(200, (req) => actions.reviewAction(storeOf(req), firmActor(req), req.params.id, req.body)));
router.post('/:id/return', auth, noKey, ledgerOn, firmOrOwner, ...contract.checked('POST /:id/return'), rightStore, door(200, (req) => {
  const byFirm = actingAdviser(req);
  return actions.returnAction(storeOf(req), byFirm ? firmActor(req) : ownerActor(req), req.params.id, req.body, !byFirm);
}));
router.post('/:id/accept', auth, noKey, ledgerOn, ownerOnly, ...contract.checked('POST /:id/accept'), rightStore, door(200, (req) => actions.acceptAction(storeOf(req), ownerActor(req), req.params.id, req.body)));

router.openapi = { paths: contract.pathsOf() };
module.exports = router;

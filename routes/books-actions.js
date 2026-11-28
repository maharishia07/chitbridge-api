// OWNS      /api/books-actions: MAKER-CHECKER for an adviser firm acting in a store's books (ACC-176b) — the firm's team PREPARES, a colleague REVIEWS, the OWNER ACCEPTS and the existing writers post; the queue; every step stamped with the person, the firm, the role.
// CALLED BY server.js (mounted at /api/books-actions), the adviser's and the owner's action queues (cb-network, cb-reports).
// FLOW      the grant front (middleware/books-grant: X-Books-For + X-Books-Role: adviser → the live grant, the log row, the synthetic identity of the store) → auth → noKey → the ledger is on → the role gate → the store check (store_id = the grant's store)
//           → schema check (lib/books-actions-contract) → lib/books-action → the answer; a refusal → problem(req, res, refusal in words)
// CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
// ⚠️ The adviser has NO direct write on the books: the doors that run under an adviser grant are the allow-list ADVISER_DOORS of the grant front, and this file's prepare, review and return are the only writes among them (each writes a STEP, never a book row).
// ⚠️ ACCEPT is the owner's own door: the owner signs in as himself (no X-Books-For), so no grant is involved and no firm person can reach it. Under adviser_posts the server accepts for the owner in the preparer's own transaction, stamped delegated.
const express = require('express');
const router = express.Router();
router.use(require('../middleware/books-grant'));
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const { problem } = require('../lib/problem');
const { declaresStatuses } = require('../lib/contract-kit'); /* a gate that refuses nothing and says which status the store under the handler can answer (a table not yet made: 503) */
const { refusalOf } = require('../lib/books-contract');
const { isOwner } = require('../lib/owner');
const ledger = require('../lib/books');
const countrySetup = require('../lib/country-setup');
const actions = require('../lib/books-action');
const contract = require('../lib/books-actions-contract');
const approval = require('../lib/books-approval'); /* SHOPBK-B: the shop's own Bookkeeper's held entries, the same queue */
/* S36: the accept POSTS to the ledger, so it is a money write: one Idempotency-Key per attempt, a replay answers the FIRST answer (never a 409 on a post that succeeded) */
const onceOnly = require('../middleware/idempotency').requireKey();

const storeOf = (req) => auth.entityOf(req);
/** a refusal of the action store is a typed answer in words; the books' own refusals go through the ledger's mapper */
function answer(req, res, err) {
  if (err && err.words) return problem(req, res, { status: err.status, code: err.code, detail: err.words, legacy: { error: err.words, message: err.words } });
  return problem(req, res, refusalOf(err, req));
}
/** a key is not a person: nothing here is done by a device key */
function noKey(req, res, next) {
  if (!req.api_key) return next();
  return problem(req, res, { status: 403, code: 'SIGN_IN_FOR_LEDGER', detail: 'Sign in to work on the books.', legacy: { error: 'Sign in to work on the books.', message: 'Sign in to work on the books.' } });
}
/** the ledger must be on and its country setup in order: the books router's own gate (country-setup.gate), so a shop that cannot post for itself cannot accept an adviser action either; the setting is read once for the composer */
async function ledgerOn(req, res, next) {
  try {
    const store = storeOf(req);
    const setting = await withEntity(store, async (handle) => {
      await countrySetup.gate(handle, store);
      return ledger.settingOf(handle, store);
    });
    if (!setting || !setting.enabled) return problem(req, res, { status: 404, code: 'LEDGER_OFF', detail: 'This shop has not switched the ledger on.', legacy: { error: 'This shop has not switched the ledger on.', message: 'This shop has not switched the ledger on.' } });
    req.books = setting;
    return next();
  } catch (err) {
    return answer(req, res, err);
  }
}
const actingAuditor = (req) => !!req.acting_for_grant && req.identity && req.identity.acting_preset === 'auditor';
const actingAdviser = (req) => !!req.acting_for_grant && req.identity && req.identity.acting_preset === 'adviser';
/** the firm's team only (prepare, review): a person acting under a live ADVISER grant, never the owner and never an auditor */
function firmOnly(req, res, next) {
  if (actingAdviser(req)) return next();
  return problem(req, res, { status: 403, code: 'ACTION_FIRM_ONLY', detail: 'Only the adviser firm prepares and reviews. The owner accepts.', legacy: { error: 'Only the adviser firm prepares and reviews. The owner accepts.', message: 'Only the adviser firm prepares and reviews. The owner accepts.' } });
}
/**
 * prepare: the firm's team under a live adviser grant, OR (SHOPBK-B) the shop's own Bookkeeper seat when the owner asked to approve (policy_flags.books_owner_approves, read server-side). The Bookkeeper's own setting being off is a
 * business answer (409, in words), not a seat refusal: nothing is held, the entry is posted at POST /api/books/events as before.
 */
async function firmOrBookkeeper(req, res, next) {
  if (actingAdviser(req)) return next();
  if (!approval.isBookkeeperSeat(req)) return firmOnly(req, res, next);
  try {
    if (await approval.approvalOn(storeOf(req))) return next();
  } catch (err) {
    return answer(req, res, err);
  }
  return problem(req, res, { status: 409, code: 'BOOKS_OWNER_APPROVES_OFF', detail: 'The owner has not asked to approve entries. Record it in the Day book and it posts.', legacy: { error: 'The owner has not asked to approve entries. Record it in the Day book and it posts.', message: 'The owner has not asked to approve entries. Record it in the Day book and it posts.' } });
}
/** the preparer: the firm's person, or the shop's own Bookkeeper (no firm, no grant) */
const preparerOf = (req) => (actingAdviser(req) ? firmActor(req) : approval.makerOf(req));
/** the firm's team or the owner of the books (the queue, one action, a return) */
function firmOrOwner(req, res, next) {
  if (actingAdviser(req) || (!req.acting_for_grant && isOwner(req))) return next();
  return problem(req, res, { status: 403, code: 'ACTION_NOT_FOR_YOU', detail: 'Only the owner and the adviser firm work on these actions.', legacy: { error: 'Only the owner and the adviser firm work on these actions.', message: 'Only the owner and the adviser firm work on these actions.' } });
}
/** RC-11: the READ doors (the queue, one action) are also the auditor's, read only: the review and sign-off record is audit evidence (ISA 230) */
function firmOrOwnerOrAuditor(req, res, next) {
  return actingAuditor(req) ? next() : firmOrOwner(req, res, next);
}
/** accept: the store's owner, signed in as himself */
function ownerOnly(req, res, next) {
  if (!req.acting_for_grant && isOwner(req)) return next();
  return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: 'Only the owner accepts an action.', legacy: { error: 'Only the owner accepts an action.', message: 'Only the owner accepts an action.' } });
}
/** the open page's store must be the store the request is scoped to (the grant's, or the owner's own): a stale tab of another store is refused and nothing is stored */
function rightStore(req, res, next) {
  const carried = String((req.body && req.body.store_id) || '').toLowerCase();
  if (carried === String(storeOf(req)).toLowerCase()) return next();
  return problem(req, res, { status: 409, code: 'STORE_MISMATCH', detail: 'This page is open on another store than the one you are working in. Nothing was saved. Open the store again.', legacy: { error: 'This page is open on another store than the one you are working in. Nothing was saved. Open the store again.', message: 'This page is open on another store than the one you are working in. Nothing was saved. Open the store again.' } });
}
/** the firm's person: the real caller (never the store's synthetic identity), the firm and the grant from the live look; `named` = a person's own sign-in (an actor of the firm), not the firm's owner sign-in */
const firmActor = (req) => approval.firmActorOf(req); /* BB-P1-2: the ONE firm-person reader lives beside the proposing gate (lib/books-approval) */
/** the caller of a queue or a read: the firm's person (tied to its grant) or the owner */
const actorOf = (req) => (actingAdviser(req) ? firmActor(req) : ownerActor(req)); /* an auditor reads the whole store's record: no grant filter, as the owner */
const ownerActor = (req) => ({ identity_id: req.identity.identity_id, name: req.identity.display_name });
/** one handler: run `work`, answer its result (200), or the refusal in words */
const door = (work) => async (req, res) => {
  try {
    res.json(await work(req));
  } catch (err) {
    answer(req, res, err);
  }
};
/** the same for the one door that creates (201) */
const made = (work) => async (req, res) => {
  try {
    res.status(201).json(await work(req));
  } catch (err) {
    answer(req, res, err);
  }
};

// @does A state, mine, page in -> we list the adviser actions of this store (the firm's team and the owner) -> the page of actions with the total.
router.get('/', auth, noKey, firmOrOwnerOrAuditor, ledgerOn, declaresStatuses([503]), ...contract.checked('GET /'), door((req) => actions.listActions(storeOf(req), req.query || {}, actorOf(req))));
// @does An action id in -> we read the action with every step (who, role, when, why returned) -> the action (the firm's team or the owner).
router.get('/:id', auth, noKey, firmOrOwnerOrAuditor, ledgerOn, declaresStatuses([503]), ...contract.checked('GET /:id'), door((req) => actions.getAction(storeOf(req), req.params.id, actorOf(req))));
// @does A store, a kind, a body and a reference in -> we PREPARE the action, nothing is posted (the firm's team, or the shop's own Bookkeeper when the owner approves) -> the action waiting for review or for the owner's OK.
router.post('/', auth, noKey, firmOrBookkeeper, ledgerOn, declaresStatuses([503]), ...contract.checked('POST /'), rightStore, made((req) => actions.prepareAction(storeOf(req), preparerOf(req), req.body, req.books)));
// @does An action id and the body hash shown in -> a DIFFERENT person of the firm reviews that very body -> the action waiting for the owner to accept.
router.post('/:id/review', auth, noKey, firmOnly, ledgerOn, declaresStatuses([503]), ...contract.checked('POST /:id/review'), rightStore, door((req) => actions.reviewAction(storeOf(req), firmActor(req), req.params.id, req.body)));
// @does An action id, the body hash and a reason in -> we end the round, nothing is posted (a colleague of the firm or the owner) -> the action returned.
router.post('/:id/return', auth, noKey, firmOrOwner, ledgerOn, declaresStatuses([503]), ...contract.checked('POST /:id/return'), rightStore, door((req) => {
  const byFirm = actingAdviser(req);
  return actions.returnAction(storeOf(req), byFirm ? firmActor(req) : ownerActor(req), req.params.id, req.body, !byFirm);
}));
// @does An action id, the body hash and the confirmed total in -> the owner accepts and the existing writer posts once -> the action and the entry numbered.
router.post('/:id/accept', auth, noKey, ownerOnly, onceOnly, ledgerOn, declaresStatuses([503]), ...contract.checked('POST /:id/accept'), rightStore, door((req) => actions.acceptAction(storeOf(req), ownerActor(req), req.params.id, req.body)));

router.openapi = { paths: contract.pathsOf() };
module.exports = router;

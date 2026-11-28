'use strict';
// OWNS      /api/books-grants: the MEMBER's side of ACC-176 — the owner of the books gives its network parent read-only access (a purpose, an end date, a yes to the plain-words consent), edits the end date, ends it, and reads who looked.
// CALLED BY server.js (mounted at /api/books-grants), the member's grant and log screens (cb-network).
// FLOW      auth → noKey → ownerOnly (the member's OWNER only: not a co-assist, not the parent) → schema check (lib/books-grants-contract) → lib/books-grant → the answer; a refusal → problem(req, res, refusal in words)
// CARD      04-network/ACC-176-AUDITOR-GRANT
// The auditor does not use this file: it reads the books through GET /api/books/* with an X-Books-For header (middleware/books-grant.js). A grant is written with its access_events row in one transaction (lib/books-grant.js).
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { ownerOnly, isOwner } = require('../lib/owner');
const grants = require('../lib/books-grant');
const frontMiddleware = require('../middleware/books-grant');
const contract = require('../lib/books-grants-contract');
const { declaresStatuses } = require('../lib/contract-kit'); /* a gate that refuses nothing and says which statuses the store under the handler can answer (a table not yet made: 503; a second open grant: 409) */

const entityOf = (req) => auth.entityOf(req);
const byOf = (req) => req.identity.identity_id;
/** a key is not a person: the member's decision to open its books is made by a signed-in owner */
function noKey(req, res, next) {
  if (!req.api_key) return next();
  const words = 'Sign in as the owner to change who can read your books.';
  return problem(req, res, { status: 403, code: 'SIGN_IN_FOR_BOOKS_GRANT', detail: words, legacy: { error: words, message: words } });
}
const memberOnly = ownerOnly('Only the owner can change who reads these books.');
/** a refusal of the grant store is a typed answer in words; anything else is a fault of ours (500, nothing of its cause) */
function answer(req, res, err) {
  if (err && err.words) return problem(req, res, { status: err.status, code: err.code, detail: err.words, legacy: { error: err.words, message: err.words } });
  require('../lib/logger').error('books grant route failed', { code: (err && err.code) || null });
  return problem(req, res, { status: 500, code: 'INTERNAL', detail: 'Something went wrong on our side. Nothing was changed.', legacy: { error: 'Failed', message: 'Something went wrong on our side. Nothing was changed.' } });
}

// @does Whether costs are shared in the query -> we give the words the owner reads (any signed-in shop session) before sharing the books -> the consent wording.
router.get('/consent', auth, noKey, ...contract.checked('GET /consent'), (req, res) => res.json(contract.consentWords(req.query.can_see_costs !== 'false', req.query.preset)));

/**
 * who may read the list: the owner of the books (the grants he gave and the ones he holds) and, for the `received` side only, any person who may use a grant (a firm's team member or auditor): he learns which stores his own
 * firm works for. A person of the firm sees the firm's grants and no other firm's (row security: a grantee sees its own rows); a person who may use no grant is refused as before.
 */
function ownerOrGrantUser(req, res, next) {
  const grantUser = !req.api_key && ['adviser', 'auditor'].some((role) => frontMiddleware.mayUseGrant(req, role));
  if (grantUser) return next();
  return memberOnly(req, res, next);
}
/** the seats this person holds and, per received grant, whether they may open it: the decision the server already takes (holdsSeat, mayUseGrant), printed so the web never guesses it (a second rule would drift) */
function seatAnswer(req, received) {
  const seats = [grants.ADVISER, grants.AUDITOR].filter((role) => frontMiddleware.holdsSeat(req, role));
  return { seats, received: (received || []).map((row) => ({ ...row, may_use: frontMiddleware.mayUseGrant(req, grants.roleOf(row.preset)) })) };
}
router.seatAnswer = seatAnswer;
// @does Nothing in -> we list who the shop has given access to its books and the access it holds, such as an auditor or an adviser firm -> the grants (owner of the books, or a firm person for the received side; not keys).
router.get('/', auth, noKey, ownerOrGrantUser, declaresStatuses([503]), ...contract.checked('GET /'), async (req, res) => {
  try {
    const listed = await grants.list(entityOf(req));
    /* ONE rule: only the owner of the books sees the grants the shop GAVE; a firm's person (adviser or auditor level) gets the received side only, whatever the grant row says */
    res.json({ ...(isOwner(req) ? listed : { given: [], received: listed.received }), ...seatAnswer(req, listed.received) });
  } catch (err) {
    answer(req, res, err);
  }
});

/** who may read the practice: a firm's person who may use a grant (owner, adviser-level or auditor-level person); the roles they may use pick which of a client's grants is read */
function grantUserOnly(req, res, next) {
  req.practice_roles = frontMiddleware.usableRoles(req); /* the door's own reader (W12 included): the list holds every client the door opens */
  req.practice_seats = [grants.ADVISER, grants.AUDITOR].filter((role) => frontMiddleware.holdsSeat(req, role)); /* the seats held: a row reached only through W12 is read only */
  if (req.practice_roles.length && (req.method === 'GET' || frontMiddleware.mayReview(req))) return next(); /* the check point (POST) is a review: a Reports / MIS seat reads the reports only */
  const words = req.practice_roles.length ? 'Your seat reads the reports only, so it cannot mark a client as checked.' : "Only a firm's owner, adviser or auditor can read the practice.";
  return problem(req, res, { status: 403, code: 'BOOKS_GRANT_NOT_FOR_YOU', detail: words, legacy: { error: words, message: words } });
}
// @does Optional page and limit in -> we read, for every client that lets this firm read its books right now, the work waiting and the business's health from the client's own books (sales are the one SOLD rule, this year to date against the same dates last year), one look logged per client -> the rule, the band of counts over ALL clients and the clients worst first (a page of at most 100 when asked, else all) (a firm's person only; live grants only).
router.get('/practice', auth, noKey, grantUserOnly, declaresStatuses([503]), ...contract.checked('GET /practice'), async (req, res) => {
  try {
    const owner = require('../lib/owner');
    const practice = await require('../lib/books-practice').practice(entityOf(req), { roles: req.practice_roles, seats: req.practice_seats, actor: req.identity.identity_id, actor_name: req.identity.display_name, owner: !req.identity.parent_entity_id, manager: owner.isManager(req), query: req.query });
    res.json(Object.assign({}, practice, await require('../lib/assign-register').verdictFor(req))); /* ASSIGN-1 · A2: may_assign + may_take, the SAME gate the opener and assign-bulk use (the partner or a manager), so the web's grey state and the refusal cannot drift */
  } catch (err) {
    answer(req, res, err);
  }
});

// @does A client and the check point the Day book showed in -> we store that this person has checked that client up to there (the count of changes starts again from it) -> the check point. No look is logged: the client never sees it.
router.post('/practice/baseline', auth, noKey, grantUserOnly, declaresStatuses([503]), ...contract.checked('POST /practice/baseline'), async (req, res) => {
  try {
    const body = req.body || {};
    res.status(201).json(await require('../lib/books-baseline').setBaseline(entityOf(req), body.client, req.identity.identity_id, body.seen_to, req.practice_seats, !req.identity.parent_entity_id, require('../lib/owner').isManager(req)));
  } catch (err) {
    answer(req, res, err);
  }
});

// @does An auditor, what they may see and consent true in -> we give them read access to the books -> the grant (owner only).
router.post('/', auth, noKey, memberOnly, declaresStatuses([409, 503]), ...contract.checked('POST /'), async (req, res) => {
  try {
    const body = req.body || {};
    if (body.consent !== true) throw grants.refusal('BOOKS_GRANT_CONSENT_NEEDED', 422, 'Read what your auditor can see, then say yes.');
    res.status(201).json(await grants.give(entityOf(req), byOf(req), body));
  } catch (err) {
    answer(req, res, err);
  }
});

// @does A grant id and the changes in -> we change what that auditor can see -> the updated grant (owner only).
router.patch('/:id', auth, noKey, memberOnly, declaresStatuses([503]), ...contract.checked('PATCH /:id'), async (req, res) => {
  try {
    res.json(await grants.change(entityOf(req), byOf(req), req.params.id, req.body || {}));
  } catch (err) {
    answer(req, res, err);
  }
});

// @does A grant id in -> we take that access away -> the revoked grant (owner only).
router.post('/:id/revoke', auth, noKey, memberOnly, declaresStatuses([503]), ...contract.checked('POST /:id/revoke'), async (req, res) => {
  try {
    res.json(await grants.revoke(entityOf(req), byOf(req), req.params.id));
  } catch (err) {
    answer(req, res, err);
  }
});

// @does Optional filters in -> we read when auditors looked at the books -> the list of looks (owner only).
router.get('/log', auth, noKey, memberOnly, declaresStatuses([503]), ...contract.checked('GET /log'), async (req, res) => {
  try {
    const looks = await grants.looks(entityOf(req), req.query || {});
    res.json({ looks, visits: require('../lib/books-visits').visitsOf(looks) }); /* one row per visit (a run within 30 minutes), the pages in its detail */
  } catch (err) {
    answer(req, res, err);
  }
});

router.openapi = { paths: contract.pathsOf() };
module.exports = router;

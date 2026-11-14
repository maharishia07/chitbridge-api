'use strict';
// OWNS      /api/books-grants: the MEMBER's side of ACC-176 — the owner of the books gives its network parent read-only access (a purpose, an end date, a yes to the plain-words consent), edits the end date, ends it, and reads who looked.
// CALLED BY server.js (mounted at /api/books-grants), the member's grant and log screens (cb-network).
// FLOW      auth → noKey → ownerOnly (the member's OWNER only: not a co-assist, not the parent) → schema check (lib/books-grants-contract) → lib/books-grant → the answer; a refusal → problem(req, res, refusal in words)
// CARD      04-network/ACC-176-AUDITOR-GRANT
// The auditor does not use this file: it reads the books through GET /api/books/* with an X-Books-For header (middleware/books-auth.js). A grant is written with its access_events row in one transaction (lib/books-grant.js).
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { ownerOnly } = require('../lib/owner');
const grants = require('../lib/books-grant');
const contract = require('../lib/books-grants-contract');

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

router.get('/consent', auth, noKey, ...contract.checked('GET /consent'), (req, res) => res.json(contract.consentWords(req.query.can_see_costs !== 'false')));

router.get('/', auth, noKey, memberOnly, async (req, res) => {
  try {
    res.json(await grants.list(entityOf(req)));
  } catch (err) {
    answer(req, res, err);
  }
});

router.post('/', auth, noKey, memberOnly, ...contract.checked('POST /'), async (req, res) => {
  try {
    const body = req.body || {};
    if (body.consent !== true) throw grants.refusal('BOOKS_GRANT_CONSENT_NEEDED', 422, 'Read what your auditor can see, then say yes.');
    res.status(201).json(await grants.give(entityOf(req), byOf(req), body));
  } catch (err) {
    answer(req, res, err);
  }
});

router.patch('/:id', auth, noKey, memberOnly, ...contract.checked('PATCH /:id'), async (req, res) => {
  try {
    res.json(await grants.change(entityOf(req), byOf(req), req.params.id, req.body || {}));
  } catch (err) {
    answer(req, res, err);
  }
});

router.post('/:id/revoke', auth, noKey, memberOnly, ...contract.checked('POST /:id/revoke'), async (req, res) => {
  try {
    res.json(await grants.revoke(entityOf(req), byOf(req), req.params.id));
  } catch (err) {
    answer(req, res, err);
  }
});

router.get('/log', auth, noKey, memberOnly, ...contract.checked('GET /log'), async (req, res) => {
  try {
    res.json({ looks: await grants.looks(entityOf(req), req.query || {}) });
  } catch (err) {
    answer(req, res, err);
  }
});

router.openapi = { paths: contract.pathsOf() };
module.exports = router;

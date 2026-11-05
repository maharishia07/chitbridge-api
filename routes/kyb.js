// routes/kyb.js — the "Know your business" value panel. Sections 1-3 are computed from owned data → FREE (SELECTs over
// the entity's own rows). Section 4 (field) is metered per search + 24h-cached. Entity-scoped; identity from the token.
// Makes NO governance claim. See CB-CLI-DIRECTIVE-know-your-business-panel + lib/kyb.js.
// CALLED BY server.js (mounted at /api/kyb); the web know-your-business page (public/know-your-business.html)
// FLOW      auth (any signed-in login; a viewer's write is refused inside auth by the hat-gate) -> schema check (lib/kyb-contract.js) -> lib/kyb.js (entity from the token, no id in the path)
//           a thrown error -> problem(req, res, faultOf(e, req, label) | credentialFault(e, req)) -> the old { error, message } kept beside the Problem fields (docs/contracts/api-legacy.json)
// CARD      21-compliance-attestation-and-trade/know-your-business
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { contract, faultOf, credentialFault, credentialInputFault } = require('../lib/kyb-contract'); // the contract (each route's operation) and the one way a fault is worded
const kyb = require('../lib/kyb');
const entityId = (req) => auth.entityOf(req);

// Section 1 — Yourself (free)
router.get('/yourself', auth, ...contract.checked('GET /yourself'), async (req, res) => {
  try {
    res.json(await kyb.yourself(entityId(req)));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Yourself failed'));
  }
});
// open registry — add a credential CB doesn't know (village NOC etc.) → declared, rises to documented with an owned chit
router.post('/credential', auth, ...contract.checked('POST /credential'), async (req, res) => {
  const refused = credentialInputFault(req.body); // CMP-23: a field that is not text, or a valid_until that is not a real day, is refused before the database
  if (refused) return problem(req, res, refused);
  try {
    res.json(await kyb.addCredential(entityId(req), req.body || {}));
  } catch (err) {
    problem(req, res, credentialFault(err, req)); // a refusal the library meant (a 400, fixed words) keeps its status and its words; anything else is the generic 500
  }
});
// Section 2 — Position (free) — where you can sell, directionally
router.get('/position', auth, ...contract.checked('GET /position'), async (req, res) => {
  try {
    res.json(await kyb.position(entityId(req), { vertical: req.query.vertical, origin: req.query.origin }));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Position failed'));
  }
});
// Section 3 — Risk (free)
router.get('/risk', auth, ...contract.checked('GET /risk'), async (req, res) => {
  try {
    res.json(await kyb.risk(entityId(req)));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Risk failed'));
  }
});
// Section 4 — Field / direction (metered per search, 24h cache; walled-off, declared-only, source+as-of enforced)
router.post('/field', auth, ...contract.checked('POST /field'), async (req, res) => {
  try {
    res.json(await kyb.field(entityId(req)));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Field failed'));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;

// routes/forms.js — the AUTHORITY-FORMS engine surface. Define → resolve (fill + provenance) → issue (freeze) → sign.
// All entity-scoped (identity from the token). Resolve is FREE (compute over owned data); issue/sign persist a per-copy
// form_instance (WITH RLS, b108). Transfer is NOT here — an issued form attaches to /chits/send and rides the rail.
// See lib/forms.js + CB-CLI authority-forms.
// OWNS      the eight routes of /api/forms: the registry of forms, a free fill (resolve), issue (freeze), the issued forms, sign and attach to a chit
// CALLED BY server.js (mounted at /api/forms); the web page public/authority-forms.html
// FLOW      auth -> (write routes) access.writeGate -> schema check (lib/forms-contract.js) -> lib/forms.js (entity from the token) -> a thrown error -> problem(faultOf), the old { error, code?, message, unresolved? } kept beside the Problem fields
// CARD      21-compliance-attestation-and-trade/functions/authority-forms
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem, uuidParam } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { contract, faultOf } = require('../lib/forms-contract'); // the contract (each route's operation) and the one way a fault is worded
const forms = require('../lib/forms');
const access = require('../lib/access'); /* TRADE-SRV1 G8: issue · sign · attach are the owner's or an editor's; the reads say so (may/why) */
const mayOf = (req) => {
  const verdict = access.mayWrite(req);
  return { issue: verdict, sign: verdict, attach: verdict };
};
const entityId = (req) => auth.entityOf(req);

/* K-1 (API-10) — an issued-form id that is not a uuid names no form: the route's own 404 words (its screen's label, the library's sentence) before the database answers in a 500 */
const NOT_FOUND_LABEL = { GET: 'Get instance failed', sign: 'Sign form failed', attach: 'Attach form failed' };
const unknownInstance = (req) => {
  const { code, detail, legacy } = faultOf(Object.assign(new Error('Form instance not found'), { status: 404 }), req, NOT_FOUND_LABEL[req.method === 'GET' ? 'GET' : req.path.split('/').pop()]);
  return { code, detail, legacy }; // FORMS_NOT_FOUND, the code an unknown uuid answers: a bad id answers exactly as an unknown one (S41)
};
router.param('id', uuidParam(unknownInstance));

// list the form definitions (the registry)
// @does Signed-in caller -> we list the form definitions on offer -> the forms and what the caller may do with them.
router.get('/', auth, async (req, res) => {
  try {
    res.json({ forms: forms.listForms(), may: mayOf(req) });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'List forms failed'));
  }
});
// one definition (fields + their source precedence)
// @does A form key in the address (signed-in) -> we read that form definition with its fields and where each value comes from -> the form definition.
router.get('/:key', auth, ...contract.checked('GET /:key'), async (req, res) => {
  try {
    res.json({ key: req.params.key, ...forms.getForm(req.params.key) });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Get form failed'));
  }
});
// resolve/fill — FREE preview. body: { context_ref?, manual? }
// @does A form key and an optional chit or manual values (signed-in) -> we fill the form from what we hold as a free preview, saving nothing -> the filled form.
router.post('/:key/resolve', auth, ...contract.checked('POST /:key/resolve'), async (req, res) => {
  try {
    res.json(await forms.resolveForm(entityId(req), req.params.key, req.body || {}));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Resolve form failed'));
  }
});
// issue — freeze by value into a form_instance (refuses if a required field is unresolved)
// @does A form key and its values (signed-in, not view-only) -> we freeze a filled copy, refusing if a required field is missing -> the issued form instance.
router.post('/:key/issue', auth, access.writeGate, ...contract.checked('POST /:key/issue'), async (req, res) => {
  try {
    res.json(await forms.issueForm(entityId(req), req.params.key, req.body || {}));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Issue form failed'));
  }
});
// list issued instances — ?context_ref=<chit_id> → the papers of that one deal (G5)
// @does Signed-in shop with an optional chit id -> we list the forms it has issued, or only the papers of one deal -> the form instances.
router.get('/instances/all', auth, ...contract.checked('GET /instances/all'), async (req, res) => {
  try {
    res.json({ ...(await forms.listInstances(entityId(req), { context_ref: req.query.context_ref })), may: mayOf(req) });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'List instances failed'));
  }
});
// one issued instance (the frozen filled form + provenance)
// @does An issued form id in the address (signed-in) -> we read the frozen filled form with its provenance -> that form instance.
router.get('/instances/:id', auth, ...contract.checked('GET /instances/:id'), async (req, res) => {
  try {
    res.json(await forms.getInstance(entityId(req), req.params.id));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Get instance failed'));
  }
});
// sign — stamp who + when onto the frozen instance
// @does An issued form id and signer details (signed-in, not view-only) -> we stamp who signed and when onto the frozen form -> the signed instance.
router.post('/instances/:id/sign', auth, access.writeGate, ...contract.checked('POST /instances/:id/sign'), async (req, res) => {
  try {
    res.json(await forms.signForm(entityId(req), req.params.id, req.body || {}, { identity_id: req.identity && req.identity.identity_id, display_name: req.identity && req.identity.display_name, owner: require('../lib/owner').isOwner(req) }));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Sign form failed'));
  }
});
// transfer — file the issued form onto a chit as a per-copy attachment (rides the rail). body: { chit_id }
// @does An issued form id and a chit id (signed-in, not view-only) -> we file the form onto that chit as an attachment on this copy -> the attachment record.
router.post('/instances/:id/attach', auth, access.writeGate, ...contract.checked('POST /instances/:id/attach'), async (req, res) => {
  try {
    res.json(await forms.attachToChit(entityId(req), req.params.id, (req.body || {}).chit_id, req.identity.identity_id));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Attach form failed'));
  }
});

router.openapi = { paths: contract.pathsOf() };
module.exports = router;

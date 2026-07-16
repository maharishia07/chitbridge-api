// routes/forms.js — the AUTHORITY-FORMS engine surface. Define → resolve (fill + provenance) → issue (freeze) → sign.
// All entity-scoped (identity from the token). Resolve is FREE (compute over owned data); issue/sign persist a per-copy
// form_instance (WITH RLS, b108). Transfer is NOT here — an issued form attaches to /chits/send and rides the rail.
// See lib/forms.js + CB-CLI authority-forms.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const forms = require('../lib/forms');
const entityId = (req) => req.identity.parent_entity_id || req.identity.identity_id;
const fail = (res, err, label) => res.status(err.status || 500).json({ error: label, code: err.code, message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err), unresolved: err.unresolved });

// list the form definitions (the registry)
router.get('/', auth, async (req, res) => {
  try { res.json({ forms: forms.listForms() }); } catch (err) { fail(res, err, 'List forms failed'); }
});
// one definition (fields + their source precedence)
router.get('/:key', auth, async (req, res) => {
  try { res.json({ key: req.params.key, ...forms.getForm(req.params.key) }); } catch (err) { fail(res, err, 'Get form failed'); }
});
// resolve/fill — FREE preview. body: { context_ref?, manual? }
router.post('/:key/resolve', auth, async (req, res) => {
  try { res.json(await forms.resolveForm(entityId(req), req.params.key, req.body || {})); } catch (err) { fail(res, err, 'Resolve form failed'); }
});
// issue — freeze by value into a form_instance (refuses if a required field is unresolved)
router.post('/:key/issue', auth, async (req, res) => {
  try { res.json(await forms.issueForm(entityId(req), req.params.key, req.body || {})); } catch (err) { fail(res, err, 'Issue form failed'); }
});
// list issued instances
router.get('/instances/all', auth, async (req, res) => {
  try { res.json(await forms.listInstances(entityId(req))); } catch (err) { fail(res, err, 'List instances failed'); }
});
// one issued instance (the frozen filled form + provenance)
router.get('/instances/:id', auth, async (req, res) => {
  try { res.json(await forms.getInstance(entityId(req), req.params.id)); } catch (err) { fail(res, err, 'Get instance failed'); }
});
// sign — stamp who + when onto the frozen instance
router.post('/instances/:id/sign', auth, async (req, res) => {
  try { res.json(await forms.signForm(entityId(req), req.params.id, req.body || {})); } catch (err) { fail(res, err, 'Sign form failed'); }
});
// transfer — file the issued form onto a chit as a per-copy attachment (rides the rail). body: { chit_id }
router.post('/instances/:id/attach', auth, async (req, res) => {
  try { res.json(await forms.attachToChit(entityId(req), req.params.id, (req.body || {}).chit_id, req.identity.identity_id)); } catch (err) { fail(res, err, 'Attach form failed'); }
});

module.exports = router;

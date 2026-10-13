// @stage tested
// @stage-note [CO1] GET /api/privacy/facts — public: who processes the data, where, the notice in force and the privacy contact.
'use strict';
/**
 * routes/privacy.js — the ONE public privacy answer (web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K1 · K9 · K11).
 *
 *   GET /api/privacy/facts   anyone (no sign-in): the sub-processors with what each holds and its region, the privacy notice version in
 *                            force and the privacy contact — each NULL with a sentence until the owner publishes it — and the legal clocks
 *                            the request register uses. No database read (0 trips); every fact comes from lib/privacy.js and the env.
 *
 * ⭐ It is the Standards register's live check: the register's privacy rows point here, so a reviewer runs one GET and sees the facts,
 *   and sees just as plainly what is NOT done yet. The shop's own registers (consent, requests) are /api/crm — signed in, per shop.
 */
const express = require('express');
const router = express.Router();
router.get('/facts', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json(require('../lib/privacy').facts()); });
module.exports = router;

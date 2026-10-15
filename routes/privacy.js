// @stage tested
// @stage-note [CO1] GET /api/privacy/facts — public: who processes the data, where, the notice in force and the privacy contact.
// @stage-note [T3-P3-CONSENT] /api/privacy/me — the storefront shopper's own answer: what the shop holds, consent on/off, a request recorded.
'use strict';
/**
 * routes/privacy.js — the ONE public privacy answer (web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K1 · K9 · K11), and the shopper's own.
 *
 *   GET /api/privacy/facts   anyone (no sign-in): the sub-processors with what each holds and its region, the privacy notice version in
 *                            force and the privacy contact — each NULL with a sentence until the owner publishes it — and the legal clocks
 *                            the request register uses. No database read (0 trips); every fact comes from lib/privacy.js and the env.
 *
 *   T3-P3-CONSENT (2026-10-14) — WHO MAY CALL: a storefront SHOPPER's token only (middleware/customer-auth: identity_type 'customer', refused
 *   for an owner or an employee, as /my-orders is). The shop is the token's parent (the one shop this identity belongs to); the party is the
 *   token's own identity — the caller never names either. Every read and write runs AS THE SHOP (its b306/b307 rows, its country's law).
 *   GET  /api/privacy/me              → lib/privacy.shopper: { shop, law, held[], consent { migrated, history, may }, requests, may_consent, may_request }
 *   POST /api/privacy/me/consent      { channel, purpose, allowed } → ONE new b306 row, noted_by = the shopper (how given: "by them, online");
 *                                      the SAME notePref the CRM's staff use — never a second writer. 201 { pref, may }
 *   POST /api/privacy/me/requests     { kind } → the shop's b307 register (lib/privacy.logRequest, party_id = the shopper, the shop's country's
 *                                      clock). A copy or an erasure is RECORDED here and answered by the owner; erasure itself only ever goes
 *                                      through the lifecycle path (PATCH /api/entities/:id/erase, platform scope) — never from this page.
 *   Before b306 / b307: 503 PRIVACY_NOT_MIGRATED in words (the GET says it in may_consent / may_request so the page greys, not breaks).
 *
 * ⭐ It is the Standards register's live check: the register's privacy rows point here, so a reviewer runs one GET and sees the facts,
 *   and sees just as plainly what is NOT done yet. The shop's own registers (consent, requests) are /api/crm — signed in, per shop.
 */
const express = require('express');
const router = express.Router();
const { withEntity } = require('../db');
const customerAuth = require('../middleware/customer-auth');
const PV = require('../lib/privacy');
const { safeErr } = require('../lib/respond');
const log = require('../lib/logger');

router.get('/facts', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json(PV.facts()); });

/** the shop and the party, from the token alone (the server decides; the body never names them) */
function whoOf(req) {
  const c = req.customer || {};
  if (!c.shop_entity_id) { const e = new Error('This sign-in is not tied to a shop.'); e.status = 403; e.code = 'NO_SHOP'; throw e; }
  return { shop: c.shop_entity_id, me: c.identity_id, name: c.display_name || null };
}
function fail(res, e) {
  if (e && e.code === 'PRIVACY_NOT_MIGRATED') return res.status(503).json({ code: e.code, error: 'Not migrated yet', message: e.message });
  if (e && e.status && e.status < 500) return res.status(e.status).json(Object.assign({ code: e.code || 'REFUSED', error: e.message, message: e.message }, e.why ? { why: e.why } : {}));
  log.error('privacy/me failed', { err: e && e.message });
  return res.status(500).json({ error: 'Failed', message: safeErr(e) });
}

router.get('/me', customerAuth, async (req, res) => {
  try {
    const w = whoOf(req);
    res.json(await withEntity(w.shop, (h) => PV.shopper(h, w.shop, w.me)));
  } catch (e) { fail(res, e); }
});
router.post('/me/consent', customerAuth, async (req, res) => {
  try {
    const w = whoOf(req), b = req.body || {};
    const out = await withEntity(w.shop, async (h) => {
      const pref = await PV.notePref(h, w.shop, w.me, { channel: b.channel, purpose: b.purpose, allowed: b.allowed }, w.me);
      return { pref, may: (await PV.prefs(h, w.shop, w.me)).may };
    });
    res.status(201).json(out);
  } catch (e) { fail(res, e); }
});
router.post('/me/requests', customerAuth, async (req, res) => {
  try {
    const w = whoOf(req), b = req.body || {};
    const r = await withEntity(w.shop, async (h) => {
      const me = (await h.query(`SELECT display_name, phone, otp_contact, email FROM identities WHERE identity_id = $1`, [w.me])).rows[0] || {};
      const who = w.name || me.display_name || me.phone || me.otp_contact || me.email || 'the shopper';
      return PV.logRequest(h, w.shop, { party_id: w.me, who, kind: b.kind }, w.me);
    });
    res.status(201).json({ request: r });
  } catch (e) { fail(res, e); }
});
module.exports = router;

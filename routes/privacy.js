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
 * FLOW  facts: no sign-in → the answer of lib/privacy.js. The three shopper routes: customerAuth (a shopper's token only) → schema check (lib/privacy-contract.js) → the handler
 *       (the shop and the shopper from the token) → lib/privacy.js. A refusal or a fault → problem(req, res, faultOf(e, req)), the old { code, error, message } kept beside the Problem
 *       fields (docs/contracts/api-legacy.json). NO route here takes an id: the shopper and the shop are the token's, never named by the caller.
 * CARD  11-crm-and-marketing/privacy-consent
 *
 * ⭐ It is the Standards register's live check: the register's privacy rows point here, so a reviewer runs one GET and sees the facts,
 *   and sees just as plainly what is NOT done yet. The shop's own registers (consent, requests) are /api/crm — signed in, per shop.
 */
const express = require('express');
const router = express.Router();
const { withEntity } = require('../db');
const customerAuth = require('../middleware/customer-auth');
const PV = require('../lib/privacy');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { contract, faultOf } = require('../lib/privacy-contract'); // the contract (each route's operation) and the one way a fault is worded
const { declaresStatuses } = require('../lib/contract-kit'); // names the statuses lib/privacy.js can refuse with (a sentence of its own, the migration not run)

/** a catch that cannot spell its statuses: they are the library's (400 a sentence, 503 the migration not run) and the sign-in's (403 no shop) */
const mayRefuse = declaresStatuses([503]);

router.get('/facts', ...contract.checked('GET /facts'), (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(PV.facts());
  } catch (e) {
    next(e); // what express did with a throw here; server.js's one error handler answers it
  }
});

/** the shop and the party, from the token alone (the server decides; the body never names them) */
function whoOf(req) {
  const c = req.customer || {};
  if (!c.shop_entity_id) {
    const e = new Error('This sign-in is not tied to a shop.');
    e.status = 403;
    e.code = 'NO_SHOP';
    throw e;
  }
  return { shop: c.shop_entity_id, me: c.identity_id, name: c.display_name || null };
}

router.get('/me', customerAuth, ...contract.checked('GET /me'), async (req, res) => {
  try {
    const w = whoOf(req);
    res.json(await withEntity(w.shop, (h) => PV.shopper(h, w.shop, w.me)));
  } catch (e) {
    problem(req, res, faultOf(e, req)); // 503 migration not run · a refusal's fixed words (under 500) · else the generic 500; old keys kept
  }
});
router.post('/me/consent', customerAuth, ...contract.checked('POST /me/consent'), mayRefuse, async (req, res) => {
  try {
    const w = whoOf(req),
      b = req.body || {};
    const out = await withEntity(w.shop, async (h) => {
      const pref = await PV.notePref(h, w.shop, w.me, { channel: b.channel, purpose: b.purpose, allowed: b.allowed }, w.me);
      return { pref, may: (await PV.prefs(h, w.shop, w.me)).may };
    });
    res.status(201).json(out);
  } catch (e) {
    problem(req, res, faultOf(e, req)); // 503 migration not run · a refusal's fixed words (under 500) · else the generic 500; old keys kept
  }
});
router.post('/me/requests', customerAuth, ...contract.checked('POST /me/requests'), mayRefuse, async (req, res) => {
  try {
    const w = whoOf(req),
      b = req.body || {};
    const r = await withEntity(w.shop, async (h) => {
      const me = (await h.query(`SELECT display_name, phone, otp_contact, email FROM identities WHERE identity_id = $1`, [w.me])).rows[0] || {};
      const who = w.name || me.display_name || me.phone || me.otp_contact || me.email || 'the shopper';
      return PV.logRequest(h, w.shop, { party_id: w.me, who, kind: b.kind }, w.me);
    });
    res.status(201).json({ request: r });
  } catch (e) {
    problem(req, res, faultOf(e, req)); // 503 migration not run · a refusal's fixed words (under 500) · else the generic 500; old keys kept
  }
});
router.openapi = { paths: contract.pathsOf(), schemas: {} };
module.exports = router;

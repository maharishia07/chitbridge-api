'use strict';
/**
 * routes/identity-docs.js — a person's own identity record: phone, email, and government IDs.
 *
 * Athi, 2026-08-20: *"his phone number, and any email id, pan card, voter id, aadhar card, which he can submit
 * here for verification so it become his record."*
 *
 * ⭐ THE SHAPE IS (SCHEME, VALUE) PIVOTED BY COUNTRY — the same one IAM-SPEC §3 settled for the business
 * licence, not a second design. A new jurisdiction is a row in CATALOGUE below, never a migration.
 *
 * ⚠️⚠️ AADHAAR IS NEVER STORED — only its last four digits. The Aadhaar Act 2016 and the UIDAI regulations
 * restrict a private body from holding the number, and §29(4) restricts displaying it. Encryption is not the
 * exemption it is assumed to be: the restriction is on HOLDING it, not on holding it badly. b174 enforces this
 * with a CHECK constraint rather than trusting this comment to be read.
 *
 * ⭐ WHAT THE EMPLOYER SEES IS THE VERDICT, NOT THE DOCUMENT — verified, when, by whom. That is
 * [[reference-cb-core-principle]] applied to a person: the fact travels, the source does not.
 */
const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const schema  = require('../lib/schema');
const vault   = require('../lib/vaultcrypto');
const { query } = require('../db');
const crypto  = require('crypto');
const { safeErr } = require('../lib/respond');

/**
 * The catalogue. Country pivots to a set of schemes; each says how to mask it and how it is checked.
 *
 * `store:false` means the value NEVER reaches the database in any form — masked digits only.
 */
const CATALOGUE = {
  IN: [
    { scheme: 'PHONE',    label: 'Mobile',         pattern: /^[+]?[0-9]{10,15}$/,        mask: v => '•••••' + v.slice(-4),  store: true,  verify: 'otp' },
    { scheme: 'EMAIL',    label: 'Email',          pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, mask: v => v.replace(/^(.).*(@.*)$/, '$1•••$2'), store: true, verify: 'otp' },
    { scheme: 'PAN',      label: 'PAN',            pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,   mask: v => v.slice(0,3) + '••••' + v.slice(-3), store: true, verify: 'nsdl' },
    { scheme: 'VOTER_ID', label: 'Voter ID',       pattern: /^[A-Z]{3}[0-9]{7}$/,        mask: v => '•••' + v.slice(-4),    store: true,  verify: 'manual' },
    { scheme: 'DL',       label: 'Driving licence',pattern: /^[A-Z0-9-]{8,20}$/,          mask: v => '••••' + v.slice(-4),   store: true,  verify: 'manual' },
    /* ⚠️ store:false — the ONLY entry with it, and the reason the flag exists at all. */
    { scheme: 'AADHAAR',  label: 'Aadhaar',        pattern: /^[0-9]{12}$/,               mask: v => 'XXXX XXXX ' + v.slice(-4), store: false, verify: 'uidai-offline' },
  ],
};
const schemesFor = (cc) => CATALOGUE[cc] || CATALOGUE.IN;

/** GET — the person's own record. Never returns a stored value, only the mask and the verdict. */
router.get('/documents', auth, async (req, res) => {
  try {
    if (!(await schema.hasTable('identity_documents'))) {
      return res.status(503).json({ error: 'Not enabled', code: 'IDOC_NOT_MIGRATED',
        message: 'Identity records are not switched on yet.' });
    }
    /* ⭐ The owner reads a co-assist's record on the Co-assists screen; anyone else reads only their own. Same
       three rules as the write — resolveSubject is the ONE place that decides whose record may be named, so a
       read and a write can never disagree about it. */
    const subject = await resolveSubject(req, req.query.identity_id);
    const r = await query(
      `SELECT scheme, country, value_masked, status, verified_at, verified_by, submitted_by, consent_at
         FROM identity_documents WHERE identity_id = $1 ORDER BY scheme`,
      [subject.id]);
    res.json({ documents: r.rows, catalogue: schemesFor(req.query.country || 'IN').map(s => ({ scheme: s.scheme, label: s.label, verify: s.verify, stored: s.store })) });
  } catch (e) {
    /* ⚠️ safeErr RETURNS A STRING — it does not send a response. I first wrote safeErr(res, e, msg) as though
       it were a responder, which logs `res` as the error, discards the string, and NEVER REPLIES: the request
       hangs until the client times out. A route that silently never answers is worse than one that 500s.
       resolveSubject throws with a status, so honour it rather than flattening every refusal to 500. */
    res.status(e.status || 500).json({ error: e.code || 'Server error', message: e.status ? e.message : safeErr(e) });
  }
});

/**
 * Who is this document ABOUT — and may the caller say so?
 *
 * ⚠️⚠️ THE FIRST VERSION TOOK NO identity_id AT ALL, and that was the property that made the route safe: the
 * subject was always the caller, so no shape of the request could file a document against another person.
 * Athi, 2026-08-20: *"we have to add as part of coassist registration"* — the owner types these while creating
 * an employee. That is a real need (HR collects documents; that is how hiring works) and it reopens exactly
 * that shape, so it is allowed under three conditions and refused otherwise:
 *
 *   1. only an ENTITY may name a subject other than itself — an actor never can, so a co-assist cannot file
 *      a document against a colleague, which is the abuse the original shape prevented outright
 *   2. the subject must be an actor whose parent_entity_id IS that entity — never someone else's staff
 *   3. the row records WHO filed it, so an employee reading their own record can see it was not them
 *
 * Returns { id, onBehalf } or throws a 403-shaped error.
 */
async function resolveSubject(req, wanted) {
  /* ⚠️ THE ID IS PASSED IN, NOT DUG OUT OF req. The read path first called this as
     resolveSubject({ ...req, body: { identity_id } }) — and spreading an Express request copies only OWN
     enumerable properties, so everything on the prototype is silently lost. It happens to work because auth
     sets req.identity as an own property; it would break the moment that stopped being true, for reasons no
     one would connect to this line. One parameter removes the whole question. */
  const raw = String(wanted || '').trim();
  if (!raw || raw === req.identity.identity_id) return { id: req.identity.identity_id, onBehalf: false };

  if (req.identity.identity_type === 'actor') {
    const e = new Error('Only the account owner can record a document for someone else.');
    e.status = 403; e.code = 'IDOC_SUBJECT_FORBIDDEN'; throw e;
  }
  const r = await query(
    `SELECT 1 FROM identities WHERE identity_id = $1 AND identity_type = 'actor' AND parent_entity_id = $2`,
    [raw, req.identity.identity_id]);
  if (!r.rows.length) {
    const e = new Error('That person is not one of your co-assists.');
    e.status = 403; e.code = 'IDOC_SUBJECT_FORBIDDEN'; throw e;
  }
  return { id: raw, onBehalf: true };
}

/**
 * PUT — submit one document, for yourself or (as the owner) for one of your co-assists.
 */
router.put('/documents/:scheme', auth, async (req, res) => {
  try {
    if (!(await schema.hasTable('identity_documents'))) {
      return res.status(503).json({ error: 'Not enabled', code: 'IDOC_NOT_MIGRATED',
        message: 'Identity records are not switched on yet — the b174 migration has not been run.' });
    }
    const cc   = String(req.body.country || 'IN').toUpperCase();
    const want = String(req.params.scheme || '').toUpperCase();
    const spec = schemesFor(cc).find(s => s.scheme === want);
    if (!spec) return res.status(400).json({ error: 'Unknown document', message: 'That document is not recognised for ' + cc + '.' });

    const raw = String(req.body.value || '').trim().toUpperCase().replace(/[\s-]/g, m => (want === 'DL' ? m : ''));
    if (!spec.pattern.test(raw)) {
      return res.status(400).json({ error: 'Validation failed', field: want,
        message: 'That does not look like a ' + spec.label + '. Check it and try again.' });
    }

    /**
     * ⚠️⚠️ REFUSE RATHER THAN STORE PLAINTEXT. vaultcrypto returns false when VAULT_ENC_KEY is unset, which it
     * is everywhere today. A half-configured secret store that ACCEPTS data is worse than one that refuses it:
     * the refusal is visible, the plaintext is not. Same posture as b100's vault save.
     */
    let enc = null;
    if (spec.store) {
      if (!vault.isConfigured()) {
        return res.status(503).json({ error: 'Not configured', code: 'VAULT_ENC_UNCONFIGURED',
          message: 'Secure storage is not switched on yet, so this cannot be saved. Nothing was stored.' });
      }
      enc = JSON.stringify(vault.encryptVault({ v: raw }));
    }

    /* The hash answers "is this the same document" without holding the document — and it is salted with the
       scheme so the same digits under two schemes do not collide into one identity. */
    const hash = crypto.createHash('sha256').update(want + ':' + raw).digest('hex');
    const entity_id = auth.entityOf(req);
    const subject   = await resolveSubject(req, req.body.identity_id);
    const filedBy   = subject.onBehalf ? String(req.identity.identity_id) : 'self';

    /**
     * ⚠️⚠️ AADHAAR FILED BY SOMEONE ELSE NEEDS RECORDED CONSENT. b174 enforces this with a CHECK, so omitting
     * it here would surface as a raw constraint violation — a 500 that tells the person nothing. Refuse in the
     * handler, where the message can say what is missing and why it is being asked for.
     */
    const consent = (req.body.consent === true || req.body.consent === 'true') ? new Date() : null;
    if (want === 'AADHAAR' && subject.onBehalf && !consent) {
      return res.status(400).json({ error: 'Consent required', code: 'IDOC_CONSENT_REQUIRED',
        message: 'Recording someone else\'s Aadhaar needs their agreement. Confirm they have agreed, or ask '
               + 'them to enter it themselves from their own profile.' });
    }

    const r = await query(
      `INSERT INTO identity_documents (identity_id, entity_id, country, scheme, value_masked, value_hash, value_enc, status, submitted_by, consent_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)
       ON CONFLICT (identity_id, scheme) DO UPDATE
            SET value_masked = EXCLUDED.value_masked, value_hash = EXCLUDED.value_hash,
                value_enc = EXCLUDED.value_enc, status = 'pending', country = EXCLUDED.country,
                submitted_by = EXCLUDED.submitted_by, consent_at = EXCLUDED.consent_at,
                verified_at = NULL, verified_by = NULL, updated_at = NOW()
       RETURNING scheme, value_masked, status, submitted_by`,
      [subject.id, entity_id, cc, want, spec.mask(raw), hash, enc, filedBy, consent]);

    res.json({ message: 'Submitted for verification', document: r.rows[0], verified_by: spec.verify });
  } catch (e) {
    /* ⚠️ safeErr RETURNS A STRING — it does not send a response. I first wrote safeErr(res, e, msg) as though
       it were a responder, which logs `res` as the error, discards the string, and NEVER REPLIES: the request
       hangs until the client times out. A route that silently never answers is worse than one that 500s.
       resolveSubject throws with a status, so honour it rather than flattening every refusal to 500. */
    res.status(e.status || 500).json({ error: e.code || 'Server error', message: e.status ? e.message : safeErr(e) });
  }
});

module.exports = router;

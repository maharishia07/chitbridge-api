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
 
 * FLOW      PUT /documents/:scheme -> normalise -> docHash (keyed for Aadhaar, plain for the rest) -> upsert · identity-auth / keys.js recompute the PHONE and EMAIL hash
 *           auth (any signed-in login; the person is the token, or a co-assist the owner names) -> schema check (lib/identity-docs-contract.js) -> the handler -> lib/iddoc-verify.js for the code flow
 *           a refusal -> problem(req, res, ...) with the old { error, code, message } kept beside the Problem fields (docs/contracts/api-legacy.json)
 *           a thrown error -> problem(req, res, faultOf(e, req)); a refusal the library built -> problem(req, res, libraryRefusal(out))
 * CARD      18-identity-sign-in-and-access/identity-documents-and-the-vault
 * CALLED BY lib/identity-auth.js, routes/keys.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
const express = require('express');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const log = require('../lib/logger');
const router = express.Router();
const auth = require('../middleware/auth');
const schema = require('../lib/schema');
const vault = require('../lib/vaultcrypto');
const { query, withEntity } = require('../db');
const crypto = require('crypto');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { UUID_RE } = require('../lib/trace'); // CMP-22: the one uuid test
const { contract, faultOf, libraryRefusal, declaresStatuses } = require('../lib/identity-docs-contract'); // the contract (each route's operation) and the words of a fault

/**
 * The catalogue. Country pivots to a set of schemes; each says how to mask it and how it is checked.
 *
 * `store:false` means the value NEVER reaches the database in any form — masked digits only.
 */
/**
 * Per-scheme normalisation. ⚠️ NOT one rule for all — see the note at the call site: a blanket toUpperCase
 * stored an email as CLERK@EXAMPLE.COM and quietly broke the mask, the ciphertext and the dedupe hash.
 */
/* ⚠️ THE BACKSLASHES ARE LOAD-BEARING AND A GENERATED EDIT ATE THEM ONCE. This block was written by a script
   that collapsed \s to s, giving /[s-]/ and /s/ — which after toUpperCase() match nothing at all, so
   whitespace survived and "TN01 2011 0001234" would have failed the DL pattern for no visible reason. Third
   time in one session that a script silently dropped an escape; anything touching these lines uses an editor,
   not a generator. */
const UP = (text) => text.toUpperCase().replace(/[\s-]/g, ''); // PAN, Voter ID — case-insensitive, no separators
const UPKEEP = (text) => text.toUpperCase().replace(/\s/g, ''); // DL — keeps hyphens, which appear in real numbers
const DIGITS = (text) => text.replace(/[^0-9+]/g, ''); // phone, Aadhaar — a leading + survives
const LOWER = (text) => text.trim().toLowerCase(); // email — lowercased, never stripped

/**
 * ⭐⭐ selfServe — MAY THE PERSON THEMSELVES FILE THIS? Athi, 2026-08-20: *"mobile number and email id, he can
 * add here, rest everything only the business set and he can see here BECAUSE OTHER ITEMS SOMEONE SHOULD
 * VERIFY BY SEEING THE PHYSICAL RECORD."*
 *
 * ⭐ THE REASON IS THE RULE, AND IT DIVIDES THE CATALOGUE EXACTLY. A phone and an email VERIFY THEMSELVES: send
 * a code, and possession is the proof — nobody needs to look at anything. A PAN card, a voter ID, an Aadhaar
 * and a licence are verified by a person holding the document and comparing it. Self-declaring one of those
 * asserts something nobody checked, and an unverified claim sitting in a record is worse than an empty field,
 * because the field being filled reads as the check having happened.
 *
 * ⚠️ ENFORCED ON THE SERVER, NOT BY HIDING THE INPUT. A UI that omits a field is a suggestion; this route is
 * where the rule actually lives, because the request can be made without the UI.
 */
const CATALOGUE = {
  IN: [
    {
      scheme: 'PHONE',
      label: 'Mobile',
      pattern: /^[+]?[0-9]{10,15}$/,
      mask: (v) => '•••••' + v.slice(-4),
      store: true,
      verify: 'otp',
      norm: DIGITS,
      selfServe: true
    },
    {
      scheme: 'EMAIL',
      label: 'Email',
      pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
      mask: (text) => text.replace(/^(.).*(@.*)$/, '$1•••$2'),
      store: true,
      verify: 'otp',
      norm: LOWER,
      selfServe: true
    },
    {
      scheme: 'PAN',
      label: 'PAN',
      pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
      mask: (v) => v.slice(0, 3) + '••••' + v.slice(-3),
      store: true,
      verify: 'nsdl',
      norm: UP
    },
    { scheme: 'VOTER_ID', label: 'Voter ID', pattern: /^[A-Z]{3}[0-9]{7}$/, mask: (v) => '•••' + v.slice(-4), store: true, verify: 'manual', norm: UP },
    { scheme: 'DL', label: 'Driving licence', pattern: /^[A-Z0-9-]{8,20}$/, mask: (v) => '••••' + v.slice(-4), store: true, verify: 'manual', norm: UPKEEP },
    /* ⚠️ store:false — the ONLY entry with it, and the reason the flag exists at all. */
    {
      scheme: 'AADHAAR',
      label: 'Aadhaar',
      pattern: /^[0-9]{12}$/,
      mask: (v) => 'XXXX XXXX ' + v.slice(-4),
      store: false,
      verify: 'uidai-offline',
      norm: DIGITS
    }
  ]
};
const schemesFor = (cc) =>
  CATALOGUE[cc] ||
  CATALOGUE.IN.filter((item) => item.selfServe); /* CX0: a country with no list gets the universal two (phone · email), never India's PAN / Aadhaar */
/**
 * CX4 (R3): WHICH COUNTRY'S LIST — the shop's own (identities.country), read here by the server. A country sent by the client was
 * trusted before (default IN), so an Australian shop was offered PAN and Aadhaar and could file one. One read, the shop's row.
 */
async function shopCountry(entity_id) {
  const r = await query('SELECT country FROM identities WHERE identity_id = $1', [entity_id]);
  return String((r.rows[0] && r.rows[0].country) || '')
    .trim()
    .toUpperCase();
}

/** GET — the person's own record. Never returns a stored value, only the mask and the verdict. */
router.get('/documents', auth, ...contract.checked('GET /documents'), async (req, res) => {
  try {
    if (!(await schema.hasTable('identity_documents'))) {
      const message = 'Identity records are not switched on yet.';
      return problem(req, res, { status: 503, code: 'IDOC_NOT_MIGRATED', detail: message, legacy: { error: 'Not enabled', code: 'IDOC_NOT_MIGRATED', message } });
    }
    /* ⭐ The owner reads a co-assist's record on the Co-assists screen; anyone else reads only their own. Same
       three rules as the write — resolveSubject is the ONE place that decides whose record may be named, so a
       read and a write can never disagree about it. */
    const subject = await resolveSubject(req, req.query.identity_id);
    /**
     * ⚠️⚠️ withEntity, NOT query. identity_documents is WITH RLS, and the plain helper never sets
     * app.current_entity — so the policy matched nothing and this SELECT returned [] for EVERY caller. That is
     * the dangerous half of this bug: the WRITE failed loudly with 42501, but the READ failed SILENTLY, showing
     * "no documents on file" to a person whose documents were on file. A wrong answer with a 200 beside it is
     * worse than an error, because nothing prompts anyone to look.
     */
    const r = await withEntity(auth.entityOf(req), (db) =>
      db.query(
        `SELECT scheme, country, value_masked, status, verified_at, verified_by, submitted_by, consent_at
         FROM identity_documents WHERE identity_id = $1 ORDER BY scheme`,
        [subject.id]
      )
    );
    /* M18: a plain `verified` (+ `verified_at`) per document — what N19's trade-ready check reads. Only status 'verified'
       WITH a stamp counts; the pending-code counterfoil (verification_ref) is never selected, so it cannot leak. */
    const documents = r.rows.map((item) => ({ ...item, verified: item.status === 'verified' && !!item.verified_at }));
    res.json(
      Object.assign(PL.pageOut('documents', documents, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX)), {
        catalogue: schemesFor(await shopCountry(auth.entityOf(req))).map((item) => ({
          scheme: item.scheme,
          label: item.label,
          verify: item.verify,
          stored: item.store,
          /* the client renders an input only where this is true — the server refuses the rest either way */
          selfServe: !!item.selfServe
        }))
      })
    );
  } catch (e) {
    /* resolveSubject throws with a status (403, fixed words): faultOf honours it rather than flattening every refusal to 500, and logs any other error with the request id */
    problem(req, res, faultOf(e, req));
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

  /* CMP-22 (BH-10): an id that is not a uuid names nobody this shop holds, the same one answer as a stranger's id — said here, before the database puts its own words (22P02) into a 500 */
  if (!UUID_RE.test(raw)) {
    const e = new Error('That person is not one of your co-assists.');
    e.status = 403;
    e.code = 'IDOC_SUBJECT_FORBIDDEN';
    throw e;
  }

  if (req.identity.identity_type === 'actor') {
    const e = new Error('Only the account owner can record a document for someone else.');
    e.status = 403;
    e.code = 'IDOC_SUBJECT_FORBIDDEN';
    throw e;
  }
  const r = await query(`SELECT 1 FROM identities WHERE identity_id = $1 AND identity_type = 'actor' AND parent_entity_id = $2`, [
    raw,
    req.identity.identity_id
  ]);
  if (!r.rows.length) {
    const e = new Error('That person is not one of your co-assists.');
    e.status = 403;
    e.code = 'IDOC_SUBJECT_FORBIDDEN';
    throw e;
  }
  return { id: raw, onBehalf: true };
}

/**
 * PUT — submit one document, for yourself or (as the owner) for one of your co-assists.
 */
router.put('/documents/:scheme', auth, ...contract.checked('PUT /documents/:scheme'), async (req, res) => {
  try {
    if (!(await schema.hasTable('identity_documents'))) {
      const message = 'Identity records are not switched on yet — the b174 migration has not been run.';
      return problem(req, res, { status: 503, code: 'IDOC_NOT_MIGRATED', detail: message, legacy: { error: 'Not enabled', code: 'IDOC_NOT_MIGRATED', message } });
    }
    const cc = await shopCountry(auth.entityOf(req)); /* CX4: the shop's country, never the client's */
    const want = String(req.params.scheme || '').toUpperCase();
    const spec = schemesFor(cc).find((item) => item.scheme === want);
    if (!spec) {
      const message = 'That document is not recognised for ' + cc + '.';
      return problem(req, res, { status: 400, code: 'IDOC_UNKNOWN_DOCUMENT', detail: message, legacy: { error: 'Unknown document', message } });
    }

    /**
     * ⚠️⚠️ NORMALISATION IS PER SCHEME. One .toUpperCase() for everything stored an email as
     * "CLERK@EXAMPLE.COM" — confirmed live. Three things broke at once and none of them loudly:
     *   · the mask displayed the wrong text back to the person who typed it
     *   · the ENCRYPTED value was uppercased, so a verification code sent to it could go to the wrong
     *     mailbox — the local part of an address is case-sensitive per RFC 5321, whatever most servers do
     *   · the hash is taken over the normalised value, so the same address typed correctly later would not
     *     match, and "is this the same document" — the one question the hash exists to answer — says no
     *
     * ⭐ Each entry now declares its own rule, because "make it uppercase" was never a fact about documents,
     * only about the three Indian ones I happened to write first.
     */
    const raw = spec.norm(String(req.body.value || '').trim());
    if (!spec.pattern.test(raw)) {
      const message = 'That does not look like a ' + spec.label + '. Check it and try again.';
      return problem(req, res, { status: 400, code: 'IDOC_INVALID_VALUE', field: want, detail: message, legacy: { error: 'Validation failed', field: want, message } });
    }

    /**
     * ⚠️⚠️ REFUSE RATHER THAN STORE PLAINTEXT. vaultcrypto returns false when VAULT_ENC_KEY is unset, which it
     * is everywhere today. A half-configured secret store that ACCEPTS data is worse than one that refuses it:
     * the refusal is visible, the plaintext is not. Same posture as b100's vault save.
     */
    /* SEC-101: the key is needed for EVERY scheme now. A store:true scheme encrypts the value with it; a store:false scheme (Aadhaar)
       keeps only a keyed hash of it - without the key that hash would be a plain sha256 of a 12-digit number, so refuse like the rest. */
    if (!vault.isConfigured()) {
      const message = 'Secure storage is not switched on yet, so this cannot be saved. Nothing was stored.';
      return problem(req, res, { status: 503, code: 'VAULT_ENC_UNCONFIGURED', detail: message, legacy: { error: 'Not configured', code: 'VAULT_ENC_UNCONFIGURED', message } });
    }
    const enc = spec.store ? JSON.stringify(vault.encryptVault({ v: raw })) : null;

    /* The hash answers "is this the same document" without holding the document — and it is salted with the
       scheme so the same digits under two schemes do not collide into one identity. */
    const hash = docHash(want, raw);
    const entity_id = auth.entityOf(req);
    const subject = await resolveSubject(req, req.body.identity_id);
    const filedBy = subject.onBehalf ? String(req.identity.identity_id) : 'self';

    /**
     * ⚠️⚠️ AADHAAR FILED BY SOMEONE ELSE NEEDS RECORDED CONSENT. b174 enforces this with a CHECK, so omitting
     * it here would surface as a raw constraint violation — a 500 that tells the person nothing. Refuse in the
     * handler, where the message can say what is missing and why it is being asked for.
     */
    /**
     * ⚠️⚠️ AN EMPLOYEE MAY FILE ONLY WHAT VERIFIES ITSELF. Athi: *"mobile number and email id, he can add
     * here, rest everything only the business set… because other items someone should verify by seeing the
     * physical record."*
     *
     * A code sent to a phone or an address proves possession without anyone looking at anything. A PAN, a
     * voter ID, an Aadhaar or a licence is verified by a person holding the document — so a self-declared one
     * records a claim nobody checked, in a field whose being filled reads as the check having happened.
     *
     * ⭐ Refused here rather than by leaving the input off the screen. Hiding a field is a suggestion; a route
     * is where a rule can actually be kept, because the request can be made without the screen.
     */
    if (!subject.onBehalf && req.identity.identity_type === 'actor' && !spec.selfServe) {
      const message =
        'Your ' +
        spec.label +
        ' is recorded by your employer, who checks it against the document ' +
        'itself. You can add your mobile and email here — those are confirmed by a code sent to them.';
      return problem(req, res, { status: 403, code: 'IDOC_EMPLOYER_ONLY', detail: message, legacy: { error: 'Not permitted', code: 'IDOC_EMPLOYER_ONLY', message } });
    }

    const consent = req.body.consent === true || req.body.consent === 'true' ? new Date() : null;
    if (want === 'AADHAAR' && subject.onBehalf && !consent) {
      const message =
        "Recording someone else's Aadhaar needs their agreement. Confirm they have agreed, or ask " + 'them to enter it themselves from their own profile.';
      return problem(req, res, { status: 400, code: 'IDOC_CONSENT_REQUIRED', detail: message, legacy: { error: 'Consent required', code: 'IDOC_CONSENT_REQUIRED', message } });
    }

    /* ⚠️ withEntity — see the note on the read. WITH RLS means every statement against this table needs the
       tenant set on its connection, without exception. */
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `INSERT INTO identity_documents (identity_id, entity_id, country, scheme, value_masked, value_hash, value_enc, status, submitted_by, consent_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)
       ON CONFLICT (identity_id, scheme) DO UPDATE
            SET value_masked = EXCLUDED.value_masked, value_hash = EXCLUDED.value_hash,
                value_enc = EXCLUDED.value_enc, status = 'pending', country = EXCLUDED.country,
                submitted_by = EXCLUDED.submitted_by, consent_at = EXCLUDED.consent_at,
                verified_at = NULL, verified_by = NULL, verification_ref = NULL, updated_at = NOW()
       RETURNING scheme, value_masked, status, submitted_by`,
        [subject.id, entity_id, cc, want, spec.mask(raw), hash, enc, filedBy, consent]
      )
    );

    res.json({ message: 'Submitted for verification', document: r.rows[0], verified_by: spec.verify });
  } catch (e) {
    /* resolveSubject throws with a status (403, fixed words): faultOf honours it rather than flattening every refusal to 500, and logs any other error with the request id */
    problem(req, res, faultOf(e, req));
  }
});

/**
 * M18 — confirm a phone / e-mail by a code. POST /documents/:scheme/code sends one to the value on file;
 * POST /documents/:scheme/verify takes it. Subject rules are the same resolveSubject as the write.
 * Changing the value (PUT) clears the verification, so a new number is unverified until its own code is entered.
 * The logic is lib/iddoc-verify.js (on lib/otp.js); these handlers only load the row and hand it the store.
 */
async function loadDoc(req, scheme) {
  const subject = await resolveSubject(req, req.body.identity_id || req.query.identity_id);
  const entity_id = auth.entityOf(req);
  const r = await withEntity(entity_id, (db) =>
    db.query(`SELECT value_enc, status, verification_ref FROM identity_documents WHERE identity_id = $1 AND scheme = $2`, [subject.id, scheme])
  );
  const row = r.rows[0];
  let value = null;
  if (row && row.value_enc) {
    try {
      value = (vault.decryptVault(JSON.parse(row.value_enc)) || {}).v || null;
    } catch (e) {
      log.fellBack('identity-docs loadDoc: did not parse — answered with nothing', e, 'debug');
      value = null;
    }
  }
  return { subject, entity_id, row, value };
}
const stores = (entity_id, identity_id, scheme) => ({
  save: (ref) =>
    withEntity(entity_id, (db) =>
      db.query(`UPDATE identity_documents SET verification_ref = $3, updated_at = NOW() WHERE identity_id = $1 AND scheme = $2`, [identity_id, scheme, ref])
    ),
  verified: async (by) =>
    (
      await withEntity(entity_id, (db) =>
        db.query(
          `UPDATE identity_documents SET status = 'verified', verified_at = NOW(), verified_by = $3, verification_ref = NULL, updated_at = NOW()
      WHERE identity_id = $1 AND scheme = $2 RETURNING verified_at`,
          [identity_id, scheme, by]
        )
      )
    ).rows[0].verified_at
});
/** the table is not there yet: the 503 is written here and the handler is not reached (the one refusal this gate adds: 503 IDOC_NOT_MIGRATED) */
const idocGate = async (req, res, next) => {
  try {
    if (await schema.hasTable('identity_documents')) return next();
    const message = 'Identity records are not switched on yet.';
    return problem(req, res, { status: 503, code: 'IDOC_NOT_MIGRATED', detail: message, legacy: { error: 'Not enabled', code: 'IDOC_NOT_MIGRATED', message } });
  } catch (e) {
    return problem(req, res, faultOf(e, req));
  }
};
idocGate.addsStatuses = [503];
/* what lib/iddoc-verify.js can refuse with under each handler (R2-3 d: a refusal a helper writes is a gate): start() 400 · 409 · 503, confirm() 400 · 429 */
const startRefuses = declaresStatuses([400, 409, 503]);
const confirmRefuses = declaresStatuses([400, 429]);
const sendCode = (channel, to, code) =>
  channel === 'email' ? require('../lib/notify').sendOtpEmail(to, '', code, { ttl: '10 minutes' }) : require('../lib/notify').sendOtpSms(to, code);
const codeScheme = (req) => String(req.params.scheme || '').toUpperCase();
router.post('/documents/:scheme/code', auth, ...contract.checked('POST /documents/:scheme/code'), idocGate, startRefuses, async (req, res) => {
  try {
    const scheme = codeScheme(req);
    const { subject, entity_id, row, value } = await loadDoc(req, scheme);
    if (!row) {
      const message = 'Add that document first, then ask for a code.';
      return problem(req, res, { status: 404, code: 'IDOC_NOT_FOUND', detail: message, legacy: { error: 'Not found', code: 'IDOC_NOT_FOUND', message } });
    }
    const out = await require('../lib/iddoc-verify').start({
      doc: { identity_id: subject.id, scheme, value },
      store: stores(entity_id, subject.id, scheme),
      send: sendCode
    });
    if (out.status >= 400) return problem(req, res, libraryRefusal(out)); /* 400 IDOC_NOT_CODE_VERIFIED · 409 IDOC_VALUE_UNAVAILABLE · 503 PHONE/EMAIL_DELIVERY_NOT_CONFIGURED: the library built them */
    res.json(out.body);
  } catch (e) {
    problem(req, res, faultOf(e, req));
  }
});
router.post('/documents/:scheme/verify', auth, ...contract.checked('POST /documents/:scheme/verify'), idocGate, confirmRefuses, async (req, res) => {
  try {
    const scheme = codeScheme(req);
    const { subject, entity_id, row } = await loadDoc(req, scheme);
    if (!row) {
      const message = 'Add that document first.';
      return problem(req, res, { status: 404, code: 'IDOC_NOT_FOUND', detail: message, legacy: { error: 'Not found', code: 'IDOC_NOT_FOUND', message } });
    }
    const out = await require('../lib/iddoc-verify').confirm({
      doc: { identity_id: subject.id, scheme, verification_ref: row.verification_ref },
      code: req.body.code,
      store: stores(entity_id, subject.id, scheme)
    });
    if (out.status >= 400) return problem(req, res, libraryRefusal(out)); /* 400 IDOC_NO_CODE / OTP_EXPIRED / OTP_WRONG · 429 OTP_LOCKED: the library built them (a computed status: 400 or 429) */
    res.json(out.body);
  } catch (e) {
    problem(req, res, faultOf(e, req));
  }
});

/**
 * plainDocHash(scheme, normalisedValue) — sha256 of SCHEME:value, salted with the scheme so the same digits under two schemes never
 * collide. What PHONE and EMAIL use (sign-in recomputes it, so it must stay byte for byte) and what every row before SEC-101 holds.
 */
function plainDocHash(scheme, normalised) {
  return crypto
    .createHash('sha256')
    .update(String(scheme) + ':' + String(normalised))
    .digest('hex');
}
/** the schemes whose value is NEVER stored (store:false, Aadhaar) - a 10^12 space, so their hash must be keyed (SEC-101) */
const isNotStored = (scheme) => Object.values(CATALOGUE).some((list) => list.some((item) => item.scheme === scheme && !item.store));
/**
 * docHash(scheme, normalisedValue) — "is this the same document" without holding it. ⭐ ONE HASH, TWO READERS (M11): the PUT above
 * stores it, and routes/keys.js claimSeries matches a counter assigned to a phone number against the signed-in person's verified
 * PHONE. A not-stored scheme (Aadhaar) gets the KEYED hash (lib/vaultcrypto keyedDocHash, throws 503 without a key); the rest are
 * unchanged.
 */
function docHash(scheme, normalised) {
  return isNotStored(scheme) ? vault.keyedDocHash(scheme, normalised) : plainDocHash(scheme, normalised);
}
/** every hash a stored row for this value may hold: the keyed one, and for a not-stored scheme also the pre-SEC-101 plain one (legacy rows cannot be re-hashed) */
function docHashes(scheme, normalised) {
  return isNotStored(scheme) ? [docHash(scheme, normalised), plainDocHash(scheme, normalised)] : [plainDocHash(scheme, normalised)];
}
/** is this stored hash the same document as this value? (keyed or legacy) */
const sameDocument = (scheme, normalised, storedHash) => docHashes(scheme, normalised).includes(String(storedHash));
/** the PHONE normaliser the PUT uses (DIGITS: a leading + survives) — so a number typed by the owner hashes as the person's did */
router.normPhone = (v) => DIGITS(String(v == null ? '' : v).trim());
router.docHash = docHash;
router.openapi = { paths: contract.pathsOf(), schemas: {} };
router.docHashes = docHashes;
router.sameDocument = sameDocument;
module.exports = router;

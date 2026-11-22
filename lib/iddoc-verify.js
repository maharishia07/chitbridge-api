'use strict';
/**
 * iddoc-verify.js — M18: a phone / e-mail identity document is VERIFIED by a code sent to it.
 *
 * Invariant (tests/iddocs-verify.test.cjs): an unverified contact is never used for recovery. Anything that wants
 * to send a recovery or sign-in code to a contact held as an identity document asks verifiedContact() — it returns
 * the value only for a row with status 'verified'; otherwise null.
 *
 * Reuses lib/otp.js (generateOTP, otpEqual, MAX_OTP_ATTEMPTS — no second OTP engine), lib/dev-otp.js and the
 * lib/notify.js senders. The pending code lives on the existing row (`verification_ref`, no new column):
 *   otp:<sha256(code)>:<expiry ms>:<wrong attempts>      — the code itself is never stored.
 * On success the row becomes status 'verified', verified_at = now, verified_by = 'otp:email' | 'otp:phone', ref cleared.
 
 * CARD 18-identity-sign-in-and-access/sign-in
 * OWNS  the code that proves a phone / e-mail document, and the ONE reader of which identity holds a verified contact
 * FLOW  document PUT → code sent → confirm → status 'verified' → recovery and sign-in read it (verifiedContact · identitiesByVerifiedContact)      INIT  none
 * CALLED BY lib/entity-header.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
const crypto = require('crypto');
const log = require('./logger');
const { generateOTP, otpEqual, MAX_OTP_ATTEMPTS } = require('./otp');
const devOtp = require('./dev-otp');

const TTL_MS = 10 * 60 * 1000;
const CHANNEL = { EMAIL: 'email', PHONE: 'phone' };
const vaultcrypto = require('./vaultcrypto');
/** the stored fingerprint of a code (the code itself is never kept). A 6-digit code is a 10^6 space: an unkeyed sha256 of it is reversed from a dump in seconds (review GF-platform-03 M4), so it is KEYED under VAULT_ENC_KEY (the staff-code hash, SEC-106) whenever the vault key is set; else sha256 of key:code */
const codeHash = (code, key) =>
  vaultcrypto.isConfigured()
    ? vaultcrypto.keyedCodeHash(String(key), String(code))
    : crypto
        .createHash('sha256')
        .update(String(key) + ':' + String(code))
        .digest('hex');
/** the verification_ref text: otp:<hash>:<expiry ms>:<wrong attempts> */
const pack = (code, key, expiresAt, wrongTries) => 'otp:' + codeHash(code, key) + ':' + expiresAt + ':' + wrongTries;
function unpack(ref) {
  const m = /^otp:([0-9a-f]{64}):(\d+):(\d+)$/.exec(String(ref || ''));
  return m ? { hash: m[1], exp: Number(m[2]), tries: Number(m[3]) } : null;
}
const maskTo = (scheme, text) => (scheme === 'EMAIL' ? text.replace(/^(.).*(@.*)$/, '$1***$2') : '*****' + String(text).slice(-4));

/** why a document cannot be code-verified or has no readable value (null when it can): { status, body } for the caller to answer with */
function notStartable(doc, channel, scheme) {
  if (!channel)
    return {
      status: 400,
      body: {
        error: 'Not verifiable by code',
        code: 'IDOC_NOT_CODE_VERIFIED',
        message: 'Only a mobile number or an e-mail is confirmed by a code. The other documents are checked by your employer.'
      }
    };
  if (!doc.value)
    return {
      status: 409,
      body: {
        error: 'Value unavailable',
        code: 'IDOC_VALUE_UNAVAILABLE',
        message: 'The saved ' + scheme.toLowerCase() + ' cannot be read. Enter it again, then ask for a code.'
      }
    };
  return null;
}
/** the sealed-environment refusal when the code could not be handed over: 503, per channel */
function deliveryNotConfigured(channel) {
  return {
    status: 503,
    body:
      channel === 'phone'
        ? {
            error: 'Phone delivery is not configured',
            code: 'PHONE_DELIVERY_NOT_CONFIGURED',
            message: 'Codes cannot be sent to a mobile number yet. Nothing was changed.'
          }
        : {
            error: 'E-mail delivery is not configured',
            code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
            message: 'This environment cannot send e-mail yet, so a code cannot be delivered. Nothing was changed.'
          }
  };
}
/** the answer when a code is wrong: the attempt is counted by the caller; locks after MAX_OTP_ATTEMPTS */
function wrongCodeAnswer(triesNow) {
  const left = Math.max(0, MAX_OTP_ATTEMPTS - triesNow);
  return {
    status: left > 0 ? 400 : 429,
    body: {
      error: left > 0 ? 'Incorrect code' : 'Locked',
      code: left > 0 ? 'OTP_WRONG' : 'OTP_LOCKED',
      message: left > 0 ? 'Incorrect code — ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' : 'Too many incorrect attempts — request a new code.'
    }
  };
}
/**
 * start — doc = { identity_id, scheme, value (plain) }. store = { save(ref) }. send = (channel, to, code) => {delivered}.
 * Returns { status, body }. Nothing is saved when a sealed environment could not hand the code over.
 */
async function start({ doc, store, send, now }) {
  const scheme = doc && doc.scheme,
    channel = CHANNEL[scheme];
  const refused = notStartable(doc, channel, scheme);
  if (refused) return refused;
  const code = generateOTP('entity');
  let sent = null;
  try {
    sent = await send(channel, doc.value, code);
  } catch (e) {
    log.fellBack('iddoc-verify: failed — answered with nothing', e);
    sent = null;
  }
  const delivered = !!(sent && sent.delivered);
  if (!delivered && devOtp.isSealed()) return deliveryNotConfigured(channel);
  await store.save(pack(code, doc.identity_id + ':' + scheme, (now ? now() : Date.now()) + TTL_MS, 0));
  const body = { scheme, delivery: delivered ? 'sent' : 'not_sent', sent_to: maskTo(scheme, doc.value), expires_in: '10 minutes' };
  if (devOtp.mayExposeOtp()) body.dev_otp = code;
  return { status: 200, body };
}

/** confirm — doc = { identity_id, scheme, verification_ref }; store = { save(ref), verified(by) }. Returns { status, body }. */
async function confirm({ doc, code, store, now }) {
  const pending = unpack(doc && doc.verification_ref);
  if (!pending) return { status: 400, body: { error: 'No code requested', code: 'IDOC_NO_CODE', message: 'Ask for a code first.' } };
  if (pending.tries >= MAX_OTP_ATTEMPTS)
    return { status: 429, body: { error: 'Locked', code: 'OTP_LOCKED', message: 'Too many incorrect attempts — request a new code.' } };
  if ((now ? now() : Date.now()) > pending.exp) return { status: 400, body: { error: 'Expired', code: 'OTP_EXPIRED', message: 'Code expired — request a new one.' } };
  const key = doc.identity_id + ':' + doc.scheme;
  /* review GF-platform-03 M3: the attempt is COUNTED FIRST, atomically (compare-and-set on the ref that was read), and only the request that won the count may compare the code - parallel guesses can no longer all read tries=0 and all be checked. A store without claim() keeps the old path. */
  if (typeof store.claim === 'function') {
    const won = await store.claim(doc.verification_ref, 'otp:' + pending.hash + ':' + pending.exp + ':' + (pending.tries + 1));
    if (!won) return { status: 429, body: { error: 'Busy', code: 'OTP_LOCKED', message: 'Another attempt was in progress - try again.' } };
  }
  if (!otpEqual(pending.hash, codeHash(String(code == null ? '' : code).trim(), key))) {
    const triesNow = pending.tries + 1;
    if (typeof store.claim !== 'function') await store.save('otp:' + pending.hash + ':' + pending.exp + ':' + triesNow);
    return wrongCodeAnswer(triesNow);
  }
  const at = await store.verified('otp:' + CHANNEL[doc.scheme]);
  return { status: 200, body: { scheme: doc.scheme, verified: true, verified_at: at } };
}

/** The ONE read a recovery path may use for a contact held as an identity document: verified rows only; plain value or null. */
async function verifiedContact(run, decrypt, identity_id, scheme) {
  const found = await run(`SELECT value_enc FROM identity_documents WHERE identity_id = $1 AND scheme = $2 AND status = 'verified' AND verified_at IS NOT NULL`, [
    identity_id,
    scheme
  ]);
  const row = found && found.rows && found.rows[0];
  if (!row || !row.value_enc) return null;
  try {
    const plain = decrypt(JSON.parse(row.value_enc));
    return (plain && plain.v) || null;
  } catch (e) {
    log.fellBack('iddoc-verify verifiedContact: did not parse — answered with nothing', e, 'debug');
    return null;
  }
}

/**
 * N19's reader (the trade-ready checks): ONE statement for readBatch and the fold of its rows. The table is read here and nowhere
 * else (the guard). Only a row with status 'verified' AND a stamp is `verified`; `held` is a row of any status. No value, no ref.
 */
const available = () => require('./schema').hasTable('identity_documents'); /* the migration may not have run yet */
const docsStatement = (identity_id) => ({ text: 'SELECT scheme, status, verified_at FROM identity_documents WHERE identity_id = $1', params: [identity_id] });
function docsState(rows) {
  const out = {};
  for (const r of rows || []) out[r.scheme] = { held: true, verified: r.status === 'verified' && !!r.verified_at };
  return out;
}

/** M11's reader: the value hashes of a person's VERIFIED phone documents (same 'verified' rule as above), for matching a counter
    assigned to a phone number. Read here so the table has one reader (the recovery guard). */
const verifiedPhoneHashesStatement = (identity_id) => ({
  text: "SELECT value_hash FROM identity_documents WHERE identity_id = $1 AND scheme = 'PHONE' AND status = 'verified' AND verified_at IS NOT NULL",
  params: [identity_id]
});

/**
 * M14's reader: WHICH identities hold this contact as a VERIFIED document — sign in by a mobile number or an e-mail
 * (DECISIONS 2026-10-08: the .br/.cr grammar is added behind the scenes). `hashes` are routes/identity-docs.js docHash()
 * of every spelling the PUT could have stored (a phone with and without its +). Verified rows only — the same rule as
 * every reader above: a contact somebody typed but never proved opens nothing. Read here so the table keeps one reader.
 */
async function identitiesByVerifiedContact(run, scheme, hashes) {
  const hs = (hashes || []).filter(Boolean);
  if (!hs.length) return [];
  /* SEC-184: through the ONE pre-binding reader (ops.signin_candidates 'doc', b857) — this table is row-secured and a sign-in has no shop bound yet */
  const rows = await require('./signin-lookup').candidates(run, 'doc', scheme + ':' + hs.join(','));
  return rows.map((x) => x.identity_id).filter(Boolean);
}

module.exports = {
  start,
  confirm,
  verifiedContact,
  identitiesByVerifiedContact,
  available,
  docsStatement,
  docsState,
  verifiedPhoneHashesStatement,
  pack,
  unpack,
  TTL_MS
};

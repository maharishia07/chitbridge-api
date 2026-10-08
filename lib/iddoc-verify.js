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
 */
const crypto = require('crypto');
const { generateOTP, otpEqual, MAX_OTP_ATTEMPTS } = require('./otp');
const devOtp = require('./dev-otp');

const TTL_MS = 10 * 60 * 1000;
const CHANNEL = { EMAIL: 'email', PHONE: 'phone' };
const h = (code, key) => crypto.createHash('sha256').update(String(key) + ':' + String(code)).digest('hex');
const pack = (code, key, exp, n) => 'otp:' + h(code, key) + ':' + exp + ':' + n;
function unpack(ref) {
  const m = /^otp:([0-9a-f]{64}):(\d+):(\d+)$/.exec(String(ref || ''));
  return m ? { hash: m[1], exp: Number(m[2]), tries: Number(m[3]) } : null;
}
const maskTo = (scheme, v) => scheme === 'EMAIL' ? v.replace(/^(.).*(@.*)$/, '$1***$2') : '*****' + String(v).slice(-4);

/**
 * start — doc = { identity_id, scheme, value (plain) }. store = { save(ref) }. send = (channel, to, code) => {delivered}.
 * Returns { status, body }. Nothing is saved when a sealed environment could not hand the code over.
 */
async function start({ doc, store, send, now }) {
  const scheme = doc && doc.scheme, channel = CHANNEL[scheme];
  if (!channel) return { status: 400, body: { error: 'Not verifiable by code', code: 'IDOC_NOT_CODE_VERIFIED',
    message: 'Only a mobile number or an e-mail is confirmed by a code. The other documents are checked by your employer.' } };
  if (!doc.value) return { status: 409, body: { error: 'Value unavailable', code: 'IDOC_VALUE_UNAVAILABLE',
    message: 'The saved ' + scheme.toLowerCase() + ' cannot be read. Enter it again, then ask for a code.' } };
  const code = devOtp.fixedOtp('entity') || generateOTP();
  let r = null;
  try { r = await send(channel, doc.value, code); } catch (_) { r = null; }
  const delivered = !!(r && r.delivered);
  if (!delivered && devOtp.isSealed()) {
    return { status: 503, body: channel === 'phone'
      ? { error: 'Phone delivery is not configured', code: 'PHONE_DELIVERY_NOT_CONFIGURED', message: 'Codes cannot be sent to a mobile number yet. Nothing was changed.' }
      : { error: 'E-mail delivery is not configured', code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'This environment cannot send e-mail yet, so a code cannot be delivered. Nothing was changed.' } };
  }
  await store.save(pack(code, doc.identity_id + ':' + scheme, (now ? now() : Date.now()) + TTL_MS, 0));
  const body = { scheme, delivery: delivered ? 'sent' : 'not_sent', sent_to: maskTo(scheme, doc.value), expires_in: '10 minutes' };
  if (devOtp.mayExposeOtp()) body.dev_otp = code;
  return { status: 200, body };
}

/** confirm — doc = { identity_id, scheme, verification_ref }; store = { save(ref), verified(by) }. Returns { status, body }. */
async function confirm({ doc, code, store, now }) {
  const t = unpack(doc && doc.verification_ref);
  if (!t) return { status: 400, body: { error: 'No code requested', code: 'IDOC_NO_CODE', message: 'Ask for a code first.' } };
  if (t.tries >= MAX_OTP_ATTEMPTS) return { status: 429, body: { error: 'Locked', code: 'OTP_LOCKED', message: 'Too many incorrect attempts — request a new code.' } };
  if ((now ? now() : Date.now()) > t.exp) return { status: 400, body: { error: 'Expired', code: 'OTP_EXPIRED', message: 'Code expired — request a new one.' } };
  const key = doc.identity_id + ':' + doc.scheme;
  if (!otpEqual(t.hash, h(String(code == null ? '' : code).trim(), key))) {
    const n = t.tries + 1;
    await store.save('otp:' + t.hash + ':' + t.exp + ':' + n);
    const left = Math.max(0, MAX_OTP_ATTEMPTS - n);
    return { status: left > 0 ? 400 : 429, body: { error: left > 0 ? 'Incorrect code' : 'Locked', code: left > 0 ? 'OTP_WRONG' : 'OTP_LOCKED',
      message: left > 0 ? 'Incorrect code — ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' : 'Too many incorrect attempts — request a new code.' } };
  }
  const at = await store.verified('otp:' + CHANNEL[doc.scheme]);
  return { status: 200, body: { scheme: doc.scheme, verified: true, verified_at: at } };
}

/** The ONE read a recovery path may use for a contact held as an identity document: verified rows only; plain value or null. */
async function verifiedContact(run, decrypt, identity_id, scheme) {
  const r = await run(`SELECT value_enc FROM identity_documents WHERE identity_id = $1 AND scheme = $2 AND status = 'verified' AND verified_at IS NOT NULL`, [identity_id, scheme]);
  const row = r && r.rows && r.rows[0];
  if (!row || !row.value_enc) return null;
  try { const v = decrypt(JSON.parse(row.value_enc)); return (v && v.v) || null; } catch (_) { return null; }
}

/**
 * N19's reader (the trade-ready checks): ONE statement for readBatch and the fold of its rows. The table is read here and nowhere
 * else (the guard). Only a row with status 'verified' AND a stamp is `verified`; `held` is a row of any status. No value, no ref.
 */
const available = () => require('./schema').hasTable('identity_documents');   /* the migration may not have run yet */
const docsStatement = (identity_id) => ({ text: 'SELECT scheme, status, verified_at FROM identity_documents WHERE identity_id = $1', params: [identity_id] });
function docsState(rows) {
  const out = {};
  for (const r of rows || []) out[r.scheme] = { held: true, verified: r.status === 'verified' && !!r.verified_at };
  return out;
}

/** M11's reader: the value hashes of a person's VERIFIED phone documents (same 'verified' rule as above), for matching a counter
    assigned to a phone number. Read here so the table has one reader (the recovery guard). */
const verifiedPhoneHashesStatement = (identity_id) => ({ text: "SELECT value_hash FROM identity_documents WHERE identity_id = $1 AND scheme = 'PHONE' AND status = 'verified' AND verified_at IS NOT NULL", params: [identity_id] });

/**
 * M14's reader: WHICH identities hold this contact as a VERIFIED document — sign in by a mobile number or an e-mail
 * (DECISIONS 2026-10-08: the .br/.cr grammar is added behind the scenes). `hashes` are routes/identity-docs.js docHash()
 * of every spelling the PUT could have stored (a phone with and without its +). Verified rows only — the same rule as
 * every reader above: a contact somebody typed but never proved opens nothing. Read here so the table keeps one reader.
 */
async function identitiesByVerifiedContact(run, scheme, hashes) {
  const hs = (hashes || []).filter(Boolean);
  if (!hs.length) return [];
  const r = await run(`SELECT DISTINCT identity_id FROM identity_documents WHERE scheme = $1 AND value_hash = ANY($2::text[]) AND status = 'verified' AND verified_at IS NOT NULL`, [scheme, hs]);
  return (r && r.rows ? r.rows : []).map((x) => x.identity_id).filter(Boolean);
}

module.exports = { start, confirm, verifiedContact, identitiesByVerifiedContact, available, docsStatement, docsState, verifiedPhoneHashesStatement, pack, unpack, TTL_MS };

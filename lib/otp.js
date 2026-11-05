// CARD 10-online-shop-and-storefront-orders/order-start-confirm
// owns: OTP generation, the attempt cap, the shopper's one-shot code, and the keyed hash a staff code is kept as (SEC-106).
// called by: routes/catalogue.js · routes/entities.js · routes/actors.js · routes/connectors.js.
// FLOW  issueShopperOtp → verifyOtp (cap, tester code, compare) → spendShopperOtp / spendOrderCode (compare-and-clear)
// lib/otp.js — per-account OTP attempt cap (defense-in-depth ON TOP of the auth rate limiter).
// Locks an account's CURRENT otp after MAX wrong tries. The lock clears when a fresh OTP is issued (set
// otp_attempts = 0 in the same UPDATE that sets otp_code) or on success (set otp_attempts = 0 when clearing).
const crypto = require('crypto');
const logger = require('./logger');
const vaultcrypto = require('./vaultcrypto');
/** SEC-81: the ONE sentence a sign-in door says for an unknown account, a wrong secret or a locked one (API-STANDARD S6) - never a count, never "locked" */
const SIGNIN_REFUSED_SENTENCE = "That sign-in didn't work. Check the details and try again.";
const MAX_OTP_ATTEMPTS = parseInt(process.env.MAX_OTP_ATTEMPTS || '5', 10);

/**
 * generateOTP — THE OTP generator. Every place that issues one calls this.
 *
 * ⚠️ IT LIVES HERE BECAUSE A DUPLICATE ATE THE SECURITY FIX. `generateOTP` had THREE independent copies —
 * routes/entities.js, routes/actors.js, routes/connectors.js. The S4 reviewer fix (2026-07-13) moved it to a
 * CSPRNG and wrote down exactly why: *"Math.random() — whose V8 state is recoverable, letting an attacker predict
 * a victim's OTP."*
 *
 * That fix reached routes/entities.js. The other two kept `Math.random()` for four weeks: the co-assist login OTP,
 * and the connector OTP that is valid for SEVEN DAYS. Both are credentials. The reviewer was right, the fix was
 * right, and two thirds of the code it was written for never saw it — with nothing anywhere to report that.
 *
 * Verification already lives in this file (otpEqual, the attempt cap). Issuing belongs next to it: one module owns
 * the OTP end to end, so the next fix cannot land on one third of it again.
 *
 * DEV_OTP's fixed code still applies — but only where lib/dev-otp.js fixedOtp() allows it (SEC1: a LOCAL stack, never sealed).
 * It read DEV_OTP raw before SEC1, a second door beside dev-otp; now it asks the one door.
 */
/* SEC2 (widened, additive): `kind` names the flow's fixed code (entity · customer · connector); no kind = entity, as before.
   routes/connectors.js asked this for an ENTITY code and kept a second generator beside it for the connector one. */
function generateOTP(kind) {
  return require('./dev-otp').fixedOtp(kind || 'entity') || crypto.randomInt(100000, 1000000).toString();
}

/**
 * ⭐ SH-OTP1 (14 Oct): THE SHOPPER'S SIGN-IN CODE — issued and spent here, not in each storefront route.
 * routes/catalogue.js carried its own generator (genOTP) and wrote the same issue twice (order/start, support/start) and the
 * same spend four times; connectors.js and network-design.js each kept a private generator too. One door now.
 *
 * issueShopperOtp(run, identity_id, contact) → the code. ⚠️ T3.12: the attempt counter DECAYS with the 15-minute TTL and is
 * NOT zeroed by asking again — "start → 5 guesses → start" looped forever when it was.
 */
const SHOPPER_OTP_TTL_MS = 15 * 60 * 1000;
async function issueShopperOtp(run, identity_id, contact) {
  const otp = generateOTP('customer');
  await run(
    `UPDATE identities
        SET otp_code = $1, otp_expires_at = $2, otp_contact = $3,
            otp_attempts = CASE WHEN otp_expires_at IS NULL OR otp_expires_at < NOW() THEN 0 ELSE COALESCE(otp_attempts, 0) END
      WHERE identity_id = $4`,
    [otp, new Date(Date.now() + SHOPPER_OTP_TTL_MS), contact, identity_id]
  );
  return otp;
}

/** spendShopperOtp(run, identity_id, code) — a verified code is used up and the shopper is active (verifyOtp does not clear it,
 *  so without this one code would keep working for the rest of its fifteen minutes).
 *  ⭐ ORD-FIX O7: with `code` the spend is compare-and-clear (WHERE otp_code = code … RETURNING) and answers true only for the caller that
 *  spent it — two confirms racing with one code: one order, the other is told. Without `code` it clears unconditionally, as before. */
async function spendShopperOtp(run, identity_id, code) {
  const sets = `UPDATE identities SET status='active', otp_code=NULL, otp_expires_at=NULL, otp_attempts=0, last_active_at=NOW() WHERE identity_id=$1`;
  if (code == null) {
    await run(sets, [identity_id]);
    return true;
  }
  const done = await run(sets + ' AND otp_code = $2 RETURNING identity_id', [identity_id, String(code).trim()]);
  return !!(done && done.rowCount);
}

/**
 * spendOrderCode(runQuery, row, typed) — ORD-FIX O7: the order's one spend, inside the order's own transaction. A code verifyOtp accepted that is NOT the
 * stored one (the tester code) keeps the unconditional spend; a stored code is spent compare-and-clear, and a second confirm that finds it gone throws
 * `code_already_used` (lib/knownerr answers it as a 409 in words) — so a double tap makes ONE order.
 */
async function spendOrderCode(runQuery, row, typed) {
  const code = String(typed == null ? '' : typed).trim();
  const isStored = row.otp_code != null && String(row.otp_code) === code;
  if (await spendShopperOtp(runQuery, row.identity_id, isStored ? code : undefined)) return;
  throw Object.assign(new Error('This order was already sent — check My orders before sending it again.'), { code: 'code_already_used' });
}

// S6 (reviewer 2026-07-13) — constant-time OTP comparison (no early-exit timing leak). Length-safe.
function otpEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch (e) {
    logger.fellBack('otp otpEqual: did not parse — answered no', e, 'debug');
    return false;
  }
}

/**
 * OTP_HASH_COL — the SELECT item that reads identities.otp_code_hash and answers NULL (not an error) while b781 has not been run, so a sign-in
 * lookup can list it today without breaking before the migration. Every unaliased `FROM identities` read that feeds verifyOtp lists it.
 */
const OTP_HASH_COL = "(to_jsonb(identities) ->> 'otp_code_hash') AS otp_code_hash";

/**
 * codeHash(identityId, code) -> the keyed hash a staff sign-in code is stored as (identities.otp_code_hash), SEC-106. The ONE place it is
 * made: the issuer (lib/employee-code.js) writes it, hashMatches reads it. THROWS 503 VAULT_ENC_UNCONFIGURED without VAULT_ENC_KEY (callers catch it: employee-code storageMode checks first, hashMatches counts a miss).
 */
const codeHash = (identityId, code) => vaultcrypto.keyedCodeHash(identityId, String(code == null ? '' : code).trim());

/** does the typed code match the row's stored hash? Constant time; a key that cannot be read is a miss, never an error to the door, said in the log at ERROR */
function hashMatches(row, typed) {
  try {
    return otpEqual(row.otp_code_hash, codeHash(row.identity_id, typed));
  } catch (e) {
    logger.error('otp hashMatches: a held code hash cannot be checked, VAULT_ENC_KEY is gone — counted as not matching, the person asks again and gets a new code', { identity_id: row.identity_id, err: e && e.code });
    return false;
  }
}

/**
 * a code that is not the stored one, asked in this order: PLT-45 the installer's one-time token (lib/installer-token.js: its handle only, and only before any registered
 * business is active), then the tester code (lib/dev-otp testerGuess: a guess is counted per account and the door shuts after a few). → true when one of them lets the person in
 */
async function otherCodeOk(code, names, row) {
  if (await require('./installer-token').installerOk(code, names)) return true;
  return require('./dev-otp').testerGuess(code, names, row.identity_id);
}

// row  — must include: identity_id, otp_code, otp_expires_at, otp_attempts (+ otp_code_hash when the door reads staff codes: it wins over otp_code).
// run  — a query fn: the pool `query`, or a transaction `client.query`.
// submitted — the code the user typed.
// opts.names — SEC1: the sign-in name the person typed (the identity's own email / user_id / bridge_id / contact are added here),
//   for TESTER_NAMES. The tester code (lib/dev-otp.js testerCodeOk) is checked HERE, the one verify every door uses — after the
//   attempt lock (a locked account stays locked) and before the stored code. A miss falls through to the stored code, so a
//   wrong tester code is counted and answered exactly like any wrong code.
// Returns { ok:true } (the caller then clears the OTP), or { ok:false, status, message, reason } — status + message to send
// back verbatim; reason (OTP_WRONG | OTP_LOCKED | OTP_EXPIRED) is for the sign-in log (lib/signin-events.js), never the body.
async function verifyOtp(run, row, submitted, opts) {
  if ((row.otp_attempts || 0) >= MAX_OTP_ATTEMPTS) return { ok: false, status: 400, reason: 'OTP_LOCKED', message: SIGNIN_REFUSED_SENTENCE };

  const code = String(submitted == null ? '' : submitted).trim();
  const names = [].concat((opts && opts.names) || [], row.email, row.user_id, row.bridge_id, row.otp_contact, row.phone);
  const storedHit = row.otp_code_hash ? hashMatches(row, code) : Boolean(row.otp_code) && otpEqual(row.otp_code, code);
  /* SEC (finding 3): a typed stored code is never a tester guess or an installer token: those are asked only on a miss */
  if (!storedHit && (await otherCodeOk(code, names, row))) return { ok: true };
  if (!storedHit) {
    await run(`UPDATE identities SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE identity_id = $1`, [row.identity_id]);
    const locked = (row.otp_attempts || 0) + 1 >= MAX_OTP_ATTEMPTS;
    return { ok: false, status: 400, reason: locked ? 'OTP_LOCKED' : 'OTP_WRONG', message: SIGNIN_REFUSED_SENTENCE }; // SEC-81: no count, no "locked" on the door
  }
  if (new Date() > new Date(row.otp_expires_at)) return { ok: false, status: 400, reason: 'OTP_EXPIRED', message: 'Code expired — request a new one.' };

  return { ok: true };
}

module.exports = { SIGNIN_REFUSED_SENTENCE, generateOTP, verifyOtp, otpEqual, codeHash, OTP_HASH_COL, issueShopperOtp, spendShopperOtp, spendOrderCode, MAX_OTP_ATTEMPTS };

'use strict';
/**
 * dev-otp.js — THE ONE PLACE that decides whether a fixed test OTP exists and whether it may ever leave the server.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  WHAT TO CHANGE AT CUTOVER  (this is the whole checklist — there is nothing else to hunt for)
 *    1. Railway → Variables → set  NODE_ENV = production   (or uat | staging | live)
 *    2. Railway → Variables → DELETE  DEV_OTP
 *    3. Railway → Variables → set  OTP_EMAIL_ENABLED = true   (real delivery must work first)
 *  The server REFUSES TO BOOT if 1 is done without 2 or 3 — you cannot half-seal it. See assertOtpPosture().
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * THE THREE FIXED OTPs, and why there are three. They are deliberately DIFFERENT so a test tells you WHICH flow
 * issued the code you are holding:
 *
 *    kind        default   env override        used by                          what it authenticates
 *    ─────────   ───────   ─────────────────   ──────────────────────────────   ────────────────────────────────
 *    entity      123456    DEV_OTP             routes/entities.js, actors.js    a BUSINESS registering / logging in
 *    customer    123123    DEV_OTP_CUSTOMER    routes/catalogue.js (storefront) an END CUSTOMER placing an order
 *    connector   654321    DEV_OTP_CONNECTOR   routes/connectors.js             an ACTOR / connector being provisioned
 *
 * All three are armed by the SINGLE flag `DEV_OTP`. Unset it and every one of them reverts to a CSPRNG code, so
 * there is one switch to throw, not three.
 *
 * ⚠️ WHY THIS FILE EXISTS (security review, 2026-07-29 — the finding was live on production):
 *   `POST /api/catalogue/:shop/order/start` returned `{"dev_otp":"123123"}` in the response body to an
 *   unauthenticated caller, for ANY email address — unauthenticated takeover of any storefront customer.
 *   Two separate defects made it possible:
 *     (a) `lib/notify.js` defined production as `NODE_ENV === 'production'` while `server.js` used
 *         ['production','uat','staging','live']. Setting NODE_ENV=uat at cutover would have blocked DEV_OTP at boot
 *         while notify.js kept leaking the code — a half-seal that LOOKS sealed.
 *     (b) `routes/actors.js` gated exposure on `process.env.DEV_OTP` alone, with no environment check at all.
 *   Both are now impossible: there is one definition of "sealed", and one `mayExposeOtp()`.
 */

// ── ONE definition of a sealed environment. server.js imports this; nothing may redefine it. ──
// NODE_ENV is trimmed because production has been observed carrying a leading space (" development"), which silently
// defeated every `=== 'production'` comparison in the codebase.
const SEALED_ENVS = ['production', 'uat', 'staging', 'live', 'prod'];
const env = () => String(process.env.NODE_ENV || '').trim().toLowerCase();
const isSealed = () => SEALED_ENVS.includes(env());

// The single arming flag. Fixed OTPs exist only while this is set.
const armed = () => !!String(process.env.DEV_OTP || '').trim();

const DEFAULTS = { entity: '123456', customer: '123123', connector: '654321' };
const ENV_KEY  = { entity: 'DEV_OTP', customer: 'DEV_OTP_CUSTOMER', connector: 'DEV_OTP_CONNECTOR' };

/**
 * The fixed OTP for a flow, or null when not armed (caller must then use a CSPRNG code).
 * A sealed environment NEVER returns a fixed OTP, even if DEV_OTP somehow survived — defence in depth behind the
 * boot guard, so a mis-set variable degrades to a real random code rather than a known one.
 */
function fixedOtp(kind) {
  if (!armed() || isSealed()) return null;
  const k = Object.prototype.hasOwnProperty.call(DEFAULTS, kind) ? kind : 'entity';
  const override = String(process.env[ENV_KEY[k]] || '').trim();
  // DEV_OTP doubles as the arming flag AND the entity code, so honour it as a value only if it looks like one.
  if (k === 'entity') return /^[0-9]{4,8}$/.test(override) ? override : DEFAULTS.entity;
  return /^[0-9]{4,8}$/.test(override) ? override : DEFAULTS[k];
}

/**
 * ── ⭐⭐⭐ EXISTING AND BEING ECHOED BACK ARE TWO DIFFERENT DECISIONS ─────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"we still use the hardcoded OTP, but any leakages should be addressed."* Exactly right,
 * and the two halves were welded together: `armed() && !isSealed()` meant that arming the fixed code — which
 * is the only way anyone can sign in while OTP_EMAIL_ENABLED is false — ALSO published it in the response
 * body of `/register`, `/login` and the storefront's `order/start`, to an unauthenticated caller, for ANY
 * email address.
 *
 * ⚠️⚠️ THAT IS THE EXACT SHAPE THE 2026-07-29 REVIEW FOUND AND THIS FILE WAS WRITTEN TO PREVENT — see the
 * header: *"returned {"dev_otp":"123123"} … for ANY email address — unauthenticated takeover"*. It was fixed
 * for the case where the environment is SEALED. It was never fixed for the case we are actually in, which is
 * armed-and-unsealed, and that is where the product has lived every day since.
 *
 * ⭐ NOTHING NEEDS THE ECHO. The fixed codes are CONSTANTS a caller already knows (123456 / 123123 / 654321,
 * documented in the table above), the server logs them for a human, and every e2e fixture hardcodes them.
 * The response body is the one consumer that gains nothing and is reachable by everyone.
 *
 * ⚠️ SO IT IS OFF UNLESS SOMEBODY ASKS FOR IT, IN WRITING, PER ENVIRONMENT. Arming the OTP no longer implies
 * publishing it. This changes nothing about who can sign in. [[feedback-silence-is-the-bug]]
 */
const echoOptIn = () => String(process.env.DEV_OTP_IN_RESPONSE || '').trim().toLowerCase() === 'true';

/**
 * May a code be echoed back in an HTTP response? Only while armed, only in an explicitly non-sealed
 * environment, and only when someone has deliberately opted in. Every route that returns `dev_otp` MUST gate
 * on this — never on `process.env.DEV_OTP`, and never on a mailer's `sent.dev` flag, which says the mail was
 * not delivered and says nothing at all about who may read the code.
 */
const mayExposeOtp = () => armed() && !isSealed() && echoOptIn();

/**
 * Boot guard — refuse to start in a state that LOOKS sealed but leaks. Called from server.js.
 * Returns a list of fatal reasons (empty = fine).
 */
function otpPostureErrors() {
  const errs = [];
  if (!isSealed()) return errs;                       // dev/test: nothing to enforce
  if (armed()) errs.push('DEV_OTP is set in a sealed environment (' + env() + ') — fixed test OTPs must not exist here');
  if (String(process.env.OTP_EMAIL_ENABLED || '').trim() !== 'true')
    errs.push('OTP_EMAIL_ENABLED is not "true" in a sealed environment (' + env() + ') — real OTP delivery must be '
            + 'proven working before sealing, or codes silently fall back to the dev branch');
  return errs;
}

module.exports = { SEALED_ENVS, isSealed, armed, fixedOtp, mayExposeOtp, otpPostureErrors, DEFAULTS, ENV_KEY };

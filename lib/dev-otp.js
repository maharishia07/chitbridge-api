'use strict';
/**
 * dev-otp.js — THE ONE PLACE that decides whether a fixed test OTP exists and whether it may ever leave the server.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  WHAT TO CHANGE AT CUTOVER  (this is the whole checklist — there is nothing else to hunt for)
 *    1. Railway → Variables → set  NODE_ENV = production   (or uat | staging | live)
 *    2. Railway → Variables → DELETE  DEV_OTP
 *    3. Railway → Variables → set  OTP_EMAIL_ENABLED = true   (real delivery must work first)
 *    4. BEFORE REAL USERS — REMOVE  TESTER_CODE · TESTER_NAMES · TESTER_CODE_TZ  (Railway) and  E2E_TESTER_CODE  (web GitHub secret).
 *       The tester code (and its daily {yymmdd} form, SEC1b) is a TEMPORARY testing-phase arrangement; every boot warns while it is set.
 *  The server REFUSES TO BOOT if 1 is done without 2 or 3 — you cannot half-seal it. See assertOtpPosture().
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * TWO KINDS OF TEST CODE, and where each one may work (SEC1, Athi 2026-10-14: *"do not keep the code in the logic, i can share
 * the password to the testers"*):
 *
 *    THE TESTER CODE   env TESTER_CODE (8+ characters), set by Athi in the host's variables and shared with testers privately.
 *                      Never in the code, never issued, never stored, never e-mailed, never logged, never echoed. It is checked
 *                      on the VERIFY side only (testerCodeOk, asked by lib/otp.js verifyOtp — the one verify every door uses),
 *                      against SHA-256 digests with crypto.timingSafeEqual. Unset (or shorter than 8) → no tester code works.
 *                      Optional env TESTER_NAMES (comma list; exact names or `*` patterns like `*@test.chitbridge`) limits it
 *                      to those sign-in names; unset → any name. Change either any time — no deploy.
 *    THE FIXED CODES   one per flow (entity · customer · connector), armed by DEV_OTP — LOCAL STACK ONLY: the database host is
 *                      127.0.0.1 / localhost / ::1 AND NODE_ENV (trimmed) is development. Anywhere else fixedOtp() is null, a
 *                      random code is issued, and a fixed code is refused like any wrong code. The values live in the LOCAL
 *                      STACK block below and in the LOCAL-STACK docs, nowhere else (tests/tester-code.test.cjs guards it).
 *
 * ⚠️ WHY THIS FILE EXISTS (security review, 2026-07-29 — the finding was live on production):
 *   `POST /api/catalogue/:shop/order/start` returned `{"dev_otp":"<the customer code>"}` in the response body to an
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

/**
 * SEC1 · a LOCAL stack: the database is on this machine AND NODE_ENV says development. Both, because production carried
 * NODE_ENV=" development" for months (above) — the environment word alone never proved a machine was a developer's.
 * A docker service name or a test spin's host is NOT local here (sim-load's localOnly is a loader rule, wider on purpose).
 */
const LOCAL_DB_HOSTS = ['127.0.0.1', 'localhost', '::1'];
function isLocalStack() {
  if (env() !== 'development') return false;
  let host = '';
  try { host = new URL(String(process.env.DATABASE_URL || '')).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch (e) { logger.fellBack('dev-otp isLocalStack: did not parse — answered no', e, 'debug'); return false; /* no URL → not local; nothing to log */ }
  return LOCAL_DB_HOSTS.includes(host);
}

// ── LOCAL STACK ONLY — the fixed codes. Nothing outside this block may name them (tests/tester-code.test.cjs). ──
const DEFAULTS = { entity: '123456', customer: '123123', connector: '654321' };
const ENV_KEY  = { entity: 'DEV_OTP', customer: 'DEV_OTP_CUSTOMER', connector: 'DEV_OTP_CONNECTOR' };
// ── end LOCAL STACK ──

/**
 * The fixed OTP for a flow, or null (caller must then use a CSPRNG code) unless armed AND on a local stack (SEC1).
 * A sealed environment NEVER returns a fixed OTP, even if DEV_OTP somehow survived — defence in depth behind the
 * boot guard, so a mis-set variable degrades to a real random code rather than a known one.
 */
function fixedOtp(kind) {
  if (!armed() || isSealed() || !isLocalStack()) return null;
  const k = Object.prototype.hasOwnProperty.call(DEFAULTS, kind) ? kind : 'entity';
  const override = String(process.env[ENV_KEY[k]] || '').trim();
  // DEV_OTP doubles as the arming flag AND the entity code, so honour it as a value only if it looks like one.
  if (k === 'entity') return /^[0-9]{4,8}$/.test(override) ? override : DEFAULTS.entity;
  return /^[0-9]{4,8}$/.test(override) ? override : DEFAULTS[k];
}
/**
 * ⭐ TOP-CORRECT (2026-10-14): is `code` one of the fixed test codes (a default, or an env override)? A sealed environment must never
 * leave one usable — lib/identity-auth heldOtp re-issues such a code instead of keeping it; everywhere else the admin's code is kept.
 */
function isFixedCode(code) {
  const c = String(code == null ? '' : code).trim();
  if (!c) return false;
  return Object.values(DEFAULTS).includes(c) || Object.values(ENV_KEY).some((k) => String(process.env[k] || '').trim() === c);
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
 * header: *"returned {"dev_otp":"…"} … for ANY email address — unauthenticated takeover"*. It was fixed
 * for the case where the environment is SEALED. It was never fixed for the case we are actually in, which is
 * armed-and-unsealed, and that is where the product has lived every day since.
 *
 * ⭐ NOTHING NEEDS THE ECHO. The fixed codes are CONSTANTS a local caller already knows (the LOCAL STACK block
 * above), the server logs them for a human, and every e2e fixture hardcodes them.
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
const mayExposeOtp = () => armed() && !isSealed() && isLocalStack() && echoOptIn();

/* ── SEC1 · THE TESTER CODE — Athi's secret, read from the environment on every call (change it any time, no deploy) ── */
const TESTER_MIN = 8;
const digest = (v) => require('crypto').createHash('sha256').update(String(v), 'utf8').digest();
const logger = require('./logger');
/** a TESTER_NAMES entry → a test: exact (case-insensitive) or `*` as "any run of characters" */
function nameRule(entry) {
  const e = String(entry).trim().toLowerCase();
  if (!e.includes('*')) return (n) => n === e;
  const re = new RegExp('^' + e.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return (n) => re.test(n);
}
/** may `names` (the sign-in name typed, and the identity's own stored names) use the tester code? unset list → anyone */
function testerNameAllowed(names) {
  const list = String(process.env.TESTER_NAMES || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length) return true;
  const rules = list.map(nameRule);
  return [].concat(names || []).map((n) => String(n == null ? '' : n).trim().toLowerCase()).filter(Boolean)
    .some((n) => rules.some((r) => r(n)));
}
/**
 * testerCodeOk(submitted, names) — true only when TESTER_CODE is set (8+ characters), `submitted` equals it (or, for a daily
 * template, today's / before 06:00 yesterday's filling — SEC1b, testerCodesNow below), and the name is allowed. Equal-length SHA-256 digests through crypto.timingSafeEqual, so neither the length nor the first wrong character
 * shows in the time taken. ⚠️ It returns a boolean and nothing else: no log, no reason — a refusal must look exactly like a
 * wrong code, so nobody can learn from an answer or a log line whether a tester code exists.
 */
function testerCodeOk(submitted, names) {
  const wants = testerCodesNow();
  const got = String(submitted == null ? '' : submitted).trim();
  if (!wants.length || !got) return false;
  let same = false;
  for (const want of wants) same = require('crypto').timingSafeEqual(digest(got), digest(want)) || same;   // every candidate compared, always
  return same && testerNameAllowed(names);
}

/* ── SEC1b · THE DAILY TESTER CODE — ⚠️ TEMPORARY, testing phase only (Athi, 14 Oct: "this is a temp arrangement and that should be
   changed before releasing to prod"). TESTER_CODE may carry ONE date placeholder, {yymmdd} or {yyyymmdd}, filled with TODAY in the
   testers' zone (TESTER_CODE_TZ, default Asia/Kolkata — an IANA zone or a country, books-hooks.zoneOf). Yesterday's code is also
   taken until 06:00 that morning, so someone who signed in near midnight is not locked out. The day comes from the shop clock
   (lib/shop-clock.js) and books-hooks.dayOf / dayBounds — never a raw Date. Neither the template nor its expansion is ever logged. ── */
const DAY_SLOT = /\{(yymmdd|yyyymmdd)\}/g;
const YESTERDAY_UNTIL_MS = 6 * 3600e3;
const testerZone = () => String(process.env.TESTER_CODE_TZ || '').trim() || 'Asia/Kolkata';
/** the template's shape: { template, slots } — slots = how many placeholders it carries */
function testerTemplate() {
  const template = String(process.env.TESTER_CODE || '').trim();
  return { template, slots: (template.match(DAY_SLOT) || []).length };
}
/** the template filled for a day (YYYY-MM-DD) */
const fill = (template, day) => template.replace(DAY_SLOT, (_, f) => (f === 'yymmdd' ? day.slice(2) : day).replace(/-/g, ''));
/** why the tester door is shut, or null — the expansion's length is fixed by the template (6 or 8 digits), so this is a boot fact */
function testerRefusal() {
  const { template, slots } = testerTemplate();
  if (!template) return null;
  if (slots > 1) return 'TESTER_CODE carries more than one date placeholder — use ONE of {yymmdd} or {yyyymmdd}; no tester code works';
  if (fill(template, '2000-01-01').length < TESTER_MIN) return 'TESTER_CODE is shorter than ' + TESTER_MIN + ' characters (after the date is filled in) — no tester code works';
  return null;
}
/** the codes that sign a tester in at this moment: [] (door shut) · [static] · [today] · [today, yesterday] before 06:00 */
function testerCodesNow() {
  const { template, slots } = testerTemplate();
  if (!template || testerRefusal()) return [];
  if (!slots) return [template];
  const clock = require('./shop-clock'), hooks = require('./books-hooks');
  const zone = testerZone(), now = clock.nowMs(), today = clock.bizDay(now, zone);
  const start = Date.parse(hooks.dayBounds(today, zone).from);
  const codes = [fill(template, today)];
  if (now - start < YESTERDAY_UNTIL_MS) codes.push(fill(template, clock.bizDay(start - 1, zone)));
  return codes;
}
/**
 * What server.js logs at boot about the tester code: [{ level, msg, reason }]. Never the value, its length or its expansion.
 * ⚠️ The TEMPORARY warning is the point: while TESTER_CODE is set, every boot says it must go before real users.
 */
function testerNotices() {
  if (!testerTemplate().template) return [];
  const notes = [{ level: 'warn', msg: 'TEMPORARY: a tester sign-in code is active (testing phase). Remove TESTER_CODE before real users.',
    reason: 'see docs/HOSTING.md "Testers\' sign-in code" and the cutover checklist at the top of lib/dev-otp.js' }];
  const refused = testerRefusal();
  if (refused) notes.push({ level: 'warn', msg: 'tester sign-in code refused', reason: refused });
  const tz = String(process.env.TESTER_CODE_TZ || '').trim();
  if (tz.indexOf('/') > 0) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
    catch (_) { notes.push({ level: 'warn', msg: 'TESTER_CODE_TZ is not a time zone', reason: 'the daily tester code follows India\'s day (Asia/Kolkata) instead' }); }
  }
  return notes;
}

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
  // M02: an employee's first code is e-mailed, never shown, so a sealed environment needs a real sender.
  if (!String(process.env.RESEND_API_KEY || '').trim() || !String(process.env.FROM_EMAIL || '').trim())
    errs.push('RESEND_API_KEY and FROM_EMAIL must both be set in a sealed environment (' + env() + ') — employees get their '
            + 'first code by e-mail and a sealed environment never shows one on screen');
  return errs;
}

module.exports = { SEALED_ENVS, isSealed, armed, isLocalStack, fixedOtp, isFixedCode, mayExposeOtp, testerCodeOk, testerNameAllowed, testerNotices, otpPostureErrors, DEFAULTS, ENV_KEY };

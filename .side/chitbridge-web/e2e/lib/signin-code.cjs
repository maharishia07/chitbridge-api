'use strict';
/**
 * e2e/lib/signin-code.cjs — THE sign-in code the suite types (SEC1, Athi 2026-10-14: "do not keep the code in the logic, i can share
 * the password to the testers"). One place for fixtures.js (the specs) and the standalone scripts that sign in through the api.
 *
 *   against a DEPLOYED api → env E2E_TESTER_CODE (a GitHub secret Athi sets; the api's TESTER_CODE). Never a fallback: unset → null,
 *                            and the caller SKIPS with a CI warning naming the secret — a skip, never a silent pass.
 *   against a LOCAL api    → the local stack's fixed code (CB_DEV_OTP / CB_DEV_OTP_CUSTOMER). The api accepts those on a local stack
 *                            only (chitbridge-api lib/dev-otp.js: database on 127.0.0.1/localhost/::1 AND NODE_ENV=development).
 *
 * SEC1b (TEMPORARY, testing phase only): the secret may carry ONE {yymmdd} / {yyyymmdd} — the api's TESTER_CODE then changes by
 *   itself every day (chitbridge-api lib/dev-otp.js testerCodesNow). fillDay types TODAY's code in Asia/Kolkata (E2E_TESTER_CODE_TZ
 *   overrides, matching the api's TESTER_CODE_TZ). A mirror of the api's fill, not a second rule: the web cannot import the api, so
 *   e2e/signin-code.test.cjs asks the api's own testerCodeOk whether what this types is accepted, whenever the twin is beside it.
 *
 * `api` — the api the caller talks to; omitted → CB_API_BASE / CB_API, or the web served from localhost (app.html then uses the local api).
 */
const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
function apiIsLocal(api) {
  const named = api || process.env.CB_API_BASE || process.env.CB_API || '';
  return named ? LOCAL_URL.test(named) : LOCAL_URL.test(process.env.CB_WEB_BASE || '');
}
function signinCode(kind, api) {
  if (apiIsLocal(api)) return kind === 'customer' ? (process.env.CB_DEV_OTP_CUSTOMER || '123123') : (process.env.CB_DEV_OTP || '123456');   // LOCAL stack only
  return fillDay(String(process.env.E2E_TESTER_CODE || '').trim()) || null;
}
const DAY_SLOT = /\{(yymmdd|yyyymmdd)\}/g;
/** the template filled with the day of `ms` (default now) in the testers' zone; a code without a placeholder comes back unchanged */
function fillDay(template, ms) {
  if (template.search(DAY_SLOT) < 0) return template;   // search(), not test(): a /g regex keeps its place between calls
  const zone = String(process.env.E2E_TESTER_CODE_TZ || '').trim() || 'Asia/Kolkata';
  const w = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms == null ? Date.now() : ms))) w[p.type] = p.value;   /* clock-ok: the api's own tester code is the REAL day's */
  return template.replace(DAY_SLOT, (_, f) => (f === 'yymmdd' ? w.year.slice(2) : w.year) + w.month + w.day);
}
const NO_CODE = 'E2E_TESTER_CODE is not set — the testers\' sign-in code for a deployed api is a GitHub secret (repo Settings → Secrets → Actions → E2E_TESTER_CODE). Skipped, not passed.';
let warned = false;
function warnNoCode() { if (warned) return; warned = true; console.log('::warning title=E2E_TESTER_CODE missing::' + NO_CODE); }
/** a standalone script: the code for `api`, or warn and END the run as skipped (exit 0) — never type a code we do not have */
function codeOrSkip(api, kind) {
  const c = signinCode(kind, api);
  if (c) return c;
  warnNoCode();
  process.exit(0);
}
module.exports = { signinCode, apiIsLocal, warnNoCode, codeOrSkip, fillDay, NO_CODE };

/* signin.cjs — drive the ONE sign-in window on the counter (CBSignin.mount in #usignbody, since #68) through its own controls.
 *
 * ⭐ WHY (round W1, 2026-10-12): five till harnesses each carried a copy of the OLD counter form's steps (till-usign-who · -ask ·
 * -otp · -verify · -pinlater) and all five went red the day the till mounted CBSignin. One helper, the current control ids
 * (signin-id · signin-go · signin-code / signin-pin · signin-verify · signin-later), so the next move of the window is one edit.
 * Drives the control, never pokes the DOM. The stand-in servers answer /api/signin/ask with dev_otp '123456' (not prefilled by
 * the window — a person types the code they were sent), and /api/signin/verify with a token.
 *
 *   signIn(p, id, { code, out })   open the window (usignOpen), sign `id` in with the code (default '123456') — stops right after
 *                                  "Sign in" is pressed, because what follows depends on the counter (a PIN offer, "a different
 *                                  shop" question, "Opening …"). `out`: press Sign out first if somebody is on.
 *   signedIn(p, { timeout })       the usual after-step: the counter PIN offer is declined ("Not now") and the window says who
 *                                  is in (till-usign-in). Returns nothing; throws on a timeout like any Playwright wait.
 */
'use strict';
const T = (s) => '[data-testid="' + s + '"]';

exports.signIn = async function (p, id, o) {
  o = o || {};
  await p.evaluate(() => usignOpen());
  if (o.out && await p.locator(T('till-usign-out')).count()) await p.click(T('till-usign-out'));
  await p.waitForSelector(T('signin-id'), { timeout: o.timeout || 15000 });
  await p.fill(T('signin-id'), id);
  await p.click(T('signin-go'));
  await p.waitForSelector(T('signin-code') + ', ' + T('signin-pin'), { timeout: o.timeout || 15000 });
  if (await p.locator(T('signin-code')).count()) await p.fill(T('signin-code'), o.code || '123456');
  else await p.fill(T('signin-pin'), o.pin || '');
  await p.click(T('signin-verify'));
};

exports.signedIn = async function (p, o) {
  o = o || {};
  await p.waitForSelector(T('till-usign-in') + ', ' + T('signin-later'), { timeout: o.timeout || 15000 });
  if (await p.locator(T('signin-later')).count()) await p.click(T('signin-later'));
  await p.waitForSelector(T('till-usign-in'), { timeout: o.timeout || 15000 });
};

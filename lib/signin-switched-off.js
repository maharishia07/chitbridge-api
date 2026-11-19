'use strict';
/**
 * CARD 18-identity-sign-in-and-access/sign-in
 * lib/signin-switched-off.js — RC-13 (DECISIONS 19 Nov): a switched-off person signing in is told the account is switched off, not "That sign-in didn't work".
 * OWNS      told(parts, req, res, actor, parent) → true when answered (403 ACCOUNT_SWITCHED_OFF, no token), false when the secret failed (the caller's old one answer follows)
 * CALLED BY routes/signin.js actorLogin (parts = the door's own actorSecretCheck, note, methodOf, textOf, problem)
 * The SEC-81 / SEC-143 rule stands: nothing about an account's state is told to someone who has NOT proved the secret, so the secret is checked FIRST (the same check, counts and answer) and only a RIGHT one hears the words.
 */
const words = (shop) => 'This account is switched off, so you cannot sign in. Ask the owner of ' + (shop || 'the business') + ' to switch it back on.';

async function told({ actorSecretCheck, note, methodOf, textOf, problem }, req, res, actor, parent) {
  const typed = actor.pin_hash ? textOf(req.body.pin) || (req.body.otp || '').trim() : (req.body.otp || '').trim();
  if (!(await actorSecretCheck(req, actor, typed)).ok) return false;
  note(req, actor, 'fail', methodOf(actor), 'ACCESS_DEACTIVATED');
  res.locals.code = 'ACCESS_DEACTIVATED';
  const sentence = words(parent && parent.display_name);
  problem(req, res, { status: 403, code: 'ACCOUNT_SWITCHED_OFF', detail: sentence, legacy: { error: 'Account switched off', message: sentence } });
  return true;
}

module.exports = { told, words };

'use strict';
// OWNS      the ONE-TIME INSTALLER TOKEN: the code that lets the installer make an installation's first private root entity through the ordinary register + verify door.
// CALLED BY lib/otp.verifyOtp (the one verify every door uses)
// FLOW      installer: POST /api/entities/register (the root's handle) → POST /api/entities/verify with CB_INSTALLER_TOKEN → verifyOtp → installerOk → the entity goes active, stamped by the existing writer
// CARD      18-identity-sign-in-and-access/platform-root
/**
 * ⭐ NOT A SECOND DOOR, NOT A DATABASE SEED. The root is an ordinary entity made by the ONE register door, so the governance stamp keeps its existing writers (CTP-DESIGN 9.10 already
 * counts three; a direct insert would be a fourth). This module only answers one question inside the one verify: "is this the installer's token, for this handle, on a database that
 * has no registered business yet?"
 *
 * ⚠️ FAIL-CLOSED, IN FOUR WAYS. (1) CB_INSTALLER_TOKEN and CB_INSTALLER_HANDLE must both be set, the token 16+ characters. (2) The token only works for the entity whose handle is
 * CB_INSTALLER_HANDLE. (3) It only works while NO registered business is active here (a registered business = identity_type 'entity' with a user_id that is not a minted party
 * '~…'; the seeded CBSRC rows have no user_id). The moment the root is active, the token is dead, whatever .env still says. (4) A database that cannot be read answers no.
 * The daily tester code is not used. A refusal looks exactly like a wrong code: it returns a boolean and nothing else.
 */
const crypto = require('crypto');
const { query } = require('../db');
const log = require('./logger');

const MIN_LENGTH = 16;
const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();

/** is the token set properly, and does it match what was typed (constant time)? */
function tokenMatches(typed) {
  const want = String(process.env.CB_INSTALLER_TOKEN || '');
  const handle = String(process.env.CB_INSTALLER_HANDLE || '').trim();
  if (want.length < MIN_LENGTH || !handle || !typed) return false;
  return crypto.timingSafeEqual(digest(typed), digest(want));
}

/** is this the entity the installer meant? (its handle, case-folded, among the names the verify door already gathers) */
function handleMatches(names) {
  const handle = String(process.env.CB_INSTALLER_HANDLE || '').trim().toLowerCase();
  return !!handle && (names || []).some((name) => String(name || '').toLowerCase() === handle);
}

/** installerOk(typed, names) → true only for the installer's token, for the installer's handle, before any registered business is active */
async function installerOk(typed, names) {
  const code = String(typed == null ? '' : typed).trim();
  if (!tokenMatches(code) || !handleMatches(names)) return false;
  try {
    const active = await query(`SELECT 1 FROM identities WHERE identity_type = 'entity' AND status = 'active' AND user_id IS NOT NULL AND user_id NOT LIKE '~%' LIMIT 1`);
    return active.rows.length === 0;
  } catch (e) {
    log.fellBack('installer-token: the check could not read identities — answered no', e);
    return false;
  }
}

module.exports = { installerOk, MIN_LENGTH };

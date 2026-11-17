'use strict';
// OWNS      the answer to "is migration b874 run?" (ops.identity_secret + ops.spend_shopper_code) and the ONE rewrite that lets the sign-in code run before AND after it
// CALLED BY lib/bound-read.js (every identities credential read goes through boundRead/boundEach) · lib/otp.js (spendShopperOtp) · routes/actors.js (two direct reads)
// CARD      28-platform-and-operations/api-standard
// FLOW      tolerate(sql) → viewReady() → yes: the SQL as written (view door) · no: the pre-b874 reads of main (identities.pin_hash / otp_code, otp_code_hash through to_jsonb) · ask failed: as written
/**
 * ⭐ WHY (release prep 17 Nov 2026): the api deploys BEFORE Athi runs b874. The SEC-186 code joined ops.identity_secret, so on a database without b874 EVERY sign-in, register and verify
 * answered 500 (relation does not exist). Until b874 is run the credential columns are still readable by cb_app (the revoke RUN file follows b874), so the old reads are the right ones:
 * exactly what main does today, never weaker (no secret skipped, no code written anywhere). After b874 the view door is used, as SEC-186 intends.
 * ⭐ A YES IS CACHED FOREVER, A NO FOR 20 SECONDS (b874 may be run by hand against a live server). A failed ask is NOT "absent": the statement that follows would fail the same way, so the
 * SQL stays as written (and a unit test with a stub `execute` keeps seeing the view text it always saw).
 */
const VIEW = 'ops.identity_secret';
const JOIN = 'LEFT JOIN ops.identity_secret s ON s.for_identity = identities.identity_id';
const NO_VIEW_TTL_MS = 20000;
let yes = false;
let noUntil = 0;
let inflight = null;

async function askDatabase() {
  const { query } = require('../db');
  const answer = await query('SELECT to_regclass($1) IS NOT NULL AS has_view, to_regprocedure($2) IS NOT NULL AS has_fn', [VIEW, 'ops.spend_shopper_code(uuid,text)']);
  const row = answer && answer.rows && answer.rows[0];
  if (!row || typeof row.has_view !== 'boolean') throw new Error('identity-secret: no answer'); /* an answer that is not a clear yes or no is a failed ask, not an absent view */
  return row.has_view && row.has_fn;
}

/** true unless the database definitely lacks b874 */
async function viewReady() {
  if (yes) return true;
  if (Date.now() < noUntil) return false;
  if (!inflight) {
    inflight = askDatabase().then(
      (present) => { if (present) yes = true; else noUntil = Date.now() + NO_VIEW_TTL_MS; return present; },
      () => true,
    ).finally(() => { inflight = null; });
  }
  return inflight;
}

/** the view-door SQL as the pre-b874 read of main: the join goes, s.<col> reads identities.<col> (the hash column stays NULL-safe through to_jsonb while b781 may not be run) */
function legacySql(sql) {
  return String(sql)
    .split(JOIN).join('')
    .replace(/\bs\.otp_code_hash\b/g, "(to_jsonb(identities) ->> 'otp_code_hash')")
    .replace(/\bs\.otp_code\b/g, 'identities.otp_code')
    .replace(/\bs\.pin_hash\b/g, 'identities.pin_hash')
    .replace(/\bs\.has_pin\b/g, '(identities.pin_hash IS NOT NULL)')
    .replace(/\bs\.has_code\b/g, "(identities.otp_code IS NOT NULL OR (to_jsonb(identities) ->> 'otp_code_hash') IS NOT NULL)");
}

/** the SQL that is right for the database as it is now; text that does not name the view is returned as is */
async function tolerate(sql) {
  if (typeof sql !== 'string' || sql.indexOf('identity_secret') < 0) return sql;
  return (await viewReady()) ? sql : legacySql(sql);
}

function _reset() { yes = false; noUntil = 0; inflight = null; }
module.exports = { viewReady, tolerate, legacySql, _reset };

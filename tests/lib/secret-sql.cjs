'use strict';
/**
 * tests/lib/secret-sql.cjs — SEC-186: a read of pin_hash / otp_code / otp_code_hash joins the owner view ops.identity_secret
 * (`FROM identities LEFT JOIN ops.identity_secret s ON s.for_identity = identities.identity_id`, items `s.pin_hash AS pin_hash`).
 * The in-memory identities stand-ins model the row with those keys already, so they read the statement as it was before the join:
 * unsecret(sql) drops the join and the `s.` prefix, nothing else.
 */
const JOIN = /\s*LEFT JOIN ops\.identity_secret s ON s\.for_identity = identities\.identity_id/gi;
const ITEM = /\bs\.(pin_hash|otp_code_hash|otp_code) AS \1\b/gi;
const unsecret = (sql) => String(sql).replace(JOIN, '').replace(ITEM, '$1');
module.exports = { unsecret };

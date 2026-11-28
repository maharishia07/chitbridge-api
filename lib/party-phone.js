'use strict';
/**
 * lib/party-phone.js — the ONE rule for the phone a party's row shows (DRIFT 35b, PROOF-2026-11-27).
 * OWNER     crm (cb-crm)
 * RISK      showing another business's sign-in phone (otp_contact) as a party's contact breaks APP 11 / DPDP / UAE PDPL minimisation (LENSSEC-1129); the rule below is the whole defence.
 * OWNS      phoneOf(row) (no route, no state)
 * CALLED BY lib/crm.js (CRM party list and record) · routes/relationships.js (GET /customers): both screens answer the same phone for the same party
 * FLOW      row { phone, otp_contact, user_id } → the number the party published, else (a party THIS shop minted, handle starting ~) the number the shop typed on otp_contact, else null
 * CARD      11-crm-and-marketing/crm-party-list
 */
/** the phone a party's row shows: its published phone, else, for a party this shop minted, the number the shop typed (otp_contact); never a registered business's sign-in phone */
function phoneOf(row) {
  return row.phone || (require('./handle').isMinted(row.user_id) ? row.otp_contact : null) || null;
}
module.exports = { phoneOf };

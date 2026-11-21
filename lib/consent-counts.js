'use strict';
/*
 * lib/consent-counts.js — WHO HAS AGREED TO OFFERS, counted once (the Home card and the results read the same two numbers).
 * OWNER     cb-marketing
 * RISK      personal-data
 * OWNS      the ONE count of "who has agreed to offers" (SAMECOUNT, A-F-58): a party AGREED when its newest standing marketing row on any channel is a yes;
 *           SAID NO when it has marketing rows and none is a standing yes. The same rows (consent-standing) the send gate and the Groups list read.
 * CALLED BY lib/home-facts.js (marketing card) · lib/marketing-results.js (why a result is 0 - never "nobody agreed" while someone has)
 * FLOW      handle.query (newest row per party × channel) → { agreed, said_no }
 * CARD      12-marketing/README
 */
const { standingSql } = require('./consent-standing');
const toNumber = (value) => Number(value) || 0;
/** { agreed, said_no } for one shop over an open handle (withEntity). Throws as the db does (the caller words "not provisioned"). */
async function agreedCounts(handle, owner) {
  const result = await handle.query(
    `WITH last AS (SELECT DISTINCT ON (party_id, channel) party_id, allowed FROM party_contact_pref
        WHERE owner_entity_id = $1 AND purpose = 'marketing' AND ${standingSql('party_contact_pref')} ORDER BY party_id, channel, noted_at DESC),
      per AS (SELECT party_id, bool_or(allowed) AS yes FROM last GROUP BY party_id)
      SELECT (count(*) FILTER (WHERE yes))::int AS agreed, (count(*) FILTER (WHERE NOT yes))::int AS said_no FROM per`,
    [owner]
  );
  const row = (result.rows && result.rows[0]) || {};
  return { agreed: toNumber(row.agreed), said_no: toNumber(row.said_no) };
}
module.exports = { agreedCounts };

/**
 * public-facts.js — WHAT A COUNTERPARTY MAY SEE ABOUT AN ENTITY, WITH HOW WELL IT IS KNOWN.
 *
 * Athi, 2026-09-05 (from Chola's Suppliers screen): "trade-ready verified information should display on the left-hand side —
 * or given information?" Both, each labelled: the facts the profile map holds about a business (GSTIN · state · registration
 * type) with their RUNG — declared (they typed it) · copied (their own books, via the connector) · checked (our arithmetic:
 * the check digit, the state code) · verified (a registry) — and where and when it came from.
 *
 * ⚠️ NEVER THE VAULT. Only the identities row (gstn · country · policy_flags.profile_provenance · gst_registration) is read,
 * and only fields a counterparty already sees on an invoice. Phone, email, PAN and bank rows stay private.
 */
'use strict';
const GST_STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory' };
const RANK = { declared: 1, copied: 2, checked: 3, verified: 4 };

/** factsOf(identityRow) → { gstin, gstin_rung, state, state_code, reg_type, country, source, as_of, rung } or null when nothing is known */
function factsOf(row) {
  if (!row) return null;
  const flags = (row.policy_flags && typeof row.policy_flags === 'object') ? row.policy_flags : {};
  const prov = (flags.profile_provenance && typeof flags.profile_provenance === 'object') ? flags.profile_provenance : {};
  const gstin = row.gstn ? String(row.gstn).trim().toUpperCase() : null;
  const pg = prov.gstin || null;
  /* the check we can make ourselves, so a typed GSTIN with a right check digit still says "checked" here */
  let gstin_rung = (pg && pg.rung) || (gstin ? 'declared' : null);
  if (gstin && gstin_rung && RANK[gstin_rung] < RANK.checked) { try { const pm = require('./profile-map'); const a = pm.assess({ gstin: { value: gstin, rung: gstin_rung } }); if (a.fields && a.fields.gstin && a.fields.gstin.rung && RANK[a.fields.gstin.rung] > RANK[gstin_rung]) gstin_rung = a.fields.gstin.rung; } catch (_) {} }
  const state_code = gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  const out = {
    gstin, gstin_rung,
    state: state_code ? (GST_STATES[state_code] || null) : null, state_code,
    reg_type: flags.gst_registration ? String(flags.gst_registration) : null,
    country: row.country ? String(row.country).toUpperCase() : null,
    source: (pg && pg.source) || null, as_of: (pg && pg.as_of) || null,
    /* the lowest rung among what is shown — the honest single word for the card */
    rung: gstin_rung || null,
  };
  return (out.gstin || out.country) ? out : null;
}
module.exports = { factsOf, GST_STATES };

'use strict';
/*
 * OWNS      which consent row STANDS when staff and the customer disagree (SEC audit 2026-11-16): the customer's own withdrawal outranks a later staff-written yes, and the evidence a staff yes must carry
 * CALLED BY lib/privacy.js (the send gate, the may map, the party list - re-exported there as standing / standingSql / requireStaffEvidence) · routes/crm.js (POST /parties/:id/contact-prefs)
 * FLOW      rows newest first → standing(rows) → the rows that count → mayMessage / mayAll   ·   the same rule as SQL for the three queries that read the newest row (standingSql)
 * CARD      11-crm-and-marketing/privacy-consent
 */
/**
 * AU Spam Act 2003 s.18 · IN DPDP Act 2023 s.6(4) · GDPR Art.7(3): a person's withdrawal of consent must stand until THEY say yes again; no member of staff can undo it by typing a yes.
 * Same in every country - law is never a switch. A row is customer-sourced when source is 'self' (the shopper's own answer) or 'reply' (a STOP message). A STAFF yes written after the customer's
 * latest own answer, when that answer was a no, does not stand; the customer's own new yes lifts it. A staff no always stands (the safe direction). Every row stays as proof.
 */
const isCustomerSource = (source) => source === 'self' || source === 'reply';
/** the rows that count, from one party's rows newest first (PURE; channel and purpose are judged per pair) */
function standing(rows) {
  const list = rows || [];
  return list.filter((row, i) => {
    if (!row.allowed || isCustomerSource(row.source)) return true;
    const older = list.slice(i + 1).find((o) => o.channel === row.channel && o.purpose === row.purpose && isCustomerSource(o.source));
    return !(older && !older.allowed);
  });
}
/** the same rule as a WHERE condition on party_contact_pref (alias = the table's name or alias in that query); a table with no `source` column yet (b777) reads every row as staff, so nothing is hidden */
const standingSql = (alias) => `NOT (${alias}.allowed AND COALESCE(to_jsonb(${alias})->>'source', 'staff') NOT IN ('self', 'reply') AND COALESCE((SELECT NOT c.allowed FROM party_contact_pref c
    WHERE c.owner_entity_id = ${alias}.owner_entity_id AND c.party_id = ${alias}.party_id AND c.channel = ${alias}.channel AND c.purpose = ${alias}.purpose
      AND to_jsonb(c)->>'source' IN ('self', 'reply') AND c.noted_at < ${alias}.noted_at ORDER BY c.noted_at DESC LIMIT 1), false))`;
const EVIDENCE_WHY = 'To note a yes to offers, say it came from staff (source: staff) and add a note of what the customer said, and when.';
/** staff recording a NEW yes to offers needs evidence: the source said out loud and a note (3+ characters); a no needs neither. Throws the sentence (the caller's bad-request) */
function requireStaffEvidence(sent, fail) {
  const yes = sent && sent.allowed === true && String(sent.purpose || '').toLowerCase() === 'marketing';
  if (yes && (sent.source !== 'staff' || String(sent.note || '').trim().length < 3)) throw fail(EVIDENCE_WHY);
}
module.exports = { standing, standingSql, requireStaffEvidence, isCustomerSource };

# Critique · SEC-130 residual (7 Nov 2026) · written before the code

Full critic: C:/dev/PM/SEC-130-RESIDUAL-PLAN-2026-11-07.md (cb-crm-marketing, read-only). This is its build-time extract.

(a) Assumptions checked against the code
- A party e-mail is written to identities.email (global unique `identities_email_key`): TRUE, lib/local-identity.js keepEmail, lib/party-fields.js saveContact. Two writers, no third (grep).
- The web reads the wire key `email` only and has no consumer of `email_held`: TRUE (grep of web public/ and tests, 0 hits).
- A lead e-mail is already off identities.email (lib/crm-leads.js): TRUE, the precedent for the rule.
- Sign-in cannot reach a minted party since #683 (identity-auth isAccount filter): TRUE, kept as the belt.

(b) Conflicts with rules: none. party_tax_id is the table pattern (FORCE RLS, rls_entity); its value is unique per shop, so it is not reused. A column on customer_list AND supplier_list would be two homes for one fact.

(c) Simpler way: none that closes the oracle at the source. A filter (A and B, landed as #683/#917) hides the symptom; only dropping the global unique for party e-mail removes it.

(d) Risks
- Migration numbers: b839 and b840 are free on origin/main (highest b838) and on every open api PR (highest b833, checked 7 Nov).
- Code deploys before the SQL: every read and write asks schema.hasTable('party_contact') first; absent = nothing written to identities either, reads fall back to identities.email.
- Backfill nulls identities.email of minted parties: dry-run count first, one transaction, reversible from party_contact.
- Other rounds touching the same files: routes/relationships.js and lib/crm.js are shared with RAIL-146 (read only here).

(e) VERDICT: BUILD AS PLANNED (coordinator decisions: keep #917's within-shop 409 as a P2 note; the COALESCE-fallback cleanup PR comes after Athi applies b839, deploy, b840).

# R14 critique - a party's phone and e-mail are kept (2026-10-24)
(a) Assumptions checked
- "PARTY_KEYS has no phone/email, so they are dropped": TRUE, routes/relationships.js:34; hasParty() is false, partyPatch() returns null, PATCH /customers/:id answers 200 with no change.
- "The edit route is unclear" (laptop2): FALSE. The web sends supPatch/custGroup = PATCH /api/relationships/suppliers|customers/:id (cap-books.js:1061); there is one route per side, both call partyPatch -> lib/party-fields.patch.
- "Where phone/email live": identities.otp_contact (phone) and identities.email of the party's own identity. TRUE: lib/local-identity.js addCustomer:355 writes both; the readers lib/crm.js:171,205 read phone || otp_contact and email; lib/crm-leads.js:239 writes otp_contact. No second store needed.
(b) Conflicts
- One phone check: local-identity.phoneOf (the reward engine's holderOf). Reuse, no new regex for phone.
- Ledger lesson 2026-10-18: identities_email_key is a global UNIQUE; a clash must not say who holds the e-mail. Refuse with fixed words only.
- A real ChitBridge business's contact is theirs; only a party this shop minted (handle.isMinted) may be edited.
(c) Simpler way: none; widening party-fields.patch is the smallest change and gives suppliers the same fix.
(d) Risks: no migration (columns exist); supplier route shares the code; unknown-key refusal is limited to PATCH /customers/:id (its body is small and known) so the supplier route, whose callers send many keys, is not broken.
(e) VERDICT: BUILD WITH CHANGES - store in identities.otp_contact / identities.email through party-fields.patch; refuse unknown keys on the customer PATCH in words (400 naming the field).

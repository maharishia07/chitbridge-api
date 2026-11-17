# Record of processing activities (RoPA) — DRAFT, for the owner to sign (OWNER-ACTIONS O7)

UAE PDPL Art.7–8 · DPDP Act 2023 s.8 · Privacy Act 1988 APP 1 · ISO/IEC 27701. One record for the whole platform. Drafted 13 Oct 2026 (CO1)
from `docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md` §1 and the code; not legal advice.

**Who processes what, and where** is NOT copied here: it lives once in chitbridge-api `lib/privacy.js` `FACTS` and is answered by
`GET /api/privacy/facts` (run it; a region the repo does not state says so). Today the database is Supabase on AWS ap-south-1 (Mumbai).

| Activity | Data (where it lives) | Whose data | Our role (IN · AU · AE) | Purpose · lawful basis | Kept for | Shared with |
|---|---|---|---|---|---|---|
| Accounts and sign-in | name, phone, e-mail, sessions (`identities`, `signin_events` b282) | shop owners, staff | fiduciary · APP entity · controller | run the account, security · contract | while the account is open; sign-in log per CO2 | database, API host, e-mail sender |
| Staff identity documents | masked + encrypted ID numbers (`identity_documents` b174) | shop staff | processor for the shop | the shop's HR · consent recorded (`consent_at`) | as the shop decides | database |
| A shop's customers and suppliers | names, phones, tax ids, notes, calls (`customer_list`, `supplier_list`, `party_*` b274/b276) | shops' customers | processor for the shop | the shop's trade · contract / legitimate use | as the shop decides; trade records per CO3 floors | database |
| Contact consent | channel · purpose · yes/no · when · notice version (`party_contact_pref` b306) | shops' customers | processor for the shop | proof of consent (DPDP s.6(10)) | never edited; kept as long as the party | database |
| Privacy requests and grievances | who asked, what, due date, answer (`privacy_request` b307) | anyone | processor (shop's register) · fiduciary (the platform's own) | answering rights in time | never deleted | database |
| Online-store orders and sign-in codes | phone, name, order (`otp_contact`, chits) | consumers | fiduciary for the code we send · processor for the order | deliver the order · contract | as the shop decides | database, e-mail/SMS sender |
| Chits, bills, books | the business record, sender snapshot (`chits`, `journal_*` b273) | businesses; a proprietor is a person | records service provider | the shop's books · legal obligation | statutory floors (CO3) | database; the counterparty's own copy |
| Order updates by WhatsApp | phone, message text (outbound log b126) | shops' customers | processor | tell them about their order · legitimate use | outbound log | Meta |
| AI drafting, speech and form reading | the text or image sent | shops | processor | draft a chit, read a form · the shop's request | not stored by us beyond the result | Anthropic, OpenAI |
| Request logs | IP, user agent, request id (`lib/logger.js`) | everyone | fiduciary · controller | security · legitimate use | host's log retention — CO2 (≥ 1 year, India) | API host |

**Transfers abroad:** all data sits in India. For an Australian or UAE shop that is a transfer abroad (APP 8, PDPL Art.22–23): it must
be in their notice and in the DPA (OWNER-ACTIONS O2, O6).

Signed: ______________________ (owner) · date ____________

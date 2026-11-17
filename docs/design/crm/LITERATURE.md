# CB CRM — the literature baseline (what any CRM does without being told)

**Status:** spec, phase 1. The CRM equivalent of `golden-books`: the checklist any small-business CRM meets — Zoho CRM,
HubSpot (free CRM), Salesforce Essentials (Starter), and Tally's party masters as a shop knows them. Our customisation
comes **on top** of this, never instead of it.

**Marks:** **HAVE** (with the inventory's file:line) · **PARTLY** (what is missing) · **MISSING** · **OUT** (out of scope
for a shop, with the reason). Prefixes as in `INVENTORY.md`: API · WEB · ENG.

| # | Item | What the literature expects | Mark | Where / what is missing |
|---|---|---|---|---|
| **1** | **Contacts** | a person record with name, phone, e-mail, address | **PARTLY** | `identities` holds them; customers WEB custDetailHTML 10411, suppliers supDetailHTML 11143. Missing: more than one contact person per party; address not shown/edited by the shop. |
| **2** | **Organisations (accounts)** | a business record that contacts belong to | **PARTLY** | a party is an identity (entity); `legal_name` b274. Missing: contact people under an organisation (Tally has one contact per ledger; Zoho/HubSpot have many). Decision: phase 3, as named contacts on the party (PLAN.md Q7). |
| **3** | **One record per party, every channel** | one page with all phones, e-mails, addresses, IDs | **PARTLY** | split today: customer and supplier screens (WEB 10379 / 8485); a party on both lists is dropped from customers (API relationships.js:497 — gap 1). Fix: DATA.md §3 gap 1. |
| 3a | Unique party number | Tally ledger alias / Zoho account number | **HAVE** | `party_no` (API party-fields.js ensureNo :56, numberAll :146) — shown only in the ledger block (gap 4). |
| 3b | Tax registration | GSTIN, PAN, state (Tally: mandatory for GST) | **PARTLY** | `party_tax_id` (party-fields.js:94), state_code (b274); edit form takes one id (gap 6); state never shown (gap 5); GSTIN also in identities.gstn (gap 7). |
| 3c | Credit terms | credit days, credit limit (Tally: "maintain balances bill-by-bill", credit period) | **PARTLY** | b274 credit_days / credit_limit_minor; shown only with the Ledger on (gap 4); limit not enforced anywhere. |
| **4** | **Activity timeline** | everything that happened with the party, newest first | **MISSING** | pieces exist but no per-party view: chits (lib/select.js counterparties), disputes (cap-dispute.js:245, by dispute), messages (cap-messages.js:182, by chit), scorecard API with no screen (gap 2). |
| **5** | **Notes** | free-text notes on the record, dated, by whom | **PARTLY** | `supplier_list.notes` (one text field, suppliers only). Customers have none. |
| **6** | **Tasks / follow-ups / reminders** | "call Ravi on Friday", due dates, assignee, overdue list | **MISSING** | nothing per party. (Chit "due" is per chit; Dues ageing exists — `/api/books/dues` buckets.) |
| **7** | **E-mail from inside the record** | standard compose: To · Cc · Bcc · Subject · body · attachments · templates · signature · send / schedule; thread kept on the record | **MISSING** | compose exists for **chits** (WEB app.html compose :6738 — no body, no Bcc, no templates/signature/schedule); Resend sends system mail (API lib/notify.js:77). MESSAGING.md §3. |
| **8** | **Interactions log** | calls, visits, messages, mails logged against the party | **PARTLY** | chit messages are logged per chit (API chits.js:3548, routes/folders.js:454); calls / visits / WhatsApp: nothing. |
| **9** | **Segments and tags** | lists by rule (segment) and by hand (tag) | **PARTLY** | customers: computed segment (customer-groups.js:18) + named groups (b205, relationships.js:614); `high_value` never computed (gap 3); suppliers: category / preferred only; no tag on a supplier. |
| **10** | **Duplicates and merge** | find duplicates (same phone / GSTIN / name), merge keeping history | **PARTLY** | `merged_into` column (b274) with no UI and no reader (gap 5); duplicate GSTIN refused with 409 DUPLICATE_PARTY (party-fields.js:89-92). Missing: finder, merge flow, readers honouring it. |
| **11** | **Import / export** | CSV import with column mapping and preview; CSV / vCard export | **MISSING** | none for parties (CSV exists for products, routes/products.js:778/827/875; `added_via='import'` allowed but never written). |
| **12** | **Consent and contact preferences** | per channel opt-in / opt-out, purpose, when given, withdrawal — **DPDP Act 2023** (India): notice, consent for a specified purpose, right to withdraw as easily as given, erasure when the purpose ends, a grievance contact | **MISSING** | none (only `identity_documents.consent_at`, and the network-offers policy). Lists are explicitly no-consent (relationships.js:34, D-056). DATA.md §5 `party_contact_pref`. |
| **13** | **Owner / assignment** | each record has an owner; records can be reassigned | **MISSING** | the shop owns all; co-assists see what they are assigned on chits only. Decision: assignment on follow-ups only (DATA.md §5; PLAN.md Q5). |
| **14** | **Search and saved views** | search any field; save a filter as a view | **PARTLY** | list-ctl.js search / filter / sort on customers and suppliers (WEB list-ctl.js:73). Missing: one search across both, saved views. |
| **15** | **Reports** | new parties, activity, top parties, dues | **PARTLY** | dues: `/api/books/dues` + bkDues (cap-books.js:865); top / activity: scorecard API only; new parties: `customer_since`, `created_at` exist, no report. |
| 15a | Statement of account per party | Tally / Zoho Books standard | **HAVE** | `/api/books/party/:id/statement`, partyStatementLoad (cap-books.js:181) — Ledger on only. |
| 15b | Ageing | 0-30 / 31-60 / 61-90 / 90+ | **HAVE** | `/api/books/dues` buckets, ENG ledger.ageing. |
| **16** | **Loyalty / points** | (retail CRM) points balance and history | **HAVE** | reward_ledger (reward-store.js:46), custRewardsLoad 10464; walk-ins by phone; claim (rewards.js:327). |
| **17** | **Bulk actions** | select many → tag, export, mail, delete | **MISSING** | Task has select mode (`UI.selectMode`, app.html colTemplate 16772); the party lists do not. |
| **18** | **Audit of changes** | who changed what on the record | **PARTLY** | `books_change_log` (books-store.js:345) written, shown only in the handover pack. |
| **19** | **Mobile use** | the record and logging a call work on a phone | **PARTLY** | two-pane screens collapse on mobile (custDetail `UI.vp==='mob'`); no call logging. |
| **20** | **Permissions** | who may see / edit / export parties | **PARTLY** | owner vs co-assist hats (API lib/access.js); export / merge / import must be owner-only (new). |
| **21** | **Sales pipeline / deals / stages** | opportunities with stages and forecast | **OUT** | A shop's "deal" is an order; it is already a chit with steps (Task/Order, Bills folder). A second pipeline would be a second status for the same sale. A shop that quotes (a service shop) uses a draft chit. Revisit only if Athi names a quoting shop. |
| **22** | **Leads and lead scoring** | unqualified prospects, scores | **OUT** | Every party in a shop has bought or sold; a "lead" is a party with no bill yet (segment `new`). No scoring model. |
| **23** | **Marketing campaigns / sequences** | drip e-mails, campaign analytics | **OUT** (phase 1) | Offers ("Only for" a segment/group, cap-definitions.js:949) are the shop's campaign. Bulk mail to a segment is phase 3, consent-gated. |
| **24** | **Quotes / invoices inside CRM** | | **OUT** | Those are chits and the Ledger — linked from the record, not rebuilt. |
| **25** | **Web forms / chat widgets** | capture leads from a website | **OUT** | The storefront already adds customers (catalogue.js:1219). |
| **26** | **Territories, forecasting, products on the deal** | | **OUT** | Enterprise; not a shop's need. |

**Count:** HAVE 4 (3a, 15a, 15b, 16) · PARTLY 14 · MISSING 7 (4, 6, 7, 11, 12, 13, 17) · OUT 6.

## What "good" means for us on top of the literature
- **The other side can be on ChitBridge.** No CRM above knows whether the contact can receive a two-sided bill or a
  chit; ours does (BRIDGE.md). That is the customisation.
- **One record across both roles**, and the Ledger's balance on it, because the shop's customer and supplier are often
  the same trader (gap 1).
- **The literature is the floor:** a CRM screen that lacks an item marked HAVE or PARTLY above is a regression; each
  MISSING item is either in PLAN.md's phases or marked OUT here.

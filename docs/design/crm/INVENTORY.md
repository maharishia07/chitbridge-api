# CRM — what ChitBridge already holds and shows about a shop's parties (inventory, 2026-10-02)

Read-only survey of all three repos, made before any CRM design so the CRM is built from what exists (CLAUDE.md rules 1–5).
Prefixes: API = chitbridge-api, WEB = chitbridge-web/public, ENG = chitbridge-engines/src. Line numbers are as of 2026-10-02.

## 1 · Data
| Store.column | Written | Read |
|---|---|---|
| **customer_list** (baseline :511): customer_list_id, owner_entity_id, customer_identity_id, customer_type (entity/end_customer), segment_override (high_value/regular/new/inactive), added_via (transaction/manual/import/catalogue/system), txn_count, last_txn_at, created_at | auto-add on a sent bill `routes/chits.js:1471`; seller row for an order :1489; storefront order `routes/catalogue.js:1219`; manual `routes/relationships.js:587`; root link `lib/rootlink.js:113`; segment override `relationships.js:637` | `GET /customers` relationships.js:487; till snapshot `routes/till.js:206`; counter gate chits.js:119; `lib/customer-groups.js:28` |
| customer_list.groups text[] (b205) | relationships.js:614 | customer-groups.js; till snapshot |
| **supplier_list** (baseline :750): supplier_list_id, owner_entity_id, supplier_entity_id, category, added_via, created_at, nickname, preferred, notes; supply_kind resale/own_use (b216) | add relationships.js:126,155; patch :286; delete :308; rootlink :124 | `GET /suppliers` :182; availability :357; routes/adopt.js:99 |
| **b274 party fields** on both lists: legal_name, party_no, credit_days, credit_limit_minor, state_code, merged_into (+ nickname on customers) | `lib/party-fields.js` patch :83; party_no via ensureNo :56 (now also on add) and numberAll :146 | party-fields.decorate :114; books-store terms :358 / parties :362; till snapshot |
| **party_tax_id** (owner, party, scheme, value) | party-fields.js:94 | decorate :118 |
| **identities** (the party itself): display_name, bridge_id, user_id, email, phone, otp_contact, gstn, country, currency_code, address, logo_url, is_verified, status, identity_type, owner_scope, parent_entity_id, business_status, entity_kind (b225), population (b249), is_test, city/lat/lng (b119) | storefront customer catalogue.js:759,858; minted local supplier `lib/local-identity.js:111` (`~owner.sup-NNNN`) | customers relationships.js:489; suppliers :186 (gstn/policy_flags → `facts`) |
| Segment (computed): SEGMENT_SQL | — | customer-groups.js:18 |
| **reward_ledger** (b213): holder = identity or phone | lib/reward-store.js:46 | `GET /customers/:id/rewards`; `GET /till/reward` |
| **party_item** (b273): receivable/payable documents, due date, status (disputed…) | books-store.js:182 | `/books/dues`; decorate; till snapshot |
| **books_change_log** (b273) | books-store.js:345 from party-fields | only the handover pack |
| Offer "Only for" a segment / group / customer | WEB app/cap-definitions.js:949 | customer-groups.offersFor; offers-engine; supplier `for_you` |
| Chit history per party | chit_status / chit_header (lib/select.js) | select.counterparties; `/scorecard` |
| Disputes | dispute_participants (own display_name copy) | chits.js:3894,4099 |
| Messages | per chit | routes/folders.js:454, chits.js:3692 |
| Adoption | catalogue_adoption (by source, not supplier) | adopt.js, till |
| Local purchases | supply_item.last_from — FREE TEXT | lib/supply-store.js |

## 2 · APIs (`/api/relationships` unless stated)
POST/GET/PATCH/DELETE `/suppliers` · `/suppliers/availability` · `/suppliers/:sid/catalogue` · GET `/customers/groups` ·
GET/POST `/customers` · `/customers/:id/rewards` · POST `/customers/:id/groups` · PATCH `/customers/:id` · GET `/scorecard`,
`/scorecard/:entity_id` · `/api/books/party/:id/statement` · `/api/books/dues` · POST `/api/books/parties/:id/dispute` ·
`/api/till/snapshot` (customers) · `/api/till/reward`. Engines: ledger.partyStatement, ledger.ageing, receivables.outstanding.

## 3 · Screens (WEB app.html unless stated)
customersScreen/custCtl 10379 · custRowHTML 10393 · selectCust/custDetailHTML 10411 · custNamedGroupsHTML 10451 ·
custRewardsLoad 10464 · suppliersScreen/supRowHTML 8485/8625 · supInfoCardHTML 8659 · supSlideHTML 8762 ·
supDetailHTML/viewSupplierPassport/supFindRun 11143/11083/8808 · cap-books.js partyDueChipHTML 144, partyBooksHTML 157,
partyStatementLoad 181, partyEditOpen 263, bkDues/bkDuesTable 865/847 · cap-definitions.js cbDefPickCustomerHTML 931 ·
cap-dispute.js disputesScreen 245 · cap-messages.js messagesScreen 182 (by chit, not by party) · cap-supplies.js supRecordDelivery 241.

## 4 · Gaps found
1. A party who is ALSO a supplier is dropped from the customer list (relationships.js:497) — its txn_count stops, it cannot be grouped, picked for an offer or shown rewards; Dues nets it as both.
2. The scorecard has an API and no screen; no per-party history of chits, orders, disputes, messages.
3. `high_value` is never computed — only by manual override.
4. Party fields (party_no, legal name, credit, tax ids) show only inside the ledger block, hidden when the ledger is off — yet every party is numbered.
5. Never shown: state_code; merged_into (no UI, no reader honours it); customer_type / identity_type / owner_scope / on_rail; books_change_log; supplier rewards.
6. The edit form takes one tax id; the server takes many.
7. The same fact stored twice: GSTIN (identities.gstn vs party_tax_id); phone (phone vs otp_contact); nickname per list; credit terms per list; dispute names copied; supplier as free text in supply_item.last_from; customer kind across customer_type / identity_type / entity_kind.
8. Customers and suppliers treated differently: local minting exists for suppliers only (`cus` declared in lib/handle.js:331, no path); walk-ins exist only as phone holders in reward_ledger; groups/segments/points for customers vs preferred/category/notes/supply_kind for suppliers; supplier add takes a name, customer add needs a handle.
Docs: `C:\dev\SPEC-books-v2.md` §1/§4 ("party ≠ a new table"). No CRM spec exists.

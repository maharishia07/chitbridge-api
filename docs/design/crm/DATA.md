# CB CRM — one record per party (DATA)

**Status:** spec, phase 1. Nothing here is built. Source: `INVENTORY.md` (file:line as of 2026-10-02) plus a read of
chitbridge-api `main` @ 33da275 (where a line has moved since the inventory, the current line is given as "now :n").
Prefixes as in the inventory: API = chitbridge-api, WEB = chitbridge-web/public.

> **Party ≠ a new table** (`SPEC-books-v2.md` §1). The CRM's party record is a **read model assembled from what
> exists**. It adds no `parties` table, no copy of a name, no second phone. CLAUDE.md rule 3: fill the slot that
> exists; a new key only with its dictionary entry in the same change.

---

## 1 · The key

**A party is `(owner_entity_id, party_id)`**, where `party_id` is the **identity id** of the other side —
`customer_list.customer_identity_id` or `supplier_list.supplier_entity_id`. Both lists already key on the identity, so
the same person on both lists has the **same `party_id`**. This is the key the Ledger already uses
(`party_item`, `party_tax_id`, `/api/books/party/:id/statement`, `/api/books/dues` all take `party_id`), so the CRM
record and the Ledger agree by construction.

`party_no` (b274, `lib/party-fields.js` ensureNo :56) is what the shop **sees and types** (`P-0007`); it is a display
number, never the key.

## 2 · The record — where every field comes from

One record = the union below, read in one call (see §4). Nothing is copied.

| Record part | Field(s) | Source (store.column) | Writer today | Shown today |
|---|---|---|---|---|
| **Who** | display_name, logo_url, city | `identities` | the party itself (on ChitBridge) · `lib/local-identity.js:111` (local supplier) | custDetailHTML 10412 · supDetailHTML 11141 |
| | legal_name, nickname | `customer_list` / `supplier_list` (b274; nickname per list) | `party-fields.patch` :83 | ledger block only (partyBooksHTML, cap-books.js:157) |
| | party_no | both lists (b274) | `party-fields.ensureNo` :56, `numberAll` :146 | ledger block only |
| **ChitBridge** | bridge_id, user_id, on_rail, is_test/population, is_verified, status | `identities` | identity owner | user_id in the customer detail; on_rail computed in `GET /suppliers` (now :167) |
| **Roles** | customer? supplier? | row exists in `customer_list` / `supplier_list` | relationships.js add routes | two separate screens |
| **Channels** | phone, email, otp_contact, address | `identities` | the party / storefront signup `catalogue.js:759,858` | customer detail |
| **Tax** | tax_ids `[{scheme,value}]`, state_code | `party_tax_id` · both lists (b274) | `party-fields.patch` :94 | ledger block (one tax id in the form) |
| | gstn | `identities.gstn` | the party itself | supplier `facts` |
| **Terms** | credit_days, credit_limit_minor | both lists (b274) | party-fields.patch | ledger block |
| **Customer side** | customer_type, added_via, txn_count, last_txn_at, segment, groups[] | `customer_list` + `SEGMENT_SQL` (`customer-groups.js:18`) | chits.js:1471, catalogue.js:1219, relationships.js add/groups/patch | customer list + detail |
| **Supplier side** | category, preferred, notes, supply_kind, added_via | `supplier_list` | relationships.js POST/PATCH | supplier detail |
| **Money** | balance_minor, oldest_due, buckets, disputed_minor | `party_item` via `books-store.parties` / `/api/books/dues` | the Ledger (books-store.js:182) | partyDueChipHTML cap-books.js:144, Dues |
| | statement | `ledger.partyStatement` via `/api/books/party/:id/statement` | the Ledger | partyStatementLoad cap-books.js:181 |
| **Points** | balance, programme | `reward_ledger` (holder identity or phone) | `reward-store.js:46` | custRewardsLoad 10464 |
| **History** | chits, last_at, relationship, completion | `chit_header` / `chit_status` via `select.counterparties` + `measure` (`/scorecard/:id`) | the rail | **no screen** (gap 2) |
| | disputes | dispute copies (frozen roster) | chits.js raise (now ~:3790) | disputesScreen (cap-dispute.js:245), by dispute |
| | messages | per chit (see MESSAGING.md) | folders.js:454, chits.js:3692 | messagesScreen, by chit |
| **Audit** | changes | `books_change_log` | party-fields → books-store.js:345 | handover pack only |

## 3 · The decision for each inventory gap

| # | Gap (INVENTORY §4) | Decision |
|---|---|---|
| 1 | A party who is also a supplier is dropped from `GET /customers` (`NOT EXISTS supplier_list`, relationships.js:497, now :477-480). | **One party, two roles.** Remove the filter for the CRM read; the CRM list shows the party once with both role chips. `GET /customers` keeps its current answer only if a caller depends on it (check `till.js:206` snapshot and the counter gate chits.js:119 before changing it — the CRM read is a new route, §4, so the old route need not change at all). txn_count, groups, offers and rewards then work for a both-sides party because the CRM reads `customer_list` directly. Dues already returns `side: 'both'` (books.js:295-332) — the CRM shows that one netted balance, never two. |
| 2 | Scorecard has an API and no screen; no per-party history. | **The party record's Timeline** (REQUIREMENT-timeline.md) reads `/scorecard/:entity_id` for the relationship line (first · last · sent · received · completion %) and a new per-party chit list (§4, `GET /api/crm/parties/:id/timeline`) built on `select.counterparties`' query filtered to one party. No new table. |
| 3 | `high_value` is never computed. | **Compute it in `SEGMENT_SQL`** (one place, customer-groups.js:18) from a shop setting: top N % by 12-month billed value (default **top 10 %**, min 3 bills). Override still wins. Value comes from `party_item` receivables (the Ledger's number), never a second sum. The setting lives in CRM settings (REQUIREMENT-settings.md). Needs Athi's yes on the rule (PLAN.md Q3). |
| 4 | Party fields show only inside the ledger block. | **Party fields belong to the record, not the Ledger.** The record's "Who / Tax / Terms" section shows party_no, legal name, tax ids, state, credit terms whether the Ledger is on or off. Balance and statement stay Ledger-only (they need `party_item`). Edit reuses `partyEditOpen` (cap-books.js:263), moved out of the ledger-only block — not copied. |
| 5 | Never shown: state_code, merged_into, customer_type/identity_type/owner_scope/on_rail, books_change_log, supplier rewards. | state_code → Tax section (it decides place of supply, `tax-engine.supplyType`). on_rail → the ChitBridge chip (BRIDGE.md). customer_type/identity_type/owner_scope/entity_kind → **one derived "kind"** (gap 7). books_change_log → the record's **History of changes** (owner only). merged_into → the merge flow (gap below + REQUIREMENT-merge.md). Supplier rewards: **out of scope** — points are a customer programme; a supplier who is also a customer shows their customer points. |
| 6 | The edit form takes one tax id; the server takes many. | The edit form takes **a list** of `{scheme, value}` from the server's schemes (`party-fields.js:26`: GSTIN, PAN, TAN, TRN, VAT, TIN, CIN, UDYAM). Widen `partyEditOpen`, do not fork it. Duplicate → server's 409 `DUPLICATE_PARTY` (party-fields.js:89-92) shown as "This GSTIN is already on P-0012 Agro Mills — open it or merge" with both buttons. |
| 7 | The same fact stored twice. | Per fact, **one reader rule** (no data moves in phase 1): **GSTIN** — `party_tax_id` (scheme GSTIN) is the shop's word and wins; `identities.gstn` is the party's own claim and shows only when the shop has none, marked "from their profile"; if both exist and differ, the record shows one amber row "GSTIN differs from their profile" with **Use theirs** / **Keep mine**. **Phone** — `identities.phone` is the contact phone; `otp_contact` is a sign-in target and is shown only when phone is empty. **Nickname** — one per party: the customer-list nickname wins, else the supplier-list nickname (a both-sides party edited in the CRM writes both, one PATCH each, through party-fields). **Credit terms** — per role (a customer's terms and a supplier's terms are genuinely different facts — what I give vs what I get); shown under each role. **Dispute names** — the frozen roster stays (it is evidence of who was named at the time); the record shows the live name. **Supplier as free text** (`supply_item.last_from`) — the record does not read it; the Supplies flow should pick a party (out of CRM scope, PLAN.md follow-up). **Kind** — derived: `local` (minted handle) · `walk-in` (phone holder only) · `person` (`entity_kind='shopper'` / customer_type end_customer) · `business` (else). |
| 8 | Customers and suppliers treated differently. | **One add, one mint.** Add-by-name for a customer uses the **same** `lib/local-identity.mint` with `kind:'cus'` (handle.js:333 already declares it) — widen mint to set `entity_kind` from kind (today it hard-codes `'supplier'`, local-identity.js:110-114); no second path. Add-by-handle stays for both. Walk-ins (phone-only reward holders) appear in the CRM list as **walk-in** rows read from `reward_ledger` holders with scheme `phone` not yet claimed; **Add to my parties** mints a local `cus` identity and runs the existing `rewards.claim` (rewards.js:327) to move the points. Groups/segments stay customer-side; preferred/category/supply_kind stay supplier-side; **notes** become party-level (see §5). |

## 4 · The read — one route, many sources

New: `GET /api/crm/parties` (list) and `GET /api/crm/parties/:party_id` (record). They **assemble**, they do not store:

- list = `customer_list ∪ supplier_list` on `party_id`, joined to `identities`, decorated by `party-fields.decorate`
  (:109-143, already adds balance/oldest_due when the Ledger is on), plus `SEGMENT_SQL`. Excludes rows whose
  `merged_into` is set (gap 5 — the first reader that honours it). One query; no per-row fetch.
- record = the list row + `/scorecard/:id` fields + reward balance (reward-store) + tax ids + follow-ups (§5).
- timeline = `GET /api/crm/parties/:party_id/timeline?before=` — chits (with their messages' latest line), disputes,
  interactions, follow-ups, changes, bills/receipts from `party_item`, newest first, server-paged (it can be long).

Why a new route and not widening `GET /customers`: the old route has callers with a fixed contract (till snapshot,
counter gate, offers picker `cbDefPickCustomerHTML`); the CRM's answer is a different shape (both roles in one row). Rule
3: a new key with a new shape, not a different shape under an old key.

## 5 · New storage — only where unavoidable

| Name | Why nothing existing serves | Columns | Migration |
|---|---|---|---|
| **`party_interaction`** (b276) | A call, a visit, a WhatsApp, a note is not a chit (no counterparty consent, no rail) and has nowhere to live. Chit messages are per chit and two-sided. | interaction_id uuid · owner_entity_id · party_id · kind (`call`·`visit`·`message`·`mail`·`note`) · direction (`in`·`out`·null) · body text · at timestamptz · by_user_id · mail_id (nullable, §MESSAGING) · created_at | **yes** |
| **`party_followup`** (b276) | No reminder exists against a party. The chit "due" is per chit. | followup_id · owner_entity_id · party_id · what text · due_at · assignee_user_id · done_at · done_by · source (`manual`·`dues`·`interaction`) · created_at | **yes** |
| **`party_contact_pref`** (b277) | DPDP consent and "do not message" have no home (inventory: none; relationships.js:34 lists are no-consent). | owner_entity_id · party_id · channel (`phone`·`sms`·`whatsapp`·`email`·`chitbridge`) · allowed bool · purpose (`service`·`marketing`) · basis (`consent`·`legitimate_use`) · noted_at · noted_by · withdrawn_at | **yes** |
| **`party_mail`** (b278, only if mail is approved — PLAN.md Q1) | An outbound e-mail has no store. | mail_id · owner_entity_id · party_id · to/cc/bcc text[] · subject · body · attachment refs · status (`queued`·`sent`·`failed`·`bounced`) · provider_id · scheduled_at · sent_at · in_reply_to · created_by | **yes** |
| Shop settings key `crm` | high_value rule, follow-up defaults, mail from-address, signature, templates | in the existing shop settings JSON (`business_json` or the settings store the app already PATCHes — confirm the slot with docs/FIELDS.md before adding) | no |

**Notes:** `supplier_list.notes` exists; a customer has none. Rather than add `customer_list.notes`, a note is a
`party_interaction` of kind `note` (one place for both roles); existing `supplier_list.notes` text is shown as the
first, pinned note and kept writable where it is until a later cleanup. **Owner / assignment:** an `owner_user_id` on
both lists is **not** proposed in phase 1 — the shop's co-assists are few; assignment lives on follow-ups (PLAN.md Q5).

All tables carry `owner_entity_id` and RLS like `party_item`. Athi runs the SQL; every route answers a plain
"needs migration bNNN" (409, like party-fields.js:81) until it has run, never a 500.

## 6 · Dictionary entries (rule 3) — for docs/FIELDS.md when built

| Key | Number | Source/derived | Written by | Read by |
|---|---|---|---|---|
| `party.kind` | — | derived (handle minted · phone holder · entity_kind · customer_type) | nobody | CRM list, record |
| `party.roles` | — | derived (row exists on each list) | nobody | CRM list, record |
| `party.on_chitbridge` | — | derived (`local-identity.onRail`) | nobody | CRM, BRIDGE.md |
| `party_interaction.*` | b276 | source | CRM log, mail send | timeline |
| `party_followup.*` | b276 | source | CRM, Dues "remind" | follow-ups, home |
| `party_contact_pref.*` | b277 | source | record, import | compose, offers send, export |
| `party_mail.*` | b278 | source | mail sender | timeline, compose |
| `settings.crm.high_value_pct` | — | source | CRM settings | `SEGMENT_SQL` |

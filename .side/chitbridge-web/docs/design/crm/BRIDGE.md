# CB CRM — how ChitBridge identity is integrated (BRIDGE)

**Status:** spec, phase 1. Nothing here is built. API = chitbridge-api `main` @ 33da275.

## 1 · Four names for one party, and what each is for

| Name | Example | Owned by | Scope | Where |
|---|---|---|---|---|
| **party_id** | uuid | — (the identity's id) | the key; never shown | `customer_list.customer_identity_id`, `supplier_list.supplier_entity_id` |
| **party_no** | `P-0007` | **the shop** | this shop only; what the shop types and prints | b274, `lib/party-fields.js` ensureNo :56 |
| **user_id** (handle) | `chola-ravi` · `~shop.sup-0003` | the party (or the shop, for a minted one) | platform-wide | `identities.user_id`, grammar `lib/handle.js` |
| **bridge_id** | `CB7K3QX9PA` | the platform | platform-wide, never reused | `identities.bridge_id`, `lib/bridgeid.js:27-34` (`CB` + 8 chars) |

A **minted** handle starts with `~` (`~<owner>.sup-NNNN`, `handle.isMinted` :353; kinds `sup`, `cus` at :333). A minted
identity has a bridge_id too (local-identity.js:110-114) but **no sign-in** (no email, no password): it exists only
under its shop.

## 2 · On ChitBridge or not — the one test

> ⚠️ The task named `lib/istest` **mayTrade**. It does not exist (no match in either repo; istest.js exports `ready`,
> `where`, `atRegistration`). The test is today spread over three places. The CRM must not add a fourth.

A party is **on ChitBridge** for this shop when all hold:
1. **On the rail** — `lib/local-identity.js` `onRail(row)` :137 / `onRailSql` :146-149: `identity_type='entity'`,
   `status='active'`, handle not minted, `entity_kind <> 'shopper'`.
2. **Same population** — a DB trigger, `chit_populations_must_match` (b247 :67-99, redefined b249 ~:205-225): a test
   shop and a production shop can never exchange a chit. Surfaced as 409 via `lib/knownerr.js` (chits.js:1642-1645).
3. **Active** — covered by 1.

**Decision:** wrap 1 + 2 in **one** function, `lib/local-identity.mayTrade(owner, party)` → `{ ok, why }` with `why` one
of `local` · `inactive` · `shopper` · `other_population`, and make `routes/chits.js:98-115` `tillMaySend`, `routes/till.js:213`
and the new CRM read call it (widen, don't copy — CLAUDE.md rule 2). The trigger stays as the last guard. The CRM shows
the result as one chip; it never decides it in the browser.

## 3 · What being on ChitBridge unlocks (per party)

| Capability | On ChitBridge | Local (minted) | Walk-in (phone only) | Route that already does it |
|---|---|---|---|---|
| Bills | **two-sided** — they receive it in Task, accept / dispute / pay; steps per Bills-folder rules | **one-sided** — the bill is mine only; printed / shared as PDF | counter bill, closed at issue | `POST /api/chits/send`; Bills folder REQUIREMENT |
| Chits (orders, tasks) | yes | no | no | `POST /api/chits/send` |
| Messages | chit threads, external + internal | **internal notes only** + phone / mail (MESSAGING.md) | none | `POST /api/chits/:id/messages` |
| Catalogue / adoption | see their catalogue, adopt | no | no | `/suppliers/:sid/catalogue`, adopt.js |
| Offers "for you" | delivered to them | the shop can still price for them at the counter | at the counter | customer-groups.offersFor, offers-engine |
| Rewards | holder = identity | holder = identity (minted) | holder = phone; claim moves them | reward-store.js:46, rewards.claim :327 |
| Disputes | two-sided thread | not possible (nobody to answer) — a note instead | no | chits.js disputes |
| Statement | can be **sent** as a chit | printed / mailed PDF | — | `/api/books/party/:id/statement` |
| Scorecard / history | full | bills and notes only | points only | `/scorecard/:id` |

The party record shows these as what the party **can** do, not as a feature list: a local party's Message button reads
"Call" / "Mail" instead of "Message", and the screen says once, "Not on ChitBridge — bills are yours only. Invite them".

## 4 · Adding a party

- **By handle** (user_id, bridge_id or email) → existing resolve: suppliers relationships.js:128-131
  (`bridge_id OR lower(user_id) OR lower(email)`), customers :549-577. Search-as-you-type uses
  `GET /api/entities/search?q=` (entities.js:521 — already excludes `~` handles, sealed and internal). Do **not** use
  `/api/entities/lookup` for this: it does not exclude `~` handles (entities.js:1088-1104).
- **By name** → `lib/local-identity.mint(owner, name, { kind })` for **both** roles (DATA.md gap 8). Same find-first rule
  (:86-90): the same name under the same shop returns the same identity, so adding "Ravi Traders" as a customer after
  adding it as a supplier gives **one party, two roles**.
- Before minting, the add screen searches ChitBridge by the name and offers matches first ("Is this them?") so a party
  that *is* on ChitBridge is not minted as local by accident.

## 5 · Linking a local party when it later joins ChitBridge

Today there is **no link path** — local-identity.js:35-38 says "never migrate offline to on-line… not now", with the
future shape "debit the older one and credit the new one". The CRM needs one, because the shop's history must survive.

**Decision (needs Athi's yes, PLAN.md Q2): link, don't move.**
1. The shop opens the local party → **Link to ChitBridge** → finds them by handle (search above).
2. Server: the on-rail identity is added to the same list(s) with the local row's party fields copied **once**
   (party_no, legal_name, credit terms, tax ids, groups, notes); the local row gets `merged_into = <on-rail party_id>`
   (b274 column, today unread — this makes it the first honoured use). One `books_change_log` row per field.
3. **The Ledger:** per the comment's intended shape, a transfer entry moves the open balance — Dr new party / Cr old
   party (or the reverse) — through the existing journal (`books-store`), dated the link date. Old documents stay on
   the old party; the record shows both statements as one, with a "linked on" divider. Nothing is rewritten.
4. **Points:** `rewards.claim`-style two-entry move from the old holder to the new one.
5. **Reads:** every CRM read follows `merged_into` (a merged row never appears in the list; opening its id opens the
   survivor). Dues and books-store.parties (:363-375) must learn the same rule — **API work, PLAN.md phase 2**.
6. A link is undoable by the owner within the same month lock period (reverse entry; `merged_into` cleared).

The same mechanism is the **merge** of two duplicates (REQUIREMENT-merge.md): merge = link where both sides happen to
be under this shop.

## 6 · What the CRM must never do

- Show another shop's view of a party (all reads are `owner_entity_id`-scoped; customers are "locked under your shop").
- Decide on-rail in the browser, or treat a minted handle as on ChitBridge.
- Let a test shop see or add a production party (population rule).
- Expose `bridge_id` of a minted party as if it could be used to send to them.

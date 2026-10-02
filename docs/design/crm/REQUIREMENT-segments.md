# Requirement — segments & groups

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Data: `lib/customer-groups.js`
(SEGMENT_SQL :18, groups :23-24), DATA.md gap 3. Flow: FLOWS.md F12.

## 1 · Purpose
See how the shop's parties divide — computed **segments** (new, regular, high value, inactive) and the shop's own
named **groups** — and which offers reach each, so a group can be built once and used for offers, mail and follow-ups.

## 2 · Who
Owner: everything. Co-assist editor: add/remove members; cannot rename/delete groups or change the high-value rule.

## 3 · Where it sits
CB CRM sidebar **Segments & groups**. Also reachable from CRM home's Segment / Group filter ("Manage groups").

## 4 · What it shows
- **Segments** (computed, customers only): New · Regular · High value · Inactive — each with its count and its rule in
  one line ("3+ bills" · "top 10 % by 12-month value" · "no bill in 90 days" · "the rest"), plus overrides (n).
  Rule numbers come from the server (`settings.crm`), never typed into the page.
- **Groups** (named, b205 `customer_list.groups`): name · members (n) · offers that target it (n, from
  cap-definitions "Only for", cap-definitions.js:949).
- **Supplier tags**: Preferred (n) · by category — read-only here (edited on the record).
- The list is the Task table; a row's next level (its members) opens the way Task's group sum does (`gsToggle`);
  a member opens the party record.

## 5 · What it does
| Action | Route |
|---|---|
| New group | name (≤ 40 chars, ≤ 20 groups — server limits) → added when the first member is placed (`POST /customers/:id/groups`) |
| Rename / delete group (owner) | `PUT /api/crm/groups/:name` / `DELETE` (new; rewrites `groups[]` on each member server-side) |
| Add / remove members | bulk from CRM home select mode, or here: `POST /customers/:id/groups` per member (server batch route new, PLAN.md) |
| Override a segment | from the record (`PATCH /customers/:id {segment_override}`) |
| Change the high-value rule (owner) | CRM settings |
| Use a segment / group | buttons: **Make an offer** (offer lab "Only for" prefilled) · **Mail** (phase 3, consent-gated) · **Export** |

## 6 · States
- **No groups yet:** "No groups yet. Name one to offer or mail a set of customers together." + **New group**.
- **Migration b205 not run:** owner: "Named groups need one database step (b205)." (the existing message,
  custNamedGroupsHTML) ; others: nothing.
- **A both-roles party:** counted in segments (gap 1 fixed) — no special state.
- **One-sided / not on ChitBridge parties:** included; an offer to a group reaches on-ChitBridge members in the app and
  others at the counter — the offer row says "n reach them in the app · m at the counter".
- **Loading / error:** existing row; "Couldn't load groups. Try again." + **Try again**.
- **Delete a group used by a live offer:** confirm says "1 offer is only for this group. It will reach no one." +
  **Delete anyway** / **Keep**.

## 7 · Phone
Segment tiles become one card each (name, count, rule line); groups one card each; members open below the card (group
sum). `scrollWidth === 390`.

## 8 · Words on screen
"Segments" · "Groups" · "New" · "Regular" · "High value" · "Inactive" · "New group" · "Make an offer" · "members" ·
"n reach them in the app · m at the counter".

## 9 · Data it reads
`GET /api/crm/segments` (new) → `{ segments:[{ key, count, rule_text, overrides }], groups:[{ name, members, offers }],
supplier:{ preferred, categories:[{name,count}] } }`; members from the CRM list in memory (filtered by group).
`GET /customers/groups` (existing) for names.

## 10 · Must NOT
- Compute a segment in the page (SEGMENT_SQL is the one rule).
- Introduce tags on a second store — groups are `customer_list.groups`; supplier "tags" are category/preferred.
- Send mail to a segment without the consent check (phase 3).

## For the designer
**Standard:** SYSTEM.md (rule 11: each tile carries its live number); the Task table and group sum. **Design:** the
segment tiles with their rule line; the group rows with members/offers counts; the member expansion; the bulk-add
path from CRM home's select mode.

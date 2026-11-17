# Requirement — the party record

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Flows: FLOWS.md F3–F8, F11.
Data: DATA.md §2–§4; identity: BRIDGE.md.

## 1 · Purpose
Everything the shop knows about one party, on one page: who they are, how to reach them, what is owed, what is next,
and what happened — with the button for each next step.

## 2 · Who
Owner (all) · co-assist editor (all but Merge / Link / Remove / History of changes) · viewer (read only).

## 3 · Where it sits
The detail pane of CRM home (second pane; mobile: full screen with "‹ Parties"). Deep link
`crm.html#/party/<party_no>`. Opened also from Dues, the chit sheet's counterparty name, and the app search.

## 4 · What it shows (sections, top to bottom)
1. **Header** — name (nickname wins; legal name under it if different) · `party_no` · role chips · ChitBridge chip
   (On ChitBridge · Local · Walk-in, with `why_not` in words when off: "Not on ChitBridge" / "Account inactive" /
   "Test space") · dues chip (`partyDueChipHTML`) · segment.
2. **Next** — only failing or due things (SYSTEM rule 1): follow-up due/overdue (with **Done**) · unread messages (n,
   **Open**) · overdue dues (oldest due date, **Remind** / **Receive payment**) · GSTIN differs from their profile
   (**Use theirs** / **Keep mine**) · mail bounced (**Fix address**). Nothing due → not drawn.
3. **Actions** — primary: **Message** (on ChitBridge) or **Call** (local with phone) or **Mail**; then Log · Follow-up ·
   Edit · More (Mail / Send statement / Merge / Link to ChitBridge / Export vCard / Remove from my parties).
4. **Timeline** — the latest 5 entries and **See all** (REQUIREMENT-timeline.md).
5. **Who & contact** — phone(s), e-mail(s), address, city, user_id (on ChitBridge), contact preferences per channel
   (allowed / not, purpose, since).
6. **Tax & terms** — tax ids (list: scheme · value), state (and place of supply it implies — words from
   `tax-engine.supplyType`, not computed here), credit days and limit **per role**.
7. **Customer** (if role) — txn_count, last bill, customer since, added via, segment (with override), named groups
   (custNamedGroupsHTML pattern), points (custRewardsLoad, one read on open).
8. **Supplier** (if role) — category, preferred, supply kind (resale / own use), notes (pinned), catalogue link
   (on ChitBridge), availability.
9. **Ledger** (CB Accounts on) — `partyBooksHTML` + statement (`partyStatementLoad`) unchanged. Off → one line
   "Dues show when CB Accounts is on" + **Switch on** (owner).
10. **History of changes** (owner) — `books_change_log` rows for this party; merge/link entries with **Undo**.

## 5 · What it does
| Action | Route | Reuse |
|---|---|---|
| Edit fields | `PATCH /suppliers/:id`, `PATCH /customers/:id`, party-fields patch | `partyEditOpen` (cap-books.js:263) widened to many tax ids and moved out of the Ledger-only block |
| Message | `compose({to: party})` kind chit | the one compose |
| Mail | compose kind mail | MESSAGING.md §3 |
| Call / WhatsApp | `tel:` / `wa.me`, then Log sheet | — |
| Log | `POST /api/crm/parties/:id/interactions` (new) | — |
| Follow-up | `POST /api/crm/followups` (new) | — |
| Groups / segment override | `POST /customers/:id/groups`, `PATCH /customers/:id` | existing |
| Add role ("Also a supplier") | `POST /suppliers {supplier_bridge_id}` / by name for local | existing; same party_id |
| Send statement | chit (on ChitBridge) / mail with PDF (local) | statement route |
| Merge · Link | REQUIREMENT-merge.md, BRIDGE.md §5 | — |
| Remove from my parties | `DELETE /suppliers/:id`; customer removal (new; refused while dues are open) | — |
| Contact preference | `PUT /api/crm/parties/:id/prefs` (new) | — |

## 6 · States
- **Loading:** header from the list row at once (no flash); sections fill as the record read returns.
- **Error:** "Couldn't open this party. Try again." + **Try again**.
- **Not found / merged:** a folded party opens its keeper with "Merged from P-0012" once.
- **One-sided / not on ChitBridge:** Message is replaced by Call / Mail; one line "Not on ChitBridge — bills are yours
  only." + **Link to ChitBridge** (owner) / **Invite** (share link). Disputes section absent.
- **Walk-in:** only phone, points and counter bills; primary action **Add to my parties** (mint + claim, DATA.md gap 8).
- **No contact at all:** "No phone or e-mail yet" + **Add**.
- **Viewer:** every action hidden, not disabled-and-unexplained.
- **Ledger off:** see §4.9.

## 7 · Phone
One column; header and Next stay at top; sections are the order above; actions in a bottom bar (primary + Log +
More). `scrollWidth === 390`. No section scrolls inside itself.

## 8 · Words on screen
"On ChitBridge" · "Not on ChitBridge — bills are yours only." · "Link to ChitBridge" · "Message" · "Mail" · "Call" ·
"Log" · "Follow-up" · "Next" · "Who & contact" · "Tax & terms" · "Dues show when CB Accounts is on" · "Also a supplier" /
"Also a customer" · "Merged from P-0012". Never "accounting", "entity", "identity", "bridge_id" as a label (show
"ChitBridge ID").

## 9 · Data it reads
`GET /api/crm/parties/:party_id` (new) → the list row (REQUIREMENT-home §9) + `{ customer:{…}, supplier:{…},
contacts:{phones[], emails[], address}, prefs:[{channel, allowed, purpose, basis, noted_at}], gstn_profile,
scorecard:{first_at, last_at, you_sent, you_received, completion_rate_pct}, points:{balance, programme},
followups:[open], timeline_head:[5], changes? (owner) }`. Statement and points use their existing routes on open.

## 10 · Must NOT
- Compute dues, place of supply, segment, points, or on-ChitBridge.
- Show the same string twice (e.g. the name in header and again in Who — Who shows legal name only if different).
- Offer Message to a local party or Mail when the e-mail preference is off (show why instead).
- Copy `partyEditOpen` or `custDetailHTML` — move/widen them.
- Show a second party's data, or another shop's notes.

## For the designer
**Standard:** SYSTEM.md (rules 1–3, 5, 7–9 especially); the Customers detail pane as the existing frame; the chit sheet
(`docs/design/chit-sheet/`) for how a document opens over it. **Design:** the header with its chips; the Next block and
its fix buttons; the action bar (desktop and phone); section order and which are collapsed by default; how a local vs
on-ChitBridge party *feels* different without a paragraph; the tax-ids list editor inside the existing edit sheet.

# CB CRM — the flows, end to end (FLOWS)

**Status:** spec, phase 1. Each flow names the screen (REQUIREMENT-*.md), the route, and what is reused. "New route" =
API work listed in PLAN.md. Words in quotes are the screen's words.

## F1 · Add a party
**Who:** owner or co-assist (editor). **From:** CRM home → **+ Add party**.
1. One field: "Name, User ID, phone or e-mail". Typing searches ChitBridge (`GET /api/entities/search?q=`) and the
   shop's own parties (the CRM list in memory).
2. **Match on ChitBridge** → pick → choose role(s): Customer · Supplier · both → `POST /customers {handle}` and/or
   `POST /suppliers {supplier_bridge_id}`. Chip "On ChitBridge".
3. **Already mine** → "Already your party — P-0007" → opens the record (no duplicate).
4. **No match** → "Add *Ravi Traders* as a local party" → role(s) → `local-identity.mint(owner, name, {kind})`
   (suppliers today via POST /suppliers by name; customers via the widened route, DATA.md gap 8). Chip "Not on
   ChitBridge".
5. `party_no` is assigned at add (ensureNo). The record opens on **Who** with phone / e-mail / GSTIN to fill.
6. Errors: 409 already on the list → treated as step 3; population mismatch → "That shop is in a test space — it can't
   be your party here"; `@` in a local name → "Use their User ID or e-mail to find them on ChitBridge".

## F2 · Find a party
CRM home: one search across both roles (list-ctl search over name · party_no · user_id · phone · e-mail · GSTIN · group),
filters Role · Segment · Group · On ChitBridge · Has dues · Has follow-up due, sort Name · Last activity · Dues · Newest.
Count "n parties of m". A saved view = the current search + filters, named (phase 3). Global: the app's search
(app/search.js) gains parties as a result kind (phase 2).

## F3 · Open a party's record
Row → the party record (two-pane: list stays; mobile: full screen with ‹ back). `GET /api/crm/parties/:id`.
Sections: header (name · party_no · role chips · ChitBridge chip · dues chip) · **Next** (follow-up due, unread
messages, overdue dues — only failing things, SYSTEM rule 1) · Timeline · Who & contact · Tax & terms · Groups · Points ·
Ledger (statement, when on). Actions: Message / Mail / Call / Log / Follow-up / Edit / More (Merge · Link to ChitBridge ·
Export · Remove).

## F4 · Log an interaction
Record → **Log** → kind (Call · Visit · WhatsApp · Note) → direction (in/out, not for Note) → one line of text → when
(default now) → Save → `POST /api/crm/parties/:id/interactions` (new) → appears at the top of the timeline.
"Add a follow-up" checkbox on the same sheet opens F6 prefilled. A `tel:` / `wa.me` tap from the record opens the
same sheet afterwards ("Log this call?").

## F5 · Write a mail
Record → **Mail** (shown when the party has an e-mail and e-mail preference is not off).
1. Opens the one compose in kind `mail` (MESSAGING.md §3) prefilled: To = party e-mail; signature; optional template.
2. Attach: device, or **From this party** (bills, statement PDF, chit attachments).
3. Review → **Send** or **Schedule** → `POST /api/crm/parties/:id/mail` (new) → `party_mail` row → Resend.
4. Timeline shows it "Queued" → "Sent" (→ "Bounced" amber with **Fix address**). A reply (if Q1(b) approved) arrives
   as a timeline entry under the mail.
Blocked: no e-mail → "Add an e-mail to mail them" with **Add e-mail**; preference off → "They asked not to be mailed"
with **Change preference** (owner); not configured → "Mail isn't set up" with **Set up** (owner, CRM settings).
For a party **on ChitBridge**, the record's primary button is **Message** (a chit / thread), Mail is secondary.

## F6 · Set a follow-up
Record → **Follow-up** (or from Log, or from Dues "Remind") → what (one line) · when (Today · Tomorrow · Next week ·
date — presets write into the date field, SYSTEM rule 6) · who (me / a co-assist) → `POST /api/crm/followups` (new).
Follow-ups screen lists due ones; **Done** → `PATCH /api/crm/followups/:id {done:true}`; **Snooze** → new due date.
Overdue ones appear on CRM home's alert line with the button **Open follow-ups**. Due today raises a bell `cb`
`{kind:'followup'}` (the nightly sweep, phase 2).

## F7 · See dues and statement
Record header dues chip = `partyDueChipHTML` (cap-books.js:144) from the record read (`balance_minor`,
`oldest_due` via party-fields.decorate). Tap → Ledger section: `partyBooksHTML` + `partyStatementLoad` (cap-books.js
157/181) unchanged. Ledger off → the chip is absent and the section says "Dues show when CB Accounts is on" with
**Switch on** (owner, the existing `bizLedgerSwitch`). Actions from here: **Send statement** (on ChitBridge: as a chit;
local: Mail with the statement PDF attached), **Receive payment** (the Ledger's existing receive), **Remind** (F6).

## F8 · Merge duplicates
CRM home → More → **Find duplicates**, or a record's **Merge** (or the 409 DUPLICATE_PARTY prompt from Edit).
1. Candidates by rule: same GSTIN/PAN · same phone · same e-mail · same name (normalised) — `GET /api/crm/duplicates`
   (new). Each pair shows why ("Same GSTIN 33ABCDE1234F1Z5").
2. Pick the **keeper** (default: the on-ChitBridge one, else the older party_no). Side by side, field by field, choose
   which value survives (only differing fields shown).
3. Confirm sheet says what will happen: "P-0012 will be folded into P-0007. Its 4 bills, ₹2,300 due and 120 points move
   to P-0007. This can be undone until the month is locked." → `POST /api/crm/merge {keep, fold, fields}` (new;
   BRIDGE.md §5 mechanism) → owner only.
4. The folded party disappears from the list; opening its old link opens the keeper with "Merged from P-0012".
Undo: record → History → **Undo merge** (owner, before month lock).

## F9 · Export
CRM home → More → **Export** (owner only) → what: the current view / everything · format: CSV · vCard → columns
listed (party_no, name, legal name, roles, phone, e-mail, GSTIN, state, groups, segment, dues, on ChitBridge) →
`GET /api/crm/export?format=csv|vcf&view=` (new; streamed by the server, never assembled in the page). Parties whose
preference says "do not share" are still exported (it's the shop's own record) but the file carries the preference
columns. The export is logged (who, when, how many) — DPDP accountability.

## F10 · Import
CRM home → More → **Import** (owner only) → upload CSV or vCard → map columns (auto-guessed; the same preflight shape as
products: `routes/products.js:827` preflight then `:875` import) → preview: n new · n match existing (by GSTIN /
phone / e-mail / handle) · n errors (with the row and reason) → **Import n** → each new row: on-ChitBridge handle
→ add by handle; else mint local; `added_via='import'`. A consent column ("may mail: yes/no") maps to
`party_contact_pref` with `basis` as given; absent → no marketing consent recorded.

## F11 · Link a local party to ChitBridge
Record (local) → **Link to ChitBridge** → search by handle → confirm ("History stays. Future bills go to them on
ChitBridge.") → `POST /api/crm/parties/:id/link {to}` (new; BRIDGE.md §5). Also offered automatically when an import or
add finds the local party's phone/e-mail/GSTIN on an on-rail identity ("Ravi Traders is now on ChitBridge — link?").

## F12 · Segments and groups
CRM home filter by segment/group, or **Segments & groups** screen: the computed segments (counts), the named groups
(rename, delete, members), and "Only for" offers that target each (read from cap-definitions). Add to group: from the
record (custNamedGroupsHTML pattern) or bulk from the list (select mode).

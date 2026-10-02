# Requirement — CRM home: the parties list

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`, every line. Never write "accounting".
Flows: FLOWS.md F1, F2, F3, F9, F10, F12. Data: DATA.md §2, §4.

## 1 · Purpose
One list of everyone the shop deals with — customers and suppliers together, one row per party — so the shopkeeper
can find a party in two taps and see who needs a hand today.

## 2 · Who
- **Owner** — everything, including Import, Export, Find duplicates, Settings.
- **Co-assist (editor)** — find, open, add, log, follow up. No Import / Export / Merge / Settings.
- **Co-assist (viewer / commenter hats, `lib/access.js:80-85`)** — find and open only.

## 3 · Where it sits
Its own page, like CB Accounts: `public/crm.html`, named **CB CRM**, with the CB Accounts shell (`accounts.html`
sidebar + pinned header + avatar menu, `app/accounts-shell.js`). Sidebar: **Parties** (this screen) · **Follow-ups** ·
**Segments & groups** · **Duplicates** · **Import / export** · **Settings**. The app's left menu "Customers" and
"Suppliers" items gain "Open in CB CRM ↗"; the old screens stay reachable by URL until phase 3 (do not delete).

## 4 · What it shows
**The alert line (only failing things, SYSTEM rule 1):** follow-ups overdue (n) with **Open follow-ups** · parties with
overdue dues (n, the same number as Dues) with **See dues** · duplicates found (n) with **Review**. All fine → one
line, or nothing.

**The list** — the Task table: `listHeader` · `rowGrid` · `colTemplate` (app.html:16772-16799) with
`list-ctl.js` (`listCtl`, `listCtlToolbarHTML`, `listCtlRowsHTML`, `listCtlCountHTML`, lazyWrap). Hover = `rowPeek`
(app.html:16777). Columns (choosable/orderable as Task's are; at most three on screen at once, SYSTEM rule 7):

| Column | Field | Note |
|---|---|---|
| Party | `display_name` (nickname wins) + `party_no` | |
| Roles | `roles` → Customer · Supplier | both chips when both |
| ChitBridge | `on_chitbridge` / `kind` | On ChitBridge · Local · Walk-in |
| Last activity | `last_at` (max of last_txn_at, last chit, last interaction) | |
| Dues | `balance_minor`, `oldest_due` via `partyDueChipHTML` (cap-books.js:144) | Ledger on only; server number |
| Segment / groups | `segment`, `groups[]` | customer role only |
| Next follow-up | `next_followup_at` | amber when overdue |
| Phone · e-mail · GSTIN · state · city | identity / party_tax_id | off by default |

**Controls (the five, `e2e/list-controls.cjs`):** search (name · party_no · user_id · phone · e-mail · GSTIN · group) ·
filters (Role · On ChitBridge · Segment · Group · Has dues · Follow-up due) · sort (Name · Last activity · Dues ·
Newest) · count ("n parties of m") · lazy rows. Select mode (Task's `UI.selectMode`) for bulk: Add to group · Export ·
Mail (phase 3).

**+ Add party** — the one field of F1.

## 5 · What it does
Row → party record (REQUIREMENT-record.md) in the detail pane (`openChitSheet`-style popup is NOT used for the record —
the record is the second pane, as Customers is today). Add → F1. More → Find duplicates · Import · Export.

## 6 · States
- **Empty (no parties):** "No parties yet" + "Customers appear when you bill them; suppliers when you add them." +
  **Add party**. (listCtlEmptyHTML picks between this and "nothing matches *ravi*".)
- **Loading:** the list's existing loading row; the alert line is not drawn until its numbers arrive.
- **Error:** "Couldn't load your parties. Check the connection and try again." + **Try again**. Never `error.message`.
- **Migration not run (409 from `/api/crm/*`):** owner: "CB CRM needs one database step (bNNN)." with the button that
  shows the SQL file name; others: "Ask the owner to finish setting up CB CRM."
- **One-sided (party not on ChitBridge):** the row carries the Local chip; nothing else differs in the list.
- **Not on ChitBridge — the shop itself is a test shop:** a test shop sees only test-population parties (server rule).
- **Ledger off:** Dues column and the "overdue dues" alert are absent; no blank column.

## 7 · Phone (390 px)
`document.scrollWidth === 390`; one card per party (name + party_no, role chips, the one most useful fact: dues if
overdue, else next follow-up, else last activity); 16 px gutter; the alert line wraps; Add party stays reachable.

## 8 · Words on screen
"CB CRM" · "Parties" · "Add party" · "Name, User ID, phone or e-mail" · "On ChitBridge" · "Local" · "Walk-in" ·
"Customer" · "Supplier" · "n parties of m" · "No parties yet" · "Open follow-ups" · "See dues" · "Review".
Never "accounting", "CRM record", "contact entity", "lead".

## 9 · Data it reads
`GET /api/crm/parties` (new, DATA.md §4) → `{ parties:[{ party_id, party_no, display_name, nickname, legal_name,
roles:['customer','supplier'], kind, on_chitbridge, why_not, user_id, bridge_id (on-rail only), phone, email, city,
state_code, tax_ids, segment, groups, txn_count, last_at, balance_minor?, oldest_due?, next_followup_at, unread }],
alerts:{ followups_overdue, dues_overdue, duplicates } }`. One read; no per-row fetch.

## 10 · Must NOT
- Draw its own rows, cards or expander (CLAUDE.md rule 5) — Task's table and list-ctl only.
- Compute dues, segment or on-ChitBridge in the page.
- Show a both-roles party twice, or a merged (`merged_into`) party at all.
- Show `bridge_id` of a minted party.
- Page from the server with list-ctl (the party list arrives whole; if a shop passes ~5,000 parties, PLAN.md Q8).

## For the designer
**Standard:** SYSTEM.md tokens and rules; the CB Accounts shell (`docs/design/ledgers-page/`) for the page frame; the
Task table for the list (same header, rows, column chooser, rowPeek). **Design:** the CB CRM sidebar and header; the
alert line; the column set and its phone card; the three ChitBridge chips (on / local / walk-in) and the two role
chips so they read at a glance; Add party's one field with its three result kinds (on ChitBridge · already mine ·
add as local). No new list style.

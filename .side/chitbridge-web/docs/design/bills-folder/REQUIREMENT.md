# Designer brief — the Bills folders

**Status:** brief for design. **Not built.** The server side is done and tested (chitbridge-api branches `bills-folder`,
then `bills-private`: each shop's steps stay its own, at the folder's messaging level).
This web branch changes only one thing: the folder list now also carries system folders, and those are kept away from
Task, Order and 📁 Move. Build the screen from the design Athi accepts.
**Pass mark:** `docs/design/SYSTEM.md`, every line of it. Never write "accounting".

Athi, 2026-10-01: *"the purpose of rail is for the order to be received and serviced, but this is not a task … once the
life cycle is done it has to be closed — the accounting done, material received."* (BACKLOG: "BILLS TO ACCEPT".)

## 1 · Who uses it, and for what
- **The shop owner or a co-assist, at the counter or on a phone.** Two jobs:
  1. **Received:** a supplier's bill has come in. Count the goods in, then accept it (that posts the bill) or dispute it.
  2. **Issued:** my bill is out with a customer. Has the money come? Is there a dispute?

**Each shop's steps are its own** (Athi, 2026-10-01: *"goods verified and accounted are internal status, not between two
shops … only the dispute can be a both-side message"* · *"money received, part paid, it has to be both sides"*).
- The seller **never** sees the buyer counting goods in or accepting the bill. The buyer never sees the seller's steps.
- What crosses: the bill itself, the **dispute** (always), and the steps the other party's own folder is set to share.
  By default that is only the **payment** (R-1400), shown like a remittance advice: "Chola Auto Care paid ₹300 · ₹181.65 due".
- **The owner, once in a while:** decides which system folders the shop shows (an on/off list).
- Bills are **not tasks**. They no longer appear in Task or Order. They live here.

## 2 · Where it sits
- In the rail under **Rail**, after Order: **Bills**. Under it, one row per system folder that is switched on, in
  inventory order. Each row shows: **code**, **name**, **open count**, e.g. `B-2100  Bills · Received  2`.
- A shop's own *view* folders (a rule such as "from: Agro Mills") come after the system rows.
- The web already keeps these apart for you: `UI.sysFolders` (system and view folders). `UI.folders` holds only the
  filed folders that hang under Task and Order. Do not merge them.

## 3 · The data (exact API fields)

### 3.1 The folders — `GET /api/folders`
`{ folders: [...], system_error? }`. System rows come first:

| field | example | show it as |
|---|---|---|
| `folder_id` | fixed uuid per code | (key) |
| `code` | `B-2100` | the code, always beside the name |
| `name` | `Bills · Received` | the name |
| `system` | `true` | — |
| `kind` | `view` | — |
| `side` | `received` · `issued` · `null` | which tab it is |
| `ledger` | `{ code: '2100', name: 'Suppliers (Sundry Creditors)', role: 'creditors' }` | the ledger line on the inventory list |
| `count` | `2` | **open** items: the rail count, and the tab count |
| `total` | `3` | open + closed |

A shop's own view folder: `{ folder_id, name, kind: 'view', scope, count }`. It has no `code`.
If `system_error` is present, the system folders could not be read. Say so in one line. Never show an empty folder that
is not empty.

### 3.2 The inventory — `GET /api/folders/inventory` · `PUT /api/folders/inventory/:code { on?, msg? }`
`{ rows: [...], can_change }`. One row per inventory entry:

| `code` | `name` | `ledger` | shown | **Messages** (ceiling → the shop may choose) |
|---|---|---|---|---|
| `B-2100` | Bills · Received | 2100 Suppliers (Sundry Creditors) · role `creditors` | on | **Internal** → Internal · None |
| `B-1300` | Bills · Issued | 1300 Customers (Sundry Debtors) · role `debtors` | on | **Internal** → Internal · None |
| `R-1400` | Receipts | 1400 Cash · role `cash` (also bank · upi · card) | on | **External** → External · Internal · None |
| `E-6000` | Expenses | 6000 Indirect Expenses · group | off | **Internal** → Internal · None |
| `RT-4090` | Returns | 4090 Sales returns · role `sales_returns` | off | **Internal** → Internal · None |
| `DSP` | Disputes | — · `fixed: true` | always | **External**, fixed |
| `T` | Tasks | — · `fixed: true` | always on | — |
| `O` | Orders | — · `fixed: true` | always on | — |

Each row also has `on`, `default_on`, `fixed`, `leaves_inbox`, `kind`, `folder_id`, and the messaging fields:
`msg_ceiling` (the platform's level), `msg` (the shop's level now), `msg_fixed`, `msg_choices` (what may be picked).

**Messages** is the level the steps of that folder are written at:
- **External** — written to my history **and** the other party's.
- **Internal** — my history only.
- **None** — no message is written at all, not even in mine. (The step itself still happens: a bill is still accepted.)

The ceiling is the most a folder may ever share. A shop may only go **down** from it. Show the choice as three options with
only `msg_choices` enabled. Show the ceiling beside it, e.g. "External (default)". A widen is refused with **409** and a
plain sentence ("Bills · Received can be kept internal or switched off, but not shared beyond the default."). The dispute
cannot be changed (**409**).
- **`can_change: false`** (a co-assist): show the list with every box disabled, and one line: "Only the owner can change these."
- The PUT returns the same shape. Possible refusals: **403** not the owner · **400** switching off a fixed row · **409** a
  level above the ceiling, or the dispute's level · **404** an unknown code.
  Show each one in your own words. `error.message` never reaches the screen.
- Switching a folder **off** hides it, and its count, from the rail. **Its bills stay out of Task either way**
  (`leaves_inbox`). Say that once, beside the list.

### 3.3 The bills in a folder — `GET /api/folders/:id/chits?state=open|closed|all`
`{ chits: [...], counts: { open, closed, total } }`. Default `state=open`. An off folder answers **404**.

Each row has these fields:

| field | example | use |
|---|---|---|
| `chit_id` | uuid | open it |
| `manual_subject` · `auto_subject` | `Bill C1/26-27/0041 from Agro Mills` | the title |
| `bill_no` | `C1/26-27/0041` | the number |
| `counterparty_name` | `Agro Mills` | who |
| `value` · `currency` | `481.65` · `INR` | the amount (tabular figures) |
| `created_at` | ISO | when it arrived or was issued |
| `doc_kind` | `bill_received` · `bill_issued` · `receipt` · `expense` · `return` | — |
| `open_disputes` | `0` | — |
| `summary_json.bill_received` | `{ from, no, total }` | on a received counter bill |
| **`bill`** | see below | the step chip and the status line |

**`bill`** is worked out by the server (`lib/bill-steps.js`). The page never decides a step.
```
bill: { step, code, label, by, at, open, paid,
        history: [ { step, code, label, by, at }, … ] }   // every acceptance, oldest first
```
- `step`: one of `received` · `goods_checked` · `accepted` · `disputed` · `closed` · `issued`.
- `label`: the words to show, e.g. `Goods checked`, `Bill accepted`, `Bill refused`, `Dispute settled`,
  `Paid ₹300 of ₹481.65` (my own payment), `Chola Auto Care paid ₹300 · ₹181.65 due` (theirs, shared).
- `code`: **the folder that owns the step**. Goods and bill steps carry the bill folder's code (`B-2100` / `B-1300`).
  Money carries `R-1400`. The dispute carries `DSP`.
- `theirs` (on a history line): `true` when the other party wrote it and their folder shared it. Mark these lines
  (e.g. their name first, a lighter tone). Everything else is mine.
- `by`: the person's **user id** (e.g. `chola-ravi`), or their name if they have none.
- `at`: ISO time.
- `paid`: **my own** ledger shows nothing left open on it. **Paid never keeps a received bill open.** An issued bill
  closes when my ledger has it paid in full, or at once if it is a walk-in bill.

## 4 · What each element shows

### 4.1 The tab pair
**Received · n** and **Issued · n**. `n` is the folder's open `count`. A tab whose folder is switched off is not drawn.

### 4.2 Open / Closed
Two views of one folder (`state=open` / `state=closed`). `counts.open` and `counts.closed` give the numbers.

### 4.3 The step chip, one per bill
| step | Received side | Issued side | colour (SYSTEM.md) |
|---|---|---|---|
| `received` | Received | — | neutral |
| `goods_checked` | Goods checked | — | blue (in hand) |
| `accepted` | Bill accepted | — | amber (goods still to come in) |
| `disputed` | Disputed (DSP) | Disputed (DSP) | red |
| `issued` | — | Issued (waiting on payment) | neutral |
| `closed` | Closed | Closed (paid in full, or walk-in) | green |
| *(paid)* | **Paid**, as a second chip | **Paid** | green |

### 4.4 The status line, one per bill: `bill.code · bill.label · bill.by · bill.at`
```
B-2100 · Goods checked · chola-ravi · 01 Oct 14:20          (buyer — internal: the seller never sees it)
B-2100 · Bill accepted · chola-ravi · 01 Oct 14:40          (buyer — internal)
R-1400 · Paid ₹300 of ₹481.65 · chola-ravi · 02 Oct 09:30   (buyer's own line)
R-1400 · Chola Auto Care paid ₹300 · ₹181.65 due · chola-ravi · 02 Oct 09:30   (the same payment, on the seller's screen)
DSP · Disputed · chola-ravi · 02 Oct 10:00                   (both see it)
```
"Accepted" on its own is ambiguous. The **code** says which acceptance it was: goods, the bill, the money or the dispute.
Opened, the bill shows its whole `history` as these lines, one per acceptance.

## 5 · Actions per step
These are buttons on the bill. Each one calls a route that already exists. Draw only what the step allows.

| step | actions | route |
|---|---|---|
| Received | **Goods in** · **What it's for** (resale · use · asset) · **Accept** · **Dispute** | `POST /api/chits/:id/deliver-lines` · `PUT /api/chits/:id/use` · `PUT /api/chits/:id/status {status:'accepted'}` · `POST /api/chits/:id/disputes` |
| Goods checked | **Goods in** (the rest) · **Accept** · **Dispute** | as above. Receiving every line accepts the bill by itself. |
| Bill accepted | **Goods in** (the rest) · **Pay** | deliver-lines · the Ledger's Pay (`POST /api/books/payments`) |
| Disputed | **Open the dispute** | the chit's dispute thread |
| Closed | **Pay** (only if not paid) · **Open** | — |
| Issued | **Receive payment** · **Open** | the Ledger's receive (`POST /api/books/payments`) |

A payment confirmed against a bill writes its R-1400 line at R-1400's level, so the other party sees it only while
R-1400 is External.

Opening a bill uses the **chit sheet** (`public/app/chit-sheet.js`, cloud task `cloud/chit-sheet`) when it exists, and
otherwise `openChit(id)`. It is not on main today.

## 6 · Empty, error and edge states
- **Nothing open:** say it plainly ("Nothing open."). A closed folder with nothing in it: "Nothing closed yet."
- **Every bills folder off:** one line, plus the button that opens the on/off list. (SYSTEM.md rule 2: the warning carries its fix.)
- **The folder was switched off while open (404):** go back to the Bills landing. Do not show an error.
- **`system_error` / a read failure:** what happened · what it means · what to do, in your own words.
- **A bill with no lines** (amount only or service): it closes when it is accepted. No goods step is shown.
- **A walk-in bill** (no customer on the rail): it is Closed as soon as it is issued. It belongs in the Closed view.

## 7 · Phone width, and the list controls
- At **390 px**, `document.scrollWidth === 390`. One card per bill, with a 16 px gutter. Nothing scrolls sideways.
  The status line wraps. It is never truncated (SYSTEM.md rule 5).
- **The five list controls** (`e2e/list-controls.cjs` checks them): search · filter (by step) · sort (newest · oldest ·
  amount) · count ("n bills of m") · lazy rows. Use `app/list-ctl.js` (`listCtl`, `listCtlToolbarHTML`,
  `listCtlRowsHTML`, `listCtlCountHTML`). Do not write a second one.
- Maximum three columns. Figures in IBM Plex Mono with tabular numbers.

## 8 · How the build proves itself (after the design is accepted)
- `e2e/bills-folder.cjs` grows into the screen's harness. Use the pattern in `e2e/books-web.cjs`: a stand-in API on a
  free OS port, never localhost:3000, 7351 or live. It checks:
  - the rail rows (code, name, count);
  - the tabs and their counts;
  - each step chip, and each status line as `code · label · user id · time`;
  - a bill with two acceptances shows two codes;
  - the seller's screen never shows a buyer step, and a "theirs" payment line is marked as theirs;
  - the Messages column: ceiling and choice, choices above the ceiling disabled, the dispute fixed;
  - switching a folder off removes it, and its count, from the rail;
  - a co-assist sees every box disabled;
  - 390 px with no sideways scroll;
  - no "accounting" anywhere.
- `e2e/bills-folder-breaks.cjs`: every guard broken once, each restored from a COPY.
- `node scripts/check-syntax.js`, `node scripts/check-app-parses.cjs`, `node e2e/list-controls.cjs`,
  `node e2e/api-envelope.cjs` → exit 0.
- Screenshots: `e2e/shots/bills-{laptop,phone,inventory}.png`.

⚠️ `/api/folders/:id/chits` answers with `{ chits, counts }` and nothing else. The envelope in `core.js` collapses
`chits` to the array and keeps only the siblings it knows. `counts` is one of them.

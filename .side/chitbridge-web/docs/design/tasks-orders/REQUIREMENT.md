# Designer brief — Tasks & Orders (a Home box and its small app)

**Status:** brief for design. **Not built.** **Pass mark:** `docs/design/SYSTEM.md`, every line of it.
Athi, 2026-10-09: *"we need to have another box called Task and orders, so we can bring those here. but the ui and all
should be very nice."* · *"it is for a delivery, so it has to come to till or order queue so that can be addressed"* ·
*"each of the order cannot enter into journal if it is a cash sale … otherwise journal will flood."*
Decisions: DECISIONS.md 2026-10-09 (order queue · order → journal lifecycle · Tasks & Orders box · workshop simplified).

## 1 · Why it exists
Today the work on chits lives in the WORKSHOP (app.html → Compose · Task · Order · Drafts · Archive · Trash), which customers
never enter. An online order reaches the shop only as a bell line and a CRM timeline row, without its address or total, and the
till never sees it (black-box test 2026-10-09, rows O1–O11). This box is where the shop **does the work** on chits; CRM stays
the view of a **party**, CB Accounts the view of the **money**.

## 2 · Who uses it, and for what
- **The person at the counter, on a phone, mid-rush.** One job above all: *a new order came — see it, accept it, get it out.*
- **The owner, a few times a day:** what is waiting on me, what is stuck, what did I send a supplier.
- Assume they cannot read much (memory: a SYMBOL, a DIGIT, a COLOUR with a word). Big targets; one action per row.

## 3 · What it holds (tabs or a segmented control — designer decides)
| Tab | What | Comes from today |
|---|---|---|
| **Orders in** ⭐ first | orders from customers (online shop, other shops on the rail); NEW ones loud | Order (in) + the new queue |
| **Orders out** | orders this shop sent to its suppliers | Order (out) |
| **Tasks** | chits assigned to me / my team that need doing | Task |
| **Drafts** | started, not sent | Drafts |
| **Done** | closed, delivered, cancelled; a "deleted" filter replaces Trash | Archive, Trash |
| **＋ New** | start a chit / an order to a supplier | Compose |

## 4 · An order IN — the life cycle the screen must carry (the order queue)
`New` → **Accept** (or Reject with a reason) → **Bill it** (becomes the counter bill: invoice no + tax frozen) → **Ready** →
**Delivered / Handed over**. Payment: cash/UPI/card now or on delivery, or on credit for a named customer.
- **No journal** for New / Accepted / Ready. A bill **paid at once** joins the **day's walk-in summary** (one Day book entry per
  day, never one per order). **On credit** → its own sale to that customer. Rejected/cancelled → closed with a reason, never posted.
- Each row shows: **🌐 Online** (or the channel) · **Delivery / Pick up** · customer · items count · **₹ total** · **asked-for time** ·
  **address** (delivery) · the remark · age. A NEW order makes a sound (setting) and a count on the Home box and the till.
- **Stuck = ideally zero.** A row past its time shows the reason and the button that clears it (DECISIONS 2026-10-09).
- The **till shows the same queue** (one queue, two places) — the designer should draw the till's compact strip too.

## 5 · ONE unit, opened from anywhere
Athi, 2026-10-09: *"so the external order will come to task. the same should be able to open from till also or anywhere."*
- An external order **lands in Tasks & Orders** (it IS the shop's task).
- The queue and the order are **one unit**, mountable on any page (like CBSheet, CBBell): the Tasks & Orders app, the till,
  Home, CRM (a party's orders), CB Accounts (an order not yet billed). **The same order opens the same way everywhere** —
  same sheet, same actions, same state; acting on it in one place updates it in all.
- Design it once as the unit; the pages only give it a place.

## 6 · Where it sits
- **Home:** a box "Tasks & Orders" beside CB Accounts / CB CRM, with live facts: `3 new orders · 2 tasks for you · 1 stuck`.
- **The bell:** a row for a new order opens THAT order here (today pressing it opens nothing — O4).
- **The till:** a strip/drawer with the Orders-in queue; Bill it there turns it into the bill on the till.
- Same frame as the other apps (CBShell header, avatar, bell, kural band foldable).

## 7 · Reuse — nothing new underneath
CBList (lists, the five list controls) · the chit sheet (`chit-sheet.js`, Messages and files, `chit.actions` = what this login may
do, refusals with the engine's `why`) · `GET /api/facts/rail/chits` (in/out/stuck with reasons, added 2026-10-09) · the till's bill
path + summary-chit fold · CBThread · CBAttach · CBBell. Show every action; the server decides enabled + why (greyed with its sentence).

## 8 · Shots wanted
Phone 390 px and laptop 1366 px: Orders in (with 1 NEW, 1 accepted, 1 stuck) · an order open (delivery, with address and ₹) ·
Accept → Bill it → Ready → Delivered steps · Tasks · ＋ New · empty states · the till's strip · the Home box. Light + dark.

## 9 · Not in this brief
Delivery-partner integration, payments online, the customer's tracking page (the online shop round — S2ORD-04 asks for an
order number and a way to follow it; draw only the shop side here).

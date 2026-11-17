# REQUIREMENT — One detail page (DRAFT for Athi to read · 2026-10-02)

**Status:** requirement only. Not designed, not built. Next: Athi reads → designer → build (cloud, Sonnet).
**Pass mark:** `docs/design/SYSTEM.md` (tokens, fonts, 390 px, ≤ 3 columns, no truncation, short strings).
**Decision:** `C:\users\mahar\DECISIONS.md` › "One detail page, the same everywhere".

## Why
Athi, 2026-10-02: *"irrespective of the page, the details page should follow the same style, so it is easier for us to
improvise one design and apply it every where … the control below should be a custom added, but the detail page design
should be same … so each product tax will be visible seperately and any offer provided will be known"* · *"currently the
detail page is not in a good shape … we can redesign it and make it better and the same will be visible everywhere."*

Today there are TWO detail pages, drawn separately, and they can disagree:
| Where | File | What it shows | Problem |
|---|---|---|---|
| Task list's right pane | `public/app.html` ~17540–17600 (`UI.dtab` content · status · summary · messages) | item cards (letter tile · name · unit · amount), Goods / Total incl. tax, payment, work done, tabs | **recomputes** the money from the lines (`CBCart.moneyFromLines`, app.html:17555), which breaks "compute once"; no per-line tax, no GST summary |
| The popup (Day book, Dues, Bills, Waiting) | `public/app/chit-sheet.js` | the bill as printed: Item · Qty · Price · Total, GST summary rate-wise, Total, Paid by, action row | reads the frozen invoice correctly; no per-line tax or offer; a separate design |

**One design replaces both.** It is a single module that every page opens, in a popup, side pane or full page, and the
look is the same in all three.

## Who
A shopkeeper or their staff, often on a phone, who may not read well (memory: *assume they cannot read*). Digits, symbols
and the familiar shape of a printed bill do the work. Both sides of a bill see the SAME page: the seller and the buyer see
the same lines and the same figures.

## The data (READ, never computed on the page)
The figures come only from the frozen invoice, through the tax engine's mapping `CBTax.moneyOf(invoice)`
(`chitbridge-engines/src/tax.js:401`). It is a mapping, not a calculation:
- **Bill:** gross · savings · net · taxable · tax · total · round_off · cgst · sgst · igst · cess · supply · pos_state ·
  currency_code · `by_rate{rate: taxable, cgst, sgst, igst, tax}` · `heads[{name, rate, base, amount}]`.
- **Per line**, in invoice order: gross · discount (the offer) · taxable · cgst · sgst · igst · cess · tax · total. The
  line's name, qty, unit, price, HSN, rate and offer name come from the chit's `line_items[]` and the invoice `ItemList`.
- **Tax applicability** (DECISIONS: "always engaged"): applies | not_applicable plus a reason, for the bill and per line
  (nil-rated · exempt · non-gst · zero-rated).
- **Header:** kind (sale · supplier bill · order · expense …) · bill no · date/time · counter · rung by (person) · from →
  to (names, never ids) · place of supply · step / status · payment (paid by: cash / UPI / on credit, with amounts).
- **History:** the chit's state log (accepted by `by_name`, disputed, amended) and line amendments (original → now, who,
  when). A frozen chit is never changed; an amendment is a new record shown beside the original.
**Never recompute** (Athi, 2026-10-02: *"never ever recompute"*). The page holds NO money arithmetic. Its one reader is
`chit-sheet.js` `moneyFor`: the frozen invoice through `CBTax.moneyOf`, else `summary_json.money`, else nothing. When it
returns nothing (a draft not yet billed, or an issued chit with no stored figures), the money sections show a clear state:
"Not issued yet" for a draft; an ERROR, "No issued figures for this bill", for anything else. Never a number worked out on
the page. Figures are only ever computed where the bill is made (the counter, the cart).

## Sections (top to bottom; the designer decides the look)
1. **Header:** kind · bill no · date · from → to · step chip · total, large.
2. **Lines:** each product on its own line: name, qty × price, the **offer** if any (name plus saving), and **its tax**
   (rate plus amount, CGST/SGST or IGST). This must be readable at 390 px without a fourth column (Athi's rule; a line can
   wrap to two rows, as the Day book's flow does).
3. **Tax summary:** rate-wise, as the counter prints it. "Tax: Not applicable — <reason>" when it doesn't apply.
4. **Total:** to the paisa; a rounded figure only shown beside it, never instead of it (DECISIONS: "kept to the paisa").
5. **Payment:** paid by, what is still owed, and payment state.
6. **Tabs or folds:** Content · Status/History · Messages (Summary folds into Content unless the designer keeps it).
7. **Action bar (bottom), the ONLY part that differs per place.** Each place declares its actions; the step flow decides
   which are allowed. Examples:
   - Supplier bill to accept: What is it for? (resale · for the shop · an asset · let my catalogue decide) · Accept ·
     Dispute · Goods in · Open page. The per-line receive controls (checkbox arrived, received qty) are in
     `docs/design/receive-a-bill/REQUIREMENT.md` and plug in here as that place's addition.
   - My sale: Mark paid · Show QR · Forward · PDF · Dispute.
   - Task: Assign · priority · Move · Status · Ask AI.

## States to design
issued (normal) · draft / not issued · to accept · accepted (show who) · disputed (the disputed line marked) · amended
(original and now) · paid / part-paid / on credit · tax not applicable · one-sided (customer not on ChitBridge: "kept on your
side only") · loading · could not load (plain words plus Try again; never `error.message`) · a long bill (40 lines) · phone.

## Pass checks for the build (later)
- No money arithmetic in the page: a guard greps the module for `+ - * /` on money fields and allows only the mapping.
- The same chit opened from Task, Day book, Bills and the popup gives identical HTML for sections 1–6.
- Seller's and buyer's copies show identical figures (e2e two-sided).
- 390 px: no sideways scroll; the long bill scrolls inside the page, not in an inner box.

## Not in scope
The counter's own slip (`till.html`, vendored). The list (that's the one list control, web #21). The receive-a-bill
queue (its own requirement).


---

## Update 19 Oct 2026 (cb-ux-locale, against NAV-MAP and the current API): UX-11, UX-17, "already asked"

**Checked:** this brief is still right on content (frozen invoice only, never recompute). What moved is the count and the doors. Today there are THREE looks, not two (NAV-MAP D15):
the chit sheet (`public/app/chit-sheet.js`, opened from Accounts Day book, Ledgers, Bills, Waiting, Receivables, Finance Collections and Repeat, CRM Record and Chits, Tasks Disputes: 10 ways in), the CRM chit page (`crm.html#/chit/<id>`, reached only from the sheet's "Open page", in a new tab) and the Tasks and Orders sheet (`tasks.html?open=<id>`, from the Home bell and Orders in). The Dispute button closes the sheet and does nothing on Accounts, Finance and CRM (`cap-dispute.js` is not loaded there).

### WAYS IN (all open the SAME page: popup, side pane or full page, one design)
Every list row that names a chit (Day book, Ledgers, Bills, Waiting, Receivables, Collections, Repeat, CRM Chits, a party's Record, Disputes, Orders in and out) · the Home bell and the "Needs you" strip · a task or order sheet · a link in a message. Taps from Home: Money > Accounts > a row = 3.
### WAYS OUT
Close (back to the exact list row, scroll kept) · "Open page" opens the full page in the SAME tab with a back arrow (NAV-MAP item 13), never a new CRM tab · the other party's name opens their Record (CRM) · Goods in (Operations) · Pay or Mark paid (Finance) · Dispute opens Tasks > Disputes on that chit, or is greyed with its sentence, never a silent close (item 12; the server answers may/why) · the page has its own URL, `#/chit/<id>`, so the browser's back works.

### Current fields to read (real API: `GET /api/work/:chit_id`, fixture `e2e/fixtures/web-api.contract.json`)
`chit_id` · `kind` · `tab` · `stage` · `word` (the step in words) · `status` · `side` (sell or buy) · `subject` · `ref` · `party` · `party_id` · `channel` · `fulfilment` · `address` · `requested_for` · `remark` · `total_minor` · `currency` · `lines_n` · `lines_open_n` · `billed` · `despatched` · `assignee{id,name}` · `created_at` · `age_days` · `actions{accept, reject, complete, cancel, reopen, assign_task, assign_line, deliver_line, amend}`, each `{ok, why, say, needs[]}` · `lines[]` = `line_id` · `particulars` · `qty` · `unit` · `price_minor` · `delivered` · `remaining` · `assignment{assignee_name, history[]}` · `settings{due, task, note, state}` · `actions{assign_line, deliver_line, amend}`.
The money sections still come from the frozen invoice through `CBTax.moneyOf` (list above). `particulars` can hold an id ("Item 2000...") for a line with no name: the page must show the item's name, so the designer draws the line with a name slot and cb-orders fixes the source. Money is `*_minor` integers painted through the one money unit.
**Actions are the server's:** draw every action in `actions{}` as a button; `ok:false` is greyed WITH `say`; `needs:["reason"]` opens a one-line reason box first. Never hide one (show action, enable by role).

### Sample (label "Sample"; from the work fixture)
Order SO-1 "Order 1", from Meena, online, pickup on 12 Oct, remark "Ring first", 1,200.50 INR, 2 lines (one open; 5 kg at 100.00, delivered 5, assigned to Asha), step "New". Actions: Accept (already done), Reject, Cancel and Complete (ask for a reason), Reopen greyed "This chit cannot move to that step from where it is now."; assign and amend greyed for a view-only login: "Your access is view-only. You can read this chit but not change it."

### Added states
A chit with no stored figures (an error line, not a number) · the Dispute unit not loaded (the button routes to Tasks > Disputes) · opened from a notification whose chit is not yours ("We can't find that bill" + Back; the 404 of `GET /api/work/:chit_id`) · phone: the action bar is fixed at the bottom with the primary action first, tabs become folds, one scroll for the page.
**Open questions for Athi:** 1. Popup, side pane or full page by default on a desktop list? Recommend side pane, full page on a phone. 2. Does the buyer see the seller's internal task and assignee, or only the bill and its status? Recommend only the bill.

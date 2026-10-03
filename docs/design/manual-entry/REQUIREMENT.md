# REQUIREMENT — Manual entries in CB Accounts: "＋ Entry" on the Day book (DRAFT for Athi · 2026-10-02)

**Status:** requirement only. Order: after CBList and CBAvatar (the frozen look), then the CB CRM, then this.
**Pass mark:** docs/design/SYSTEM.md §3a (FROZEN look) · the list standard (the Day book is a CBList) · never "accounting".
**Backlog:** BACKLOG.md › "MANUAL JOURNAL ENTRY" and "Corrections = ADD a record, never edit".

## Why
Athi, 2026-10-02: *"start working on entries within the CB Accounts, add day ledger for manual entries? we need to have a
design to collect most of the information if not all of the information required to fulfill the journal for all three
type of accounts."* Earlier: *"journal entry should be able to create manually also, so need a Plus icon … the format
should be retained."*

Most entries come from bills on their own. The rest come from the shop's day, and today there is no door for them: cash
taken to the bank, the owner putting money in or taking it out, rent paid, a loan, a repair, an asset, a correction.

## Literature: how the systems a shop or its CA already uses do this (the baseline; memory: literature-is-the-baseline)
Athi, 2026-10-02: *"do we have any reference from other systems how do we have to create screen to accomplish the same."*
| System | How a manual entry is made | What we take |
|---|---|---|
| **TallyPrime** (what most Indian CAs know) | Voucher types on keys: Contra F4 (cash↔bank) · Payment F5 · Receipt F6 · Journal F7 · Sales F8 · Purchase F9 · Credit/Debit notes. Single-entry mode: pick the account (Cash/Bank), then the particulars; Tally writes the other side | The event grid = Tally's voucher types in plain words; Contra / Payment / Receipt / Journal map one-to-one, so a CA recognises the logic |
| **Zoho Books** | Simple modules for daily things (Expenses, Banking › Transfer) + Accountant › Manual Journals (free Dr/Cr lines that must balance) | Two levels: guided events for the shopkeeper, "Write a journal" for the CA |
| **QuickBooks** | One "+ New" menu: Expense · Cheque · Bill · Transfer · Bank deposit · Journal entry | One ＋ door on the Day book, opening the event grid |
| **Vyapar / Khatabook** (Indian small shops) | Plain words and icons: Cash in / Cash out · Add expense · Bank › Deposit / Withdraw / Transfer · Adjust cash | No bookkeeping words, for people who don't read much |
| **ERPNext** | One Journal Entry form with an Entry Type (Cash, Bank, Contra, Opening, Depreciation, Write Off, Credit/Debit Note …) that presets the lines | Each event presets its lines from a rule: our engine's posting events already work this way |
| **Odoo** | Journal entries in a Miscellaneous journal + payment wizards; corrections by reversal | Reverse, never edit (already decided) |
Every one splits it the same way: guided events for daily life, one free journal for the accountant. **Our addition:**
before saving, the shopkeeper sees which golden rule wrote each line, in plain words. (These references come from how the
products are documented and used; the designer should check current screens before drawing.)

## The idea: ask what happened; the golden rules write the journal
Every ledger already carries its type in the chart (`accounts-packs`: 14 personal · 7 real · 7 nominal groups), and the
posting engine states the golden rules (`posting.js` header):
| Type | What it is | Rule |
|---|---|---|
| **Personal** | people and firms: customers, suppliers, the owner (capital/drawings), a lender, staff, the government (GST) | **Debit the receiver, credit the giver** |
| **Real** | things the shop holds: cash, bank, UPI, stock, furniture, a computer | **Debit what comes in, credit what goes out** |
| **Nominal** | expenses, losses, incomes, gains: rent, salary, power, interest, discount received | **Debit expenses and losses, credit incomes and gains** |
The person never picks "debit" or "credit". They answer **what happened, with whom or what, and how much**. The engine
names the accounts' types and applies the rules, and the screen shows the journal it will post (Dr/Cr lines) BEFORE saving.

## The entry, in four plain steps
1. **What happened?** A grid of common events, each an icon plus two words (memory: *assume they cannot read*):
   - Money moves: cash → bank (deposit) · bank → cash (withdrawal) · between two banks / UPI → bank (contra)
   - Owner: put money in (capital) · took money / goods out (drawings)
   - Paid: rent · salary · power · repair · transport · other expense (each a nominal ledger) · with GST or without
   - Received: interest · commission · rent · other income
   - Bought for the shop: furniture, a computer, a vehicle (an ASSET → the asset register, R2)
   - Loan: taken · EMI paid (principal + interest, R5)
   - Staff: salary advance · advance recovered
   - Adjust: closing stock (R1) · outstanding / prepaid (R6) · depreciation (R2) · bad debt written off
   - **Write a journal** (free form, for the CA): any lines, Dr/Cr chosen by hand, must balance
2. **With whom / what?** Only the fields that event needs, picked rather than typed: a party (the CRM's party list,
   including local customers by name), a ledger (the Ledgers view's own list, grouped by the four bands), a bank, an
   asset class, a loan.
3. **How much, when, on what paper?** Amount (₹, to the paisa) · date (default today; a locked month refuses it before you
   type further) · paid by (cash / bank / UPI / cheque, with the cheque's number and date; a cheque posts on CLEARING, C3)
   · the document no. (bill, receipt, challan) · a photo or file of it (the vault) · a short narration (prefilled from the
   event, editable).
   - **With GST** (an expense bill with tax): the supplier's GSTIN, the rate or the bill's tax lines → the tax engine
     reads the bill. Never hand-computed, and input credit only when the bill qualifies (s.16; blocked credits s.17(5)
     are flagged).
4. **Check and save.** The journal it will post, in the Day book's own lines (code · ledger · Dr · Cr), with each line's
   TYPE and the rule that put it there ("Bank: real, comes in → Dr"). Dr = Cr to the paisa or Save stays off. Then
   **Save**: one entry (JV/…), source `manual`, by whom, idempotent by its own reference so a double tap never posts twice.

## Who chooses the numbers (Athi, 2026-10-02: *"how each entry to be posted against the designated number, who chooses, is it system or the person has to choose?"*)
- **Manual entries number on their OWN series, MJ/** (Athi, 2026-10-02): JV/<fy>/<n> is the system's (bills, payments, day close, set-off); MJ/<fy>/<n> is a person's (every ＋ Entry, every Reverse, every correction). Both gap-free per shop per FY, never typed or reused. Tally numbers each voucher type separately; an auditor filters manual journals first (SA 240). The api already draws numbers from a named series (lib/books.js S.nextNo(…, 'JV', fy)).
- **The entry number (JV/2026-27/000123): always the system.** Next in sequence, gap-free per shop per financial year
  (engines `accounts-packs.jvNo`). Never typed, never edited, never reused. A reversal gets its own number and names the
  entry it reverses.
- **The ledger code each line posts to: the system, from the event.** Event → rule → the country pack's code (e.g. "Paid:
  rent" → expense class `rent` → 6010; the bill's GST → 2210/2211 from the tax engine; cash → 1400; a customer → 1300
  against that party's P-no). The person chooses ONLY what the event can't know: which bank account, which party, which
  asset class. They pick it by name; the code shows beside it.
- **A shop's own ledger** ("Generator diesel"): the person names it and picks its group; the system assigns the next free
  code in that group's range (`accounts-packs.nextCode`; Books v2: shop-added ledgers get an auto code, role null).
- **Never the person's choice in a guided event:** the GST heads, the debtors/creditors control accounts, and the Dr/Cr
  side. The golden rule decides the side.
- **"Write a journal" (the CA):** the accountant picks each ledger by name and its Dr/Cr, like Tally F7. The system still
  numbers the entry, requires Dr = Cr, and names each line's type and rule so a wrong side stands out.
- The preview shows each line as **code · ledger · type · the rule that placed it** before Save.

## Rules it keeps (already decided)
- Insert-only: a saved entry is never edited. **Reverse this entry** on any Day book row adds the mirror entry, and a
  correction is a new entry (Companies Act audit trail, Apr 2023; Books v2).
- A locked month refuses a typed date (PERIOD_LOCKED, "Open it again (with a reason) …"); closed for good refuses always.
- Suspense: a free-form journal that doesn't balance is NOT saved into Suspense; it waits as a draft.
- Who: the owner, and a co-assist the owner has allowed (IAM: editor on CB Accounts). Everyone else reads.
- One computation: the engine composes the lines (posting rules / the golden rules); the page only shows them.

## What the engines need (from the year journey's gaps)
An asset register (gap 4) for "Bought for the shop" · an Insurance expense class (gap 3) · a cheque-dishonoured-after-
clearing event (gap 2) · a proprietor's Capital account shown as one (gap 6). The events above that already exist:
expense, other_income, manual, opening, closing_stock, accrual, loan_taken/repaid, depreciation, write_off,
payment_received/made, gst_setoff/payment.

## States to design
the event grid · each event's short form (phone first) · the journal preview (balanced / not balanced) · a locked month ·
GST bill (credit allowed / blocked) · cheque pending clearing · saved (with Reverse) · a draft journal · not allowed
(read-only) · could not save (plain words, Try again).

## Pass checks for the build (later)
For each event: the lines equal a hand-worked journal (golden-books style), Dr = Cr, each line's type and rule are named;
a locked month refuses; a double tap posts once; Reverse posts the mirror; the entry shows in the Day book, Ledgers and
Trial balance with no new style.

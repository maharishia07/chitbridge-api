# REQUIREMENT — Opening balances: bring your old books in (DRAFT for Athi · 2026-10-02)

**Status:** requirement only. Not designed, not built. Next: Athi reads → designer → build (Sonnet).
**Pass mark:** `docs/design/SYSTEM.md`. Never the word "accounting"; this is the Ledger.
**Backlog:** `C:\dev\BACKLOG.md` › "LEDGER PANELS" › Opening balances ([O] design first).

## Why
Today the screen is a raw CSV text box ("code, party no, debit, credit, bill, due date"). A shopkeeper cannot use that
(memory: *assume they cannot read*). Yet it is the way IN for every shop that already keeps books, whether in Tally, a
spreadsheet or a notebook. If the opening is wrong, every balance sheet after it is wrong.

## The API (exists; no new endpoint needed)
`POST /api/books/opening { date?, rows: [{ code, party_no?, dr_minor, cr_minor, bill_ref?, due_date? }], client_ref }` →
`{ entry_no, suspense_minor, lines }` (chitbridge-api routes/books.js:536). It is ONE entry in period 0 (`is_opening`). A
party row names its bill, so dues are bill-wise from day one. Any difference between debits and credits goes to **2900
Suspense**, and Suspense must be nil before the year can close. A second tap never records twice (`client_ref`). Owner only.

## Who
The owner, once, when they start. Often with their CA, or with last year's balance sheet or Tally trial balance in hand.

## The flow (the designer decides the look)
1. **Start date:** "Your books start on" (default: 1 April of this financial year).
2. **Three ways in, one result:**
   - **By hand, guided.** Go through the four Ledger bands the index page already uses (DECISIONS: People · Things you hold ·
     Income and expenses · Results). Cash in hand? Bank balance? GST credit / payable? Stock value? Each is one question
     with a ₹ box, never a ledger code.
   - **People, bill by bill:** each customer who owes you and each supplier you owe, with the bill no, amount and due date,
     picked from the CRM's party list (or added by name, web #24). This is what makes Dues right from day one.
   - **Import:** a Tally trial balance or a spreadsheet. Show how each line matched a ledger (matched · guessed · not
     matched), the same pattern as the catalogue import. Nothing is saved until the person says so.
3. **Check before save:** the totals of both sides. If they differ, show the difference as "will sit in Suspense until
   fixed", with the button that takes you to the line most likely wrong. One **Save opening** button.
4. **After save:** "Opening entry JV/… recorded on <date>". It is read-only from then on. A correction is a new adjusting
   entry, never an edit (DECISIONS: corrections ADD a record).

## States to design
nothing entered · part entered (saved as a draft on the device, never posted) · balanced · unbalanced (Suspense) · import
with unmatched lines · already recorded (read-only, with "Add a correction") · not the owner (read-only) · phone.

## Not in scope
The posting itself (the API does it) · moving a test shop to live (that's the "promote" design, a transfer entry).

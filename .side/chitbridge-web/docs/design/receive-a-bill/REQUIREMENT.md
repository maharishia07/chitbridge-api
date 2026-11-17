# REQUIREMENT — Receive a bill (DRAFT for Athi to read · 2026-10-02)

**Status:** draft, written from Athi's live test on 2026-10-02 (Chola Auto Care receiving Tally Test's counter bills
C2/26-27/0007, 0008, 0009). Not designed, not built. Next: Athi reads → designer → build.

## Who and when
A shopkeeper who has just received goods with a supplier's bill (a bill sent on the rail). They are at the counter or
the back room, often on a phone, often with the goods in front of them. They may not read well
([[Assume they cannot read]]): symbols, digits and the supplier's own printed bill do the work, not sentences.

## What Athi asked for (his words, live)
1. *"if more than one bill received, all will be in queue one after the other"* — several bills are a **queue**.
2. *"there is a difference between bill and the one showcasing here, the GST is not appearing"* — what the buyer sees
   must be **the same bill the seller printed**: same lines, offers, taxable, GST, total.
3. *"this is not the cart style design"* — it looks like the **bill / cart**, not a data table.
4. *"just showing accept text, nothing is happening"* — after Accept, the screen must **visibly change**.
5. *"it is not showing resale, asset kind of column"* and *"directly treated as expense, but didn't ask for the
   category"* — **what the goods are for** is asked, on screen, **before** Accept.
6. *"a checkbox for each of the item, and the select all button … each item can be checked and that could be an input
   for material as well"* — ticking a line = **this arrived**; it feeds the goods received (GRN).
7. *"the information showcase is not human friendly … it has to be opening the invoice and other information to
   accept it"* — no ids, no retry counts; every row **opens the bill**.

## The screen, in one line each
- **The list — "Bills to accept"** (CB Accounts › Bills › Received, and the Day book to-do): one row per bill —
  supplier · bill no · date · amount · items · **Open**. Oldest first. Nothing technical.
- **Open → the bill, as printed**: the seller's lines with offers, then Taxable · GST (rate-wise) · Total, and how it is
  to be paid (on credit / paid). Figures come from ONE calculation shared with the seller's printed bill — never
  recomputed in the browser.
- **Per line**: a **checkbox** (arrived) · **received quantity** (defaults to the billed one; less = short) · **for:**
  resale / use / asset (default from my catalogue: a product I sell = resale, else use; the line can be changed).
  **Select all** and **one "for" for the whole bill** at the top.
- **Accept** → posts the purchase (or expense / asset) for what was ticked; the bill shows **Accepted**, the buttons
  change, and the **next bill in the queue opens** ("2 of 3"). Nothing else to tap.
- **Not everything arrived** → Accept the ticked lines and raise a **short / damaged** note for the rest (the debit
  note / PRN in BACKLOG "THE TWO-SIDED COUNTER BILL"); the money follows only what was accepted.
- **Dispute** → the existing dispute, from the same screen.
- **ONE MODULE, EVERY DOOR** (Athi, 2026-10-02: *"they can do it from here also assuming the same activity is
  expected, so call the same module here"*). Receive-a-bill is ONE module; every place a received bill shows calls it
  with the bill (and the queue it belongs to) — never its own copy of the screen or the actions:
  - CB Accounts › **Bills** › Received (the list)
  - the Day book's to-do **"N supplier bills to accept"**
  - CB Accounts › **Waiting** — a row that waits on "confirm the goods were received" opens the module, and Accept
    there does exactly what it does anywhere else. Rows read as a sentence (supplier · bill no · amount), no chit id,
    no "tries"; "Try again" only for a posting that genuinely failed.
  - the bell / the index page's to-do, when they list a received bill
  One door's Accept must leave every other door showing the same step at once (the list, the to-do count, Waiting).

## Open questions for Athi
- A line not ticked and not disputed — is it "not arrived yet" (the bill stays open) or "short" (debit note)?
- Received quantity more than billed — refuse, or accept the billed quantity and flag?
- Does accepting part of a bill post part of the purchase now (and the rest later), or wait until the bill is closed?

## Depends on (do first)
- **The tax truth** (BACKLOG, 2026-10-02): the counter printed GST ₹0.00 while both ledgers posted ₹119.95 for the same
  bill. The screen shows ONE calculation, so that calculation must be right first.
- **The popup's status bugs**: Accept recorded but the sheet kept showing "To accept"; the accepted bill still counted
  in the to-do (the sheet reads the shared status, the API keeps each shop's step privately since bills-private).

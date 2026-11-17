# Designer brief — the bill (the counter slip, 72 mm and A4) 

**Status:** brief for design. **Not built.** **Pass mark:** `docs/design/SYSTEM.md`.
Athi, 2026-10-09, after Claude made 3 bills at Mayur Bhavan: *"check the bill, I am not convinced — the feel of the bill."*
Observations BF1–BF11, TB1–TB10 in C:/dev/TEST-LOG-2026-10-09.md. Sample bill: C5/26-27/0001 (₹235, cash).

## 1 · What is wrong today (the slip as printed)
- "TAX INVOICE" printed with **GST ₹0.00** (items had no rate) — no warning at the counter.
- Address **Chennai, Tamil Nadu** with GSTIN **29…** and "Place of supply 29" (Karnataka) — printed unchecked.
- No CGST / SGST split, no rate per line, no HSN/SAC; no FSSAI licence number (a restaurant must show it).
- The chosen **modifier** ("Medium" spice) and **Dine-in / Takeaway** are not on the slip.
- "Counter 1" printed while the number is **C5/…**.
- Five summary rows before the TOTAL; the total is not the biggest thing; "1 plate × ₹50.00" under every single item.

## 2 · Rules the slip must follow (the STANDARD — memory "literature is the baseline"; verify at build)
- **Which document:** a registered shop with tax on the items → **Tax Invoice**; a shop on composition or unregistered →
  **Bill of Supply** (no tax charged); never "Tax Invoice" with no tax. The engine decides; the slip prints its answer.
- **Tax invoice must show** (GST invoice rules, from knowledge): supplier name, address, GSTIN; invoice number + date;
  per line description, quantity, rate/value; **HSN/SAC** (code length by turnover); taxable value; **rate and amount of CGST +
  SGST** (intra-state) or **IGST** (inter-state); place of supply (state); total. A B2C slip under the limit need not name the buyer.
- **Restaurants:** FSSAI licence number on the bill (FSSAI order, 2021).
- **State check:** the address's state = the GSTIN's first two digits; refuse to print a tax invoice that contradicts itself —
  say it in words to the cashier with the fix (memory: write for the shopkeeper).
- Money is the engine's (one frozen invoice, `money.js`); the slip only lays it out — never computes.

## 3 · What the slip should feel like
- **Header:** logo (optional) · shop name large · address one line · GSTIN · FSSAI · phone.
- **Title:** TAX INVOICE / BILL OF SUPPLY · number · date + time · **Dine-in (table 4) / Takeaway / Delivery** · who billed (the person).
- **Lines:** name · qty × rate only when qty > 1 · amount; the **modifier** under the item, small ("Medium spice").
- **Totals:** taxable · CGST x% · SGST x% (one row per rate when mixed) · **TOTAL — the biggest thing on the slip** · paid by (cash / card /
  UPI, change given).
- **Footer:** thank-you line (the shop's own) · a QR to the bill (the customer keeps a copy, "Billed on ChitBridge").
- **Widths:** 72 mm (58 mm too) and A4 portrait. Tamil/Hindi names when the shop keeps local names. Light only (paper).

## 4 · Shots wanted
72 mm: a cash dine-in bill with a modifier · a card takeaway bill · a mixed-rate GST bill (5 % + 18 %) · a Bill of Supply ·
the refusal at the counter when the state and the GSTIN disagree. A4: the same tax invoice.

## 5 · Reuse
The till's bill renderer (till.html — master in chitbridge-api tools/tally-connector, vendored to web) · the tax engine (engines tax,
rate per item from the catalogue) · the frozen invoice in `summary_json` · the day-close slip (already good — keep its tone).

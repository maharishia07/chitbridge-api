# Designer brief — the Ledgers page, again (2026-10-03)

Athi, on a live screenshot (Chola Auto Care › Ledgers › 2100 Suppliers, Dark theme): *"this screen needs a bit more make over, if
the same information is repeated twice, can we shrink … also left side folder structure, and the entire page … ask designer what
else can be done."*

**Your earlier design** is in this folder (index.html / styles.css). Since then the look was FROZEN: docs/design/list-standard/index.html
and SYSTEM.md §3a (three-row head ≤ 20%, every list a CBList, adjustable columns, only the rows scroll, the one avatar, 16 themes incl.
Dark and Terminal). The page must work in every theme. The CB Accounts layout (docs/design/cb-accounts-ia) puts Ledgers under Reports
/ People. Please redesign the WHOLE page, the left tree included, and tell us what else you'd change.

## What we found (start here, not the limit)
1. "Expense · Expense C2/26-27/0007": the kind and the document type repeat.
2. The closing figure appears three times (Closing −₹3,720.12 · Total of the parties ₹3,720.12 · Ledger closing ₹3,720.12) with
   changing signs. We want one line: opening · closing (Dr/Cr) · "parties agree", or the difference named.
3. Minus signs on a creditor's balance; the tree already says "₹3,720.12 Cr". One notation everywhere.
4. Opening an entry shows its journal lines, and a sideways scroll cuts them off on the left ("EDGER", "ndry expenses"). No sideways
   scroll; the opened detail must stay readable.
5. On a party's own ledger the party repeats on every row and inside every opened entry.
6. The head still has date boxes + Show; the standard is the period chip.
7. The LEFT TREE: People / Things you hold / Income and expenses / Your capital (the four bands) → groups → ledgers → parties. One
   account wraps over four lines; counts and amounts don't align; selection is a heavy filled block. How should a shopkeeper move
   through ~50 ledgers and their parties on a phone and on a laptop?

## Data (what each row has; nothing is computed on the page)
Ledger: code · name · nature · group/band · opening · closing (Dr/Cr) · for control accounts the parties with their balances.
Each entry line: date · voucher no. (SV/PV/RV/PY/CV/CN/DN/JV/MJ + its type) · kind · document no. + time · tender · counter · rung by ·
party · Dr · Cr · running balance; opening an entry shows its journal lines (code · ledger · Dr · Cr) and its gist.
Monthly party reconciliation (coming): "✓ Agreed with <party> to <month end>" markers on lines.

## Please return
The same handoff shape as before (index.html · styles.css · app.js · data.js · README.md), every state at 1366×768 and 390 px, in
Cream, Dark and Terminal: tree open/folded, a control account with parties, a plain ledger, a party's ledger, an entry opened, empty
period, a long name. And a short list of anything else you'd change.

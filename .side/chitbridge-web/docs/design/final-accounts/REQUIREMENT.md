# REQUIREMENT — Final accounts in the standard format: Trading · P&L · Balance sheet (DRAFT for Athi · 2026-10-02)

**Status:** requirement only. Not designed, not built. Next: Athi reads → designer → build (Sonnet).
**Pass mark:** `docs/design/SYSTEM.md` (tokens, fonts, 390 px, ≤ 3 columns in a grid, no truncation, short strings; never
the word "accounting" on a screen — this is the **Ledger**).
**Backlog:** `C:\dev\BACKLOG.md` › "BALANCE SHEET IN THE STANDARD FORMAT" and "ACCOUNTS AUDIT".

## Why
Athi, 2026-10-02, on the live Balance sheet (Chola Auto Care): *"balance sheet format, is it the standard, if not, bring the
standard format as well"*. It isn't:
- Input CGST/SGST/IGST appear as **negative liabilities** (−₹399.00). GST credit is an **asset**.
- "Assets · Total ₹0.00", and the other side is also ₹0.00. The sides must show their real totals (₹399.00 = ₹399.00).
- "Owner · Profit for the year to date −₹3,321.12": there is no **capital account**, and a loss reads as a negative profit.
- No stock and no Trading account, so a shop can't see its **gross profit**.

## Who
The shop owner, and their accountant at year end. The owner reads it like the printed final accounts a CA hands over, so it
must look like that, not like a database table. The accountant checks it against Schedule III or the familiar proprietor format.

## The data (READ only; the engine computes, the page lays out)
- `GET /api/books/bs?date=` → the flat keys (today) plus the **Schedule III grouping** (heads in order; each head's
  ledgers with code, name and amount; head totals; side totals; `balanced` and the difference). API branch `feat/bs-by-line`.
- P&L and Trading: `ledger.profitAndLoss()` and, from engines v1.14.0, `ledger.tradingAccount()` (gross profit = net sales −
  cost of goods sold).
- `books.entity_type` (company · proprietor · partnership · LLP …), which is TO BE SETTLED: read from the registration
  profile, else asked once. It chooses the layout.
- Never a sum on the page except laying out the head totals the API already sends.

## Layout by entity type (the designer draws both)
**A · Proprietor / partnership: the traditional horizontal format** (what most shops' CAs print):
| Liabilities | ₹ | Assets | ₹ |
|---|---|---|---|
| Capital A/c: opening · add net profit / less net loss · less drawings | | Fixed assets (less depreciation) | |
| Loans | | Closing stock | |
| Sundry creditors (by party on tap) | | Sundry debtors (by party on tap) | |
| Outstanding expenses · advances from customers | | Cash · Bank · UPI | |
| GST payable (net) | | GST credit (net) · prepaid · advances to suppliers | |
| **Total** | | **Total** | |
On a phone the two sides stack: Liabilities, then Assets, each with its total.

**B · Company: Schedule III vertical**, with a note number per head and a previous-period column:
I. Equity & Liabilities: Shareholders' funds · Non-current liabilities · Current liabilities (trade payables, other current
liabilities, short-term provisions) · Total. II. Assets: Non-current (PPE, investments) · Current (inventories, trade
receivables, cash and cash equivalents, short-term loans and advances, other current assets) · Total.

**Trading account and P&L** (both formats): Trading (opening stock, purchases less returns, direct expenses | sales less
returns, closing stock) → **Gross profit** → P&L (indirect expenses | gross profit, other income) → **Net profit / Net loss**.
The words are "Net loss", never a minus sign on "profit".

## Behaviour
- A head is one line; tapping it opens its ledgers, and tapping a ledger opens that ledger (the one list control, web #21).
- A date (as at) plus a comparison period; Download (PDF as printed, CSV).
- "✓ Balances" chip stays; if the API says `balanced:false`, show the difference as a warning WITH the button that opens
  Suspense / the trial balance (rule: every warning carries its fix).
- The month lock state shows next to the date (locked months can't change under you).

## States to design
proprietor · company · a loss · a profit · no stock entered yet ("Closing stock not entered — profit may be understated" +
Enter closing stock) · GST credit vs GST payable · out of balance · first month (no comparison) · empty shop · phone.

## Not in scope
Posting rules (engines v1.14.0 does them) · closing-stock / asset-register / GST-close forms (separate requirements after
v1.14.0 is adopted) · the counter.

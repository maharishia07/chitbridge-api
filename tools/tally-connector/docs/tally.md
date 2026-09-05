# Tally connector — instructions

**What it does.** Reads your stock items from Tally into the ChitBridge catalogue (matched by part number / name, only what changed is sent), gives the offers engine to your billing (send basket lines, get back what comes off and why), and books every ChitBridge order into Tally as a Sales voucher the moment it arrives — once, never twice.

**What you need.** A Windows PC with Tally Prime or Tally.ERP 9 and Node.js 18 or newer (nodejs.org, LTS). Outbound internet. Nothing to open on your router.

## 1. Tally
Gateway of Tally › F1 (Help) › Settings › Connectivity › Client/Server configuration: set **TallyPrime acts as: Both**, **Enable ODBC**: Yes, port **9000**. Keep the company you want to sync open.

## 2. ChitBridge
Settings › Integrations › Connectors › Tally › **Download · tally**. Then Settings › Integrations › Your keys › scope **connector** › Mint. Copy the key now; it is shown once.

## 3. The kit — the easy way
Double-click **start.cmd** (Windows) or run . It asks for the key, where your system listens and the ledgers, tests both ends, writes connector.json, runs the first sync, and prints the next command. Nothing is installed inside Tally or Zoho.

## 3b. The kit — by hand
Unzip. Open `connector.json` and paste the key. Check `tally.url` (`http://localhost:9000`) and, if you want, `company`, `partyLedger` (default Cash), `salesLedger` (default Sales), `bankLedger` / `cashLedger` (the Receipt voucher when you mark a chit paid) — these must be ledger names that exist in Tally.

## 4. First run, safely
```
node index.js sync-products --config connector.json
```
Expect `{"read":N,"added":N,…}`. Open ChitBridge › Catalogue: your items are there with their rates. Run it again: `unchanged:N`.

```
node index.js once --config connector.json --dry
```
Prints the voucher XML for any order already waiting, without posting it. When it reads right:
```
node index.js watch --config connector.json --sync-minutes 30
```
Leave this window open. Place an order on your storefront from a phone: within a second the window prints `bell:` and `order → tally created:1`, and the voucher is in Tally (Day Book) with reference `CB-xxxxxxxx`.

## 5. Every day
Run `watch` when the PC starts (Task Scheduler › At log on › `node C:\path\index.js watch --config C:\path\connector.json`). `sync-products` whenever you change rates in Tally. Settings › Integrations › Running connectors shows the last time it checked in and what it moved.

## If Tally refuses a voucher
The window prints `Tally refused the voucher: …`. The usual causes: a ledger name that does not exist (partyLedger / salesLedger), a stock item whose name differs from the catalogue name, or a company not open. Fix the cause and run `node index.js once` — the order is retried; nothing is duplicated.

**Honest note.** This adapter was written from Tally's XML contract and proven against a stand-in. Your first live run may show a field Tally names differently; tell us the message and it is a one-line correction.

## When you mark a chit paid
Open the order in ChitBridge (Task) → the Payment cell → **Mark paid** (UPI / cash / card / bank, the transaction id). The
watching connector books a **Receipt** voucher in Tally the same second: Dr your bank ledger (`bankLedger`, default "Bank";
`cashLedger` for cash) · Cr the party ledger · against reference CB-<ref>, so the bill closes. A cash sale (`partyLedger` =
Cash) needs no receipt — the Sales voucher already settled it — and the connector says so in its receipts file.
`--dry` prints the receipt XML instead of posting it. Both ledgers must exist in Tally (Gateway › Create › Ledger).

## TallyPrime Educational edition
The free EDU edition accepts vouchers dated the **1st, 2nd or 31st** of a month only, and refuses others with the unhelpful
"Voucher date is missing". Set `"eduDates": true` under `tally` in connector.json: the voucher date snaps to the 2nd of its
month and the narration keeps the real order date. Leave it off on a licensed Tally.

## Seeing the vouchers in Tally
Gateway of Tally › **D** (Display More Reports) › **D** (Day Book); **F2** to set the period (EDU vouchers sit on the 2nd).
Alt+G and typing "day book" runs a text search through your transactions and finds nothing — pick the entry under *Reports*.
Enter on a line opens the voucher: the reference is CB-<first 8 of the chit id>, the narration carries the order and payment.

## ⚠️ Requests that freeze TallyPrime
A Collection with an unknown `<TYPE>` makes Tally stop answering its port until someone presses Esc in Tally itself.
Seen twice on 2026-09-05 with `TaxUnit` and `GSTRegistration`. The connector only ever sends `Company`, `Ledger`,
`StockItem`, `Voucher` and Import Data — do not add a TYPE you have not seen answer.

## If Tally was closed when an order came
The connector keeps a receipt per order. A voucher that failed because Tally was closed is retried every 5 minutes
(`retryMinutes` in connector.json, `--retry-minutes` on the command line) and lands once, the moment Tally is open again.
If the PC itself was off, the first `watch` after boot catches up. To start the connector with Windows, put a shortcut to
`start.cmd` in the Startup folder (Win+R › `shell:startup`).

## When you are the buyer
Set `"role": "both"` (or `"buyer"`) in connector.json. An order you placed on ChitBridge, once you mark it **completed**
(goods received), becomes a **Purchase** voucher in your Tally: the seller as a supplier under Sundry Creditors with their
GSTIN, the materials as stock items (created with unit, HSN and rate if you never stocked them), the input CGST/SGST or
IGST as your ITC claim, the supplier credited for goods + tax against a bill that carries the seller's reference
CB-<8> — the same reference on their Sales voucher. `node index.js purchases` runs it once; `watch` runs it every
`retryMinutes`. The connector checks the voucher's input tax against ChitBridge's own ITC figure and warns on a difference.
Ledgers it creates for this: Purchase (Purchase Accounts), Input CGST / Input SGST / Input IGST (Duties & Taxes).

# Tally connector — instructions

**What it does.** Reads your stock items from Tally into the ChitBridge catalogue (matched by part number / name, only what changed is sent), gives the offers engine to your billing (send basket lines, get back what comes off and why), and books every ChitBridge order into Tally as a Sales voucher the moment it arrives — once, never twice.

**What you need.** A Windows PC with Tally Prime or Tally.ERP 9 and Node.js 18 or newer (nodejs.org, LTS). Outbound internet. Nothing to open on your router.

## 0. The whole installation, in order
1. **Tally**: F1 (Help) › Settings › Connectivity › Client/Server: **TallyPrime acts as Both**, **Enable ODBC: Yes**, port **9000**. Keep the company open. Check: open http://localhost:9000 in a browser on that PC — Tally replies with a short page.
2. **Download** the kit from ChitBridge › Settings › Integrations › Connectors › Tally while signed in — **your key is inside**. Unzip on the Tally PC (for example `C:\chitbridge-connector`).
3. **Double-click start.cmd.** It installs Node.js if the PC has none (say yes to the Windows prompt), asks a few questions (where Tally listens, company, ledgers, Educational edition), tests both ends, syncs your products, registers itself to run on its own, and starts watching.
4. **Approve this PC** (once): ChitBridge › Settings › Integrations › Running connectors shows "<this PC> · <your Tally company> · waiting for approval" → **Approve this PC**. It happens by itself when your Tally company's GSTIN equals the GSTIN on your ChitBridge profile. A kit that lands on the wrong store's PC never gets past this step: a different GSTIN stops it, and an unknown PC waits for you.
5. **How you know it worked**: the window prints `Products: read N · added N`; ChitBridge › Catalogue shows your Tally items; Settings › Integrations shows the connector as **live** with a "last seen" a moment ago. Place a test order from the storefront: the voucher appears in Tally › Day Book within seconds.

## 1. Tally
Gateway of Tally › F1 (Help) › Settings › Connectivity › Client/Server configuration: set **TallyPrime acts as: Both**, **Enable ODBC**: Yes, port **9000**. Keep the company you want to sync open.

## 2. ChitBridge
Settings › Integrations › Connectors › Tally › **Download · tally**. Then Settings › Integrations › Your keys › scope **connector** › Mint. Copy the key now; it is shown once.

## 3. The kit — the easy way
Double-click **start.cmd** (Windows) or run `node setup.js`. It asks for the key, where your system listens and the ledgers, tests both ends, writes connector.json, runs the first sync, and prints the next command. Nothing is installed inside Tally or Zoho.

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
Once: `node index.js install --config connector.json` — a Windows scheduled task starts the watcher every five minutes whenever it is not already running (crash, reboot, closed window); `node index.js uninstall` removes it. (By hand instead: Task Scheduler › At log on › `node C:\path\index.js watch --config C:\path\connector.json`.) `sync-products` whenever you change rates in Tally. Settings › Integrations › Running connectors shows the last time it checked in and what it moved.

## If something does not work — where to look
| You see | It means | Do |
|---|---|---|
| `Cannot find module … setup.js` / `MODULE_NOT_FOUND`, or start.cmd says it is not beside the kit | start.cmd was run from INSIDE the zip (Windows shows a zip as a folder) | right-click the zip › Extract All › open the chitbridge-connector folder › double-click start.cmd there |
| `Node.js is not installed` from start.cmd | no Node on this PC | nodejs.org › LTS › install › run start.cmd again |
| `Checking the key … FAILED` | the key was not pasted whole, or its scope is not connector | mint a new key (scope connector), paste it in one piece |
| `Checking Tally … FAILED` | Tally's port is off, or the company is not open | Tally: F1 › Settings › Connectivity › acts as Both, ODBC on, port 9000; open the company; the browser test at http://localhost:9000 |
| `Voucher date is missing` | the free Educational edition accepts only the 1st, 2nd and 31st | answer **y** to "Educational edition" in setup (or `"eduDates": true` in connector.json) |
| the connector shows **offline** in Settings › Integrations | the watcher is not running | double-click start.cmd, or run `node index.js install` once so Windows restarts it |
| `waiting for approval` in the window · the row says **waiting for approval** | this PC is not yet approved for this account | Settings › Integrations › Running connectors › Approve this PC (check the PC name and Tally company beside it) |
| `STOP — gstin mismatch` | the Tally company belongs to a different GSTIN than this ChitBridge account | you are on the wrong store's PC, or signed into the wrong account — download the kit from the right account |
| an order arrived but no voucher | Tally was closed at that moment | nothing — it is retried every 5 minutes and lands once Tally is open |

## If Tally refuses a voucher
The window prints `Tally refused the voucher: …`. The watcher creates the ledgers it needs (Sales, Cash, Bank) on start; the usual remaining causes: a ledger name you typed that Tally spells differently, a stock item whose name differs from the catalogue name, or a company not open. Fix the cause and run `node index.js once` — the order is retried; nothing is duplicated.

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

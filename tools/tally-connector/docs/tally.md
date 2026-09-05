# Tally connector — instructions

**What it does.** Reads your stock items from Tally into the ChitBridge catalogue (matched by part number / name, only what changed is sent), gives the offers engine to your billing (send basket lines, get back what comes off and why), and books every ChitBridge order into Tally as a Sales voucher the moment it arrives — once, never twice.

**What you need.** A Windows PC with Tally Prime or Tally.ERP 9 and Node.js 18 or newer (nodejs.org, LTS). Outbound internet. Nothing to open on your router.

## 1. Tally
Gateway of Tally › F1 (Help) › Settings › Connectivity › Client/Server configuration: set **TallyPrime acts as: Both**, **Enable ODBC**: Yes, port **9000**. Keep the company you want to sync open.

## 2. ChitBridge
Settings › Integrations › Connectors › Tally › **Download · tally**. Then Settings › Integrations › Your keys › scope **connector** › Mint. Copy the key now; it is shown once.

## 3. The kit
Unzip. Open `connector.json` and paste the key. Check `tally.url` (`http://localhost:9000`) and, if you want, `company`, `partyLedger` (default Cash) and `salesLedger` (default Sales) — these must be ledger names that exist in Tally.

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

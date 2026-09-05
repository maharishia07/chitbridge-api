# Zoho Books connector — instructions

**What it does.** Reads your items from Zoho Books into the ChitBridge catalogue, gives the offers engine to your billing, and creates a Zoho invoice for every ChitBridge order the moment it arrives — once, never twice.

**What you need.** Any PC with Node.js 18 or newer, a Zoho Books organisation, and an OAuth access token for it.

## 1. Zoho
Zoho API Console (api-console.zoho.com) › Self Client › scope `ZohoBooks.fullaccess.all` › generate a code, exchange it for a refresh token and an access token as Zoho's docs describe. Note your **organisation id** (Zoho Books › Settings › Organisation Profile) and your **region** (accounts.zoho.**in**, .com, .eu …).

## 2. ChitBridge
Settings › Integrations › Connectors › Zoho Books › **Download · zoho**. Then Your keys › scope **connector** › Mint; copy the key.

## 3. The kit — the easy way
Double-click **start.cmd** (Windows) or run . It asks for the key, where your system listens and the ledgers, tests both ends, writes connector.json, runs the first sync, and prints the next command. Nothing is installed inside Tally or Zoho.

## 3b. The kit — by hand
Unzip. In `connector.json`: paste the key; set `zoho.base` (`https://www.zohoapis.in` for India), `zoho.org` (organisation id), `zoho.token` (the access token), `zoho.customer_name` (the Zoho customer an order is booked to, e.g. `Walk-in`).

## 4. First run
```
node index.js sync-products --config connector.json
node index.js once --config connector.json --dry
node index.js watch --config connector.json --sync-minutes 30
```
Same three steps as every connector: products up, a dry look at the first invoice, then watch. Settings › Integrations › Running connectors shows it checking in.

**Access tokens expire (one hour).** Put the refresh token and client credentials in `connector.json` under `zoho` and the connector will refresh on a 401 in a future release; today, replace `zoho.token` when it expires — the window prints `Zoho 401`.

**Honest note.** Written from Zoho Books' published API and proven against a stand-in. The first live run may need `customer_id` instead of `customer_name`, or `item_id` on lines; both are one-line corrections in `adapters/zoho.js`.

## When you mark a chit paid
The connector records a **Customer Payment** in Zoho Books against the invoice it created for that order
(`POST /books/v3/customerpayments`: customer, amount, date, reference = your transaction id, applied to the invoice).
UPI is sent as payment mode `others` with the description "UPI" — Zoho has no UPI mode of its own. If the order's invoice
was never created (the order push failed), the receipt is skipped and says so in the receipts file.

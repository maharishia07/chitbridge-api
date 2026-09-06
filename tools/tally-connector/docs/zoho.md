# Zoho Books connector — instructions

**What it does.** Reads your items from Zoho Books into the ChitBridge catalogue, gives the offers engine to your billing, and creates a Zoho invoice for every ChitBridge order the moment it arrives — once, never twice.

**What you need.** Any PC with Node.js 18 or newer, a Zoho Books organisation, and an OAuth access token for it.

## 0. The whole installation, in order
1. **Zoho API console** (https://api-console.zoho.in for India; .com / .eu / .com.au / .jp elsewhere) › **Add Client** › **Self Client** › Create. Copy the **Client ID** and **Client Secret**.
2. Same page › **Generate Code** tab › scope `ZohoBooks.fullaccess.all` › duration **10 minutes** › a description › Create › copy the **code**. It works once, within ten minutes — do step 4 right after.
3. **Download** the kit from ChitBridge › Settings › Integrations › Connectors › Zoho Books while signed in — **your key is inside**. Unzip.
4. **Double-click start.cmd** (installs Node.js if needed). Answer: system `zoho`, region, Client ID, Client Secret, the code. The kit exchanges the code for a **refresh token** and keeps it; from then on it renews the access token itself. It lists your organisations — pick one — and reads your items.
5. **Approve this PC** once in ChitBridge › Settings › Integrations › Running connectors (automatic when the organisation's GSTIN equals your profile GSTIN).
6. **How you know it worked**: `Products: read N`; your items under Catalogue; the connector row says live. Place a test order: an invoice appears in Zoho Books with reference CB-<ref>.

## 1. Zoho — by hand
If you would rather not use setup: `connector.json` › `zoho`: `base` (`https://www.zohoapis.in`), `client_id`, `client_secret`, `refresh_token` (exchange the code yourself as Zoho's docs describe), `org`, `customer_name`. A plain `token` still works and dies after an hour.

## If something does not work — where to look
| You see | It means | Do |
|---|---|---|
| `Zoho OAuth: invalid_code` | the code was used already, or is older than 10 minutes | Generate Code again, run start.cmd again |
| `Zoho OAuth: invalid_client` | Client ID / Secret mistyped, or the console region differs from the API region | copy both again from the same console; region in setup must match (in / com / eu) |
| `Zoho gave no refresh token` | the code was generated without the Books scope | scope `ZohoBooks.fullaccess.all` |
| `Zoho 401` while running | the refresh token was revoked in Zoho | run start.cmd again and answer y to "get a new one" |
| `Zoho 429` | the daily / per-minute API cap | nothing — retried at the next tick; raise `syncMinutes` / `stockMinutes` on the Free plan |

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

## Registered buyers and walk-ins
A walk-in order books under one **Walk-in** contact the connector creates (Zoho needs a customer on every invoice). An
order from a registered business creates that buyer as a customer once — GSTIN, place of contact, billing address — and
the invoice carries the GSTIN, the place of supply and the org's GST tax group on each line, so Zoho splits CGST/SGST
against IGST itself. Offers arrive as a discount on the line; the amount stays the chit's.

## Zoho's daily API cap
Free plan 1,000 calls a day · Standard 2,000 · Professional 5,000 (100 a minute on all). With the default schedule the
connector uses about 380 a day before orders; set `"syncMinutes": 30` and `"stockMinutes": 15` in connector.json for a
Zoho org on the Free plan and it is about 140. A 429 from Zoho is retried at the next tick, nothing is lost.

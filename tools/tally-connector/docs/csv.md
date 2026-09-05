# File connector (CSV) — instructions

**What it does.** The same connector with files instead of a system: `products.csv` in, one CSV per order out. Any system that can export and import a file attaches this way today — a spreadsheet, GoFrugal, a POS, a billing package.

**What you need.** Any PC with Node.js 18 or newer.

## 1. ChitBridge
Settings › Integrations › Connectors › File connector › **Download · csv**. Your keys › scope **connector** › Mint; copy the key into `connector.json`.

## 2. Your products
Beside the kit, `products.csv` with a header row: `name, code, unit, price` (optional `hsn`, `category`). Export it from your system; code is the identity — keep it stable.

## 3. Run
```
node index.js sync-products --config connector.json     # products.csv → catalogue (only changed rows are sent)
node index.js watch --config connector.json --sync-minutes 30             # every order arrives as orders/<chit>.csv: chit, buyer, name, code, qty, unit, price, list_price, offer, total
```
Import `orders/*.csv` into your system however it takes files. A receipt is kept per order; the same order is never written twice.

**Offers back.** `node index.js evaluate --config connector.json --lines lines.json` with `[{ "code": "BAS-25", "qty": 10, "price": 1000 }]` prints what comes off and why — the same engine the storefront uses.

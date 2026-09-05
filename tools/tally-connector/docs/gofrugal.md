# GoFrugal RetailEasy / HQ — the connector, step by step

**What it does.** Reads your items from GoFrugal's own API on your server (name, reference code, sale price, MRP, GST %,
stock per location) into the ChitBridge catalogue, keeps the stock stamped with its time, and turns every storefront or
business order into a **Sales Order** in GoFrugal, with our reference on it — your billing raises the invoice from it as
it does for any order. Offers arrive as a discount on the line; the amount stays the chit's.

**What it does not do (yet).** GoFrugal's published API has no company profile, no receipt (payment) and no purchase
endpoint, so those steps are skipped and say so in the receipts file. The profile is typed once in ChitBridge.

## 1 · Get the API enabled
Ask GoFrugal to enable the WebReporter API on your server (it is part of their e-commerce integration; the terms are theirs).
You receive an **API key**. The API answers on your server at `http://<server>:8482/WebReporter/api/v1/…` with the header
`X-Auth-Token: <key>`. Test it in a browser or Postman first: `/WebReporter/api/v1/items` must return your items.

## 2 · Configure
`node setup.js` → system `gofrugal` → the server URL, the API key, and (optional) the location id when you run several.
connector.json then carries `"gofrugal": { "url": "http://localhost:8482", "token": "…", "locationId": 1 }`.

## 3 · Run
`node index.js sync-products` · `node index.js sync-stock` · `node index.js watch --stock-minutes 5` — the same commands as
Tally. An order line must be one of your items (matched by reference code); a line that is not is refused by name and the
order waits until it is.

## Proven against
`fake-gofrugal.js` from the published knowledge base (items, sales orders). Not yet against a live GoFrugal server — the
first live run may correct a field name in `adapters/gofrugal.js`.

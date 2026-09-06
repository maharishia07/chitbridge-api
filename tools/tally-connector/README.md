# ChitBridge connector — Tally first, any system next

One core (`core.js`) that talks to ChitBridge; one small adapter per outside system (`adapters/`). The store PC runs it.
It needs outbound internet only — no open port, no static IP.

```
products  ── adapter.readProducts() ──▶  ChitBridge catalogue     (matched by code; unchanged items are not resent)
offers    ◀── /api/offers/explain  ──── ChitBridge engine         (the same engine as the storefront and compose)
orders    ◀── the bell (SSE) + catch-up ─ ChitBridge chits  ──▶  adapter.pushOrder(order)   (once, by receipt)
```

## Setup — the easy way
Install Node.js (LTS). Tally: F1 › Settings › Connectivity › acts as Both, ODBC on, port 9000. ChitBridge › Settings › Integrations › **Mint a key** (scope `connector`), copy it once. Unzip the kit and **double-click `start.cmd`** — it asks for the key and the ledgers, tests both ends, writes `connector.json`, runs the first sync. Then `node index.js install --config connector.json` once, so Windows keeps it running. The full checklist with a self-test per step: `docs/tally.md` §0.

## Setup — by hand
1. Mint the key as above.
2. Copy `connector.example.json` to `connector.json`, paste the key, set the adapter.
3. Tally: enable the XML/ODBC port (default 9000).

## Commands (node ≥ 18, no dependencies)
```
node index.js sync-products --config connector.json           # Tally stock items → ChitBridge products
node index.js evaluate --config connector.json --lines lines.json   # basket lines → what comes off, and why
node index.js once   --config connector.json                  # push every received order not yet pushed
node index.js watch  --config connector.json                  # catch-up, then hold the bell; an order lands in Tally within a second
```
Add `--dry` to print the Tally voucher XML instead of posting it. Add `--adapter csv` to use files instead of Tally
(`products.csv` in; `orders/<chit>.csv` out) — the shape any system that speaks files can attach through today.

## Receipts
`receipts.jsonl` beside the config: one line per transfer — product hash, order chit id, outcome. A failed transfer is
retried on the next run; an order is never pushed twice. Delete a line to force a resend.

## Tally: what is LIVE, and what to verify on a new machine
`adapters/tally.js` ran against TallyPrime on 2026-09-05 (Educational edition, two companies on one laptop): Sales vouchers with
GST lines, Receipt vouchers on Mark paid, and Purchase vouchers on the buyer's company (role `buyer`). Two Tally TYPEs freeze
TallyPrime until Esc — `TaxUnit` and `GSTRegistration` — and are never sent (docs/tally.md §⚠️). On a NEW machine start with
`--dry`, import one voucher, check it in Tally, then remove `--dry`; a field name or sign convention that differs is corrected
in that one file.

## Proof on one machine
`node prove.js` — starts a fake Tally, mints a key with your session token (`CB_TOKEN`), syncs three items to a
throwaway entity, evaluates a basket, places a storefront order for it, runs the catch-up, and checks the voucher
reached the fake Tally exactly once.

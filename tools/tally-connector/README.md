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

## The counter (till.js)

A shop with no other system can bill on ChitBridge itself: `node till.js` serves a counter at http://127.0.0.1:7071 from the
same folder and the same key. It holds a copy of the shop — items, prices, offers, tax slabs, customers — so it keeps billing when
the internet does not, and each sale becomes an ordinary chit as soon as the line is back. The same page runs on a phone or tablet
with no installation at all: open `/till.html`, paste a key with scope `till`, and the browser will offer to install it.

Bill numbers are local and continuous within the financial year (`C1/26-27/0041`), and every bill carries its number to
ChitBridge, so a replay after a dropped line can never bill a customer twice. Full instructions: `docs/till.md`.

## More than one system on one account

A business may run several connectors — a POS for stock, the books for vouchers, a CRM for parties. Each of the seven **streams**
(products · stock · profile · order · purchase · receipt · party) belongs to exactly ONE connector, or the same order becomes a
voucher in two ledgers and nobody can say which is the record.

Nobody is asked a question about it: every run reports which streams the adapter can carry, and the first connector to carry a
stream claims it. A later connector is told the stream is taken, says so once in its window, and carries the rest. The owner
changes it in **ChitBridge › Settings › Integrations › Who owns what** — which is what a migration does on its last day; the
connector picks the change up on its next heartbeat, with nobody at the PC.

Reconciliation lives beside it, under **In the books**: every order of the last 30 days as booked · refused (with the other
system's reason) · on the way · overdue, counted per system. Overdue means the trigger released it more than
`books_overdue_hours` ago (12 by default) and nothing has answered — the check for "did anything fail to post overnight".

⚠️ One PC can run as many kits as it likes, but each needs its OWN folder: `install` names its scheduled task after the folder and
the config path, and each kit writes its own log. (Before 2026-09-07 the task was named after the config file — and since every kit
ships `connector.json`, installing a second kit silently replaced the first one's task.)

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

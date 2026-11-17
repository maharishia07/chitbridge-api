# THE TOUR — every implementation from 2026-09-03 → 05, shown one after the other, live

Athi, 2026-09-05: *"list down all the implementation and show me one by one in the screen … create a test script and run
one after the other live and I can watch."*

Run it on your machine (a real Chrome window opens; each step shows a caption of what to look at, then pauses):

```
cd C:\dev\chitbridge-web\e2e
set TOUR=1
npx playwright test tests/tour.spec.js --headed --project=authed
```

`set TOUR_PAUSE=8000` for a longer pause per step (default 5 s). Eighteen captions (a few cases show two outcomes); `set TOUR_FROM=11` replays the earlier cases silently and narrates from there. It uses a fresh entity minted for the run, so your own
data is never touched. The same script with `TOUR=1` and no `--headed` is a regression of every step.

| # | what was built | where you see it |
|---|---|---|
| 1 | Product page = a FACT SHEET (Pricing & tax · Offers · Order model · Details · Categories · Variants · Synonyms · Media · Stock · Consists of · Barcode · Storefront), one line each with its outcome, pinned index, Tabs/Page switch | Catalogue › a product |
| 2 | Tax slabs from the governance layer (b201): pick GST 18% → same-state / other-state split, Before · GST · After tax | Pricing & tax tab |
| 3 | Offers on a product — the cart breakdown at qty 1 and the sample qty, tax after offers, You save | Offers tab |
| 4 | Catalogue rows show what is in effect (🏷️ the active offer, GST %), search by offer or tax | the left list |
| 5 | Setup › Tax = a register of what every product carries (tax as resolved + source, offers, HSN, categories) | Catalogue setup › Tax |
| 6 | Setup › Offers = terms · window with Scheduled/Active/Expired · where applied; the next six months; Plan several | Catalogue setup › Offers |
| 7 | A slab does not go dark: Retire a cited slab → "Pick the slab that takes over"; Reinstate on retired rows | Catalogue setup › Tax |
| 8 | Publish on a date (b203): Effective from → the change is parked and shown beside the live value | Edit › Save |
| 9 | Barcode (Code 128 of the SKU) · Consists of (BOM read-out) | the two new tabs |
| 10 | Compose: typing your product's name makes its offers fire in the cart | Compose |
| 11 | The invoice and the ledger: rated at send, frozen at completed, MIS › Tax month | MIS › Tax |
| 12 | Columns panel — Columns · Types · Usage (observation 2) | Catalogue setup › Columns |

Not in the tour (needs a second entity or your own data): the buyer's input-credit side of the ledger ([TAX-03] proves it),
other countries' VAT split (an entity with country DE), the WhatsApp/offline paths.

## Added 2026-09-04 (cases 19–23)
19 **Media** — Edit › Media › the shared test picture (`e2e/assets/test-picture.png`) → a tile at once; with no store the caption says so.
20 **A video is a link** — paste a YouTube link › Add video → an embedded player tile (no bytes stored).
21 **Storefront gate** — a fresh catalogue is private: the row says "● Not public · set it in Profile" instead of framing "Shop not found".
22 **Storefront: how a customer sees it** — after Profile › Public: THIS product framed at phone width, picture and player under the line.
23–25 Compose · MIS › Tax · Columns (unchanged).
`TOUR_FROM=19` replays 1–18 without pauses, then narrates from Media.

## Added 2026-09-04 (night 5)
17 **Lifecycle** — status with its meaning + Change, Since, Last change, the parked strip (moved here from Details).
18 **History** — every cut version newest first, what changed (name · variant · unit · price · SKU · status), who.
Later cases renumbered: 19 Barcode/Identifiers · 20 Consists of · 21 Media · 22 Video link · 23 Storefront gate · 24 Storefront · 25 Compose · 26 MIS › Tax · 27 Columns. `TOUR_FROM=17` starts the narration at Lifecycle.

## ⚠️ Run the tour like this (2026-09-04)
    NODE_OPTIONS=--max-old-space-size=4096 TOUR=1 TOUR_HEADED=1 TOUR_PAUSE=8000 TOUR_FROM=17 npx playwright test tests/tour.spec.js --headed --project=authed
The config turns trace and video OFF when TOUR is set: with them on, the worker ran out of heap at ~9 minutes and the
headed window froze on a caption. Never start a second Playwright run while the tour is on screen (shared auth state).

## The two-party tour — `tests/tour-two.spec.js` (2026-09-05)
One trade across two windows: LEFT the seller's app (fresh entity: product · GST 5% · 10% offer · public storefront), RIGHT the buyer's storefront (shop.html, OTP customer). Eight cases: shelf → tax+offer → public → the shop → six bags in the basket (offer off, GST on the after-offers figure) → order (contact, code, place) → the seller's BELL rings (asserted at cbPushArrived, no timer) → the order chit opens.

    NODE_OPTIONS=--max-old-space-size=4096 TOUR=1 TOUR_HEADED=1 TOUR_PAUSE=8000 npx playwright test tests/tour-two.spec.js --headed --project=authed

Headless proof: drop `TOUR_HEADED`/`--headed`. Green 2026-09-05 00:57 (2 passed, 2.2 m).

# Backlog — parked, not forgotten

Everything agreed so far that is **not** in the current core. Ordered by theme; each item has a size (S/M/L) and what unblocks it. Nothing here starts until the reliability and usability core in `NOW-reliability-usability.md` is done.

Legend: **S** ≤ 2 days · **M** ≤ 1 week · **L** > 1 week.

---

## A. Global context and backend (from `global-context-and-infrastructure.md`)

| # | Item | Size | Notes / unblocked by |
|---|---|---|---|
| A1 | `GlobalContext` object + `/bootstrap` | M | The schema is written; backend work |
| A2 | Country packs (IN first, then one African + one EU) | M | After A1 |
| A3 | Config precedence (org → pack → shop → counter → device → user) with "changed here" markers | S | After A1 |
| A4 | Delta catalog + config sync with ETags | M | |
| A5 | `/time` clock-skew correction | S | Needed by reliability; **pulled into core** |
| A6 | Content proxy (weather, holidays, festivals, notices) | S | Decision needed: proxy vs direct |
| A7 | Hash-addressed assets + image manifest | S | |
| A8 | e-invoicing queue (IRN, NF-e, ZATCA…) | L | After A2 |
| A9 | Fiscal device drivers (IT/PL/GR/HU) | L | Market-driven |
| A10 | Data residency, retention, GDPR/DPDP export & erase | M | Enterprise sales requirement |

## B. Money, tax and payments

| # | Item | Size | Notes |
|---|---|---|---|
| B1 | Credit ledger / khata as a tender (unpaid bills, part payments, reminders) | L | Decision needed; changes the bill model and day-close |
| B2 | Line and bill discounts with approval limits | M | DISCOUNT column already in the bill |
| B3 | Refund, void and reprint with a reason and audit line | M | |
| B4 | Tips and service charge | S | Only where the pack enables it |
| B5 | Card terminal integration (EMV, tap to pay) | L | |
| B6 | Multi-tender split beyond "+ part" | S | |
| B7 | Cash rounding rules per pack | S | |
| B8 | Sales tax by address (US), EU VAT per line, deposits | L | After A2 |

## C. Day and staff

| # | Item | Size | Notes |
|---|---|---|---|
| C1 | Sign in / sign out with PIN, name on every bill | M | **Partly pulled into core** (usability of a shared device) |
| C2 | Open and close the till with a cash count, expected vs counted | M | |
| C3 | X / Z report at the counter | M | After C2 |
| C4 | Roles and limits (discount %, void, price edit, settings) | M | After C1 |
| C5 | Audit log view | S | After C1 |
| C6 | Rota-aware sign-in, per-person drawer | L | Enterprise |

## D. Selling

| # | Item | Size | Notes |
|---|---|---|---|
| D1 | Parked bills list (not just F6) | S | |
| D2 | Weight entry for loose goods, tare, per-kg price | M | |
| D3 | Customer screen + points redemption | M | Shop points strip exists |
| D4 | KOT / kitchen ticket view, course timing | L | Checkbox exists in settings |
| D5 | Tables and dine-in flow | L | |
| D6 | Barcode via camera on phones | S | |
| D7 | Quick keys that learn from what sold at this hour | M | Wild-option favourite |
| D8 | Time-window nudge banner ("Afternoon started") | S | Designed, not built |
| D9 | Sold-out tray with one-tap restore | S | Designed, partly built |

## E. Screens designed but not built

| # | Item | Size |
|---|---|---|
| E1 | Sell layouts B (dark), C (timeline), D (rail) | M each |
| E2 | Pickers: side drawer, full-screen | S each |
| E3 | Devices: vertical terminal, compact, tablet (+pay), phone (3 steps), handheld (2 steps) | M total |
| E4 | Back office: quick keys maintenance (list and board), device screen style | M |
| E5 | Panel sizes screen with drag bars | M |
| E6 | Hub phone + wide (merged menu and settings) | M — **the next build after core** |
| E7 | Shop screen (TV) design and build | M |
| E8 | First-run setup wizard reading the country pack | M |

## F. Delivery to the customer

| # | Item | Size | Notes |
|---|---|---|---|
| F1 | Digital receipt: QR to view the bill | S | Works with no printer, no data cost |
| F2 | WhatsApp receipt | M | Needs business API |
| F3 | SMS receipt | S | Costs per message |
| F4 | Customer-facing display / "show the customer" total | S | |
| F5 | Receipt rendered as an image when the printer lacks the script (Tamil, Bangla…) | M | |

## G. Low-infrastructure programme

| # | Item | Size | Notes |
|---|---|---|---|
| G1 | Lite build for Android Go (< 250 KB JS, text tiles, no animation) | M | |
| G2 | Data-saver mode with "data used today" | S | |
| G3 | Tier switch (dark / trickle / patchy / wired) driving what the UI offers | M | After A1 |
| G4 | Device-to-device export by QR or file when there is no network at all | M | |
| G5 | Voice billing in local languages | L | Voice tab exists |
| G6 | Picture-and-colour mode for low literacy, amounts read aloud | M | |

## H. Enterprise and scale

| # | Item | Size |
|---|---|---|
| H1 | Multi-store price books, central menu with local overrides | L |
| H2 | Consolidated day-close across counters | M |
| H3 | SSO / SAML, device attestation | M |
| H4 | Warehouse export, accounting connectors, per-bill webhook | M |
| H5 | Delivery aggregator order intake | L |
| H6 | 100k SKU catalogue performance work | M |

## I. Product ideas kept warm

Plain-language daily report ("Idli ran out at 10:40 — about 20 plates lost") · festival and weather modes suggesting a group · counter-to-counter handover of a parked bill · one health pill everywhere (**pulled into core**) · foot-pedal / hardware key mapping · gloves mode with 64 px targets · shop-screen queue numbers.

---

## Decisions still open

1. Credit ledger (khata) in scope? — blocks B1, changes C2/C3.
2. Content proxy in ChitBridge, or direct provider call? — blocks A6.
3. Countries after India? — blocks A2.
4. Digital receipts: QR only first, or WhatsApp/SMS too? — blocks F1–F3.
5. May a counter ever override tax or price? — recommendation: never.

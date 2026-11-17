# Settings — set up your business (requirement for the designer)

From the registration walk of 16 Oct 2026 (IN · AU · AE shops on the local stack). Every decision below is Athi's, quoted
in `C:/dev/docs/29-qa-test-tooling-ux-locale-and-design-system/WALK-REG-2026-10-16.md` (R1–R48). Pass mark: `docs/design/SYSTEM.md`.
A first build of the smaller fixes is live on branch `walk/reg-fixes-1016` (:8124). Athi's verdict on it: *"no, it doesn't look
good either — I am looking for something else, check with the designer."* So this is a visible redesign: design first, then build.

## Who and what for
A shop owner (tea shop, pharmacy, wholesaler, service business — *"they don't even need to have a shop"*) on day one, often on a
phone, who will not read paragraphs. They want to start billing. Everything not needed for that waits until the day it is.

## The idea, in Athi's words
- *"With very few inputs we can cover all"* the governance layers. Six questions set everything; the rest is defaulted and
  labelled where it came from ("from India pack", "from Tea shop").
- Business information in **small cards**, filled now or later, *"like a microservice — if not given now, fill it when it becomes
  necessary"*. The system asks for a card at the moment a step needs it.
- *"Remove any information which overwhelms the page."* No explanation lines. Required field = label + `*`. Optional page or
  section = "(optional)" in its heading. Details behind an ⓘ.
- *"If something runs it has to be on the top of the page"* — live things first, things you could set up below.
- *"Need to have a crisp text, and the change required and save button all in a single row or two rows, very aesthetically."* — every setting = label · value/control · change, on one row (two at most).
- *"Anywhere possible, make it like a table so it reads perfectly"* — aligned, adjustable columns.

## Screens (one shell — the Settings sidebar: Country · Your business · Print setup · Counters · Connectors · Policy · Plan & usage · Account)

### 1. Register (signed-out)
Its own centred card, not inside Settings. Fields: **User ID*** (8+ lowercase/digits/dashes, can't change — rule behind ⓘ) ·
**E-mail*** → code sent → **Code*** (field focused automatically) → in. One sign-in link. Country is detected and shown as one
line with a dropdown; the rest of the country pack is NOT shown here (it is shown once, on Country).

### 2. The six setup questions (first visit after register — a short step flow or one card)
| # | Question | Sets (layer) | Real field |
|---|---|---|---|
| 1 | Country* | money · financial year · tax system · language · date/number format (Jurisdiction) | `country_setup.country`, `currency`, `fy_start_month`, `timezone` |
| 2 | Kind of business* (tea shop, grocery, pharmacy, restaurant, wholesale, services…) | units · tax slabs · bill layout · sample bill · policy defaults (Vertical) | **new — needs a vertical pack; designer shows the picker** |
| 3 | Nature + what you supply* — Retailer · Wholesaler · Distributor · Manufacturer · Service provider (multi) / Goods · Services · Both | sell side, HSN vs SAC, slip vs A4 | `supplies` (exists); nature **new** |
| 4 | Tax number (GSTIN / ABN / TRN) — or "not registered" | state · PAN · business structure · place of supply | `tax_registration {registered, number, scheme}` |
| 5 | Business name* (as on the signboard — never the user ID) + logo | every bill, online shop, counter | `trade_name`, logo (today a URL — must be an upload) |
| 6 | Address with a map pin* (popup: search → pin → parts; page shows one condensed line + small map) | state check, delivery area | `address` today one line → structured parts per country |

Rules for every row: **not yet answered → the dropdown inline; answered → value + "Change"**. 🔒 only on Country and Money
("fixed after your first sale"). Each row saves itself ("✓ Saved"); no page Save.

### 3. Your business — seven cards (status on each: ✓ Done · Not needed yet)
1. **Your business** — name, logo, kind, what you supply, tagline, banner/signboard photo
2. **Contact & address** — address + map, phone, e-mail
3. **Tax & registration** — tax number, type (IN: Regular/Composition with ⓘ), **business structure derived from the PAN letter**
   inside the GSTIN (C company → ask CIN · LLP → LLPIN · P individual → nothing); AU: ABN (+ ACN for a company); AE: TRN
4. **Licences** — only those the kind of business needs: FSSAI (food), drug licence (pharmacy), trade licence, Udyam/MSME
5. **Bank & payments** — a SUMMARY card only (bank ••4521 · UPI id ✎); its owner is **Finance › Bank accounts** — ✎ opens that same screen as a popup (Athi: "we have to call that screen to set it in the shop settings"); asked at the first invoice/payment
6. **Who signs** — signatory name + signature — asked when a bill/form needs it
7. **Export** — IEC, ports, logistics — only when export is turned on (today's "Trade documents vault" lives here)
Today these are spread over 4 places (Country, Your shop top block, Business identity vault, Print setup) — **one owner per field**.

### 4. Print setup
Left: "Always on a tax invoice" (fixed, no ticks, no arrows: logo → business name → address → tax id, + state for IN) · "Your
choice" (phone, e-mail, registered name, footer — tick + order). Right: the sample bill **drawn by the tax engine**, redrawn for
the paper (58/80 mm · A5 · A4 · A3 · Letter) and later the kind of business (pharmacy batch/expiry, restaurant table/KOT, B2B A4 with
buyer GSTIN + HSN). Buttons **Preview** (full-size overlay) and **Print** (test print).

### 5. Counters (optional) · 6. Connectors · 7. Policy (optional) · 8. Plan & usage · 9. Account
- Counters: list of counters + "which device holds it". Nothing else.
- Connectors: **Running on your PCs** at the top (● Running · <PC> · seen 1 min ago / Stopped / Not installed), then one row per
  connector: name · Available / reason · **Download** · **Guide** (PDF, sample: `C:/dev/docs/23-connectors-and-integrations/guides/Tally-Guide.pdf`).
  Keys live inside their connector. List ordered by country (AU: Xero, MYOB, QuickBooks first).
- Policy: a table — Rule · Now · Who may change it · ⓘ; edit in place as a draft: Save and Cancel appear once it differs, Save asks first (R121, 24 Oct: never autosave). Each rule ALSO appears in the step where it acts
  (e.g. short-delivery tolerance on the receiving screen).
- Plan & usage: table Limit · Allowed · Used; usage shows "US$" (billed in USD).
- Account: you (name · e-mail · phone), where you are signed in (+ **Sign out** — missing today), devices.

## Countries (show all three in the mock)
IN: ₹ · Apr FY · GSTIN · CGST+SGST/IGST · lakh/crore · Cash/UPI. AU: A$ · Jul FY · ABN · GST 10% · BAS · zones by city · Cash/Card.
AE: AED · TRN · VAT 5% · Arabic/RTL available · Cash/Card.

## States to design
First visit (nothing answered) · partly done (cards: some ✓, some "Not needed yet") · all done · a wrong tax number (the reason in
plain words, on the row) · phone 390 px.

## Out of scope this round
Live tax-ID lookup, more connectors, the procurement (buy-side) mode, branches/consolidation — all in BACKLOG.

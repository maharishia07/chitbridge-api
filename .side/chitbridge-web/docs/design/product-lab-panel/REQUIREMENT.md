# Product Lab — the panel layout (requirement for the designer)

From the 16 Oct walk (WALK-REG R57, `C:/dev/docs/29-qa-test-tooling-ux-locale-and-design-system/WALK-REG-2026-10-16.md`). Athi: *"you know
it yourself now, can you find out what can be in the panel and how we can make it better looking?"* · *"how do we showcase with images, how does
it look in the counter with different panel style and so on? do we need to bring it here?"* Pass mark: `docs/design/SYSTEM.md`.
Walk mock-up (on the page's own list): `C:/dev/toolset/walk-mocks/product-lab-panel.js`.

## Keep the flow — 1 Choose what this shop sells · 2 Price & shelf — change the layout
| Area | What it holds |
|---|---|
| Top line | "Prices in AED · market: your area · local names: by country ✎" · "12 chosen" · **Next: price & shelf ›** |
| Left panel | Categories with counts (Vegetables & fruit 216 · Eggs 18 · …) · "+ Add your own category". Units ("Sold by kg / bunch") are a FILTER on the right, not categories. |
| Right panel | Search + sub-group chips (Gourds · Roots · Greens …) · products as CARDS: photo or letter tile · name · local name · suggested price / unit (marked "suggested", always editable) · tap = ✓ chosen (green). Filters: Everything / In my catalogue / Not yet. |

## Images and "how it looks" — show, don't rebuild
Product Lab is the back office. Photos and the counter / online-shop look are drawn by the screens that own them (Catalogue product page,
the counter's quick-key screen styles — CBScreen presets, the online shop). Each card: the product's photo if it has one (else the counter's
letter tile), and **"How it looks ▸ Counter · Online shop"** opening a preview drawn by THOSE renderers — one drawing, never a copy. Adding a
photo happens on the product, once.

## Rules
- 🔴 **Suggested prices from the shop's own market** — today a UAE shop sees Indian-rupee numbers under "AED" (Tomato kg AED 40). A suggestion
  comes from the country's (area's) price table, or is blank. Never another country's number relabelled.
- Local-name language and the starter list from the country pack + kind of business (UAE: Arabic / Hindi-Urdu names, not Tamil).
- Cost and margin stay inside the Labs (DECISIONS "cost never travels").
- App colours only; same panel pattern as Settings and Offer Lab; phone: categories as a top strip, cards one column.

## States to draw
Nothing chosen yet · some chosen in two categories · a product with a photo and one without · the "How it looks" preview · phone 390 px.

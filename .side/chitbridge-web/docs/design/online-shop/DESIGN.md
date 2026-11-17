# Online shop SHOWCASE — design (round S1; pass mark for the build round S2)
Pass mark: `mock-showcase.html` (open it; the PROTOTYPE bar switches the cart face). Requirement: `REQUIREMENT.md`.
No product code changes in S1. Tokens: SYSTEM.md §2, copied, never restyled (the mock uses `var(--token,#fallback)`).

## 1 · Hierarchy — the work first
Top to bottom on a phone (390 px, 16 px gutter, no sideways scroll):
1. **Window strip** (one row): logo/initial · shop name (h1, Bricolage 800) · ⤴ share. No shell header, bell or avatar for visitors.
2. **One line** of what the shop does + place · open-now dot with hours · 📞 call · 💬 WhatsApp · 📍 map (icons; the word in aria-label/title).
3. **Search** (🔍) and **category chips** (the shop's own categories, one swipe row — the only horizontal scroll, inside the chip row).
4. **The range**: photo grid, 2 columns at 390, 3 at 768, 4 at 1366. The photo is the card (4:5); under it ONE line: name, and the price only if the shop chose to show one. "Showcase only" items show no price and no price words at all.
5. **Cart face bar** (sticky, only when something is shortlisted/ordered): count badge + the face's one action.
6. **Kural footer** (CBKural, SYSTEM.md §3b) — last, outside the grid, never inside an outgoing message.
Cost, stock counts and anything not "Shown to customers" never reach the page.

## 2 · Layouts
| width | grid | notes |
|---|---|---|
| 390 | 2 col, gap 10 | share + call/WhatsApp on the strip; item page is a full screen with a ‹ back |
| 768 | 3 col | strip becomes a hero row (name left, contact icons right); item page opens as a side sheet |
| 1366 | 4 col, max-width 1180 centred | categories become a sticky left list; item page is two columns (photos · facts) |

Item page (own URL): big photo (swipe / thumbs) · name (h1 on that URL) · sizes/variants as chips · price if shown, else "Price on asking" · primary = the face's action for ONE item · ⤴ share · 💬 "Ask about this" (WhatsApp prefilled with the item name + its URL).

## 3 · Text budget
Page ≤ 40 words outside item names and the shop's own text. Buttons are icons; a visible verb only where the face needs one ("Order" is the only verb on a card, and only where ordering is on). No paragraph about ChitBridge. Empty states say one short line. The same string never twice on a screen.

## 4 · The cart wears the business type (one engine, four faces)
Same bar + sheet; only words and the finishing action change. Each face mints its own chit kind → Tasks & Orders.
| face | bar icon | bar title | finish | prices | chit kind |
|---|---|---|---|---|---|
| Enquiry (DEFAULT on a showcase) | ♡ | Shortlist | **Send your enquiry** | none needed | enquiry |
| Order | 🛍 | Order | **Place the order** | line + total, painted from the server | order |
| Quote | 🧾 | List | **Ask for a price** | qty only | quote request |
| Booking | 📅 | Booking | **Ask for the date** | service + date | booking |

Never an empty-cart feeling: with nothing chosen the bar is absent; on a showcase the card's quiet action is ♡, not a cart. Money is only painted from the engine (M36 unit), never computed on the page.

## 5 · Share
⤴ on the strip and on each item: `navigator.share({title,url})`; where missing, copy the link and say "Link copied" through the action-state helper. The shared URL is the page's own (per-item for items). The owner view adds the existing QR and "Share your shop link" (PROVISIONAL name).

## 6 · "Be found" owner card (owner preview only, never shown to visitors)
One card: your link (mono) · ⧉ copy · two one-line guides: "Google › your Business Profile › Website — paste this link" · "Facebook page › About › Website — paste this link". No Google/Facebook API this round; the owner pastes.

## 7 · SEO notes
- `<title>`: `<Shop name> — <what they do>, <place>` (≤ 60 chars; trim the place first). Item URL: `<Item> — <Shop name>, <place>`.
- `<meta name=description>`: the shop's one line + place + hours, ≤ 155 chars; item: its first sentence + "Ask <shop> on WhatsApp".
- ONE `<h1>`: shop name on the shop URL; item name on an item URL (shop name becomes a link above it). Categories are h2.
- schema.org JSON-LD: shop URL → `LocalBusiness` (name, image, telephone, address, openingHoursSpecification, url, sameAs) plus an `ItemList` of the first 24 items; item URL → `Product` (name, image[], description, `offers` ONLY if the shop shows a price — never price 0; `brand`/`seller` = the LocalBusiness).
- Each item at its own crawlable URL `/shop/<slug>/<item-slug>`; canonical set; `og:title/description/image` (first photo) so WhatsApp/Facebook previews show the work.
- Fast first paint on a phone: server-rendered first 12 cards, `loading=lazy` + width/height on every image (no layout shift), no blocking script above the fold.
- Only published items appear in markup and sitemap; cost/stock never.

## 8 · Rules kept
Icons not words (ICON-MAP: one meaning per icon — new here: ⤴ share, ♡ shortlist, 📍 map, 📅 booking, ⧉ copy; S2 adds them to ICON-MAP.md); 16 px gutter; tokens only; AA contrast; kural footer last; the server answers may/why, a refused action is greyed WITH its sentence.

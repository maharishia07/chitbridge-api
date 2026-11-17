# Your online shop — a SHOWCASE, redesigned (requirement for the designer)

Decision (Athi, 2026-10-10, DECISIONS.md bottom): the page is not mostly for selling — it SHOWCASES the shop
to the outside world. Whoever can sell directly is already online somewhere; the audience is the millions who
are not. The wedding-card designer with hundreds of designs who today shares a few photos on WhatsApp is the
person this page is for: here the WHOLE range is presented. If an order comes through it, well and good.

## What the page is
1. **The shop's window, and usually its first website.** Name, what the shop does in one line, where it is,
   when it is open, how to reach it (call · WhatsApp) — then the range, large and browsable. The design leads
   with the WORK (photos first — memory: assume they cannot read), not with price/cart.
2. **The whole range, organised.** Hundreds of items must feel light: categories the shop already has, a
   search, big pictures, tap for the item's page (photos · sizes/variants · price where the shop chooses to
   show one · "Ask about this"). A shop may mark items "showcase only — price on asking".
3. **Selling is a bonus, not the spine.** Where ordering is on (the existing storefront flow), the button sits
   on the item quietly ("Order"); where it is off, the page still works fully as a window. Never an empty-cart
   feeling on a showcase shop.
4. **Share, everywhere.** A share icon on the page (and per item): the device share sheet, else copy — to
   WhatsApp status, Instagram, Facebook, anywhere. The owner's view adds the QR (exists) and
   "Share your shop link" (exists; PROVISIONAL name).
5. **Found through Google and Facebook, not through us.** The page must read well to a stranger AND to a
   crawler: real <title> ("<Shop name> — <what they do>, <place>"), meta description, one h1, schema.org
   Product/LocalBusiness markup, each item's page at its own URL, fast first paint on a phone.
   The owner's view gets a small "Be found" card: your link · copy · the two guides in plain words
   ("Google › your Business Profile › Website — paste this link" · "Facebook page › About › Website").
   We do not call any Google/Facebook API in this round — the owner pastes.

## Constraints (standing rules)
- Phone first (390 px, no sideways scroll); the frozen design tokens; text budget; icons not words where a
  picture is unambiguous; cost never reaches this page (automated test exists); CB core principle — only what
  the shop chose to publish is shown.
- The kural footer stays (every page).
- One frame style does NOT apply here as-is: this page faces the PUBLIC, so the shell header (bell, avatar)
  is absent for visitors; the owner preview may carry the shell.
- Catalogue is the one source (PIM-on-MDM); no second product store. Exposure per item ("Shown to customers")
  decides what appears.

## Out of scope this round
Google/Facebook API connections (the owner pastes the link); payments changes; the order queue (built, stays);
multi-language beyond what the string layer gives.

## The cart wears the business type (Athi, same day)
One cart engine (the chit IS the cart) — but its FACE follows the business type: **Enquiry/shortlist** (collect
designs, "Ask about these" — no prices needed) · **Order** (restaurant, grocery — today's flow) · **Quote
request** (bulk/hardware) · **Booking** (a date and a service). The designer shows the same bar/sheet wearing
each face; the words and the finishing action change ("Send your enquiry" · "Place the order" · "Ask for a
price" · "Ask for the date"), the machinery does not. Each face mints its chit kind and lands in Tasks & Orders.

## Not one design — a template collection (Athi, same day, on seeing the mock)
The mock is SEED #1, not the design. One data contract (catalogue + shop profile + exposure), many registered
faces (kind.vertical.face@version): the shop CHOOSES its template and may mix sections. Round S2 builds the
MECHANISM (template registry · the data contract a template receives · the chooser in the owner view · preview
with the shop's own data) plus 3–4 seeds: gallery-first (designer/cards) · menu (food) · spec wall
(paint/hardware) · booking (services). A template is sections, so mix-and-match is assembly, not forking.
A couple of iterations are expected on this piece before it is called right.


---

## Update 19 Oct 2026 (cb-ux-locale, against NAV-MAP §5 item 3, §6 items 14 and 64): NET-1/2, MKT-6/7, UX-4/33/53/55/56

**Checked:** the showcase decision stands. What changed in the code: the template mechanism now exists (`public/app/showcase-templates.js`: 4 looks as registered sections under ONE data contract `{shop, categories, items}`; `cap-showcase.js`; policy flags `showcase_template` and `showcase_sections`) and the four cart FACES (enquiry, order, quote, booking) live in `app/cart.js`. The gaps the walk found (W19-W26): the chosen look may not reach the live `shop.html`, the ordering face is fixed per look, the heart is unlabelled, and there is no prerequisites checklist. So the designer's job here is the ONE shop look the visitor sees and the owner's way back; the chooser belongs to the Marketing page (`docs/design/marketing/REQUIREMENT.md`, tab Shop window).

### Four screens, one family (NAV-MAP D8: four shop screens today)
`shop.html?s=<bridge>` (the front) and its item page (`&item=<id>`) · `network-shop.html?bridge=<net>` · `store.html?net=<net>` (plus `embed.html`). One header, one look, one footer. The owner and the visitor see the same page; the owner adds one thin bar.

### WAYS IN
Home > Selling > Your online shop (2 taps; greyed with "Set up your shop link first" when there is no shop id, NAV-MAP item 8) · Marketing > Shop window "View" · the till's bill slip "Share" and the till menu · a link or QR from outside (WhatsApp, Google, Facebook) · Network shop and Store from the network. A visitor never has Home.
### WAYS OUT
Visitor: the item page and back; Order, Enquire or Ask (the cart sheet, per face); Sign in and My orders; Support; Privacy; Share (device share sheet, else copy). Owner (signed in as this shop's owner): a thin **owner bar** "Back to ChitBridge ⌂" on every shop screen plus "Edit this page" (to Marketing > Shop window); the shop's own ⌂ stays the shop front (`homeHref`). Sign in on a public page goes to Home's window. A missing `?s=` is not "No shop specified." but "This shop link is not complete" with a button to ChitBridge. Owner max 3 taps: Home > Your online shop > the page; back = 1 tap.

### Fields (real contract: `e2e/fixtures/shop-catalogue.json`, the public catalogue)
`shop{bridge_id, display_name, currency_code, gstn, is_verified, logo_url, address, business_status, storefront_access, upi_id, order_method, order_input{preset, pipeline, showsPrice, negotiable, schema}}` · item fields `name` · `unit` · `price` · `image` · `combo_of` · `modifiers` · `code` · `desc` · `gst_rate`. The page copies ONLY the template contract's fields (`shop{name, line, place, hours, open, phone, whatsapp, logo, url, currency}`; `items[{id, name, photo, category, price, unit, note, sizes[], showcaseOnly}]`). Cost, stock counts and anything unpublished never reach the page (a test walks every template). Reuse: `node C:/dev/seams.cjs showcase`.

### Sample (label "Sample"; from the fixture)
"Mayur Bhavan", INR, open, Bollineni Hillside Road, browse access, order method cart; items from `shop-catalogue.json`; the same shop in all four looks (gallery, menu, spec wall, booking) and all four faces ("Send your enquiry", "Place the order", "Ask for a price", "Ask for the date"). The owner bar shown on one. The empty shop: "Nothing is on show yet" with, for the owner only, "Add items in the Catalogue".

### Actions per state (show action, enable by role)
Visitor: Order is shown on an order shop and greyed with a sentence when ordering is off or the shop is closed ("Closed now. Opens at 9:00"); Share always. Owner: Preview as visitor, Copy link, QR, the Be-found card; Edit greyed with `why` for a login that may not. The heart is labelled ("Shortlist") with its count.

### States
Loading (skeleton cards, header drawn first) · open / closed · showcase-only items ("Price on asking") · cart empty / not empty (a bottom bar, never above the list) · shop not found · shop paused · offline (what is cached still browses) · phone 390 first (photos first, 2 columns, categories as an overlay) · a long range (300 items: light, search first) · owner bar present / absent · RTL. Public pages carry the kural footer; cost never shows.

**Open questions for Athi:** 1. Does a visitor see "Powered by ChitBridge", and where (footer only)? 2. When the owner is signed in, is the owner bar on by default or a toggle?

# The lab journey: pick your trade, walk the whole system (REQUIREMENT for the designer, 19 Oct 2026)

**Status:** requirement only (UX-91, with UX-90 one frame, UX-89 lab-only). Do not build. **Pass mark:** `docs/design/SYSTEM.md`. **Map:** `C:/dev/docs/design/NAV-MAP.md` §6 items 58-63, §7 row "Labs".
**Plan (Athi said yes to both recommendations, 18 Oct):** `C:/dev/docs/29-qa-test-tooling-ux-locale-and-design-system/PLAN-lab-journey-2026-10-18.md`. This brief is the designer's view of it; the plan keeps the decisions.
**Owner:** cb-ux-locale; the sample products are cb-vertical's (VERT-8). Code today: `public/product-lab.html`, `offer-lab-next.html` (`?mode=combo`), `conversion-lab.html`, `country-lab.html`, `network-design.html`, the frame `public/app/page-frame.js` + `page-skeleton.css`.

## Why
Five labs, five looks, no switcher; Country Lab and Conversion Lab have no tile. Athi: "all should follow the same style as the Finance UI"; "select your vertical and that gives some sample products, use it to explore each lab and the entire system". A visitor should see the whole system in ten minutes without reading.

## Who
(a) A visitor or newcomer, signed out, who wants to see how it works. (b) A signed-in shopkeeper trying an offer or a price before it touches the shop. Never confusable with the real shop.

## The one frame
Every lab in the Finance frame: left menu, standard page skeleton, one background. The menu starts with a **Labs switcher** (Price, Offer with Combo as a tab, Network, Country, Conversion) and a **Lab shop** card on top (trade, country, "Sample" or "Lab copy of your shop"). One title pattern. Combo's close goes back to the Offer Lab, never closes the tab.

## The journey
1. Pick your trade (a card per trade; the reference lists cover vegetables and fruit, eggs, chicken, fish, meat, hotel; restaurant and provision store need a list from cb-vertical: open question 1). This makes the **lab shop**: name, country, sample products.
2. Price Lab (start) > 3. Offer Lab and Combo > 4. Conversion Lab > 5. Country Lab > 6. Network Lab > 7. a bill at the counter, a collection, the ledger (the "See it work" tour, cb-demo).
Two ways to ride: **free** (open any lab; the lab shop follows) or **guided** ("Run it for me": one step at a time with Next, Back and Stop; each step names the lab and the one thing to look at). A progress line "Step 3 of 7".

## WAYS IN
Home > Labs (or More > Labs on the phone) > any lab tile: 2 to 3 taps. Home "See it work" button. The Offer Lab from the till menu (Labs). The lab-journey start screen is the Labs section's top card. Country Lab and Conversion Lab get their Home tiles (NAV-MAP item 2).
## WAYS OUT
⌂ Home in the frame header. Labs switcher to any other lab. "Use this in my shop" (signed in only) to the real screen it writes to (Catalogue or Offers review). "See them in the Catalogue ›" after Price Lab's done (NAV-MAP item 48). Stop the guided ride returns to the lab you were on. No "later" buttons: unbuilt steps are shown greyed with "Not yet" (show action).

## The two states the banner must make obvious (never colour alone; one banner in the frame, not per lab)
| | Signed out | Signed in |
|---|---|---|
| Data | the trade's sample products, in this browser only | the shop's real products, read |
| Writes | none, no api call | saved to the **lab copy**, not the shop |
| Banner | "Sample. Nothing here reaches a shop." | "Lab copy. Nothing reaches your shop until you press Use this in my shop." |
| Button | none | "Use this in my shop" (the existing write: offer draft > review, adopt); greyed with `why` if the login may not |
A cost typed in a lab stays in the lab until that button (decision 2).

## Fields (reuse; widen, never copy)
Trade > products: `lib/catalogue-blueprint.js` BLUEPRINTS, each `key` · `label` · `units[]` · `defaultUnit` · `categories[]` · `starter[{name, unit, price, category, names, barcode, image}]`; the trade of a real shop: `verticalOf`. Real shop products and offers (signed in): the catalogue API; fixture `e2e/fixtures/shop-catalogue.json` (`shop`, `fields[]`, items). The Offer Lab's two in-page sample books (HOTEL...) become readers of the lab shop. Run `node C:/dev/seams.cjs verticalOf` and `starter` before naming a field; the lab shop's own record needs a dictionary entry in docs/FIELDS.md (a new key).

## Sample (label "Sample")
Trade "Vegetables and fruit", lab shop "Sample Veg Stall", India; first products from the blueprint (Tomato, kg, 40; and the next starters); Offer Lab proposes "Buy 2 kg tomato, get a bunch of coriander" judged against the sample cost; Conversion Lab shows kg > gram > bunch from the same item; Country Lab shows that bill's GST lines; Network Lab shows a supplier > shop move of the same items.

## States
Signed out / signed in (above) · no trade picked (the picker is the screen) · trade picked · guided running (step n of 7, Next/Back/Stop) · finished ("You have seen it all. Try it on your own shop": Sign in or Register) · step not built (greyed, "Not yet") · could not load the shop's products (plain words, falls back to Sample and says so) · phone: the guided card sits in a fixed bottom bar, one pane at a time.

## Rules for the design
Text budget: step names two words, each step one sentence. Copy for the shopkeeper; no "engine", "blueprint", "vertical" words on screen (say "trade"). Light, dark, AA, 390 px, no sideways scroll; the Offer Lab "What this offer does" sheet must fit 390 px.

## Open questions for Athi
1. Which trades beyond the six on file (restaurant, provision store)? cb-vertical must widen the list first. 2. Does the guided ride end with sign-up, or only offer it?

## Not in scope
Writing the lab copy (cb-db / cb-catalogue). The tour's overlay cards (cb-demo's). Tax Lab and Rail Lab (they become Country Lab and the Dispute Lab; NAV-MAP item 2).

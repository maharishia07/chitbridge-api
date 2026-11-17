# Home on a phone: the 5-tab bottom bar (REQUIREMENT for the designer, 19 Oct 2026)

**Status:** PLACED in the real Home on 19 Oct 2026 (branch design/home: shell.js five tabs + More page, manifest places and words, greyed shop tile, one waiting row, Labs tiles). Wiring of the remaining facts comes later; Athi walks the flow first. Test: `node tests/home-phone-bar.test.cjs`.
**Pass mark:** `docs/design/SYSTEM.md` (§3 rules 8-9, §3c one frame). **Map:** `C:/dev/docs/design/NAV-MAP.md` §6 item 6, §7 row "Home".
**Replaces:** the line "the nav shows 7 icons" in `docs/design/home-first-impression/REQUIREMENT.md` (Rules) and `docs/design/phone/REQUIREMENT.md` P6.
**Code today:** `public/app/shell.js` (`.cbsh-nav`, `.cbsh-nv`, phone block `@media(max-width:700px)`, about 55 px per tab at 390) · `public/app/manifest.json` (`entries[].area`).

## Why
Seven bottom tabs (Home, Selling, Money, Running, Trade, Labs, Setup) leave about 55 px each at 390 px: the words shrink to 10.5 px and
Trade, Labs and Setup are things a shop visits rarely. Five tabs is the most a thumb can hit without looking.

## Who
A shopkeeper on a phone, one hand, often not reading. The tab is an icon plus one short word. Staff with a limited role see the same bar.

## The five tabs (NAV-MAP §6 target; designer confirms icons and order)
| Tab | Opens | Holds (one tile each) |
|---|---|---|
| Home | the first screen: "Needs you" strip, Your work, the lead apps | links to the rest |
| Selling | Selling | Till · Catalogue · CRM · Marketing · Your online shop · Disputes |
| Money | Money | Finance · Accounts · How the shop is doing |
| Running | Running | Tasks and Orders · Operations · Employees · Counters · Assist |
| More | a short list of three rows | Trade (Know your business, Documents, Network) · Labs (Price, Offer, Network, Country, Conversion) · Setup (Your business, Country, Connectors, Policy, Account, Plan and usage, Standards) |
Today Tasks and Orders sits in Selling and CRM in Running; the target moves them (NAV-MAP §6). The designer shows the moved result, not today's.

## WAYS IN (to this screen)
- Launch or the app icon: Home tab. Every other page: the header ⌂ Home (one tap).
- The till's own ⌂ (see `docs/design/till-home/REQUIREMENT.md`). Sign-in lands here.
## WAYS OUT (from this screen), max 3 taps to any job
- Tab, then tile: 2 taps (Selling > Till).
- More, then a row, then a tile: 3 taps (More > Labs > Price Lab). Nothing may be deeper than that.
- "Needs you" strip row: 1 tap straight to the page that needs a hand.
- Header: switcher, bell, avatar (Profile, Settings for the owner, Sign out).

## The data the screen shows (real, nothing computed on the page)
- Tiles: `manifest.entries[]` = `id` · `area` · `name` · `route`. A route-less entry (Delivery, People, Trade, Tax Lab, Rail Lab) is greyed with its sentence; the "LATER" dashed chips go (NAV-MAP §6 item 3).
- Per-tile fact and status (docs/FIELDS.md): one fact line and `state` = Needs you (amber) / In use (green) / Not started (grey, "Set up").
- Counts: `GET /api/work/facts` gives `counts{orders_in,orders_out,tasks,done}` and `lines[{text,value,tone}]`.
- Badge on a tab = how many of its tiles are "Needs you". The three "waiting" alert rows become ONE row with ONE count (NAV-MAP item 7).
- "Your online shop" with no shop id is greyed with the sentence why (NAV-MAP item 8). Show every action; the server says may/why.

## Sample (shown before wiring; label it "Sample")
Home tab, shop "Mayur Bhavan" (from `e2e/fixtures/shop-catalogue.json`): Needs you 2: "1 new order" (from `/api/work/facts` fixture `lines[0]`, tone `dn`) · "1 supplier bill is waiting for you to confirm the goods" (from the `/api/books/todo` fixture). Selling badge 1, Money badge 1, Running none. More shows a small dot only if Setup needs a hand.

## States
Signed out (Sign in in the header; tabs show, tiles greyed with "Sign in first") · loading (skeleton tiles, tabs already drawn) · all well (no strip, no container) · needs you (strip + badges) · a role without Money (the Money tab stays, its tiles greyed with the sentence) · could not load (one plain line and Try again; never `error.message`) · Larger text (132%) and RTL: five tabs must still fit.

## Rules for the design
- Icon + one word, 11 px minimum label, a 44 px touch target, the current tab marked by shape as well as colour.
- More is a page, not a menu that covers content. Headers frozen; only the tile list scrolls.
- Tile text: name up to 4 words, one fact line. Same string never twice on one screen.
- Light, dark, and the accessibility themes; AA contrast; `document.scrollWidth === 390`.

## Open questions for Athi
1. Does Marketing stay in Selling (target) or sit under CRM? 2. Should Assist move to Running (NAV-MAP) or stay where staff find it today (Setup)?

## Not in scope
Desktop Home (the side rail stays). The Needs-you strip design (home-first-impression). Icon set (the same brief).

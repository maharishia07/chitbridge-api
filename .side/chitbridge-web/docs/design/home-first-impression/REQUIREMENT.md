# Designer brief: Home, the first impression

**Status:** brief for design, 2026-10-17 (index walk with Athi). **Motto (Athi):** "keep first impression as the motto". The people who saw it before did not understand it; "one or two who have seen it said it makes sense now".
**Pass mark:** `docs/design/SYSTEM.md`. **Code:** `public/app/shell.js` (areas, tiles, facts) · `index.html` (the Your work box) · `public/app/manifest.json`.
Goes with: `docs/design/shop-header/REQUIREMENT.md` (the bar and shop card).

## Already built on walk/index-1 (design from this, not from older shots)
- Sections, daily first and set-up last: **Your work · Selling · Money · Running it · Trade · Labs · Setup**. Each has a one-line purpose under its title.
- Every tile is the **same size (148 px)**: the icon beside the name, up to two lines of purpose (room for longer languages), one fact line. If there are more facts, a **+n** badge shows and the full list **drops down over the page** on hover or focus, so nothing moves.
- Every tile has a **status** from the server (facts `state`, docs/FIELDS.md): **● Needs you** (amber) · **● In use** (green) · **○ Not started · Set up ›** (grey).
- **"● Needs you" strip** at the top of Home: only the amber tiles, each one a link. It is hidden when there are none.

## Wanted from design
1. **One icon set.** Today the icons are text symbols (▤ ¤ ⇆ ◈), which look dated next to Shopify, Square and Zoho. Pick one line-icon set (Lucide is free and MIT). Use the same stroke and size everywhere, and keep the money icon as the shop's currency sign (the AU-WORDS rule). Deliver: the mapping from manifest id to icon name.
2. **A lead row.** The 3–4 apps a shop opens every day (Till · Tasks & Orders · Catalogue · Accounts) are drawn bigger, above the sections. Today every tile has equal weight. Show where it sits next to the Your work box.
3. **"See it work" (60 s).** A guided path from Home: a bill at the Till → the chit reaches the other side → Accounts posts it. Design the entry point (one button on Home) and the 4 steps (overlay cards pointing at the real screen, not a video).
4. **Not started, made inviting.** A grey tile must read as "ready for you", not "broken". Show the treatment, for example a dashed edge with "Set up ›".
5. **The two labs that are still "coming":**
   - Tax Lab: `C:/dev/docs/planning/tax-lab/REQUIREMENT.md` (J0–J4).
   - Rail Lab: `C:/dev/docs/01-rail-core-the-chit/design/RAIL-LAB-REQUIREMENT.md` (4 jobs).

## Rules
- Text budget: titles ≤ 4 words, buttons ≤ 3, no paragraphs. Write for the shopkeeper.
- No "CB"/"ChitBridge" in names: Accounts, Finance, Assist… The trademark appears only in the logo (decided 2026-10-17).
- Never colour alone: every status has its word.
- Phone 390 px: tiles become a list, the nav shows 5 tabs (Home, Selling, Money, Running, More; see docs/design/home-phone-bar/REQUIREMENT.md), and the drop-down shows in place.
- Light and dark, plus the accessibility themes.

## Shots wanted
Laptop and phone, light and dark:
- Home with a lead row, the Needs-you strip and the mixed statuses;
- a section with not-started tiles;
- the See-it-work step 1;
- Tax Lab J1–J2;
- the Rail Lab steps map.

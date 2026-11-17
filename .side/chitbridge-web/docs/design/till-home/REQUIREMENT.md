# The till's Home button (REQUIREMENT for the designer, 19 Oct 2026)

**Status:** requirement only. Do not build. This is the one home of the text; `C:/dev/docs/09-counter/TILL-REDESIGN-BRIEF.md` §8 links here and the designer draws it with the till redesign (CTR-138).
**Pass mark:** `docs/design/SYSTEM.md` §3c (one frame) and `docs/design/phone-till/`. **Map:** `C:/dev/docs/design/NAV-MAP.md` §6 items 15-18, §7 row "Till".
**Owner:** cb-counter (the master is api `tools/tally-connector/till.html`; web `public/till.html` is the vendored copy, so edits go through the api's vendor script).

## Why
The till is the only page with no shell header. The only way out is a small "ChitBridge ↗" in the menu footer, opening a new tab (`till.html:10737`). A cashier in the middle of a rush has no one-tap way back, and the owner has no way to reach the rest of the shop from the counter.

## Who
A cashier or the owner at the counter, on a phone or a till PC, one hand, in a hurry, often unable to read. The button must be findable by shape and position, and must never lose a bill.

## What is wanted
A ⌂ Home button in the till's own top row. Not the full shell header (the till keeps its quiet top row; TILL-REDESIGN-BRIEF §2). It sits at the start of the row beside ☰, and is the same ⌂ glyph as every other page's Home. The "ChitBridge ↗" menu-footer link goes (one door, not two).
Top row after the change, left to right: ☰ (badge) · ⌂ · shop name · counter name · 🛒 N orders (only when any) · ⚠ line (only when wrong) · person chip. Mode is not here (it is in the menu).

## WAYS IN (to the till)
Home > Selling > Till (2 taps). Day book row "Open in the till". Tasks and Orders sheet "Open at the counter". Settings > Counters "Open <name>'s counter" (SET2, replaces the workshop door). Standards list.
## WAYS OUT (from the till)
⌂ to Home, same tab. The ☰ menu stays the hub (Today's bills, Check, Expense, To do, Labs, Settings, Repair and close). Labs and "This device" use `cbRoot()` links, never a relative path (the shop-PC kit serves none). Fix > tax rate goes to `/catalogue.html`. Slip Share with no shop link shows no link; it never opens `app.html` (NAV-MAP items 16-17).

## Behaviour the designer must show
- **A bill in progress is never lost.** Pressing ⌂ with items in the bill, or an unsaved pay step, asks once: "Leave this bill? It will be parked." with two buttons, **Park and leave** and **Stay**. (The till already has Park, F6.) With an empty bill it goes straight home.
- **Offline.** The till works offline (the shop-PC kit). ⌂ is greyed with its sentence "Home needs the internet. Billing goes on." when the page cannot reach Home; it never shows a browser error page. Show the action, grey it with the reason.
- **Role.** A cashier may press ⌂ (Home then shows what their role may open, the server decides). Never hidden.
- **Customer screen.** The customer-facing display (`tvdlg`) has no ⌂.

## Fields
None new. The words come from the catalogue; the counter's name is the counter's own name (W45), never its code. The park uses the till's existing park store. Reuse: `node C:/dev/seams.cjs cbRoot` and `cbHome` (note: `cbHome()` returns `app.html` and hides the door from the guard; CTR-next teaches the guard to flag it).

## Sample (label "Sample")
Mayur Restaurant · Counter 1 · 2 items in the bill (Masala Tea x2 20.00 each, Plain Dosa x1 70.00; from the brief's own mock) · Ravi. Press ⌂ > "Leave this bill? It will be parked." [Park and leave] [Stay]. Offline: ⌂ greyed, line "Home needs the internet. Billing goes on."

## States
Bill empty (straight home) · bill with items (the ask) · pay step open (the ask, and the amount taken is kept in the park) · offline (greyed + sentence) · slow line (works, normal) · phone 390 (⌂ stays in the row; it is 44 px, the shop name gives way to it, never the reverse) · customer screen (absent).

## Rules for the design
No icon appears twice on one screen (a check in TILL-REDESIGN-BRIEF §5): ⌂ must not repeat the 🛍 or the logo. The `data-testid` moves WITH the control (e2e presses controls by testid); the new one is `till-home`. Light, dark, AA, 390 px.

## Open questions for Athi
1. On Park and leave, should the parked bill show on Home's "Needs you" strip so it is not forgotten overnight? 2. Should a signed-in owner see an owner-only extra in the person chip (Settings), or only ⌂?

## Not in scope
The rest of the till redesign (TILL-REDESIGN-BRIEF). Changing `till.html` itself: it is vendored, the counter area does it.

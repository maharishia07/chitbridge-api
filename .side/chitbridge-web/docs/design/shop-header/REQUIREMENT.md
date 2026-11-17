# Designer brief — the shop header (bar + "shop ▼" card)

**Status:** brief for design, 2026-10-17 (index walk with Athi, finding 9). **Visible redesign of what exists** — no new data.
**Pass mark:** `docs/design/SYSTEM.md`. Today's code: `public/app/shell.js` `paintSheet()` (~line 434), words at ~line 51.

## What is wrong today (seen on Home, 1800 px, signed in)
1. The shop name prints twice: once in the bar ("Mayur Restaurant ▼") and again as "THE BUSINESS".
2. **LICENCES** shows as an empty column when the shop has none.
3. The Trade-ready checks are drawn as empty squares that look clickable, but they are statuses.
4. Three thin columns spread over ~1,240 px with large gaps. It opens as a band pushing the page down.

## How others do it (the pattern to follow)
Shopify, Square, Stripe and Zoho Books all put **logo + shop name ▼** in the bar. The ▼ opens a **small card** with the shop's facts and "switch shop".
"Finish your setup" is a **progress card on Home** ("2 of 5 done ▬▬▬░░") that **disappears when done**. It is never a permanent band.

## Wanted
**Bar (44 px, unchanged height):** logo · **shop name ▼** · while any check is missing, one small chip **"Checks 1/3 ›"**. The chip is
amber and opens the card. When all checks are done, there is no chip. Right side unchanged: Home · screen id · 🔔 · avatar.

**Card (opens under the name, ≤ 360 px wide, overlay, one at a time, closes on ✕ / Esc / outside click):**
- Header (frozen): shop name · country flag-less code + currency (e.g. `IN · INR`) · ✕
- Facts: legal name · address · phone · tax number (masked), shown only when present. No empty rows.
- Licences: one row each (label · masked number · days-left status · Renew/Again button on the worst one, as today). If there are none:
  one line, "No licences added · Add", which links to the licences screen.
- Checks: one row each, with ✓ (green) or ○ (grey) and its label. These are **not** checkboxes. Below them, one **Finish the checks** button while any is open.
- Foot: "Your business ›" (settings) · "Switch shop" (only when the person has more than one shop).

## Data (exactly what the shell already reads — `S.header`)
| Field | Source |
|---|---|
| name, legal_name, address, phone | `header.business.*` |
| licences[] {label, number_masked, days_left, band, registered, renew_url, note} | `header.licences` (worst = `worstOf`) |
| checks[] {label, done} · fix_url | `header.trade_ready` |
| country · currency | the stated country/currency (step zero; `CBAvatar.shopCountry`), never guessed |

## States
| State | Bar | Card |
|---|---|---|
| Loading | name ▼ | "Loading…" |
| No header data | name ▼ | name + "Not available yet" |
| All checks done | name ▼ (no chip) | checks collapsed to "✓ All checks done" |
| Some missing | name ▼ · "Checks n/m ›" | as above |
| Licence expiring / gone | name ▼ · chip amber/red | the licence row's Renew / Again |
| Phone 390 px | logo · name ▼ (truncate) · chip as a dot | the card is a full-width sheet from the top, frozen title + ✕ |

## Rules
Tokens from SYSTEM §2. Text budget: card title ≤ 4 words, buttons ≤ 3, no paragraph. Frozen card header. Never colour alone (✓ / ○ symbols).

## Shots wanted
Laptop + phone, light + dark: bar with chip · card with 1/3 checks and no licences · card all done · licence expiring.

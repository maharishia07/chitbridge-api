# Phone pass — every screen re-discovered for a 390 px phone (REQUIREMENT, for the designer)

Athi, 2026-10-10: *"many of the screens are not mobile friendly and has to be rediscovered."*
Source: the morning walk at 390 px — TEST-LOG-2026-10-09.md rows M58–M60, M62–M65, M67–M73, M85–M99.

## What goes wrong today (the same five things on every app)
1. **The top eats the screen** — header + search + 3–5 rows of chips/buttons before the first row of content (till items, online shop, CRM, Day book, Product Lab).
2. **Desktop rows squeezed** — a Day book entry wraps one fragment per line; CRM parties are tall cards; tables scroll sideways.
3. **Two scroll areas** — a box that scrolls inside a page that scrolls (till tiles, CRM, Day book).
4. **The footer kural takes a quarter of the screen**, and its two languages overlap.
5. **Desktop words on a phone** — "Cancel · Esc", key hints, unlabelled icon rows, raw IDs.

## The rules to design once and apply everywhere
| # | Rule | Where it bites now |
|---|---|---|
| P1 | First content row visible in the top third of the first screen | online shop, till, CRM, Day book, Product Lab |
| P2 | Toolbar = one row: the main control + "⋯" for the rest | till quick-keys bar, CRM, Day book, Product Lab |
| P3 | Categories / filters open as an **overlay panel** (takes no space when closed); tap = choose; a visible button always does what a gesture does (Athi) | online shop, till |
| P4 | A list row is 2 lines max: what · amount / who · when | Day book, CRM, follow-ups |
| P5 | One scroll per screen | till, CRM, Day book |
| P6 | Navigation = bottom tabs; the desktop left rail never shows on a phone; tab words = the pillar words | CRM, Accounts, Home |
| P7 | Footer = a minimal one-line strip, opens on tap (Athi) | every page |
| P8 | Totals / basket live in a fixed bottom bar, never inserted above the list | online shop, till |
| P9 | No sideways page scroll, ever (390 px) | Offer Lab sheet, Product Lab, category IDs |
| P10 | Touch words only — no key names, no unlabelled icons | till dialogs, Offer Lab |

## Screens, in order of who uses them on a phone
till (phone shape) → online shop → CRM → CB Accounts → Home → Offer Lab → Product Lab → Standards → the rest.

## Done when
Each screen passes P1–P10 at 390 × 844, checked by the e2e walks at phone size + the AI eye (`pack --review`).

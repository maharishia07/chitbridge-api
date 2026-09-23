# Feedback: your till vs well-known till apps — and where to go next

Reviewed: your built sell screen (chitbridge-web · till.html), the Settings dialog (7 tabs) and the new collapsible Counter menu, from `UI design 1.docx` (18 Sep 2026).

Compared against the patterns used by Square Point of Sale, Square for Restaurants, Toast POS, Lightspeed, Loyverse, Zettle, and the Indian-market tools (Petpooja, Vyapar, Zoho Billing).

---

## 1. What you already do better than most

| | Your till | Typical till app |
|---|---|---|
| Plain language | "Why is a bill stuck?", "Take a break", "Read the shop again", "Bohni" | "Sync queue", "Lock terminal", "Refresh catalog" — jargon |
| First sale of the day | Bohni card, day-open ritual with a photo | Nothing; the day just starts |
| Keyboard-first billing | F2/F4/F6/F8/F9/F10, 3* qty, Ctrl ↑↓, always visible | Square and Toast are touch-first; keyboard is an afterthought |
| Honest money text | "No GSTIN on this shop, so no GST is charged or shown" | Silent tax misconfiguration, discovered at filing |
| UPI as a first-class tender with QR | Yes, with a warning that the address is unverified | Usually a generic "other" tender |
| Time-based quick-key groups | Morning/Afternoon/Evening/Night with per-shift hiding | Square/Toast have fixed grids or "menus" per service period, but hiding a sold-out item is buried |
| Offline honesty | "everything has reached ChitBridge", stuck-bill view | Most show a silent spinner or a red dot |

Keep all of that. It is the personality of the product.

---

## 2. Where the big apps are ahead (gaps to close)

1. **Who is at the till.** Square/Toast/Loyverse open with a PIN per person, and every bill carries that name. You show "nobody signed in" but there is no sign-in or sign-out. Without it there is no accountability for voids, discounts or cash.
2. **Open and close the till with cash.** Toast and Square both do: opening float → sales by tender → expected cash → counted cash → difference → X/Z report. You have "Close this counter" (a sync action) but no cash count, so a short drawer is invisible.
3. **Voids, refunds and reprints with a reason.** Standard everywhere, audited. Missing here.
4. **Parked/held bills as a visible list.** You have Park·F6; there is no list of what is parked, which is how tickets get lost in a rush.
5. **Discounts and offers on a line or a bill.** Your bill table has a DISCOUNT column that is always "—", and the categories include "On offer", but nothing applies one.
6. **Customer and loyalty.** You collect name/phone and show Shop points, but there is no customer screen, history or redemption.
7. **Kitchen tickets.** A KOT checkbox exists in Settings → Quick keys. Toast's whole strength is the kitchen side: where the ticket goes, course timing, re-fire.
8. **Reports at the counter.** Loyverse and Square put a sales summary on the device. You have "Today" in the hub now — that is the right start.
9. **Settings that explain themselves.** Square uses one search across settings. Your 7 tabs will not scale past ~40 fields.
10. **First-run setup.** No wizard: counter number, printer, tax, UPI, groups. Every competitor has one.

---

## 3. The duplication you asked about (menu vs settings)

Comparing the two screens field by field, these appear twice, with different words:

| Thing | In the menu | In Settings | Fix |
|---|---|---|---|
| Quick keys | "Quick keys" show/hide toggle, group dropdown on the sell screen, Arrange button | Quick keys tab: keys from, group, add/remove, hidden keys, KOT | **Settings owns the definition** (which groups and items exist). **The counter owns the moment** (which groups show now, what is sold out). Nothing else repeats |
| Look and feel | Text size, theme, screen-off, hand, product view, "show on this counter" | Screen tab (same fields) | Keep them in the hub's **How it looks** only. Settings → Screen becomes read-only with "change on the counter panel" |
| Counter identity | Header: Counter 1, online, time | Counter tab: counter, bill number, restart, day starts | Identity is shown in the hub header; the numbering rules stay in Settings |
| "Bill" | Bills group (today's bills, stuck) | Bill tab (columns, printer) | Rename the settings tab to **Receipt**; "Bills" always means documents |
| Clear and reload | Careful group | Device tab → Start fresh | Only in Careful |
| Pay | Cash/Card/UPI on the sell screen | Pay tab (UPI payee, button label) | Keep; the sell screen is the act, Settings is the address |
| Hidden keys | Sold-out tray on the sell screen | "Show all again" in Quick keys tab | One control, in the hub: **Sold out · bring back** |

**The rule to write down:** the hub holds anything about *now* (this shift, this device, this person). Settings holds anything *set once*. A field never appears in both; when it is relevant in the other place, it appears as a read-only line with a link.

---

## 4. The redesign on the canvas (row "One counter hub + panel sizes + build status")

**Hub · phone** and **Hub · wide** replace both the menu and the Settings dialog as the entry point. Collapsible sections, same order everywhere:

1. **Start your day** — picture, date, weather (31°C, rain after 5 pm), festival note, three readiness ticks, **Open for today**, cash-in-drawer.
2. **Today** — sale so far, bills, average, split by tender as one bar, yesterday at the same time, Bohni time, **Day close · Z report**.
3. **Alerts** — printer offline, items running low, price change waiting. Badge count on the closed row.
4. **Bills** — today's bills, parked bills (with count), why a bill is stuck.
5. **Shop & prices** — read the shop again, shop screen (TV), ChitBridge.
6. **How it looks** — panel sizes, text/colour/hand, what shows on this counter.
7. **Shop details** — the regional block you asked for: address, GSTIN, phone from ChitBridge with "last read 12:28", money and time zone, working hours. Each row shows the ChitBridge value, and editing it marks it "changed here" until it is pushed back.
8. **This counter** — all settings, take a break, install as an app.
9. **Careful** — sign out, clear and reload, close this counter.

Plus **Who is at the counter** pinned at the top (sign in / sign out) and a **health strip** (online · all sent · printer · products) that is also worth putting on the sell screen header.

**Panel sizes** board: presets (Keys first, Balanced, Search first, Bill first, No keys), density, bill-on-the-left for left-handers, photos on/off, and draggable bars between the three panels, remembered per device. On phones the parts stack instead and the preset only changes keys per row.

---

## 5. Thinking wildly — options worth considering

1. **Voice billing as the headline feature.** You already have a Voice tab and mic buttons. "Two idli, one filter coffee" → chips to confirm → added. No competitor in this segment does this well in Tamil/Hindi. This could be the reason someone switches.
2. **Camera as the catalogue.** Point at the shelf or the plate; the till suggests the item. Also: take the quick-key photo straight from the counter camera.
3. **Quick keys that learn.** Order tiles by what actually sold at this hour last week, with a lock to pin favourites. Predict "will run out by 1 pm" and warn before the item is gone.
4. **The day as a rhythm, not a screen.** Morning ritual (open) → rush mode (keys grow, list shrinks automatically) → evening wind-down (day close nudged, tomorrow's prep list). The layout follows the clock, with a manual override.
5. **One health pill, everywhere.** A single pill that turns amber when anything (sync, printer, drawer, internet, licence) needs attention; tapping opens Alerts. Cashiers learn one indicator instead of six.
6. **Shop screen as a second product.** The TV sign becomes: today's specials, the live queue number, a UPI QR, and "what's fresh". It sells while it waits.
7. **Counter-to-counter awareness.** See other counters' load; hand a parked bill to counter 2; a manager's phone shows all counters live.
8. **Plain-language reports.** "You sold ₹18,400 today, 12% more than last Friday. Idli ran out at 10:40 — you probably lost about 20 plates." Nobody in this market writes reports like that.
9. **Festival and weather modes.** Rain after 5 pm → suggest showing the tea group; Navaratri → the sweets group; salary week → bigger baskets. One tap to accept.
10. **Trust ledger for the shop owner.** Every bill's state (sent, printed, paid, synced to books) visible in one line, so the owner never wonders whether the numbers are real.
11. **Hardware kindness.** Foot pedal or hardware key mapping for + / enter, one-hand mirror mode, big-text kiosk mode, and a "gloves mode" with 64 px targets.
12. **Handheld as the waiter's device**, with the counter as the master: table map, course timing, and the bill moving between devices mid-order.

I'd pick **1, 3 and 8** as the distinctive three, and **5** as the cheapest big win.

---

## 6. What's missing overall (put these in the design queue)

Open/close till with cash count · X/Z report · sign in & out with PIN · void/refund/reprint with reason · parked bills list · line and bill discounts · customer & points screen · KOT view · shop screen (TV) · first-run wizard · empty/error/offline states for every screen · printer setup and test print · returns of a specific bill · rounding rules · tips (if relevant) · multi-counter view · audit log.

---

## 7. Keeping track of what is built (the workstream board)

The canvas now has a **Design workstream** board: every screen, with "designed" and its build state (built / partly built / not built), grouped by area, plus counts at the top. From your screenshots: the sell screen, photos, the popup picker and the 7 settings tabs are **built**; layouts B/C/D, the other pickers, all the non-desktop devices, the back-office screens, the panel sizes and the new hub are **not built yet**.

To keep it honest without hand-maintenance, have the CLI own a status file:

```
design-passes/status.json
{ "updated": "2026-09-18T12:40:00+05:30",
  "screens": [
    { "id": "FullDesktop", "route": "/till.html", "design": "png/FullDesktop.png",
      "state": "built", "sizes": ["1600x900"], "notes": "photos + arrange shipped" },
    { "id": "FullPortrait", "route": null, "state": "not_built" }
  ] }
```

Add to `/design`:

- `/design status` — walk every route, screenshot at the sizes in the test matrix, compare with `png/<id>.png`, and rewrite `status.json` with `built | partly | not_built` plus what differs.
- `/design next` — print the highest-value not-built screens in build order.
- `/design pass N <area>` — do one pass on an area, then update `status.json`.

Then paste the `status.json` back to me and I'll rebuild the workstream board from it, so the design side and the code side always agree.

Sources for the comparison context: [Toast vs Square (2026)](https://www.selecthub.com/pos-software/toast-vs-square-pos/) · [Toast POS vs Square for Retail (2026)](https://loman.ai/blog/toast-pos-vs-square-for-retail) · [Loyverse POS vs Toast POS (2026)](https://www.softwareadvice.com/retail/loyverse-profile/vs/toast-pos/) · [Best mobile POS systems (2026)](https://technologyadvice.com/blog/sales/mobile-pos-system/)

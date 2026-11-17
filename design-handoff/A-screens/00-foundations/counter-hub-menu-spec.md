# Counter hub (the ≡ menu) — standalone build spec

One screen replaces the old ≡ menu **and** the Settings entry point. Mobile-first. Designs: `png/HubPhone.png`, `png/HubWide.png` (current), `png/MenuPanel.png`, `png/MenuPhoneFold.png` (earlier, same grouping), `pdf/menu/`.

---

## 1. What it is

- Opened by **≡** in the sell-screen header, or **Ctrl+K** (which focuses the search row when it exists).
- Phone: a **full-height sheet** with a drag handle. 900 px and up: a **centred dialog** (max 880 px wide, max 92% height).
- It is the only place a cashier goes for anything that is not billing.
- The split to remember: **the hub owns "now"** (this shift, this device, this person). **Settings owns "set once"**. No field appears in both.

## 2. Structure — fixed order, every size

| # | Section | Closed-row summary (live text) | Contents |
|---|---|---|---|
| 0 | **Who is at the counter** (pinned, not collapsible) | `Nobody signed in · bills will not carry a name` / `Priya · since 8:05 am` | Sign in (F7) / Sign out. Shows the person's initials when signed in |
| 0b | **Health strip** (pinned chips) | `online · all sent · printer off · 113 products` | Each chip taps through to Alerts. Amber/red when bad |
| 1 | **Start your day** | `weather · what is ready · open for today` | Shop picture, date, weather + rain warning, festival note, three readiness ticks (products / nothing waiting / line is up), **Open for today**, **Cash in drawer**, Change picture, To-do |
| 2 | **Today** | `₹4,280.50 · 18 bills · cash ₹1,900` | Sale so far, bills, average, tender split as one bar, yesterday at this time, Bohni time, **Day close · Z report (F10)** |
| 3 | **Alerts** *(badge = count)* | `printer offline · 3 items low · price change waiting` | One row per alert with its fix action. Empty state: `nothing needs you` |
| 4 | **Bills** | `today's bills · parked 2 · nothing stuck` | Today's bills (F8), Parked bills (F6, with count), Why is a bill stuck? |
| 5 | **Shop & prices** | `read again · shop screen · ChitBridge` | Read the shop again (F4), Shop screen (TV), ChitBridge (opens elsewhere, ↗) |
| 6 | **How it looks** | `Large · Light cream · panels balanced · left hand` | Panel sizes (own screen), text size, theme, screen-off, hand, product view, and the six **Show on this counter** switches |
| 7 | **Shop details** | `T Nagar · ₹ INR · 7 am–11 pm · GSTIN not set` | From ChitBridge (name, address, GSTIN, phone) with `last read 12:28`; money & time zone; working hours |
| 8 | **This counter** | `all settings · break · install` | **All settings** (opens Settings), Take a break, Install as an app |
| 9 | **Careful** (always last, warm-red box) | `close the counter · clear and reload` | Sign out, Clear and reload, Close this counter — each with a confirm step |

Rules: only **one section open at a time on phones** (Start your day open by default); several may be open from 900 px up (Start your day, Today, Bills open by default). Section order never changes. "Careful" is never a plain row in the list.

## 3. Row anatomy

- Closed section row: 34–36 px tinted icon square · title (15–16 px, 700) · one-line live summary (12 px, muted) · optional badge · chevron. Row ≥ 58 px.
- Action row inside a section: title + one-line description + optional key-cap (F4, F6, F8, F10) + ↗ for anything that leaves the app. Row ≥ 52 px (56 on phones).
- Group tints: bills amber `#FDF3DC/#7A5205`, shop green `#E8F4ED/#16693F`, external blue `#E4EEFA/#174A87`, counter grey `#EFEBE1/#3E3A31`, shop details violet `#EEEAFB/#44308F`, careful `#F8E2D6/#8A3517`.
- Icons: thin line icons only, one family, no colour emoji.

## 4. Sizes

| Width | Shape |
|---|---|
| < 600 | Sheet, one column, folded sections, sticky header (counter + who + chips) |
| 600–899 | Sheet, sections unfolded, action rows two per row where text fits |
| 900–1199 | Dialog, two columns: sections left, "How it looks" right, Careful strip bottom |
| 1200+ | Dialog max 880 px: three section cards left, look card right, Careful strip bottom |

On a phone the parts of "Start your day" and "Today" stack; the tender bar stays full width.

## 5. Behaviour

- Esc / tapping outside closes; focus returns to ≡; focus trapped while open; `role="dialog"`, `aria-modal="true"`, labelled.
- Section headers are `<button aria-expanded>`; open state persists per device between opens.
- Look settings apply **immediately**, no Save. Everything else that writes goes through its own screen.
- Any action that navigates (Today's bills, Settings, ChitBridge) closes the hub first.
- Summaries are live: they read the same state the sell screen reads, so a closed hub still tells the truth.
- Offline: every row still opens; rows that need the network show `needs the line` instead of acting.

## 6. Permissions

| Row | Needs |
|---|---|
| Open for today, Day close, Cash in drawer | signed in |
| Close this counter, Clear and reload | signed in + `counter.manage` |
| Shop details (edit) | `shop.manage`; otherwise read-only |
| All settings | `counter.settings`; individual tabs may be read-only |
| Everything else | any signed-in user; unsigned users may read but not act |

## 7. De-duplication (what to remove while building)

| Remove from | Because it now lives in |
|---|---|
| Settings → **Screen** tab (text, theme, hand, what shows) | Hub → How it looks (Settings shows it read-only with a link) |
| Settings → **Quick keys** → hidden keys "Show all again" | Sell screen sold-out tray / hub |
| Settings → **Device** → "Start fresh · Clear and reload" | Hub → Careful |
| Old ≡ menu → the flat list of 11 items | Hub sections 1–9 |
| Sell screen → "My group" + "Morning" dropdowns | Quick keys picker (groups with checkboxes) |

Rename **Settings → Bill** to **Settings → Receipt**, so "Bills" only ever means documents.

Settings keeps: Counter (numbering, day start), Receipt (columns, printer), Pay (UPI payee, button), Voice (listener, language), Device (counter key, ChitBridge URL), Quick keys (which groups and items exist — the definition), Screen & layout (panel-size defaults for new devices).

## 8. Data the hub needs

```ts
hub = {
  counter: { id, name, outlet, online, pricesAsAt, todayCount, todayTotal },
  user: { id, name, initials, since } | null,
  day: { open, openedAt, picture, weather: { tempC, text, rainFrom }, festival, checks: {...}, drawerFloat },
  today: { sale, bills, avg, byTender: { cash, upi, card }, bohniAt, yesterdayAtThisTime },
  alerts: [ { id, kind, title, detail, action } ],
  bills: { parked, stuck },
  shop: { address, gstin, phone, currency, timezone, hours, lastReadAt, localEdits: [] },
  look: { textSize, theme, screenOff, hand, productView, show: {...}, panelPreset }
}
```
Weather comes from one cached call per hour, keyed on the shop's location from ChitBridge; if it fails, the section drops the weather line and keeps everything else.

## 9. Acceptance checks

- Every section in §2 exists at every size, in that order, with nothing dropped.
- On a phone, all nine closed rows plus the pinned header fit on one screen with no scrolling (390 × 844).
- Closed summaries match the live state (change a theme → the "How it looks" summary changes without reopening).
- Sign in shows the name on the pinned row and on the next bill; sign out returns to "Nobody signed in".
- Alerts badge equals the number of alert rows; clearing the printer alert removes the badge and the chip turns green.
- "Careful" actions each ask for confirmation, and "Close this counter" states it can be reopened.
- No field from §7 appears in both the hub and Settings.
- Keyboard: Ctrl+K opens, ↑↓ moves between rows, Enter runs, Esc closes, F4/F6/F8/F10 work from inside the hub.
- 4.5:1 contrast on every row, ≥ 44 px targets, and the sheet respects `env(safe-area-inset-bottom)`.

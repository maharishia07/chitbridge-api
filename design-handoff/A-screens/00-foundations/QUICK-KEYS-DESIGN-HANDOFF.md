# Quick Keys, Sell Screen and Screen Library: design handoff for CLI

**Product:** CB Test Traders POS (ChitBridge). **Scope:** quick keys with two levels of control, a full sell screen on every device type, an optional photo on each key, and a library of switchable screen styles.

> **For the CLI:** read this file top to bottom before writing code.
> - `pdf/` and `png/` are the visual truth for layout and look. They show the static starting state of each screen.
> - `source/*.dc.html` are the design mockups. Read them for exact colours, sizes and copy, but **do not ship them**. They use a design-tool template format, not app code.
> - Sample data (item names, prices, groups) is illustrative only. Real data comes from the product catalogue.
> - `[shop UPI ID]` is a placeholder. Read it from shop settings.

---

## 0. Package contents

| Path | What it is |
|---|---|
| `QUICK-KEYS-DESIGN-HANDOFF.md` | This file: spec, rules, architecture, build order, acceptance checks |
| `pdf/quick-keys-designs-ALL.pdf` | Every screen, one per page (25 pages) |
| `pdf/screens/NN-*.pdf` | The same screens as separate PDFs, numbered to match §2 |
| `png/<Screen>.png` | High-resolution render of each screen (file name = screen ID in §2) |
| `source/<Screen>.dc.html` | Mockup source for each screen (reference only) |

---

## 1. Concept: two levels of quick-key control

| | Level 1 · Permanent | Level 2 · Temporary |
|---|---|---|
| Who | Manager / owner (`quickkeys.manage`) | Cashier |
| Where | Back office › Menu › Quick keys | Sell screen › **Quick keys** button, group chips and **×** on each key |
| What | Create, rename, colour, order and delete groups; set the time window; add, remove and reorder items; set item photos | Choose which groups show now; hide sold-out items and bring them back |
| Scope | All counters of the outlet, after save and sync | This counter/device only |
| Lifetime | Until changed; every change is audited | Until shift close (or end of business day, see open questions) |

**Example (hotel):** 4 groups × 10 items: Morning 06:00–11:30, Afternoon 11:30–15:30, Evening 15:30–19:00, Night 19:00–23:00.

### Sell-screen behaviour
1. **Quick keys button:** opens the picker and shows a count of ticked groups.
2. **Picker, level A (groups):** one row per group with a checkbox, colour bar, the group name as a hyperlink, the time window, "x / 10 available" and a chevron. More than one group can be ticked.
3. **Picker, level B (items):** opened by tapping a group name. It shows every item in that group with a checkbox, plus Show all / Hide all and Back. Unticking an item hides it on this counter.
4. **× on a key:** hides that item now (sold out). The item moves to the "sold out" tray or chip ("N sold out · bring back"), where one tap restores it.
5. **Group chips** beside the button: tapping a chip's × unticks that group without opening the picker.
6. **Time nudge:** when a group's window starts and the group is not ticked, a banner offers **Show <group>** / **Not now**. It never switches groups automatically.
7. **Grid order:** when several groups are ticked, sections follow group sort order and items follow position order.
8. Hidden items **can still be billed** through search or barcode.
9. **Photos on/off:** a switch in the quick-keys bar, only if the device allows it (see §4).

### Back-office behaviour (maintenance)
- **Left:** group list (colour, name, window, key count) and **New group**.
- **Centre:** group details (name, show from, until, colour, "Suggest this group when its window starts") and the keys table (#, move up/down, **photo thumbnail**, item, code, price, Remove). Remove asks for confirmation inline: "Remove X from Morning for all counters? The item stays in the menu."
- **Right:** "Add from menu" search. Each item shows **Add**, or "In group" if it's already there.
- **Footer:** unsaved-changes indicator, **Discard** and **Save changes**. After saving it shows "Saved · counters pick this up at next sync".
- **Option B (board view):** one column per group, and items are dragged in from the menu list.
- **Device screen style** (back office › Devices), see §4.

---

## 2. Screen catalogue (IDs = file names)

| # | Screen ID | Device / size | Notes |
|---|---|---|---|
| 01 | `Main` | Horizontal 1440×900 | **A · Light**, matches the current counter. Quick keys with popup, banner and sold-out tray |
| 02 | `SellDark` | Horizontal | **B · Dark** theme |
| 03 | `SellTimeline` | Horizontal | **C · Day timeline:** a bar across the day, tap a block to toggle a group. Colour-block tiles, receipt-style bill |
| 04 | `SellRail` | Horizontal | **D · Group rail:** left rail with switches and a progress bar per group; keys as list rows |
| 05 | `FullDesktop` | Horizontal 1600×900 | **Full sell screen** with every element (see §3). Interactive, photos off |
| 06 | `FullPortrait` | Vertical 1080×1920 | Full screen stacked: header › search › categories › quick keys › results › customer › bill › pay |
| 07 | `FullCompact` | Compact 1024×768 | Quick keys and Results as **tabs**; condensed header and shortcut bar |
| 08–09 | `FullTablet`, `FullTabletPay` | Tablet 1180×820 | Sell with bill panel, then **Pay** as a separate step (modal) |
| 10 | `FullPhoneSell`, `FullPhoneBill`, `FullPhonePay` | Phone 390×844 | Three steps: sell › bill (customer, points) › pay |
| 11 | `FullHandheld`, `FullHandheldPay` | Handheld 360×720 | Two steps: sell (group tabs, row keys, SCAN) › bill & pay |
| 12 | `FullDesktopPhotos` | Horizontal | **Photos ON:** 6 per row, 154 px tiles, initials fallback |
| 13 | `FullTabletPhotos` | Tablet | Photos ON: 5 per row, 138 px tiles |
| 14 | `FullPhonePhotos` (+ `FullPhoneSell`) | Phone | Photos ON (3 per row, 118 px) next to photos OFF |
| 15 | `DisplaySettings` | Back office | **Device screen style:** presets, layout, tile, picker, theme, density, photos, cashier permission, live preview |
| 16–18 | `DevicePortrait`, `DeviceCompact`, `DeviceTablet`, `DevicePhone`, `DevicePhoneSheet`, `DeviceHandheld` | Various | Quick-keys-only views per device; the phone picker is a **bottom sheet** |
| 19 | `Tiles` | — | 5 tile styles × states (normal, in bill, sold out) |
| 20 | `PopupDrawer` | Horizontal | Picker alternative: **side drawer** (accordion with switches and item pills) |
| 21 | `PopupFull` | Horizontal | Picker alternative: **full-screen** (4 columns, All/None, Apply/Cancel) |
| 22 | `Maintenance` | Back office 1366×900 | Permanent maintenance: list layout with photo column |
| 23 | `MaintBoard` | Back office 1600×900 | Maintenance option B: board layout |
| 24 | `Flow` | — | Visual flow, data model, rules and acceptance checks |

---

## 3. Full sell screen: every element must exist on every device

On small devices an element may move into a tab, step or sheet, but it must **never be dropped**.

**Header**
- Shop name and the **Sell ▾** mode switch
- Status chips: Counter N · signed-in user or "nobody signed in" · online/offline · "prices as at HH:MM"
- "today N · ₹x" day total, sync tick, and ≡ menu

**Search**
- Mic (voice) and the "Item name, code or barcode…" field
- Hint "↓↑ choose · Enter add", clear (×) button, and a **SCAN** (camera) button on touch devices

**Categories**
- Scrollable chips with counts: Everything · On offer · Off the shelf 5 · Spices 1461 · Rice & grains 1283 · Personal care 1124 · Cleaning 983 · Vegetables 965 · Pulses 650 …

**Quick keys**
- Picker button with count, and group chips with "x/10"
- Sold-out restore, Photos switch, **+ group**, **+ marked row**
- The key grid

**Results list**, per row:
- Name, pack unit, and "code · category"
- Price
- "per packet · incl. 5% GST"
- "MRP ~~₹x~~ **₹y under**"
- **+** button
- The focused row gets a green left border

**Shortcut bar**
- F2 search · ↓↑ PgUp/PgDn choose · Enter/double-click add · 3* quantity · Ctrl ↓↑ change line
- F9 save & print · F6 park · F8 bills · F10 day close · F7 who · F4 re-read the shop · Esc clear

**Customer**
- Customer (optional) + mic, Phone + mic
- **Shop points** strip: "1 point for every ₹100.00 spent · a name or a phone number to hold them"

**Bill**
- "N products · M items"
- Table columns: # · ITEM (name, "per packet · GST 5%") · PRICE/QTY · QTY (− n +) · QTY × PRICE · DISCOUNT · VALUE · ×

**Totals**
- "▸ tax & offer breakdown"
- **Saved −₹x** (green)
- **TOTAL ₹x** (heavy)

**Pay**
- Cash / Card / **UPI (QR)** buttons, with the selected one highlighted green
- UPI panel: QR, amount, "Scan with any UPI app · pays [shop UPI ID]", "The shop marks it paid here once the money arrives."
- "This bill will be recorded as **UPI**"
- **Amount taken** input and **+ part** (split payment)

**Actions:** Clear · Esc, Park · F6, **Save & print · F9** (primary green).

**Status line:** "everything has reached ChitBridge" · "10,441 products, up to date."

**Reference numbers (tests):** 5 × ₹64.00 + 5 × ₹163.00 + 5 × ₹352.00 = ₹2,895.00; saved ₹144.75; **TOTAL ₹2,750.25**.

### Device adaptations
| Device | Quick keys | Results | Bill | Pay |
|---|---|---|---|---|
| Horizontal 1440–1920 | Panel above results, 6 per row | Below keys | Right column (table) | Inline in right column |
| Vertical 1080×1920 | 5 per row | 3 rows | Bottom half (cards with steppers) | Inline, QR to the right |
| Compact 1024×768 | **Tab** "Quick keys", 4 per row | **Tab** "Results" | Right 410 px, compact rows | Inline, small QR |
| Tablet 1180×820 | 5 per row | 2–3 rows | Right 400 px | **Separate step** (modal) |
| Phone 390×844 | 3 per row; picker = **bottom sheet** | List | **Step 2** screen | **Step 3** screen |
| Handheld 360×720 | Group **tabs** + list rows | Via search | **Step 2** (bill & pay) | Same step |

---

## 4. Photos on keys (on/off)

**Setting hierarchy:** per device, then per counter, then outlet default. Optionally the cashier may toggle it for their own device (permission `screen.personalise`).

**Rules**
1. **The photo is optional on every tile style.** The `Photo` tile and Classic-with-photo read the same `item.imageUrl`.
2. **Fallback:** with no image, the tile shows an **initials badge** (letters only, e.g. "Idli batter" → IB) on the group tint. It must never leave an empty box.
3. **Fixed aspect:** the image area has a fixed height (terminal 78 px, tablet 70 px, phone 54 px) and uses `object-fit: cover` with a centred crop.
4. **Text never overlays the image.** Name and price go below it, with a 3 px group-colour bar between image and text.
5. **Sold out:** the image turns greyscale with a "SOLD OUT" label, and one-tap undo works as before.
6. **Sizes per device:**

   | Device | Photos | Tile height | Per row |
   |---|---|---|---|
   | Terminal | full | 154 px | 6 |
   | Tablet | full | 138 px | 5 |
   | Phone | small | 118 px | 3 |
   | Handheld | off by default (list rows) | | |
   | Compact | configurable | | |

   Photos make tiles taller, so fewer keys fit. Show that trade-off in settings: "Fewer keys fit per screen."
7. **Images:**
   - On upload, generate 3 sizes (96, 192 and 384 px, WebP plus a JPEG fallback) and store the hash in `product_image`.
   - Devices pre-cache the images for all quick-key items at sync, so photos still show offline.
   - Lazy-load, with the tinted placeholder showing until the image loads.
8. **Maintenance:** the keys table has a Photo column (thumbnail, or a dashed "+" to upload), with crop, replace and remove. The group panel shows "8 of 10 have a photo".
9. **Accessibility:** use `alt` = item name; decorative placeholders get `aria-hidden`.

---

## 5. Data model

```
quick_key_group          (id, outlet_id, name, color, sort_order, window_from, window_to,
                          suggest_on_start bool, is_deleted bool, version, updated_by, updated_at)
quick_key_group_item     (group_id, product_id, position)   unique(group_id, product_id)
product_image            (product_id, hash, url_96, url_192, url_384, updated_at)
counter_quick_key_state  (counter_id, device_id, business_date, shift_id, active_group_ids[], updated_at)   -- Level 2
counter_hidden_item      (counter_id, device_id, shift_id, group_id, product_id, hidden_at, hidden_by)    -- Level 2
device_screen_config     (outlet_id, counter_id NULL, device_id NULL, config json, updated_by, updated_at)
quick_key_audit          (id, user_id, at, action[create|rename|delete|add|remove|move|photo], before json, after json)
```

`device_screen_config.config`:
```json
{ "preset": "counterClassic", "layout": "horizontal|vertical|compact|tablet|phone|handheld|timeline|rail|auto",
  "tile": "classic|colourBlock|monogram|compactRow|hotkey|photo",
  "picker": "popup|sideDrawer|fullScreen|bottomSheet|dayTimeline|groupRail|tabStrip",
  "theme": "lightCream|dark|paper|navy", "density": "comfortable|compact",
  "photos": true, "photoSize": "full|small", "keysPerRow": 6,
  "cashierMayPersonalise": true }
```
Resolution order: device config, then counter config, then outlet default.

---

## 6. Rules
1. Removing a key in maintenance never deletes the product from the menu.
2. Level 2 actions never write Level 1 tables.
3. Hidden items remain sellable through search or barcode.
4. Temporary state resets at shift close. A new shift defaults to the groups whose window contains the current time.
5. When several groups are ticked, show them in group sort order, then item position order.
6. An item in two groups is hidden **per group**. *(Decision to confirm.)*
7. If a group is deleted or an item removed in back office, counters drop them from Level 2 state on sync.
8. No hard limit on keys per group; the UI is designed for 10.
9. Level 2 and photos work offline (local first, then sync).
10. Switching a screen preset at runtime keeps the current bill and quick-key state.
11. Keyboard shortcuts are identical in every layout that has a keyboard.

---

## 7. Screen library architecture (so users can choose any style)

One shared data model and logic layer, plus a **registry** of swappable UI parts. A new style is one component plus one registry line.

```
src/pos-ui/
  core/        models.ts  quickKeys.ts  bill.ts  shortcuts.ts  images.ts  store.ts   # no UI, fully unit-tested
  tokens/      themes/lightCream.json dark.json paper.json navy.json               # colours, fonts, radii, spacing
  parts/
    header/ search/ categoryChips/ resultsList/ shortcutBar/
    quickKeys/tiles/    Classic ColourBlock Monogram CompactRow Hotkey Photo
    quickKeys/pickers/  Popup SideDrawer FullScreen BottomSheet DayTimeline GroupRail TabStrip
    quickKeys/          GroupChips SoldOutTray WindowBanner PhotosSwitch KeyImage(fallback)
    bill/               CustomerBar PointsStrip BillTable BillCards Totals
    pay/                PayModes UpiQr AmountTaken ActionBar StatusLine
  layouts/     Horizontal Vertical Compact TabletSplit PhoneSteps HandheldSteps TimelineHorizontal RailHorizontal
  registry.ts  presets.ts  ScreenHost.tsx
  gallery/     Storybook or /gallery route showing every part × theme × device
```

**Contracts**
- `TileProps { item, groupColor, groupTint, qtyInBill, showPhoto, photoSize, soldOut, onAdd(), onHide(), onRestore(), hotkey? }`
- `PickerProps { groups, activeIds, hiddenIds, onToggleGroup, onToggleItem, onShowAll, onHideAll, onClose }`
- `LayoutProps { slots: { header, search, categories, quickKeys, results, shortcuts, customer, points, bill, totals, pay, actions, status } }`. A layout may place slots in tabs, steps or sheets, **but must render all of them**.
- Parts read state only through `core/store` hooks. No money or quick-key logic belongs in UI parts.

**Presets** (`presets.ts`):

| Preset | Layout | Tile | Picker | Theme | Photos |
|---|---|---|---|---|---|
| counterClassic (A) | horizontal | classic | popup | lightCream | off |
| counterDark (B) | horizontal | classic | popup | dark | off |
| counterTimeline (C) | timeline | colourBlock | dayTimeline | paper | off |
| counterRail (D) | rail | compactRow | groupRail | navy | off |
| compact | compact | classic | tabStrip | lightCream | off |
| kiosk | vertical | photo | popup | lightCream | on |
| tabletWaiter | tablet | photo | sideDrawer | lightCream | on |
| phoneOwner | phone | classic | bottomSheet | lightCream | off |
| handheldTable | handheld | compactRow | tabStrip | lightCream | off |

**Auto layout** (`layout: "auto"`), chosen by viewport:

| Viewport | Layout |
|---|---|
| ≥1280 wide, landscape | horizontal |
| Portrait and ≥1000 tall | vertical |
| 900–1279 wide | compact |
| 700–1180 wide, touch | tablet |
| <480 wide | phone |
| ≤400 wide with a hardware scanner | handheld |

**Where users choose:**
- **Back office › Devices › Screen style** (screen 15): device list, preset cards, override chips, Photos switch, "Cashier may change" checkbox, live preview, and Reset to counter / Save.
- **Sell › ≡ › Display:** the cashier changes tile style and photos for this device, if permitted.

---

## 8. Design tokens (from the mockups)

**Light cream (default, matches the current counter)**

| Token | Value |
|---|---|
| Page | #FCFAF5 |
| Panel | #F3EFE6 |
| Card | #FFFFFF |
| Line | #DDD6C6 / #E6E0D2 |
| Input border | #CFC7B5 |
| Ink | #1D1B16 |
| Muted | #5E594D |
| Primary (green) | #16693F (hover #0D4A2B) |
| Success tint | #E8F4ED / #A9D3BC |
| Danger tint | #FBEAE3 / #E7B9A8, ink #8E3517 |
| Quick-keys badge | #F2B544 |

**Group colours**

| Group | Bar | Tint | Ink |
|---|---|---|---|
| Morning | #E0A020 | #FDF3DC | #7A5205 |
| Afternoon | #D9602B | #FCE9DF | #8A3410 |
| Evening | #7A62D9 | #EEEAFB | #44308F |
| Night | #2F74C9 | #E4EEFA | #174A87 |

**Other themes**

| Theme | Page | Card | Accent | Notes |
|---|---|---|---|---|
| Dark | #0E1012 | #181B1F | #F2A93B | teal pay #3FB6A8 |
| Paper | #FFFDF7 | | #C2381F | ink #151412, 2 px black rules |
| Navy | #0C1522 | #0F1B2B | #6FE3C1 | |

**Type:** Bricolage Grotesque (display: shop name, TOTAL), IBM Plex Sans (UI), IBM Plex Mono (codes, times). Alternatives used in the options: Archivo, JetBrains Mono, Onest, Schibsted Grotesk.

**Shape:** radius 8–12 px on controls, 11–14 px on tiles, 16–22 px on sheets. Touch targets ≥ 44 px, text contrast ≥ 4.5:1.

---

## 9. Build order
1. `core/` with unit tests for the bill math (reference numbers in §3) and the quick-key rules (§6).
2. Tokens, then the Classic tile, Popup picker and Horizontal layout, matching screens 01/05 pixel-close.
3. `KeyImage` with the fallback, the photo pipeline and offline cache (§4), then the Photo tile and Photos switch.
4. Gallery/Storybook with every part on every device viewport.
5. Remaining layouts: Vertical, Compact, TabletSplit, PhoneSteps, HandheldSteps, Timeline, Rail.
6. Remaining pickers and tiles.
7. `ScreenHost`, registry, presets, auto layout, and back-office **Device screen style** (screen 15).
8. Maintenance screen (22), with board view (23) as an optional second view.
9. Accessibility and keyboard pass, then Playwright screenshot tests for each layout × theme × photos on/off.

## 10. Acceptance checks
- If Morning is ticked at 09:00 and the cashier ticks Afternoon, 20 keys show, with Morning first.
- Tapping × on an item removes it from the grid, adds it to sold out, and shows it unticked in picker level B. Restoring it brings it back.
- If the manager removes an item from Morning and saves, no counter shows it after sync, and it is still in the menu.
- If 3 items are hidden, closing the shift and opening a new one shows all items again.
- At window start, if the group is not ticked, the banner appears once. "Not now" hides it for that window.
- When offline, group and item changes and photos (cached) keep working, and changes sync later.
- With photos ON and an item that has no image, the tile shows initials on the group tint.
- Turning photos OFF on a device turns its tiles into text tiles immediately, and the bill is unchanged.
- Changing a device's preset in back office changes that device's layout after sync, and other devices are unchanged.
- Every layout renders all slots in §3; a test enumerates them.
- The bill total for the reference basket is ₹2,750.25 on every layout.

## 11. Open questions (defaults in brackets)
1. Hide per group or item-wide when an item is in two groups? [per group]
2. Reset temporary state at shift close or end of day? [shift close]
3. Can a supervisor push Level 2 choices to all counters? [no, for now]
4. Should photos be allowed on the compact 15″ terminal? [off by default, configurable]

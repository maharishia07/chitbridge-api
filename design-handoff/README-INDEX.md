# CB Test Traders / ChitBridge till — design package index

**Give this file to the CLI first.** It says what exists, where it is, and in what order to read it.

Everything referenced here is inside the design package folder. Unzip `quick-keys-design-handoff.zip` into the repo as `design-handoff/`, so paths below resolve as `design-handoff/<path>`.

---

## 0. Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `NOW-reliability-usability.md` | **The only work in flight.** Two promises, the SLOs, the definition of done, the build order. Nothing ships that breaks these. |
| 2 | `BACKLOG.md` | Everything parked, sized, with the open decisions. Do not start any of it without being asked. |
| 3 | `QUICK-KEYS-DESIGN-HANDOFF.md` | The main functional spec: quick keys (two levels), the full sell screen element list, devices, photos, data model, rules, acceptance checks. |
| 4 | `mobile-first-instructions.md` | How every screen behaves from phone to wide terminal. Breakpoints, what each pattern becomes, the 11-size test matrix. |
| 5 | `counter-hub-menu-spec.md` | The ≡ menu and settings merged into one hub. Sections, rows, sizes, permissions, de-duplication list. |
| 6 | `global-context-and-infrastructure.md` | What the backend must serve (`GlobalContext`, endpoints, country packs), and the low-infrastructure vs high-infrastructure programme. Mostly backlog; read for context before touching config. |
| 7 | `feedback-vs-known-till-apps.md` | Where this till is ahead of Square/Toast/Loyverse and where it is behind. Useful when choosing what to build next. |
| 8 | `status.json` | Machine-readable build state per screen. Update it as you go. |

Images and PDFs are the **visual truth**; the Markdown files are the rules. Where they disagree, ask.

---

## 1. Folders

| Path | What is in it |
|---|---|
| `png/<ScreenId>.png` | High-resolution render of every design. File name = screen id used everywhere else. |
| `pdf/quick-keys-designs-ALL.pdf` | Every design, one per page. |
| `pdf/screens/NN-*.pdf` | The same screens as separate PDFs. |
| `pdf/menu/counter-menu-designs.pdf` | Menu/hub only, 6 pages. |
| `source/<ScreenId>.dc.html` | Mockup source. **Reference only — never ship these.** They use a design tool's own template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. Read them for exact colours, sizes, spacing and copy. |
| `status.json` | Build state per screen. |

---

## 2. Screen index (id → what it is → spec)

### Sell screen
| Id | What | Spec |
|---|---|---|
| `Main` | Layout A · light, matches the live counter | handoff §2, §3 |
| `FullDesktop` | Full horizontal terminal, every element, interactive | handoff §3 |
| `FullDesktopPhotos` | Same with photos on (switch in the quick keys bar) | handoff §4 |
| `SellDark` · `SellTimeline` · `SellRail` | Layouts B, C, D (dark, day-timeline, group rail) | backlog E1 |
| `Tiles` | 5 tile styles with their states | handoff §2 |
| `PopupDrawer` · `PopupFull` | Alternative quick-key pickers | backlog E2 |

### Devices (same screen, every size)
| Id | What |
|---|---|
| `FullPortrait` | Vertical terminal 1080×1920 |
| `FullCompact` | Compact terminal 1024×768 |
| `FullTablet` · `FullTabletPay` | Tablet, sell then pay |
| `FullPhoneSell` · `FullPhoneBill` · `FullPhonePay` | Phone, three steps |
| `FullHandheld` · `FullHandheldPay` | Handheld POS, two steps |
| `FullTabletPhotos` · `FullPhonePhotos` | Photos on, tablet and phone |
| `DevicePortrait` · `DeviceCompact` · `DeviceTablet` · `DevicePhone` · `DevicePhoneSheet` · `DeviceHandheld` | Quick-keys-only views per device |

### Counter hub (the ≡ menu + settings)
| Id | What | Spec |
|---|---|---|
| `HubPhone` | **Chosen base.** Phone, folded sections, sign-in row, health chips | `counter-hub-menu-spec.md` |
| `HubWide` | Same sections, two columns, Careful strip | same |
| `MenuPanel` · `MenuPhoneFold` · `MenuPhoneStack` | Earlier menu versions, same grouping | same |
| `MenuDrawer` · `MenuPalette` | Not chosen (side drawer, type-to-find) | same |
| `PanelSizing` | Panel-size presets and drag bars, opened from "How it looks" | hub spec §2 row 6 |
| `DisplaySettings` | Back office: screen style per device (preset, layout, tile, picker, theme, photos) | handoff §7 |

### Maintenance (products)
| Id | What |
|---|---|
| `MaintV2` | **Current direction.** Wide: list + editor, filters that find work, bulk edit, for-good vs just-for-today, save states, changed-today with undo |
| `MaintV2Phone` | Same on a phone, editor as a bottom sheet |
| `Maintenance` · `MaintBoard` | Quick-keys group maintenance: list view and board view |

### Idle
| Id | What |
|---|---|
| `IdleShop` | Idle A · resting shop: picture, clock, weather, PIN pad, money hidden |
| `IdleReady` | Idle B · ready check: online/printer/drawer/battery, what is waiting, today's sale with a hide button |
| `IdlePhone` | Phone idle |

### Reference boards
| Id | What |
|---|---|
| `Flow` | Two-level quick-keys model, screen flow, data model, rules, acceptance checks |
| `DesignStatus` | What is designed vs built, by area |

---

## 3. Rules that apply to every screen

1. **Mobile-first.** Write the phone layout first, widen with `min-width` queries only. Nothing is dropped at a smaller size; it folds, tabs or becomes a step.
2. **Five states** for every screen: loading, empty, error, offline, no permission. Part of "done".
3. **Offline is normal.** Bills, quick keys, sold-out, park, printing and sign-in work with no network; the queue shows saved here → sent → confirmed.
4. **Money:** integer minor units, tax on the line, totals recomputed. Reference basket 5 × ₹64 + 5 × ₹163 + 5 × ₹352 = ₹2,895.00, saved ₹144.75, **total ₹2,750.25**.
5. **Two levels of quick keys:** back office decides what exists (permanent); the counter decides what shows now and what is sold out (temporary, resets at shift close).
6. **Hub owns "now", Settings owns "set once".** No field appears in both.
7. Targets ≥ 44 px (48 on phones), rows ≥ 56 px on phones, contrast ≥ 4.5:1, keyboard parity where a keyboard exists.
8. Sample data (names, prices, photos) is illustrative. `[shop UPI ID]` is a placeholder.

---

## 4. What to do with `status.json`

Keep it true. Shape:

```json
{ "updated": "...", "screens": [ { "id": "FullDesktop", "route": "/till.html",
  "design": "png/FullDesktop.png", "state": "built|partly|not_built", "notes": "" } ] }
```

Suggested commands to add to the repo (`.claude/commands/design.md`):

- `/design status` — open every route, screenshot at the 11 sizes in `mobile-first-instructions.md`, compare against `png/<id>.png`, rewrite `status.json`.
- `/design next` — list the highest-value `not_built` screens in build order.
- `/design <area>` / `/design pass N <area>` — one redesign pass over an area, before/after screenshots in `design-passes/<area>/pass-N/`, then update `status.json`.

Safety for those commands: look and navigate only; never save, print, pay, close a counter or delete; use a test counter or a copy of the app; code changes on a branch, never straight to production.

---

## 5. Start here (paste after reading)

```
Read design-handoff/README-INDEX.md, then the files in the order it gives.
Inspect this repo and tell me: framework, state management, styling, where the sell screen lives,
and how the offline queue works today. Then propose how the reliability work in
NOW-reliability-usability.md maps onto this codebase, and wait for my approval.
After approval, build in the order of that file, run the tests, update status.json,
and show me before/after screenshots for each screen you touch.
Ask before changing database schema, payment code, or anything in BACKLOG.md.
```

# CB Test Traders / ChitBridge till — design package index

**Give this file to the CLI first.** It says what exists, where it is, and in what order to read it.

Everything referenced here is inside the design package folder. Unzip `quick-keys-design-handoff.zip` into the repo as `design-handoff/`, so paths below resolve as `design-handoff/<path>`.

---

> **Read every file in this package before you start** — every `.md` and every `.png` under `png/`.
> The order below is the order to read them in, not a shortlist.

## 0. Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `NOW-reliability-usability.md` | **The only work in flight.** Two promises, the SLOs, the definition of done, the build order. Nothing ships that breaks these. |
| 2 | `BACKLOG.md` | Everything parked, sized, with the open decisions. Do not start any of it without being asked. |
| 3 | `QUICK-KEYS-DESIGN-HANDOFF.md` | The main functional spec: quick keys (two levels), the full sell screen element list, devices, photos, data model, rules, acceptance checks. |
| 4 | `mobile-first-instructions.md` | How every screen behaves from phone to wide terminal. Breakpoints, what each pattern becomes, the 11-size test matrix. |
| 5 | `counter-hub-menu-spec.md` | The ≡ menu and settings merged into one hub. Sections, rows, sizes, permissions, de-duplication list. |
| 6 | `global-context-and-infrastructure.md` | What the backend must serve (`GlobalContext`, endpoints, country packs), and the low-infrastructure vs high-infrastructure programme. Mostly backlog; read for context before touching config. |
| 7 | `combo-chooser-spec.md` | The combo / meal-deal modal: two ways to run it, the five button states, the words, the data shape. Fixes the "Choose Choose a tiffin and Choose a drink" button. |
| 8 | `screen-style-preview-spec.md` | The Screen style dialog: why today's preview shows nothing useful, the whole-screen preview, starting styles as pictures, try-for-10-minutes, apply scope. |
| 9 | `counter-health-spec.md` | The diagnostics page: verdict first, is-anything-lost, one action per cause, the technical view, the support report. |
| 10 | `todays-bills-spec.md` | The day's bill list: what a row says, chips for exceptions only, the words, and the operator-name data bug. |
| 11 | `without-the-line-spec.md` | The offline panel: lead with what still works, the three line states (good / patchy / gone), the words, one capability registry. |
| 12 | `counter-hub-spec.md` | The hub: the shop vs start-the-day split, the GSTIN Register path, Check ranked by consequence, the header bar and the operator bug. |
| 13 | `feedback-vs-known-till-apps.md` | Where this till is ahead of Square/Toast/Loyverse and where it is behind. Useful when choosing what to build next. |
| 14 | `status.json` | Machine-readable build state per screen. Update it as you go. |

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

### Combo chooser (the "Choose" modal)
| Id | What | Spec |
|---|---|---|
| `ComboPlate` | **A · Build the plate.** Numbered steps, live plate panel, combo vs separate price | `combo-chooser-spec.md` |
| `ComboUsual` | **B · Ready to go.** Pre-filled with the shop's usual, swap a line inline, button green from the start | same |
| `ComboPhone` | Phone bottom sheet, steps folded, sticky footer | same §7 |
| `ComboWords` | Reference: the five button states, the wording table, the eight rules | same §3–5 |

### Screen style (back office / counter)
| Id | What | Spec |
|---|---|---|
| `StyleStudio` | **Current direction.** Settings left, the whole sell screen previewed right, device tabs, Now/After, what-changes, try for 10 minutes, apply scope | `screen-style-preview-spec.md` |
| `StylePresets` | The nine starting styles drawn as pictures instead of text pills | same §3 |
| `StylePhone` | Phone: preview pinned on top, settings scroll under it | same §4 |
| `DisplaySettings` | The earlier version of this screen | same §1 |

### Today's bills
| Id | What | Spec |
|---|---|---|
| `BillsWide` | **Current direction.** Day strip, filters, list grouped by hour, the bill beside it | `todays-bills-spec.md` |
| `BillsRow` | Row anatomy before/after, seven row states, wording table, the `desktop3` bug | same §3–6 |
| `BillsPhone` | Phone, one column | same §5 |

### Counter hub — the shop, the day, what needs you
| Id | What | Spec |
|---|---|---|
| `HubStart` | **Current direction.** The shop card, then Start the day; GSTIN row with Register ↗ | `counter-hub-spec.md` |
| `HubCheck` | Check ranked by consequence, the registry, the GST item's three doors | same §3–4 |
| `HubHeader` | The header bar: two pills, folding, the person block | same §5–6 |
| `HubStartPhone` | Phone | same |

### Without the line (offline)
| Id | What | Spec |
|---|---|---|
| `OfflineWide` | **Current direction.** Keep-selling banner, three buckets, what happens when the line returns | `without-the-line-spec.md` |
| `OfflineStates` | Good / patchy / gone, the pill in each, the wording table, eight rules | same §3–4 |
| `OfflinePhone` | Phone, folded sections | same §5 |

### Counter health (diagnostics)
| Id | What | Spec |
|---|---|---|
| `HealthWide` | **Current direction.** Verdict, four checks, what is waiting, the last try, what to do, support code | `counter-health-spec.md` |
| `HealthDetail` | Technical view for support — stores, tries, raw answer, probes, retry schedule | same §3 |
| `HealthPhone` | Phone, same order in one column | same §4 |

### Key size
| Id | What | Spec |
|---|---|---|
| `KeySizes` | The five key sizes drawn at true scale, the control, how many fit | `key-size-spec.md` |
| `KeySizeAuto` | Automatic by screen and orientation, and the person's override | same §3–4 |

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

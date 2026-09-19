# What the renders actually show — read this before building any screen

⚠️⚠️ **Athi, 2026-09-18:** *"go through all the PNG, make a reference and accordingly build. i spent lot of time
with design to create those."* — after sending his own design back three times because I had built from the prose.

`README-INDEX.md` says it in one line and I ignored it: **"Images and PDFs are the visual truth; the Markdown
files are the rules."** A screen built from the words satisfies every sentence and looks like nothing anybody
drew, because the drawing is what says *which thing is biggest, what sits beside what, and what the eye lands on
first*. This file is what the renders say, so nobody has to open forty-four PNGs again to find out.

**How to use it:** find the screen, build what is written here, then `Read` the PNG anyway before you finish, then
screenshot your own result and compare. All three steps. Two of them were skipped and it cost a day.

---

## ⭐⭐ READ THE SOURCE FOR COPY, THE PNG FOR LAYOUT

`source/<ScreenId>.dc.html` is **plain text**. The index warns *"Reference only — never ship these"*, and
that is about the code — but as a way to recover **exact wording** it beats reading a picture, and it costs
almost nothing:

```bash
node -e "const h=require('fs').readFileSync('source/Flow.dc.html','utf8');
         console.log(h.replace(/<[^>]+>/g,'\n').split('\n').map(x=>x.trim()).filter(Boolean).join(' | '))"
```

Three of `Flow.png`'s acceptance checks run off the bottom edge of the image at any readable scale. All three
came back from the source in one command. **The PNG is the visual truth; the source is the textual one.** Use
the render to learn what is biggest and what sits beside what, and the source to get a sentence right.

---

## ⚠️⚠️⚠️ FIRST: not every render is the design

Forty-four PNGs, one folder, and nothing in a file name says whether a drawing is the direction or an option
that was turned down. **Building a rejected design is the next version of building from prose.**
`README-INDEX.md` §2 is the authority; this is it in one place.

| | Screens | What that means when you open one |
|---|---|---|
| ⭐ **The direction** | `Main` · `FullDesktop` · `FullDesktopPhotos` · `Tiles` · `MaintV2` · `MaintV2Phone` · `HubPhone` (**chosen base**) · `HubWide` · `PanelSizing` · `DisplaySettings` · all `Full*` and `Device*` device views · `IdleShop` · `IdleReady` · `IdlePhone` | Build these. |
| 🕐 **Earlier versions of a chosen thing** | `MenuPanel` · `MenuPhoneFold` · `MenuPhoneStack` | Same grouping, older shape. `HubPhone`/`HubWide` supersede them — read for copy, not for layout. |
| 💭 **Alternatives, parked as backlog** | `SellDark` · `SellTimeline` · `SellRail` (layouts B/C/D, backlog E1) · `PopupDrawer` · `PopupFull` (pickers, backlog E2) | Do **not** build unasked. They are choices for Athi, not work. |
| 🚫 **Not chosen** | `MenuDrawer` · `MenuPalette` | The index says so in as many words. ⚠️ The hub finder ([TILL-57]) duplicates `MenuPalette` — an open question for Athi. |
| 📋 **A board, not a screen** | `DesignStatus` | The design workstream's own scorecard. See below. |

---

## 💭 The three sell alternatives — `SellDark` · `SellTimeline` · `SellRail` (backlog E1)

⭐⭐ **THE IMPORTANT FINDING: all three carry the SAME model as `Main`.** Every one of them has groups with
time windows, an availability count (`{{g.avail}}`), a sold-out tray with undo, and the same nudge —
*"Afternoon started at 11:30 · 3 Morning keys are sold out"* / `Not now` / `Show Afternoon`.

**So choosing between them does not change the data model.** They are three chromes over `Flow.png`. That
makes E1 a cheap decision to defer and a cheap one to take — which is worth knowing before anyone treats it as
a fork in the build.

| | What is different |
|---|---|
| **`SellDark`** | The dark theme. Header adds `Thu 17 Sep · 11:42`. The group picker is a popup: *"Tick what this counter shows now. Tap a name to pick its items."* and, at its foot, *"For this counter until shift close."* — Level 2's lifetime said on the control itself. |
| **`SellTimeline`** | ⭐ Genuinely a different interaction: a **day rail from 06:00 to 23:00** with the groups as blocks along it, a `NOW 11:42` marker, and the instruction `TAP A BLOCK TO SHOW / HIDE ITS KEYS`. The empty state reads *"Tap a block on the day rail to show its keys."* Time is the navigation. |
| **`SellRail`** | A `SHOWING NOW` rail down one side listing the live groups with their windows and counts, and `SOLD OUT · n` beneath with `Undo` per item (empty state: *"Nothing hidden."*). |

---

## The idle phone — `IdlePhone.png`

Richer than `IdleShop`/`IdleReady`, and three lines in it are decisions:

- `Mayur Bhavan` · `Counter 1 · resting` — **"resting"**, not "locked" or "idle".
- A large clock (`3:42`) and `Friday 18 September · 31°C, rain after 5`. ⭐ **Weather, with a consequence**
  — "rain after 5" is a thing a shopkeeper acts on, not an ornament.
- The shop's own picture behind it.
- `WAITING FOR YOU` — a list of work, each with a badge, a title and a detail.
- ⚠️ **"Today's sale is hidden until you sign in."** The day's figure is private on a resting screen. We show
  `today 0 · ₹0.00` in the header at all times.
- Staff as initials + name, and `Tap to sell`.
- ⚠️ **"Nothing is closed · the bill in hand is saved"** — the resting screen states R1 in six words.

---

## Photos on — `FullDesktopPhotos` · `FullTabletPhotos` · `FullPhonePhotos`

Not separate screens: the same three with the **`Photos` switch in the quick-keys bar** (handoff §4), which
is where the maintenance render also puts `Pictures` — over the thing it changes, never in a settings screen.

- A tile with no photo falls back to `{{t.initials}}`, which is what we already do.
- The desktop bar also carries **`+ group`** and `+ marked row`, and a
  `{{hiddenCount}} sold out · bring back` link — the sold-out tray again.
- ⭐ The phone abbreviates the label to **`▦ Keys · 2`** and writes the switch as **`Photos ● on`** — a state,
  not a control, because there is no room for both.
- ⭐ The phone also carries a **persistent bill bar at the foot**: `15` · `3 products · view bill` ·
  `₹2,750.25`. On a phone the bill is never off screen, only folded.

---

## Quick-keys-only device views — `DeviceCompact` · `DevicePortrait` · `DeviceTablet` · `DevicePhone` · `DeviceHandheld`

The keys and the bill with everything else stripped away, one per device. They exist to show the **key grid at
each size**, and each one quietly fixes the verb for that device:

| | Says |
|---|---|
| `DeviceCompact` | `Quick keys · 2`, a `SOLD OUT` tray (Ven Pongal, Poori Masala), `Clear` `Park` **`Save · F9`** |
| `DevicePortrait` | `Park · Clear` on one control, **`Save & print`** |
| `DeviceTablet` | ⭐ **`Long-press a group to pick items`** — the touch equivalent of "tap a name for its items" |
| `DevicePhone` | `Keys` · `Morning 7` `Afternoon 10` · ⭐ **`+ Evening`** — a group not yet on is offered as an add, not hidden · `View bill ₹220.00` |
| `DeviceHandheld` | `CB · Handheld 3` · ⭐ **`Table 7 · 11:42`** — a handheld is bound to a TABLE · `Bill · 5` · ⭐ **`Charge ₹220`** |

⚠️ **`Charge`, not `Pay` and not `Save & print`.** A waiter charges a table; a cashier takes a payment. Three
device renders, three verbs, and they are not interchangeable.

---

## The menu family — `MenuPanel` · `MenuPhoneFold` · `MenuPhoneStack` · `MenuDrawer` · `MenuPalette`

🕐 Earlier versions of the hub (`HubPhone` is the chosen base, `HubWide` its wide form), plus two the index
lists as **not chosen**. Read them for **copy**, not layout — the section names are settled and identical
across all five:

- **`HOW IT LOOKS`** — label/value rows
- **`SHOW ON THIS COUNTER`** — the per-section switches
- **`CAREFUL`** — and its exact wording, which is worth keeping verbatim:
  > *"These two stop billing for a moment. Everything is sent and checked first."*
  > `Clear and reload`   `Close this counter`
- `Nobody signed in · ` **`Sign in · F7`**, and a version string (`v4.2.1`) in the phone forms.
- `MenuPanel` adds: *"These settings are kept on this device only. The counter's own style is set in* **back
  office**.*"* — the device/shop boundary, said on the screen.
- `MenuPhoneFold` gives each folded section a `{{s.summary}}` line, so a closed section still says something.

🚫 **`MenuPalette`** is the type-to-find command palette — `Ctrl K`, `↑↓ move`, `Enter run`, `Esc close`.
**Not chosen.** ⚠️ Our hub finder ([TILL-57]) is this design, rebuilt from prose. Open question for Athi.
🚫 **`MenuDrawer`** is the side-drawer form. Not chosen.

---

## The scorecard — `DesignStatus.png` and `status.json`

`status.json` carries `{ id, route, design, state, notes }` for 35 screens, and the board renders it:
**46 designed · 10 built · 6 partly · 30 not built**, as at 2026-09-18.

⚠️ **It is the DESIGN SIDE'S VIEW, and it is not measured.** The board's footer claims *"the CLI runs
`/design status` → screenshots every route → writes status.json"*, but only three rows carry a `route` at all
(`Main`, `FullDesktop`, `FullDesktopPhotos`, plus `MenuPanel` and `MaintV2` as fragments). Every other state
is hand-set. Several rows marked `not_built` — `FullPortrait`, `FullPhoneSell`, `FullHandheld` — are shapes
this counter does have. **Reconcile before believing it; never quote it as our build state.**

⭐ The board also carries a **"Missing from both (to design)"** column — seven things found by comparing this
counter against other till applications, designed but not built anywhere yet:
open/close till with a cash count · X/Z day report · refund, void, reprint with a reason · a parked-bills list ·
discounts and offers on a line · a customer & points screen.
Some exist here in another form (F6 parks a bill, F10 closes the day), so each needs checking rather than
building. **This is counter backlog, and it did not come from Athi — it came from the comparison.**

---

## The sell screen, layout A — `Main.png`

The one `status.json` calls **built**. Most of it is, but five things in the drawing are not on our counter.

**Left.** Header on one line: shop · `Sell ⌄` · `Counter 1` · `nobody signed in` · `● online` ·
`today 0 · ₹0.00` · ☰. Then a dark **`▦ Quick keys 1`** pill, the live group as a dismissible amber chip
(`● Morning ✕`), and **`+ marked row`** at the right.

⭐ **A TIME-BAND BANNER, which we do not have.** A tinted strip across the keys:
> 🕐 **Afternoon** starts at 11:30 · 3 Morning keys are sold out.   `Not now`   **`Show Afternoon`**

The counter notices the shift is about to turn over and offers the swap. `Not now` dismisses it; **Show
Afternoon** switches group. This is the design being *helpful about time*, and nothing in our build does it.

Group header: `MORNING  06:00 – 11:30 · 7 of 10 showing` ————— `Choose items` (a link, right-aligned).
So a group states **its hours**, **how many of its keys are showing**, and offers a way to pick.

**Tiles**: a short coloured bar top-left, the name, `₹40.00 / plate`, an **`✕` top-right that takes the
product off the group inline**, and a green count badge when it is on the bill.

⭐ **A `SOLD OUT · 3` STRIP PINNED AT THE FOOT**: `Ven Pongal ↺` `Poori Masala ↺` `Rava Dosa ↺` — struck
through, each with an undo arrow to put it back. We hide sold-out keys; the render *keeps them visible and
reversible*, which is the difference between "gone" and "gone until I say otherwise".

**Right — the bill is a TABLE with column headings**: `# | ITEM | PRICE | QTY | QTY × PRICE | DISC. | VALUE`
and an `✕` per row. QTY is a `− 5 +` stepper; `per plate · GST 5%` sits under the name; **DISC. shows `—`
when there is none** rather than being blank. Foot: `Includes GST 5% · ₹29.76` with `▸ tax & offer breakdown`
on the right, `TOTAL ₹625.00`, the three tenders, the QR block, `Amount taken` + `+ part`, then
`Clear · Esc` `Park · F6` **`Save & print · F9`**. Very bottom: `everything has reached ChitBridge` ·
`10,441 products, up to date.`

---

## ⭐⭐⭐ The tablet sell screen — `FullTablet.png` · **this is the real answer to the Pay question**

**There are no tender buttons on the tablet sell screen at all.** The bill foot is:

> `Saved · ▸ tax & offer breakdown`  −₹144.75
> **TOTAL  ₹2,750.25**
> `Clear`  `Park`
> **`Pay ₹2,750.25 →`** — full width, filled, **the amount is on the button**

That is it. One control, impossible to miss, and it carries the number so the eye lands on the money and the
action in the same glance. Tapping it opens the overlay card in `FullTabletPay.png`.

⚠️ So Athi's *"I was searching where it is"* was not a request for a second button — it was the absence of
**this** one. Our tablet/desktop screen puts three tenders and a QR at the bottom of a scrolling column; the
design replaces all of that with a single `Pay <amount> →` and moves the tenders into the card.

**The rest of the tablet screen.** The search row carries a **scan button** (⛶) at its right end. The quick
keys sit in their own boxed panel with a dark `▦ Quick keys · 2` label, group chips that state their fill —
`Morning 9/10 ✕`, `Afternoon 10/10 ✕` — and `+ marked row`.

⭐ **THE COLOURED BAR ON A TILE IS ITS GROUP.** Amber for the Morning row, orange for the Afternoon row. Two
groups are on screen at once and the bar is how you tell which key came from which — not a stock level, not a
margin. (`FullCompact` uses a coloured **dot** before the price for the same thing.)

Under the keys, the ordinary product list: name + unit word, `BEV-01613 · Beverages`, the price large, and
`MRP ₹358.00 ₹67.00 under` — the struck MRP with the gap **named as a fact, never as a saving**, which is
what we already do. A `+` button per row.

Right pane: `Customer (optional)` and `Phone`, **each with its own mic**; then a green strip —
`Shop points · 1 point per ₹100.00 · name or phone holds them` — so rewards are stated at the top of the bill
before anything is totalled.

---

## The compact terminal — `FullCompact.png` (1024×768)

What a small desktop gives up, and what it must not:

- The header collapses to one line with `·` separators.
- ⭐ **Quick keys and search results become TABS**, not two stacked areas: `Quick keys 2` | `Results · 4`
  with an underline on the active one. At 768px tall there is no room for both, so they share the space.
  Group chips (`Morning ✕` `Afternoon ✕`) and a `Groups…` overflow sit on the same row.
- Tiles lose their photo and their coloured bar becomes **a dot before the price**; the `✕` and the count
  badge stay.
- The bill rows **lose the column headings** that `Main` has — name, `₹64.00 · GST 5%`, stepper, value, ✕.
- ⭐ **The QR shrinks to a square tile sitting beside the tender buttons**, instead of a block under them, and
  the words move to one line underneath: `Recorded as UPI · pays [shop UPI ID]`.
- `Saved · ▸ breakdown  −₹144.75` above `TOTAL ₹2,750.25`.
- A full shortcut bar across the foot: `F2 search · Enter add · 3* qty · F9 save · F6 park · F8 bills ·
  F10 day close · F7 who · F4 re-read · Esc clear`.

⚠️ Note the compact screen keeps `Save & print · F9` rather than the tablet's `Pay →`. **A keyboard terminal
finishes the bill; a touch tablet goes to a pay card.** The difference is the input device, not the width.

---

## ⭐⭐⭐⭐ `Flow.png` — READ THIS BEFORE TOUCHING QUICK KEYS. IT IS THE WHOLE SPEC.

Not a screen. It is *"DESIGN FLOW · HANDOFF FOR BUILD"* — the two levels of control, the screen flow, the data
model, eight rules and the acceptance checks, on one page. **Nothing else in the package carries this much
decided detail, and I built quick-key groups twice without opening it.**

> *"The business decides which keys exist, and that change is permanent. The counter decides what shows right
> now, and that change is temporary."*

### The two levels

| | **Level 1 · PERMANENT** | **Level 2 · TEMPORARY** |
|---|---|---|
| Screen | Maintenance | Sell |
| Who | Manager / owner — permission `quickkeys.manage` | Cashier at the counter |
| Where | Back office › Menu › Quick keys | Sell › Quick keys button (popup), and `✕` on each key |
| Does | Create, rename, **colour**, order and delete groups; **set the time window**; add, remove and reorder items | Choose which groups show now; hide or bring back items that are sold out |
| Scope | **All counters of the outlet**, after save and sync | **This counter only** |
| Lifetime | Until changed again. **Audited** (who, when, what) | **Until shift close.** Never changes Level 1 data |

⚠️ **This is the part our build does not have at all.** Our groups are a per-device
`tillOpt().groups` map with copy-on-write. The design has an **outlet-level, audited, versioned** Level 1 and
a **per-counter, per-shift** Level 2 that can never write to it.

### Screen flow

**Maintenance:** `M1 Groups list` (pick a group or "New group") → `M2 Group details` (name, window from–to,
colour, *"suggest when window starts"*) → `M3 Keys in group` (add from menu · remove **(confirm)** · move
up/down) → `M4 Save` (write + **audit log**, bump `version`) → **Sync to counters**: *"Counters reload groups
on next sync; their temporary choices are kept where the group/item still exists."*

**Sell:** `S1 Sell opens` — *restore this shift's choice, or default to groups whose window contains now* →
`S2 Quick keys grid` — one section per ticked group, in group order, `✕` on every key → `S3 Popup: groups` —
checkbox per group (tick 1, 2 or more), group name is a link, *"x / 10 available"* → `S4 Popup: items` — all
items in the group with a checkbox, `Show all` / `Hide all` / `Back` → **Done**: popup closes, grid redraws at
once, saved locally **and** to the server as this counter's shift state.

### Three shortcuts, spelled out

- **`✕` on a key** — hides that item now (sold out). It moves to the **"Sold out" tray under the grid**;
  tapping it there brings it back. *Same state as unticking it in S4* — one state, two doors.
- **chip `✕`** — the group chips beside the Quick keys button untick a group **without opening the popup**.
- **Time nudge** — when a group's window starts and the group is not ticked, a banner offers *"Show Afternoon"*
  / *"Not now"*. ⚠️ **"It never switches groups automatically."** The counter suggests; the cashier decides.

### Data model (five tables)

```
quick_key_group        id, outlet_id, name, color, sort_order, window_from, window_to,
                       suggest_on_start, is_deleted, version, updated_by, updated_at
quick_key_group_item   group_id, product_id, position · unique (group_id, product_id)
counter_quick_key_state   counter_id, business_date, shift_id, active_group_ids[], updated_at   · LEVEL 2
counter_hidden_item       counter_id, shift_id, group_id, product_id, hidden_at, hidden_by      · LEVEL 2
quick_key_audit        who, when, action (add / remove / move / rename / delete), before, after
```

### The eight rules

1. Removing a key on the maintenance screen **never deletes the product from the menu**.
2. **Level 2 actions never write Level 1 tables.**
3. **A hidden item can still be billed through search or barcode.** Hiding is about the grid, not the shelf.
4. Temporary state **resets at shift close**; a new shift starts from the time-window default.
5. Several groups ticked: sections show in **group sort order**, items in **position order**.
6. An item in two groups is hidden **per group** — hiding it in Morning does not hide it in Afternoon.
   🟡 **Marked *"Decision to confirm"* in the render itself — this one is genuinely open, for Athi.**
7. If a group is deleted in back office, counters **drop it from their ticked list on sync**.
8. No limit on keys per group in the model; **the UI is laid out for 10 per group**.

### Acceptance checks (Given / When / Then, written for us)

- *Given* Morning ticked at 09:00 · *When* the cashier ticks Afternoon and taps Done · *Then* **20 keys show,
  Morning first**.
- *Given* Ven Pongal is showing · *When* the cashier taps its `✕` · *Then* it leaves the grid, **appears in
  Sold out**, and S4 shows it unticked.
- *Given* the manager removes Rava Dosa from Morning and saves · *When* counters sync · *Then* no counter shows
  it in Morning, **and it is still in the menu**.
- *Given* 3 items are hidden · *When* **the shift closes and a new one opens** · *Then* all items show again.
- *Given* it is 11:30 and Afternoon is not ticked · *When* the sell screen is open · *Then* **the banner appears
  once**; *"Not now"* hides it **for that window**.
- *Given* **the counter is offline** · *When* the cashier changes groups or hides items · *Then* it works
  locally and syncs later.

### What this means for us

Our quick keys satisfy the *shape* of Level 2 and none of Level 1. Before building any of it, note that the
pieces interlock: the **time window** produces the nudge banner, the **colour** makes several-groups-at-once
legible, `sort_order`/`position` produce rule 5, and `version` + the audit table are what make "the business
decides, permanently" true. Half of it is worse than none — a group with a colour and no window is decoration.

---

## ⭐⭐⭐ A QUICK-KEY GROUP HAS HOURS AND A COLOUR, AND SEVERAL CAN BE ON AT ONCE

This is the biggest thing the renders say that our model does not have, and it is spread across four of them,
which is why reading any one of them alone missed it. `DevicePhoneSheet.png` states it outright:

> **Quick keys** — *Tick groups. Tap a name for its items.*
> ☑ ▍**Morning**   06:00–11:30 · 7/10 on    ›
> ☑ ▍**Afternoon** 11:30–15:30 · 10/10 on   ›
> ☐ ▍**Evening**   15:30–19:00 · 10/10 on   ›
> ☐ ▍**Night**     19:00–23:00 · 10/10 on   ›
> **`Done`**

Four facts, none of which we implement:

1. **A group owns a time band.** `06:00–11:30`. It is not decoration — it drives the banner in `Main.png`:
   *"🕐 **Afternoon** starts at 11:30 · 3 Morning keys are sold out."* with `Not now` / **`Show Afternoon`**.
2. **A group owns a colour**: Morning amber, Afternoon orange, Evening purple, Night blue. That colour is the
   bar on a tile in `FullTablet.png` and the dot before the price in `FullCompact.png` — it is how you tell,
   with two groups on screen at once, which key came from which. It is **not** a stock level or a margin.
3. **Several groups are on at the same time** — a tick per group, not one active group. `FullTablet.png` shows
   `Morning 9/10 ✕` and `Afternoon 10/10 ✕` side by side, each dismissible, with a `Groups…` overflow.
4. **A group states how full it is**: `7/10 on`, `9/10`. So a shopkeeper can see a group is half switched off
   without opening it.

⚠️ **Our model is `tillOpt().group` — one name, no hours, no colour, no multi-select.** Everything above is a
change to that shape, not a coat of paint on it. It is also *coherent*: the hours produce the banner, the
colour makes multi-select legible, and the fill count makes "Choose items" worth opening. Building any one
piece alone would be building a third of an idea.

Two actions per row and they are different: **the tick shows or hides the group on the keys; the name drills
into its items** (`›`).

---

## The phone, step 2 — `FullPhoneBill.png`

`← Bill` with `3 products · 15 items` at the right. `Customer (optional)` and `Phone`, each with its own
mic. The green `Shop points · 1 point for every ₹100.00 spent · a name or phone holds them` strip.

Rows are **numbered** and carry their meta on one line: `₹64.00 / pkt · GST 5% · disc —` then the stepper,
the value, and an `✕`. ⭐ Note `disc —`: the DISC column that `Main.png` gives a whole table column collapses
into the meta line here rather than disappearing. **A column that vanishes on a small screen teaches the eye
that discounts are sometimes not shown.**

Foot: `Saved · ▸ tax & offer breakdown` −₹144.75 · `TOTAL ₹2,750.25` · `Clear` `Park` **`Pay →`**.
The Pay button carries no amount here because the total is directly above it; on `FullTablet` it does, because
there the eye has further to travel.

---

## The handheld — `FullHandheldPay.png` (360×720)

⭐ **A handheld is TWO steps, not three**: the screen is titled `← Bill & pay` on a **dark bar**, and the bill
and the payment share it. A waiter at a table cannot afford a third screen.

Rows are stripped right down — name, stepper, value, no meta line, no numbering. Then a hard rule, and:
`Saved −₹144.75 · ▸ breakdown` with **₹2,750.25** on the same line, the three tenders, the QR beside its words
(*"Scan with any UPI app · pays [shop UPI ID]. Marked paid once money arrives. Recorded as **UPI**."*),
`Amount taken` + `+ part`, and `Clear` `Park` **`Save & print`**.

### ⭐⭐ The rule the five device renders add up to

| Device | Steps | How the bill is finished |
|---|---|---|
| Desktop / compact terminal | one screen | tenders inline · **`Save & print · F9`** |
| Tablet | one screen | a single **`Pay ₹2,750.25 →`** → a modal pay **card** |
| Phone | **three** — pick · bill · pay | `Pay →` → a whole pay **screen** |
| Handheld | **two** — pick · bill & pay | tenders inline · **`Save & print`** |

⚠️ **It is the input device that decides, not the width.** A compact 1024×768 terminal keeps `Save & print`
because it has a keyboard; a tablet of similar width goes to a pay card because it has a thumb. Anything that
keys this off screen size alone will get the handheld and the tablet the wrong way round.

---

## Paying — `FullTabletPay.png` and `FullPhonePay.png`

### ⚠️⚠️⚠️ ON A TABLET, PAY IS A MODAL CARD — NOT A PANEL AT THE BOTTOM OF THE PAGE

This is the answer to Athi's own observation (2026-09-18): *"the pay panel is at very bottom, so i was searching
where it is, as my eyes are focusing on the top… can we introduce Pay button there also, i know it is
duplicate."* **I talked him out of the duplicate button and left the panel where it was.** The render shows we
were both solving the wrong problem: there is nothing to scroll to, because the whole screen dims and one card
comes forward carrying everything paying needs.

The card, top to bottom:
- `←` back, then a quiet line: `3 products · 15 items · Saved ₹144.75 · ▸ tax & offer breakdown`
- **`TOTAL ₹2,750.25`** — biggest thing on the card, on the same line as the back arrow
- three tender buttons of equal weight — `Cash` `Card` `UPI · QR` — the chosen one filled
- the QR **beside** its words, not above them: the amount again, *"Scan with any UPI app · pays [shop UPI ID]"*,
  *"The shop marks it paid here once the money arrives."*, and `This bill will be recorded as **UPI**`
- `Amount taken` with a `+ part` button beside it — part payment is one tap, not a mode
- `Clear` · `Park` · **`Save & print`** (filled) across the foot

⭐ Everything a cashier needs to finish a bill is on one card, and the bill behind it is dimmed but still there.

### The phone — `FullPhonePay.png`
Same content as **step 3 of 3**, not an overlay: `←` `Pay` as a title, `TOTAL · saved ₹144.75` above a very
large total, the three tenders as a full-width row, the QR **centred above** its words, then `Amount taken` +
`+ part`, and `Save & print` full-width pinned at the bottom.

⚠️ So the same job takes two shapes and the difference is not decoration: a phone has three steps and can afford
a whole screen, a tablet has one screen and borrows it. **A panel welded to the bottom of a long page is
neither.**

## Panel sizes — `PanelSizing.png` (opened from the hub's "How it looks")

**NOT BUILT, and the gap is real.** The counter has one draggable split (`.grip`, `--split`) between the left
pane and the right. The render has **two** bars — keys | list | bill — and, above them, five named presets:

| Preset | For |
|---|---|
| **Keys first** | busy tiffin counter · few searches |
| **Balanced** *(the default)* | — |
| **Search first** | big catalogue, barcode shop |
| **Bill first** | long bills, kirana baskets |
| **No keys** | scanner only · all screen to list and bill |

Each preset draws a little three-band diagram of the split it makes. The header states the live split in words —
`Balanced · keys 44% · list 22% · bill 34%` — with **Reset to balanced** on the right.

Below: **Density** (Comfortable / Compact) and **Also** — *Bill on the left (left hand)* and *Photos on keys*.

⚠️ Two rules in the render's own words, both of which a build would otherwise get wrong:
- *"The counter remembers it per device, and the presets are only starting points."* — a preset **seeds** the
  drag, it does not lock it. Dragging afterwards must not snap back to the preset.
- *"On a phone the parts stack instead, in this order: keys, list, bill. Presets then only change how many keys
  fit per row."* — so the preset means something different on a phone rather than nothing.

⚠️ **`PRESETS` in `lib/screen-kit.js` is a DIFFERENT AXIS.** Those (`counterClassic`, `kiosk`,
`tabletWaiter`…) are device styles. These five are how the width divides. Two registries, two questions —
do not fold one into the other. [[feedback-name-vs-behaviour]]

---

## Maintenance — `MaintV2.png` (wide, 1600×900-ish)

**Header strip:** `Mayur Bhavan` · `✎ Maintenance ▾` · `Counter 1` · `(RK) Ravi K · manager` ·
`● online · all sent` · `prices as at 12:28 · 2 h old — read again · F4` … right: *"changes here reach every
counter and the shop screen"* · `≡`

**Left — the list (≈55%)**
- Search: *"Which product? Name, code or barcode"* with `↓↑ choose · Enter edit` inside it, then `⚌ Sort: name`,
  then `Pictures [toggle on]`.
- Chips row 1: **Everything 113** (dark, active) · Changed today 3 · Off the shelf 4 · No photo 9 · No price 1 ·
  **Not on any key 12** · On offer 0.  Row 2: the categories — `Tiffin 25`.
- Under the chips, two lines on one row: *"113 products on this counter, read at 12:28 · everything is here,
  including what is off the shelf"* … right-aligned: *"tick rows to change many at once"*.
- **A row** = `[ ] checkbox` · square photo/initials tile · **Name** + `unit` (small, grey) · `CODE · Category`
  underneath · a **status badge** · price (bold, right) + `per plate` underneath.
- Status badges seen: `Editing` (green, on the open row), `Not on any key` (grey), `Changed today` (amber),
  `No price` + `No photo` (pink, two on one row), `Off the shelf` (grey). Price reads **`not set`** in red when
  there is none.
- The open row has a green border and a tinted background. Ticked rows show a green ✓ box.
- **Bulk bar** (dark, pinned at the foot of the list): `2 chosen` … `Change price` · `Take off the shelf` ·
  `Add to a quick key group` · **`Clear`** (amber).
- **Shortcut line** under everything: `F2 search · ↓↑ choose · Enter edit · Ctrl S save · Ctrl Z undo ·
  F4 read the shop again · Esc clear`.

**Right — the editor (≈45%)**
- Header: photo tile · **Sambar Idli** (large) · `TIF-0104 · Tiffin · name and category come from ChitBridge` ·
  right: `Change photo` button.
- **PRICE** block — label `PRICE`, then a **large bordered field** showing `₹ 66` with `per plate` beside it;
  right-aligned: `was ₹60.00 · +10%` and under it `last changed 12 Sep by Ravi K`.
  Then a tinted note: *"A 10% rise. It reaches every counter and the shop screen as soon as you save."*
- **Two panels side by side**:
  - `FOR GOOD` — **On the shelf** (*listed and sellable everywhere*) + switch; **Pick for the shop screen**
    (*otherwise the screen chooses on its own*) + switch.
  - `JUST FOR TODAY` (warm-red heading, pink border) — **Sold out now** (*hides the key on this counter until
    shift close*) + switch; footnote *"Cashiers can do this from the sell screen. It never changes the price or
    the shelf."*
- **QUICK KEY GROUPS** — label, right-aligned link **`Arrange the groups`**; chips `✓ Morning 31` (filled green,
  member) · `Afternoon 28` · `Evening 22` · `Night 19`.
- **Offers** — a quiet note: *"this shop has no live offers. Declare them in ChitBridge; they appear here to be
  turned on."*
- **CHANGED TODAY · 3** — rows: name … what changed (`₹65.00 → ₹70.00`, `taken off the shelf`, `photo added`) …
  a badge **`sent`** (green) or **`saved here`** (amber) … an **`Undo`** button.
- **Sticky foot**: *"1 change not saved — price ₹60.00 → ₹66.00"* and under it *"Saved here first, then sent.
  Nothing is lost if the line drops."* … `Undo change` · **`Save · Ctrl S`** (big green).
- **Status line**: *"No GSTIN on this shop, so no GST is charged or shown"* … right: *"113 products · everything
  has reached ChitBridge"*.

## Maintenance on a phone — `MaintV2Phone.png`

Same list, dimmed behind. The **editor is a bottom sheet** with a drag handle: photo · **Sambar Idli** ·
`TIF-0104 · Tiffin` · `✕`. Then the same PRICE / FOR GOOD / JUST FOR TODAY blocks stacked, with the price note
shortened to *"was ₹60.00 · +10% · reaches every counter when you save"*.
**Its own sticky foot**: *"1 change not saved · ₹60 → ₹66"* with `Undo` and a full-width green **`Save`**.
Chips on the phone are only `Everything 113 · Changed 3 · No photo 9` — the set is TRIMMED, not scrolled.

## The hub, wide — `HubWide.png`

⚠️ **Not the shape I built.** There is no separate pinned who-row and no separate chip strip:
- **Header, one line**: `Counter 1` (large) / `Mayur Bhavan · T Nagar · Friday 18 September, 12:35` … then the
  chips inline: `● online` `● all sent` `● printer off` (pink) `● 113 products` … then a **pink box** holding
  *"Nobody signed in"* + a green **`Sign in · F7`** … then `✕`.
- **Two columns of sections.** Left: **Start your day** (open), **Today** (open), **Alerts** (closed, badge 3).
  Right: **Bills** (open), **Shop & prices**, **How it looks**, **Shop details**, **This counter** (all closed).
- Open sections show real content, not a list of rows:
  - *Start your day*: a weather tile `☀ 31°C`, *"Clear now · **rain after 5 pm** · Navaratri week, expect an
    evening rush"*, three ✓ checks on one line, then `Open for today` (green) · `Cash in drawer ₹1,900` ·
    `Change picture`.
  - *Today*: **₹4,280.50** huge, then `18 bills · avg ₹238 · yesterday ₹3,910 at this time`, a **single tender
    bar** (green/blue/amber segments), then `● cash ₹1,900  ● UPI ₹1,030  ● card ₹515   Bohni done 8:12 am`, then
    a row `Day close · Z report` + keycap `F10`.
  - *Bills*: `Today's bills` +`F8`, **`Parked bills · 2`** +`F6`, `Why is a bill stuck?`.
- Closed rows carry a live summary: *How it looks* → `Large · Light cream · panels balanced · left hand`;
  *Shop details* → `T Nagar · ₹ INR · 7 am–11 pm · GSTIN not set`.
- **CAREFUL is a full-width pink strip at the very bottom**, not a section: the sentence on the left, and
  `Sign out` · `Clear and reload` · `Close this counter` as buttons on the right.
- ⚠️ **There is no search box in the hub.** `MenuPalette` (type-to-find) is listed in the index as **not chosen**.

## The hub, phone — `HubPhone.png`

- Header: `Counter 1` / `Mayur Bhavan · T Nagar · 12:35` · `✕`.
- Then the **pink sign-in box**: *"Nobody signed in / bills will not carry a name"* + `Sign in`.
- Then the **chip row**, horizontally scrollable: `online` `all sent` `printer off` `drawer ₹1,900…`.
- Then the nine sections, **one column, one open** (Start your day), each a card with icon square, title, live
  summary, chevron. **Careful last**, in pink.
- Alerts summary reads *"2 need you: printer offline · 3 items low"* with the badge on the right.

## The sell screen, wide — `FullDesktop.png`

**Header:** `CB Test Traders` · `▤ Sell ▾` · `Counter 1` · `nobody signed in` (pink) · `● online` ·
`prices as at 17:35` · `today 0 · ₹0.00` · `✓` · `≡`.

**Left (≈58%)**
- Search row: a round **mic button**, then the field *"Item name, code or barcode…"* with `↓↑ choose · Enter add`
  inside on the right, then a round `✕`.
- Category chips: `Everything` (green, active) · `On offer` · `Off the shelf 5` · `Spices 1461` · `Rice & grains
  1283` · `Personal care 1124` · `Cleaning 983` …
- **Quick-keys panel**, tinted, with its own bar: `⊞ Quick keys (1)` (dark badge) · `Morning · 9/10 ✕` (amber
  chip) … right: `1 sold out · bring back` · `Photos [toggle]` · `+ group` · `+ marked row`.
- A key tile: ✦ and a colour bar top-left, `✕` top-right, **name** (bold, wraps to 2 lines), `₹352 / pkt`, and a
  dark round **qty badge** on the right when it is in the bill.
- **Results rows**: `Narasus Filter coffee 200 g` + `packet` (grey), `BEV-01612 · Beverages` under it; right:
  **₹141.00** big, `per packet · incl. 5% GST`, `MRP ₹172.00 ₹31.00 under` (struck MRP, green gap); then a
  square **`+`** button. The focused row carries a **green left border**.
- **Shortcut bar**, two lines: `F2 search · ↓↑ PgUp/PgDn choose · Enter or double-click add · 3* quantity ·
  Ctrl ↓↑ change line · F9 save & print · F6 park · F8 bills` / `F10 day close · F7 who · F4 re-read the shop ·
  Esc clear`.

**Right (≈42%)**
- `Customer (optional)` + mic · `Phone` + mic.
- **Shop points** strip (green tint): *"1 point for every ₹100.00 spent · a name or a phone number to hold them"*.
- `3 products · 15 items`, then the bill table: `# · ITEM · PRICE · QTY · QTY×PRICE · DISC. · VALUE · ✕`.
  ITEM shows the name then `per packet · GST 5%`. QTY is a `− 5 +` stepper. DISC shows `—`.
- Totals: `▸ tax & offer breakdown` … `Saved −₹144.75` (green) … **`TOTAL ₹2,750.25`** (very large).
- Pay: `Cash` · `Card` · **`UPI`** (selected, green outline). Then a **QR block**: the code, `₹2,750.25`,
  *"Scan with any UPI app · pays [shop UPI ID]"*, *"The shop marks it paid here once the money arrives."*
  then *"This bill will be recorded as **UPI**"*.
- `Amount taken` field + `+ part`.
- Actions: `Clear · Esc` · `Park · F6` · **`Save & print · F9`** (big green).
- Foot: *"everything has reached ChitBridge"* … right: *"10,441 products, up to date."*

## The five tile styles — `Tiles.png`

Each style is drawn in three states: **normal · in the bill (qty) · sold out (after ✕)**.
1. **Colour block** — whole tile in the group colour, name + price, dark round qty badge. Sold out = a dashed
   hatched box, name struck through, `SOLD OUT · TAP TO BRING BACK`. *"Fastest to scan when two groups are on."*
2. **Monogram** — white card, big tinted initials badge (`MD`, `MV`), name, price; qty as a red dot on the badge.
   Sold out = a red rubber-stamp **`SOLD OUT`** across it. *"Works without product photos."*
3. **Compact rows** — a two-column list, colour bar down the left of each row, name … price, `−` qty `+` stepper
   appearing only for rows in the bill. Sold out = struck name + an **`Undo`** link. *"Fits 30+ keys."*
4. **Hotkey dark** — black tiles, the number `1`–`9`,`0` in a box top-left, name, price, and an amber `×2` badge.
   Sold out = dim tile, `OUT · key 5 is free`. *"For keyboard counters."*
5. **Photo** — image on top (tinted placeholder with an icon), name and price BELOW it, a dark `2 in bill` pill
   top-left. Sold out = greyscale with a `SOLD OUT` pill. *"Best for new staff; needs an image per item."*

## The two idle screens — `IdleShop.png` (dark) and `IdleReady.png` (light)

**IdleShop — resting shop.** Dark. `Mayur Bhavan` `T Nagar · Counter 1` + chips `online`, `everything sent`,
`printer ready`. A large panel holding **the shop's own picture**; over it, bottom-left, **`3:42 pm`** very large
with `Friday 18 September · 31°C, rain after 5` and a pill `Open since 7:02 am · closes 11 pm`. Foot: *"Nothing
is closed. The counter is only resting."*
A right-hand column: `COME BACK IN` / **Ravi K** / *"on a break since 3:28 pm"*, a **4-digit PIN pad** (1–9, 0,
⌫) with four dots, then `WAITING FOR YOU` — `Bill in hand  3 items · ₹210` / `Parked bills 2` /
`Today so far  hidden until you sign in`. Then an amber **`Someone else is taking over`** button and
*"Any key, tap or a scan wakes the counter — nothing is lost"*.
⚠️ **Money is hidden until somebody signs in.**

**IdleReady — the ready check.** Light. `RESTING · NOTHING IS CLOSED` / **`Counter 1 is ready`** /
`Mayur Bhavan · T Nagar · Friday 18 September`; right: **`3:42 pm`** and `31°C · rain after 5 · closes 11 pm`.
Four state cards: `Online · all sent` (*96 bills reached ChitBridge*) · `Printer ready` (*paper checked at 2:10
pm*) · `Drawer ₹7,900` (*counted at open: ₹2,000*) · `Battery 38%` (*about 2 hours left*, amber).
**WAITING FOR THE COUNTER** — numbered rows with an action each: `3 A bill in hand` (*3 items · ₹210 · saved 3:28
pm*) `Take it up` · `2 Parked bills` (*Table 4 and a takeaway*) `See them` · `4 Sold out today` (*Idli, Ven
Pongal, Poori, Rava Dosa*) `Bring back` · `! Evening keys start at 3:30` (*not showing yet on this counter*)
`Show them`. Under it a green note: *"The bill in hand is saved. Sign in and it comes back exactly as it was."*
**TODAY SO FAR** — `₹18,420` with a `hide` button, `96 bills · avg ₹192 · cash ₹7,900 · UPI ₹9,100 · card ₹1,420`,
a tender bar, `Busiest hour: 8–9 am · Idli ran out at 10:40`.
**SIGN IN TO SELL** (dark card) — avatars `RK Ravi K` · `PR Priya` · `SU Suresh`, *"Tap a name, then the 4-digit
PIN. Any key or a scan also wakes the counter."* then `Shop screen` and amber **`Sign in · F7`**.

## Vertical terminal — `FullPortrait.png` (1080×1920)

**One column, in this order:** header → search → category chips → quick keys → results → customer → bill →
totals → pay → actions → status.
- Header is compact: `CB Test Traders` · `Sell ▾` … right: `Counter 1` · `nobody signed in` · `online` · `≡`.
- Quick keys **5 per row**, and the bar carries **two group chips at once** — `Morning 9/10 ✕` (amber) and
  `Afternoon 10/10 ✕` (pink) — which is the two-groups-ticked case the spec describes. Right: `+ marked row`.
- Results are only **3 rows**; they are a strip between the keys and the bill, not the main event.
- The **bill rows are cards, not a table**: `1  Red Label Green tea 100 g (premium)` / `₹64.00 per packet · GST
  5%` on the left, a `− 5 +` stepper in the middle, `₹320.00` and `✕` on the right.
- Totals: `Saved · ▸ tax & offer breakdown` … `−₹144.75`, then **`TOTAL`** / **`₹2,750.25`** on one line, both huge.
- Pay: `Cash` · `Card` · `UPI` (selected) as three wide buttons, with the **QR to their right**; then `Amount
  taken` + `+ part`; then `Recorded as UPI · pays [shop UPI ID]`.
- Actions across the foot: `Clear` · `Park` · **`Save & print`** (green, widest).

## Phone, step 1 of 3 — `FullPhoneSell.png` (390×844)

- Header stacks: `CB Test Traders` then `Sell ▾ · Counter 1 · nobody signed in · online`, `≡` on the right.
- Search row: field + **mic** + a **scan** button (the camera — this is a touch device).
- Chips scroll horizontally.
- Quick-keys bar is abbreviated: **`⊞ Keys · 2`** · `Morning ✕` · `Afternoon ✕` … `+ row`.
- Keys **3 per row**, name wrapping to 2–3 lines, price, dark round qty badge.
- Results are **two-line rows**: name, then `BEV-01613 · MRP ₹358 · ₹67 under`; price and a `+` on the right.
- **A green bar pinned to the bottom** is the way to step 2: a round `15` badge, `3 products · view bill`, and
  `₹2,750.25`. That bar IS the primary action on a phone.

## Handheld POS — `FullHandheld.png` (360×720)

- **Dark header**: `CB Test Traders` `Sell · Counter 1` … `● online` `≡`.
- Search + **mic** + a black **`SCAN`** button (biggest thing in the row — a handheld is a scanner first).
- Category chips, then **group TABS across the width**: `Morning ✓ 9/10` · `Afternoon ✓ 10/10` ·
  `Evening off` · `Night off`, with a coloured underline on the active ones.
- Keys are **list rows**, not tiles: a colour bar down the left, **name** (large), price, a green qty badge, `✕`.
- Foot: `Bill · 15` / `customer · points` on the left, and a wide green **`Charge ₹2,750.25`** on the right.

## Quick-keys maintenance, list view — `Maintenance.png` (back office, 1366×900)

⚠️ **This is a BACK-OFFICE screen, not the counter's maintain mode.** Dark bar: `‹ Sell screen` ·
`Back office / Menu /` **`Quick keys maintenance`** … right `Manager · Ravi K.`

**Three columns.**
- **Left — Groups.** Heading `Groups` with `Order = sell-screen order` beside it. Each group is a card with a
  colour bar, name, `06:00 — 11:30`, and `10 keys` on the right. Then a dashed `+ New group`.
  At the foot, a tinted note: *"**Permanent changes.** Edits here apply to every counter after you save. Cashiers
  can still hide keys for their shift from the sell screen."*
- **Centre — the group.** Colour swatch + **`Morning`** + `Delete group`. Then four fields on one row:
  `Group name` · `Show from` `06:00 AM` · `Until` `11:30 AM` · `Colour` (four swatches, the chosen one ringed).
  A checkbox: *"Suggest this group on the sell screen when its window starts"*.
  A tinted note: *"Item photos: **8 of 10** have a photo. Items without one show initials. Photos on/off is set
  per device."* with a link **`Device display settings`**.
  Then **`KEYS IN THIS GROUP · 10`** … right *"Use arrows to set key position"*, and a table:
  `# · Move (▲▼) · Photo (thumbnail, or a dashed `+` to upload) · Item · Code · Price · Remove`.
- **Right — `Add from menu`.** A `Search items` box, then every product: name, `BF01 · ₹40`, and either a green
  **`In group`** label (greyed row) or an **`Add`** button.
- **Foot:** `Discard` · **`Save changes`** (green).

## Quick-key groups, board view — `MaintBoard.png` (back office, 1600×900)

`Back office / Menu / Quick keys · board view` / **`Quick key groups`**; right: a `Board | List` segmented
control, `+ New group`, and a **blue `Publish to 6 counters`**.
- **Left rail — `Menu items`**: `Search menu`, *"Drag an item onto a group"*, then draggable rows (grip, name,
  price).
- **Four columns**, one per group, each with a coloured top edge: `Morning` · `10 keys` · `⋯`, then
  `06:00 → 11:30` and **`Suggest ✓`**, then numbered rows `01 Idli (2 pc) … ₹40 🗑`, each with a drag grip.
  At the bottom of each column a dashed **`Drop here or + Add item`**.
- A card mid-drag is drawn lifted, tilted and shadowed over the column it is being dropped into.

## Back office → device screen style — `DisplaySettings.png`

`← Quick keys` · `Back office / Devices /` **`Screen style`** … right: *"Applies at next sync · per device
overrides per counter"*.
- **Left — `Devices`**: a card per device with a type badge (`POS`, `KSK`, `TAB`, `PH`, `HH`), the name, and its
  current style (`Counter classic · photos on`).
- **Centre**: `Counter 1` + `Horizontal terminal · 1600×900`. Then **`PRESET`** as 8 cards, each with a name and
  a one-line note: `Counter classic A · light` (selected, green) · `Counter dark B · dark` ·
  `Counter timeline C · day bar` · `Counter rail D · list keys` · `Compact 15″ terminal` · `Kiosk vertical` ·
  `Tablet waiter sell → pay` · `Phone 3 steps`.
  Then five rows of **pill choices**, the active one black:
  `Layout` — Horizontal · Vertical · Compact · Tablet · Phone · Handheld · Timeline · Rail · **Auto**
  `Tile style` — Classic · Colour block · Monogram · Compact row · Hotkey · Photo
  `Quick keys picker` — Popup · Side drawer · Full screen · Bottom sheet · Day timeline · Group rail · Tab strip
  `Theme` — Light cream · Dark · Paper · Navy
  `Density` — Comfortable · Compact
  Then `Photos on keys` + switch + *"On — items without a photo show initials. Fewer keys fit per screen."*
  and `Cashier may change` + a checkbox *"Tile style & photos for this device only"*.
- **Right — `Preview`**: a miniature of the sell screen in the chosen style, and under it a sentence naming every
  choice: *"Horizontal layout · Classic tiles · Popup picker · Light cream · Comfortable · photos on"*.
- Foot: `Reset to counter` · **`Save`**.

⚠️ **This screen is the UI for `device_screen_config`** (handoff §5) and for everything `lib/screen-kit.js`
already holds. The counter has the ENGINE and a tiny `Style` dropdown in ⚙ Setup; this is the manager's version
of the same thing, with a live preview.

# Category order — the fold is the decision

Replaces the **Order the categories** modal (eleven rows, up/down arrows, *Back to most-used first · Cancel · Save the order*).

Design: `png/CatOrder.png`. Source: `source/CatOrder.dc.html` — reference only, never ship.

---

## 1. What is wrong today

1. **Nothing says where the sell screen stops showing chips.** About six fit before a swipe; the list shows eleven equals. The gap between "one tap" and "a swipe" is the only thing this screen decides, and it is invisible.
2. **No picture of the strip being edited.** You reorder blind and find out at the counter.
3. **Arrows only.** Moving the bottom row to the top costs ten taps.
4. **"25" has no header.** 25 what? And while the list is sorted by it, the number only restates the order it is already in.
5. **"Back to most-used first" is a mode wearing a button** — and it sits beside Cancel, where both read as "undo my work".
6. **No way to take a category off the keys.** Combos has two products and a permanent seat.
7. **Nothing marks what moved**, and Save does not say how much it is about to save.
8. **The note explains the roadmap** — *"the shop-wide one needs a field in the catalogue, which is not built yet"* — to a shopkeeper.
9. **The arrows are ~32 px** on a screen whose own rule is 44.

---

## 2. The screen

Top to bottom: **title → the mode → the live strip → the list → the note → the buttons.**

### The mode (new, and first)

The real question is whether the order keeps updating by itself. Two options, not a button:

| Option | Subtitle |
|---|---|
| **Most used first** *(default)* | Recounted every night from the last 30 days of selling. Nothing to maintain. |
| **The order I set** | Stays exactly as you leave it. Starts from the order below, so nothing begins empty. |

Choosing **The order I set** seeds the fixed order from the current most-used order — nobody starts from an empty list. Choosing **Most used first** again discards the manual order, and says so in the confirm: *Your order will be replaced by what sells most. [Not now] [Use most used]*.

This **removes the "Back to most-used first" button** from the footer, which is what made it read as a second Cancel.

### The live strip

A real chip row, rendered from the real component at the device's real width, above the list:

```
ON THE SELL SCREEN                                     Counter 1 · 820 px
[ Tiffin ][ Curries ][ Drinks ][ Sweets ][ Breads ][ Starters ] ┆ [ Rice ][ Chinese ]
— 6 reach without a swipe. Everything past the line is a scroll.
```

It reorders as the list reorders. Chips past the fold are shown in the quiet style, not hidden.

### The fold, drawn in the list too

A dashed amber rule sits in the list after the last row that fits, labelled **↑ THESE 6 REACH WITHOUT A SWIPE**, and moves as rows move.

- **Measured, not guessed.** Lay out the real strip at the device width and count what fits before overflow.
- The count differs by device — a phone fits four, a 15-inch counter fits nine — so the line follows the device being set up, and a device picker beside "Counter 1 · 820 px" lets you check another.
- Rows below the line are **not dimmed**. They are reachable, just not first.

### A row

```
[ 2 ] ⠿  Combos      moved · most used #11              2   ( ●)  [↑] [↓]
```

| Part | Rule |
|---|---|
| **Rank box** | Mono, bordered, **and typable**. Type 3 into row 11 and it moves to 3. |
| **Handle ⠿** | Drag target. Whole row is also draggable. |
| **Name** | 13 px, 600. |
| **moved** chip | Only on rows whose position changed this session. With the fixed order on, it also carries *most used #N* so you can see how far you have moved from what sells. |
| **Count** | Mono, right-aligned, under a **PRODUCTS** header. The unit is said once at the top, never on every row. |
| **Show toggle** | Off = the category leaves the chips and the keys. It keeps its products; nothing is deleted. |
| **Arrows** | 44 × 44 px minimum. First row's ↑ and last row's ↓ are disabled, not hidden. |

### Hidden categories

Below the list: **NOT ON THE KEYS · 1**, then the hidden rows, greyed, with a **Show** action. They keep no rank (`—`). A category with zero products is hidden automatically and says so.

### Four ways to move one row

All land in the same place; build them in this order of value.

| Way | Where | Note |
|---|---|---|
| **Drag the handle** | touch + mouse | The lifted row casts a shadow; a gap opens where it will land. |
| **Tap to lift, tap to place** | touch | For terminals where a long drag is awkward. Tap the row, the list shows drop slots, tap a slot. |
| **Type the rank** | the # box | The fastest way to move something a long way. |
| **The arrows** | `Alt ↑` / `Alt ↓` on the focused row | Kept, at 44 px — the only way that works from a keyboard alone. |

### The footnote

Today: *"Kept on this counter. A second counter keeps its own order until you set it there too — the shop-wide one needs a field in the catalogue, which is not built yet."*

Instead: **"Counter 1 only. Counter 2 keeps its own order."** Nothing about the catalogue, nothing about what is not built. When a shop-wide order exists, this line gains **Use this on every counter** and not before.

### The buttons

`Cancel · Esc` plain on the left, **Save the order · 3 moved** green on the right. Two buttons, not three. The count is the number of rows whose position or visibility changed; with nothing changed, Save is quiet and reads just **Save the order**. Esc with unsaved changes asks; Esc with none just closes.

---

## 3. Words

| Instead of | Say |
|---|---|
| Order the categories | **Category order** |
| the order they are listed in — on the chips, on the keys and in maintenance | What the hand reaches first — on the chips, the keys and in maintenance. |
| Back to most-used first | *(a mode, not a button)* **Most used first** |
| Save the order | **Save the order · 3 moved** |
| *(nothing)* | **6 reach without a swipe. Everything past the line is a scroll.** |
| the shop-wide one needs a field in the catalogue, which is not built yet | *(delete)* |

---

## 4. Phone

390 px wide, bottom sheet, full height.

- Mode options stack, full width, 48 px tall.
- The strip preview scrolls horizontally with the fold line inside it, and the caption reads *4 reach without a swipe on this phone*.
- Rows keep the rank box, name, count and toggle; the arrows become a single **⠿ hold to drag** and the rank box stays typable. Drop targets are the full row.
- The two buttons pin to the bottom, safe-area padded, 48 px.

---

## 5. Data

```json
{
  "counterId": "C1",
  "categoryOrder": {
    "mode": "most_used | fixed",
    "fixed": ["cat_tiffin", "cat_combos", "cat_curries"],
    "hidden": ["cat_combos_old"],
    "updatedAt": "2026-09-21T08:10:00+05:30",
    "updatedBy": "u_12"
  },
  "categories": [
    { "id": "cat_tiffin", "name": "Tiffin", "productCount": 25, "salesRank30d": 1 }
  ],
  "fold": { "width": 820, "fits": 6 }
}
```

- The order is **per counter**, stored against `counterId`. Never silently applied to another counter.
- `mode: "most_used"` means `fixed` is ignored and the order is `salesRank30d`, recomputed nightly.
- Switching to `fixed` writes the current effective order into `fixed` at that moment.
- `hidden` removes a category from the chip strip and the key grid **only**. Products stay sellable by search and by code.
- `fold.fits` is measured at render time from the real strip, never stored as a magic number.
- `salesRank30d` is over the last 30 days of this shop's sales, not this counter's.

---

## 6. Behaviour

1. Saving is one write; the strip updates without a reload.
2. Offline: the screen opens and saves normally and the change queues — this is a counter setting, not a shop one.
3. With one category, the reorder controls are disabled and the screen says so.
4. A category added later appears at the end of a fixed order, and in its proper place in most-used order.
5. A category deleted in the catalogue drops out of `fixed` silently.
6. Reordering is not a permission-gated action; hiding is — it needs whoever may edit counter settings.

---

## 7. Acceptance checks

1. The chip strip appears above the list, reorders live, and shows the fold at the real device width.
2. The dashed fold line appears in the list at the last row that fits, and moves when rows move.
3. All four ways to move a row produce the same result; Alt ↑ / Alt ↓ work with no mouse.
4. Typing a rank into any row's box moves it there, and the other ranks renumber.
5. The mode control replaces the footer's third button; switching to most-used asks before discarding a manual order.
6. The PRODUCTS column has a header; no row repeats the unit.
7. Hiding a category removes it from the chips and the keys and from nowhere else; its products still sell by search.
8. Save reads "Save the order · N moved" and N matches the count of changed rows.
9. The footnote names the counters and says nothing about the catalogue or unbuilt work.
10. Every control is ≥ 44 px (48 on phones); contrast ≥ 4.5:1.
11. At 390 px nothing is dropped — the arrows fold into drag, and the buttons pin.

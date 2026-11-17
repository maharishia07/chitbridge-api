# 02 · Category order — give this file to the CLI first

Rebuilds the **Order the categories** modal — eleven rows, up/down arrows, *Back to most-used first · Cancel · Save the order*.

Unzip into the repo as `design-handoff/category-order/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `category-order-spec.md` | The whole spec: what is wrong today, the mode control, the live strip, the fold, row anatomy, four ways to move, hiding, phone, data shape, acceptance checks. |
| 2 | `png/CatOrder.png` | The screen — today's problems on the left, the rebuilt modal in the middle, the three ideas on the right. Build this. |
| 3 | `source/CatOrder.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship this file.** It uses a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

The image is the visual truth; the spec is the rules. Where they disagree, ask.

## The change in one line

**The screen is not ordering a list — it is deciding what the hand reaches without scrolling.** So show the chip strip being edited, draw the fold where the sell screen stops, and let a row move in one gesture instead of ten taps.

## Four things, in order of value

1. **The fold.** About six chips fit before a swipe. Draw a dashed line in the list at the last row that fits — measured from the real strip at the real device width, not a hard-coded six — and show the live strip above the list so the effect is visible while editing.
2. **The mode, not a button.** *Most used first (recounted nightly)* vs *The order I set (frozen)* as two options at the top. This deletes "Back to most-used first" from the footer, where it sat beside Cancel and read as a second undo.
3. **Four ways to move a row** — drag, tap-to-lift-tap-to-place, type the rank, and the arrows at a real 44 px. All land in the same place.
4. **Show / hide per row**, with hidden categories collected under *NOT ON THE KEYS · 1*. Ordering and hiding are the same job. Hiding removes a category from the chips and the keys and from nowhere else.

Plus: a header on the count column, a *moved* mark on changed rows, *Save the order · 3 moved*, and a footnote that says **"Counter 1 only. Counter 2 keeps its own order."** and nothing about the catalogue or unbuilt work.

## Rules this screen inherits from the rest of the package

1. **Mobile-first.** Write the phone sheet first (spec §4), widen with `min-width` only; nothing is dropped as it narrows, it folds.
2. Every number on screen says what it is. The unit is said once, at the top, never on every row.
3. Counts everywhere — a list without numbers reads as chaos.
4. Settings are per counter unless the screen says otherwise, and the screen says it in one short line.
5. **Five states**: loading, empty (one category — controls disabled, and the screen says why), error, offline (this saves offline; it is a counter setting), no permission.
6. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.
7. Nothing in the product explains the roadmap to a shopkeeper.

## Paste-ready start

```
Read EVERY file in design-handoff/category-order/ first — every .md and every .png — before writing any code.
Read design-handoff/category-order/README-CATEGORY-ORDER.md, then category-order-spec.md
and png/CatOrder.png.
First: find the category order modal and show me where the order is stored, whether it is per
counter, and how the chip strip decides what to render. Do not change anything yet.
Then propose (1) the fold measurement — how you will count what fits at the real width — and
(2) the mode control that replaces the "Back to most-used first" button. Wait for approval.
After approval, build the phone sheet first, then widen. Run the acceptance checks in
category-order-spec.md §7 and show me the screen at 390, 820 and 1440 px, with 11 categories
and with 40.
```

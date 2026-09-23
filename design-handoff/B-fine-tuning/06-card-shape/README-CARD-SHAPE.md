# 06 · The card shape — give this file to the CLI first

Adds a sixth quick-key presentation style: a **portrait card at a playing-card ratio (5 : 7)**, for vertical terminals and for turning the screen to the customer. It draws the quick keys *and* the product list.

Unzip into the repo as `design-handoff/card-shape/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `card-shape-spec.md` | The whole spec: the four sizes, why portrait, the anatomy, the five states, how many fit, the control, the rules, data shape, acceptance checks. |
| 2 | `png/KeyCard.png` | The four sizes **at true scale** beside today's largest tile, the anatomy, the states, the fit table and the control. Build from this. |
| 3 | `source/KeyCard.dc.html` | Exact colours, sizes, spacing and copy — including the arithmetic that derives every size from the ratio. **Reference only — never ship this file.** |

The image is the visual truth; the spec is the rules. Where they disagree, ask.

## The change in one line

**A card is not a bigger tile — it is a different shape.** Fixed at 5 : 7 like a real playing card, it uses the height a vertical terminal has to spare, gives the photo 62% instead of 57%, gives the name two full lines, and reads as a hand to choose from when the screen is turned round.

## The four sizes

| Size | Pixels | For |
|---|---|---|
| small | 120 × 168 | phones, dense portrait grid |
| regular | 150 × 210 | the default on a vertical terminal |
| large | 180 × 252 | a counter that wants the photo to carry |
| customer | 220 × 308 | the screen turned round for the customer to pick |

Today's largest key is 200 × 200 (Extra large); the board's comparison tile is 168 (Large). On a 1080-wide portrait terminal: **6 across, 48 on screen** at the regular size.

## The two things most likely to be got wrong

1. **Store a minimum width, not a column count.** The grid is `repeat(auto-fill, minmax(150px, 1fr))` with `aspect-ratio: 5 / 7`. A stored column count breaks the moment the panel is resized.
2. **Every state keeps the same footprint** — sold out, no photo, combo, "2 on the bill". A grid that reflows when something sells out is unusable at a counter. And *no photo* is the same card with initials, never a smaller one.

## Where it fits in the existing control

The key-size setting gains a **shape** row above the size ladder:

```
Shape     [ Tile · square ]  [ Card · 5 : 7 ]  [ List row ]
Size      [ 120 ] [ 150 ] [ 180 ] [ 220 ] [ Automatic ]
Used by   [ Quick keys ]  [ Product list ]
```

Automatic already reads the screen and its orientation (see the `quick-keys` package's key-size spec) — it now picks a shape too: **cards first on a portrait terminal, never on a handheld.** And the card must appear in the screen-style preview beside the tiles, so nobody has to imagine it.

## Rules this screen inherits from the rest of the package

1. The ratio is a constant of the shape, never a setting and never overridden.
2. One component draws the quick keys and the product list — one shape, one grid, one set of states.
3. Sold out is shown, never hidden, and comes from the same per-counter list the tiles use.
4. **Mobile-first**: the small card is the phone case; widen from it.
5. Customer-facing means read-only — tapping adds, nothing edits.
6. Targets ≥ 44 px (48 on phones); contrast ≥ 4.5:1.

## Paste-ready start

```
Read EVERY file in design-handoff/card-shape/ first — every .md and every .png — before writing any code.
Read design-handoff/card-shape/README-CARD-SHAPE.md, then card-shape-spec.md and png/KeyCard.png.
First: show me the quick-key tile component, the product-list row component, and how the grid
decides its columns today. Do not change anything yet.
Then propose making one component serve both, with shape + minWidth from spec §7, and wait
for approval.
After approval, build the card at 5:7 with all five states, add the shape row to the key-size
control, and teach Automatic to pick it on a portrait terminal.
Run the acceptance checks in card-shape-spec.md §8 and show me a 1080x1920 portrait grid at
150 and 220, a 390 px phone, and one product sold out mid-grid.
```

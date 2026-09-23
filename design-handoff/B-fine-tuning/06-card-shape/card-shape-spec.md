# The card — a playing-card shape for quick keys and the product list

A sixth presentation style, added beside the five tile sizes. Portrait, fixed at 5 : 7, for vertical terminals and for turning the screen to the customer.

Design: `png/KeyCard.png`. Source: `source/KeyCard.dc.html` — reference only, never ship.

---

## 1. What it is

A real playing card is 63 × 88 mm — a ratio of **5 : 7**. Every size below holds that ratio exactly, so a row of them reads as a hand of cards rather than as a set of rectangles.

| Size | Pixels | For |
|---|---|---|
| Card · small | **120 × 168** | phones, and a dense portrait grid |
| Card · regular | **150 × 210** | the default on a vertical terminal |
| Card · large | **180 × 252** | a counter that wants the photo to carry |
| Card · customer | **220 × 308** | the screen turned round for the customer to pick |

For comparison, today's largest key is **200 × 200** (Extra large in the key-size spec); the board draws 168 × 168, which is Large.

### Why a portrait card and not a bigger square

1. **A vertical terminal has height to spare and width to save.** A portrait card uses the shape the screen actually has.
2. **The photo gets 62% of the card** instead of a square's 57% — and it is the photo the customer picks from.
3. **The name gets two full lines**, so "Onion Rava Dosa" stops being "Onion Rava…".
4. **Cards in a row read as a hand to choose from.** That is exactly the gesture when the screen is turned round.
5. **One fixed ratio means a grid never looks ragged**, whatever width the shop picks.

---

## 2. What is on the card

| Part | Rule |
|---|---|
| **The pip · top left** | The number you would type to add it, in the corner where a playing card puts its rank. Hidden when the shop has no keyboard. |
| **The photo · 62%** | Edge to edge, no padding, centre-cropped. It is what makes the card worth the space. |
| **The name · up to 2 lines** | Never truncated to one. If it still does not fit, the card grows the text down, not the box. |
| **The price · mono, bottom** | Always on the baseline of the card, so a row of prices lines up across the grid. |
| **The unit · beside it** | "/ plate", quiet. A shop selling by weight shows "/ kg" and the card is otherwise identical. |

---

## 3. The states — the footprint never changes

| State | Looks like |
|---|---|
| **normal** | photo, name, price |
| **no photo** | the same card, photo area filled with the initials in the shop's colour — **not a smaller card** |
| **sold out** | tinted grey, a diagonal `SOLD OUT` band, still tappable to see why |
| **a combo** | amber border, `saves ₹25` in the top-right corner |
| **n on the bill** | green border, the count in the top-right corner |

**A grid that reflows when something sells out is unusable.** Every state keeps the same footprint.

---

## 4. How many fit

| Screen | Size | Across | On screen |
|---|---|---|---|
| Vertical terminal 1080 | 150 × 210 | 6 | 48 |
| Vertical terminal 1080 | 180 × 252 | 5 | 35 |
| Turned to the customer | 220 × 308 | 4 | 24 |
| Tablet 1180 × 820 | 150 × 210 | 6 | 18 |
| Counter 1440 × 900 | 150 × 210 | 8 | 16 |
| Phone 390 | 120 × 168 | 3 | 9 |

The card wins where the screen is tall and loses where it is wide and short. **Automatic offers it first on a portrait terminal and never on a handheld**, where three would fit and nothing else would.

---

## 5. The control gains a shape

Today the setting is one ladder of sizes. It becomes two questions — **what shape, then how big** — because a card is not a larger tile, it is a different thing.

```
Shape     [ Tile · square ]  [ Card · 5 : 7 ]  [ List row ]
Size      [ 120 ] [ 150 ] [ 180 ] [ 220 ] [ Automatic ]
Used by   [ Quick keys ]  [ Product list ]
```

**The same card draws the quick keys and the product list**, so a shop that picks cards gets one language on both — and the search results stop being a different-looking screen.

This slots into the existing key-size control (see the `quick-keys` package, key-size spec): the shape row sits above the size ladder, and Automatic reads the screen and its orientation exactly as it already does, now choosing a shape as well as a size.

---

## 6. Rules

1. **The ratio is fixed at 5 : 7 and is never overridden.** A card that stretches is a rectangle, and the whole idea goes with it.
2. **Store a minimum card width, not a column count.** The grid is `repeat(auto-fill, minmax(150px, 1fr))` and the height follows from `aspect-ratio: 5 / 7`.
3. **Every state keeps the same footprint** — sold out, no photo, combo, n on the bill.
4. **No photo is not a smaller card.** It is the same card with the initials in the shop's colour.
5. **Automatic offers cards first on a portrait terminal**, never on a handheld.
6. **One component draws both** the quick keys and the product list. One shape, one grid, one set of states.
7. **Turned to the customer**, the card is 220 wide, the pip disappears, prices stay, and tapping adds — nothing on it edits anything.
8. **The card is a shape, not a size:** it appears in the style preview beside the tiles, so nobody has to imagine it.

---

## 7. Data

```json
{
  "keyStyle": {
    "shape": "tile | card | list",
    "minWidth": 150,
    "ratio": "5:7",
    "mode": "automatic | chosen",
    "appliesTo": ["quickKeys", "productList"],
    "showPip": true
  }
}
```

- `ratio` is a constant of the shape, not a setting; it is stored so a future shape can carry its own.
- `minWidth` drives the grid; the column count is never stored.
- `mode: "automatic"` derives `shape` and `minWidth` from the viewport and orientation — portrait ≥ 900 px tall prefers `card`.
- `showPip` follows whether a keyboard is present, not a preference.
- `appliesTo` lets a shop use cards for the keys and rows for the list, but the default is both.

---

## 8. Acceptance checks

1. A card is exactly 5 : 7 at every width, verified at 120, 150, 180 and 220.
2. The grid uses `minmax(minWidth, 1fr)` with `aspect-ratio`; no column count is stored anywhere.
3. Sold out, no photo, combo and "2 on the bill" all occupy the identical footprint; marking something sold out does not reflow the grid.
4. A product with no photo shows initials in the same card, never a shrunken one.
5. The pip shows the key number and disappears on a touch-only counter.
6. A two-word name wraps to two lines and is not truncated.
7. Quick keys and the product list render from the same component, and switching shape changes both.
8. Automatic picks cards on a 1080 × 1920 terminal and tiles on a 360 × 720 handheld.
9. In customer mode the card is 220 wide, shows no pip, and nothing on it opens an editor.
10. The shape appears in the screen-style preview alongside the tile sizes.
11. Targets ≥ 44 px (48 on phones); the smallest card is 120 × 168, well clear.

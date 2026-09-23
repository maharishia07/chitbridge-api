# Quick key size — spec

Adds a **Key size** setting to Screen style, and makes the picture size follow from it.

Designs: `png/KeySizes.png` (the five sizes at true scale, the control, the numbers),
`png/KeySizeAuto.png` (automatic by screen and orientation, and the override).
Source: `source/KeySizes.dc.html`, `source/KeySizeAuto.dc.html` — reference only.

---

## 1. The five sizes

Named like a person would say them. Each is **one number** — the smallest a key may be — and everything else follows.

| Size | Key | Picture | Name / price | Good for |
|---|---|---|---|---|
| Extra large | 200 px | 120 px | 17 / 14 px | Kiosks, a busy tiffin counter, read from a step back |
| Large | 168 px | 96 px | 17 / 14 px | Pictures still tell packets apart at arm's length |
| **Medium** (default) | 140 px | 72 px | 15 / 13 px | Photos readable, a good number on screen |
| Small | 112 px | none | 13 / 11 px | Hundreds of keys, names and prices only |
| List | 56 px row | 40 px | 15 / 12 px | One line each, fastest to scan by name |

**Pictures follow the key, never the other way round.** The switch reads "Show a picture on each key — 72 px at this size". Below Small a picture would be 40 px, too small to tell one packet from another, so pictures turn themselves off there and the switch says why.

---

## 2. Store a width, not a column count

```css
grid-template-columns: repeat(auto-fill, minmax(var(--key-min), 1fr));
```

The setting stores `--key-min` (200 / 168 / 140 / 112 px, or the list row height). Columns and rows are worked out by the browser from the space available. No per-device table is stored, and nothing needs changing when a new screen size appears.

What that gives, for reference only — never hard-code it:

| Screen | X-large | Large | Medium | Small | List |
|---|---|---|---|---|---|
| Terminal 1600 | 4 × 2 | 5 × 3 | 6 × 3 | 8 × 4 | 2 × 10 |
| Vertical 1080 | 3 × 5 | 4 × 6 | 5 × 7 | 6 × 9 | 1 × 22 |
| Compact 1024 | 3 × 2 | 3 × 2 | 4 × 3 | 6 × 3 | 2 × 7 |
| Tablet 1180 | 3 × 3 | 4 × 3 | 5 × 4 | 6 × 5 | 2 × 9 |
| Phone 390 | 1 × 3 | 2 × 4 | 2 × 5 | 3 × 6 | 1 × 9 |
| Handheld 360 | 1 × 2 | 1 × 3 | 2 × 4 | 3 × 5 | 1 × 8 |

---

## 3. Automatic — the screen suggests, the person decides

**Automatic is the sixth stop on the control, and the default on a device nobody has touched.** A bigger vertical terminal then gets bigger keys and bigger pictures on its own, without anybody being told to go and set it.

The ladder:

| Screen | CSS px | Picks | Why |
|---|---|---|---|
| Kiosk, standing | 1080 × 1920 | Extra large | Stood at, arm's length or more; tall, so height to spend |
| Vertical terminal | 1080 × 1440 | Large | Taller than wide, used standing |
| Wide terminal | 1440–1920 wide | Medium | Sat at, keyboard in reach, many keys wanted |
| Compact terminal | 1024 × 768 | Medium | Small screen, but close to the eye |
| Tablet | 1180 × 820 | Large | Held in a hand, finger-sized targets |
| Phone / handheld | 360–430 wide | Medium | Thumb reach matters more than key size |

What the decision may use:

| Signal | Trust |
|---|---|
| Width and height in CSS px | always true — and what the grid uses anyway |
| Shape (taller than wide ⇒ stood at) | always true |
| Touch or mouse (`pointer: coarse`) | true; a touch screen never goes below 44 px targets |
| Device pixel ratio | true; separates a sharp small panel from a big one |
| Physical inches | a hint only — most browsers do not know the real size |
| How far away the person stands | **cannot be read.** That is what the person's choice is for |

Three states of the control:

1. **Automatic, nobody has chosen** — the suggested size is outlined with a dashed border; the readout says *now Large · 168 px · 5 in a row*. It moves on its own when the screen changes.
2. **Someone chose a size** — that stop is solid, the suggestion stays dashed and is ignored. The row says who chose it and when. **Back to automatic** is one tap and names what it would become.
3. **The screen changed under a chosen size** — nothing changes by itself. A line appears: *Only 4 keys fit now. Use Medium to see 18?* with one button to accept.

---

## 4. Orientation

Turning the screen **does not change the key size** — a 168 px key is 168 px either way round. It changes only how many fit in a row, and the grid does that by itself.

| Tablet | Keys |
|---|---|
| Portrait 820 × 1180 | 4 in a row, 5 rows |
| Landscape 1180 × 820 | 5 in a row, 4 rows |

Rules:

1. Keys never reshuffle on a turn — same order, re-flowed. What was under a finger is findable after.
2. Portrait puts the bill under the keys; landscape puts it beside them. Nothing is dropped either way.
3. On **Automatic**, a turn can move the size only when it crosses a step on the ladder, and it waits for the bill in hand.
4. A wall-mounted terminal can **lock its orientation** in the counter hub, so a knock never re-lays the screen out.
5. Scroll position and the open group survive a turn.

---

## 5. Pictures

Three sizes are made on the server from one upload — webp, square, centre-cropped. The counter never resizes a picture itself.

| Asset | Pixels | Weight | Used by |
|---|---|---|---|
| Small | 128 × 128 | ~8 KB | List rows, search results |
| Medium | 256 × 256 | ~20 KB | Medium and Large keys |
| Large | 512 × 512 | ~60 KB | Extra large keys, product page |

- Only the sizes this counter can show are kept offline. A Small or List counter downloads none of the large ones.
- No picture yet: two letters on the group's colour. Never a grey box, never a broken image.
- Text never sits on a picture, at any size — the name and price keep their own band under it.

---

## 6. Key size is not text size

Two different wishes, so two settings:

- **Key size** — the quick keys only: how big each key is, how many fit.
- **Size** (roomy / comfortable / tight / big text) — text and spacing everywhere: the bill, search results, the menu.

A shopkeeper with tired eyes wants **big text**. A shopkeeper selling ten things wants **extra large keys**. Neither should drag the other with it.

---

## 7. Data

```json
"style": {
  "keySize": "auto | xlarge | large | medium | small | list",
  "keySizeChosenBy": { "user": "ravi_k", "at": "2026-09-18T11:02:00Z" },
  "photos": "keys | list | both | none",
  "orientationLock": "none | portrait | landscape"
}
```

- `keySize: "auto"` means the ladder decides at render time; the resolved value is never written back to storage, only shown.
- `keySizeChosenBy` exists only when someone picked a size; clearing it returns the counter to automatic.
- Resolution order as for the rest of Screen style: counter → device type → shop → app default.

---

## 8. Acceptance checks

1. Changing key size changes the tile, the picture and the number of columns together, live in the preview.
2. The preview badge always agrees with the grid: *Medium · 140 px key · 72 px picture · 6 in a row · 18 on screen*.
3. On Automatic, opening the same counter on a 1080 × 1920 screen gives Extra large and on a 1600 × 900 screen gives Medium, with no stored per-device setting.
4. Choosing any size turns Automatic off for that counter only, and the suggestion still shows as dashed.
5. Rotating a tablet re-flows the keys without changing their size or order, and keeps the scroll position and the open group.
6. Setting Small turns pictures off and says why; setting Large turns them back on at 96 px.
7. A counter set to Small or List never downloads the 512 px pictures.
8. Everything above works with the network off.

# Screen style — give this file to the CLI first

Rebuilds the **Screen style** dialog, whose "Preview" today shows six product tiles and so previews almost nothing.

Unzip into the repo as `design-handoff/screen-style/`.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `screen-style-preview-spec.md` | The whole spec: why today's preview fails (a table of which settings are invisible), the new screen, starting styles, phone, behaviour rules, data shape, acceptance checks. |
| 2 | `png/StyleStudio.png` | The main screen — settings left, the whole sell screen previewed right. Build this. |
| 3 | `png/StylePresets.png` | The nine starting styles drawn as pictures instead of text pills. |
| 4 | `png/StylePhone.png` | Phone: preview pinned on top, settings scrolling under it. **Write this layout first**, then widen. |
| 5 | `key-size-spec.md` | **Key size** — the five sizes (Extra large → List), pictures sized from the key, Automatic by screen and orientation, the person's override, picture assets. |
| 6 | `png/KeySizes.png` · `png/KeySizeAuto.png` | The five sizes drawn at true scale; the automatic ladder and the three states of the control. |
| 7 | `source/*.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. Open only the one for the screen in hand. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## The one rule this screen exists for

**A style preview shows the whole screen.** Layout, picker and density cannot be seen in a grid of tiles, so the preview must render the entire sell screen — header, search, group chips, key grid, bill panel, pay row, shortcut bar — at the real proportions of the chosen device, with the scale stated ("1600 × 900 · shown at 59%").

Build it from the **real sell-screen components at a fixed transform scale**, inside a container-query wrapper — not a separate mock and not a screenshot. If the preview is a second implementation, it will drift from the screen within a month.

## Key size, in one line

Store a **smallest key width** (200 / 168 / 140 / 112 px, or a 56 px list row) and let `repeat(auto-fill, minmax(…, 1fr))` work out the columns. **Automatic** is the default and picks a size from the screen's width and shape — a tall 1080 × 1920 terminal gets Extra large, a 1600 × 900 desk terminal gets Medium — and any tap by the shopkeeper turns it off for that counter. Turning the screen never changes the size, only how many fit. Full detail in `key-size-spec.md`.

## Three things to build with it

1. **Try it for 10 minutes** — applies to the live screen with a floating "9:41 left · Keep it · Put it back" bar, reverts on its own, on reload and on a crash. This is what makes a big visual change safe on a working counter.
2. **Apply names its scope** — this counter / all counters of this device type / the whole shop, chosen on the button, repeated in the confirmation.
3. **Never mid-bill** — a pending style lands when the bill in hand is saved or cleared, and the screen says so before you apply.

## Rules this screen inherits from the rest of the package

1. **Mobile-first.** Phone layout first, widen with `min-width` queries only.
2. **Style is appearance only** — it may never change what a button does, a shortcut, a price, or what is on the bill.
3. **Offline is normal.** Styles are local; everything here works with no network.
4. **Five states**: loading, empty, error, offline, no permission (preview visible, Apply hidden).
5. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.
6. Reference basket in the preview: 5 × ₹64 + 5 × ₹163 + 5 × ₹352 = ₹2,895.00, saved ₹144.75, **total ₹2,750.25**.

If you have the full package (`quick-keys-design-handoff.zip`), these live in `README-INDEX.md` §3 and `NOW-reliability-usability.md`.

## Paste-ready start

```
Read design-handoff/screen-style/README-SCREEN-STYLE.md, then screen-style-preview-spec.md
and png/StyleStudio.png.
Find the current Screen style dialog in this repo and show me: the component file, how the
preview is rendered today, and where style settings are stored and resolved.
Then propose how to render the real sell screen as a scaled preview — one implementation, not two —
and wait for my approval.
After approval, build the phone layout first, then widen. Run the acceptance checks in
screen-style-preview-spec.md §7 and show me before/after screenshots at 390, 820 and 1600 px wide.
```

# Combo chooser — give this file to the CLI first

Replaces the current **Choose** modal in the till (the one whose primary button reads
*"Choose Choose a tiffin and Choose a drink"*).

Unzip into the repo as `design-handoff/combo/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `combo-chooser-spec.md` | The whole spec: what is wrong today, the two ways to run the modal, the five button states, the wording table, behaviour rules, data shape, sizes, acceptance checks. |
| 2 | `png/ComboWords.png` | The button states, the words and the rules on one board. Read this before writing any copy. |
| 3 | `png/ComboPlate.png` | Option A — Build the plate (step by step, wide). |
| 4 | `png/ComboUsual.png` | Option B — Ready to go (pre-filled, swap a line). |
| 5 | `png/ComboPhone.png` | Phone bottom sheet — build this layout first, widen from it. |
| 6 | `source/*.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these files.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. Open only the one for the screen in hand. |

The images are the visual truth; the spec is the rules. Where they disagree, ask.

## Decide before building

Ask which mode this shop runs (spec §2):

- **A · Build the plate** — every pick made on purpose. For combos that genuinely vary.
- **B · Ready to go** — pre-filled with the shop's usual, swap only what the customer changes. Fastest, and the primary button is never blocked.

Both read the same combo definition and use the same words, colours and keys. If unsure, build **B** and keep A behind the same data.

## Rules this screen inherits from the rest of the package

1. **Mobile-first.** Write the phone sheet first, widen with `min-width` queries only.
2. **Money in integer minor units** (paise). Totals recomputed, never accumulated from display strings.
3. **Offline is normal.** Combo definitions cache with the products; picking, pricing and editing work with no network.
4. **Five states** on every screen: loading, empty, error, offline, no permission.
5. **Sold out** comes from the same per-counter temporary list as the quick keys — shown greyed, never hidden.
6. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1. The amber button uses dark ink, never white.

If you have the full package (`quick-keys-design-handoff.zip`), these rules live in `README-INDEX.md` §3 and `NOW-reliability-usability.md`.

## Paste-ready start

```
Read EVERY file in design-handoff/combo/ first — every .md and every .png — before writing any code.
Read design-handoff/combo/README-COMBO.md, then combo-chooser-spec.md and png/ComboWords.png.
Find the current combo/"Choose" modal in this repo and show me: the component file, where the
button label is built, and where combo definitions come from.
Then propose the change in two parts — (1) the label and wording fix, (2) the new layout —
and wait for my approval before editing.
After approval, build the phone layout first, then widen. Run the acceptance checks in
combo-chooser-spec.md §8 and show me before/after screenshots at 390, 820 and 1440 px wide.
```

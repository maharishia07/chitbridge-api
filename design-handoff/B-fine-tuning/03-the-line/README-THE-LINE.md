# 03 · The line — levels, simulator and the grid — give this file to the CLI first

Rebuilds the **The line** modal: the *TRY IT ON THIS COUNTER* pills (Full speed · Slow 3G · Very slow 2G · Flaky · No network) and the nineteen-row LINE / WEAK / NONE grid.

Unzip into the repo as `design-handoff/the-line/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `the-line-spec.md` | The whole spec: the real reading, the five levels, the icon family, the simulator's safety rules, the grid, the registry, phone, data shape, acceptance checks. |
| 2 | `png/LineLevels.png` | Right now + usual here, the five level cards, the pretending banner, five-levels-into-three-columns, the icon family. Read this before writing any level code. |
| 3 | `png/LineGrid.png` | The grid — legend first, column heads with the lit column, three bands with counts, an icon on every row, and the full icon set. Build this. |
| 4 | `source/LineLevels.dc.html`, `source/LineGrid.dc.html` | Exact colours, sizes, spacing, copy and the SVG path data for all 19 icons. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## The change in one line

**A level means nothing until you can see where you already are.** Show the counter's real line first, define each level in numbers and in feel, say how many times slower the pretend one is, and make the chosen level light its own column in the grid.

## Five things, in order of value

1. **Right now, and usual here.** A reading from the last 20 real sends — *3.8 Mbps · 190 ms · 0 of 20 failed* — plus a bar per half hour of today: *good 92% · weak 7% · no line 1% · worst spell 4 min at 11:20 am*. Never `navigator.onLine`: a counter can be online and reach nothing.
2. **Each level gets a face.** Icon, the numbers that define it, what it feels like at the counter (*"three to five seconds a bill — nobody notices"*), the column it turns on, and **how far from real it is** — `simulated ÷ measured`, computed live, so *15× slower* is true rather than decorative.
3. **Join the pills to the columns.** Five levels, three behaviours. The selected level rings its column head and quiets the other two — that ring is the whole answer to "which pill does what". Two levels share a column because the counter does the same thing in both, just slower; say that plainly instead of inventing a fourth column.
4. **Pretending is loud, timed and reversible.** A banner with a countdown, in this modal *and in the till header*; fifteen minutes then back to real; a line in the day log; will not start with a bill open; Full speed = Stop. A real throttle left on looks exactly like a broken shop.
5. **The grid gets icons and bands.** Legend above, not below. Three bands with counts — *carries on (7)*, *works and waits (6 · 8 waiting · oldest 23 min)*, *needs the line (6)*. An icon on every row, the same one that stands for that thing elsewhere in the till. Grey for "no line", never black and never red; ✓ / ◔ / – instead of ✓ / hourglass / ✕.

## Build it from one registry

`{ id, label, icon, bucket: normal | waits | needs_line, workaround?, count? }` — **the same registry drives this grid, the offline panel and the header pill**. Three hand-written lists will disagree within a month. The grid is that registry filtered by the selected column.

If you have the **without-the-line** package, this is the same registry described in its §7 — build one, not two.

## Rules this screen inherits from the rest of the package

1. **Offline is normal**, not an error. The whole tone follows from that.
2. Red is only for a stopped sale or work at risk. No line is grey; weak and flaky are amber.
3. Colour never carries meaning alone — lit-bar count, the slash and the numbers say the same thing.
4. Counts everywhere, on the band rather than repeated on every row.
5. One word for one thing — **the line**, never "the server" / "the connection" / "the books".
6. **Mobile-first**: at 390 px the grid shows one column with a level switcher (spec §7); nothing is dropped.
7. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.

## Paste-ready start

```
Read EVERY file in design-handoff/the-line/ first — every .md and every .png — before writing any code.
Read design-handoff/the-line/README-THE-LINE.md, then the-line-spec.md and png/LineLevels.png.
First: show me how line state is decided today (is navigator.onLine involved?), where the
simulator's throttle is applied, whether it can be left on, and where the grid's 19 rows come
from. Do not change anything yet.
Then propose the capability registry from spec §6 — one row driving the grid, the offline panel
and the header pill — and the measured reading from spec §2. Wait for approval.
After approval, build in this order: (1) the real reading + usual-here strip, (2) the five level
cards with the computed multiplier, (3) the pretending banner with countdown, auto-stop and the
till-header copy, (4) the grid with icons and bands.
Run the acceptance checks in the-line-spec.md §9 and show me the modal at good, weak and no line,
with a simulation running, and at 390 px.
```

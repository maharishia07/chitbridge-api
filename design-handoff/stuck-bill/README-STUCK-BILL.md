# 08 · Why is a bill stuck? — give this file to the CLI first

Rebuilds the diagnostics panel that answers its own question in row fourteen.

Unzip into the repo as `design-handoff/stuck-bill/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `stuck-bill-spec.md` | The whole spec: what is wrong, the order of the screen, the verdict table, the wording table, set-aside, rules, data shape, acceptance checks. |
| 2 | `png/StuckBill.png` | Today's panel with its nine problems, the rebuilt panel, the verdict table and every word that was cut. Build this. |
| 3 | `source/StuckBill.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship this file.** |

## The change in one line

**The screen already knows the answer and prints it as row fourteen.** Put the cause at the top, make the button the fix, and delete the rest. 180 words become 44.

## Five things, in order of value

1. **The verdict is the headline.** *The shop does not accept this counter's key — pair it again and the bill goes. Nothing is lost.* That sentence is currently the fourteenth row, in the same type as "Rows tried: 1".
2. **The primary button is the fix, not a retry.** "Try now" is the loudest thing on the panel today and it is guaranteed to fail — the key was refused 13 seconds ago. It stays visible, greyed, saying *will fail again until it is paired*.
3. **Say what is held.** Three numbers, large: **1 bill waiting · ₹40 held here · 2m oldest**. Today the panel never says the money, which is the whole reason anyone opened it.
4. **Everything that is fine becomes one green line.** Online, paired, storage, bills stored — four rows saying nothing is wrong become *"Selling, printing and taking money are not affected."*
5. **No ids, no HTTP codes, no field names on the first view.** The 36-character database id and the "401" go behind *Show technical detail*, reached by a short support code.

## Build it from the verdict table

Six causes, each with its line, its button and its support code — and it is **the same table Counter health uses** (`A-screens/03-counter-health/counter-health-spec.md` §5). Add `key refused` and `clock wrong` to that table rather than starting a second one. Nothing on this panel is written by hand, so it can never describe one fault and offer the fix for another.

## Rules this screen inherits from the rest of the package

1. **Never break a sale** — and say so, once, in the green line.
2. Every warning carries the action that clears it; an action that cannot work says why.
3. Red only for a stopped sale or work at risk — *no space* is the only verdict here that earns it.
4. The explanation of a button belongs on its confirm, never standing above it.
5. **Mobile-first**: at 390 px the verdict card never scrolls out of the first screenful.
6. In picture mode the verdict gets its icon, the numbers carry it, and Set aside becomes a hold.
7. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.

## Paste-ready start

```
Read EVERY file in design-handoff/stuck-bill/ first — every .md and every .png — before writing any code.
Read design-handoff/stuck-bill/README-STUCK-BILL.md, then stuck-bill-spec.md and png/StuckBill.png.
First: show me every cause this panel can currently detect and what it renders for each. Then show
me the verdict table Counter health already uses. I want them merged into one table, not two.
Propose that merge and wait for approval.
After approval rebuild the panel in the order in spec §2 — verdict, button, numbers, green line,
folded detail — and move set-aside's explanation onto its confirm.
Run the acceptance checks in stuck-bill-spec.md §8 and show me the panel for all six verdicts,
plus the word count on first view.
```

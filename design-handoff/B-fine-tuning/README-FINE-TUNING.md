# Fine tuning — 21 September 2026

Seven pieces, numbered in the order they were designed. Each folder is self-contained: a README, a spec, the boards as PNGs, and the design source for reference.

Unzip into the repo as `design-handoff/` — each folder keeps its own name.

> **Start with `HANDOVER.md`, then `00-CORRECTIONS.md`.** The handover is the single thread through
> all seven folders; the corrections file resolves 30 contradictions found by a review of the whole
> package and **wins over any spec that disagrees with it.**

> **Read every file in every folder before you start on that folder.** All the `.md` files and all
> the `.png` images — the read order inside each README is an order, not a shortlist. Do not begin
> any code for a subject until you have seen all of its files.

## What is in here

| # | Folder | Screen | The change in one line |
|---|---|---|---|
| 1 | `01-footer/` | The CAREFUL footer at the bottom of the counter hub | Delete the standing warning; move each of the three actions to its real home and put the caution in a confirm sheet with live numbers. |
| 2 | `02-category-order/` | The **Order the categories** modal | Show the chip strip being edited and draw the fold where the sell screen stops — the screen decides what the hand reaches without scrolling, not what order a list is in. |
| 3 | `03-the-line/` | The **The line** modal — speed pills and the 19-row grid | Show the counter's real line first, give each level numbers, feel and a multiplier, and make the chosen level light its own column. |
| 4 | `04-settings/` | The six-tab **Settings** modal | A switch and a setting are not the same animal: voice and the other mid-shift switches come out of the drawer, the six tabs become one searchable list, and four rows leave Settings for homes they already have. |
| 5 | `05-headers/` | The sell-screen header and the panel header | Two headers, the same facts, two dialects → one component, five zones, one fixed order. Plus the pill system, the person block, and **voice in and voice out** as two switches. |
| 6 | `06-card-shape/` | Quick-key and product-list presentation | A sixth style: a portrait card at a playing card's 5 : 7 — for vertical terminals and for turning the screen to the customer. |
| 7 | `07-picture-mode/` | The whole seller's screen, for someone who cannot read it | Digits, pictures, position and voice. Hold instead of a warning, hold to hear, change as notes. **Overturns several decisions in folders 01, 02, 04 and 05 — see its §7.** |

Do them in any order — they barely touch the same files. If you want the cheapest win first, do **1**; the one a shopkeeper notices, **2** or **6**; the one that removes the most confusion, **4** and **5**.

**Two overlaps worth knowing.** Folder 4 moves *Clear and reload* out of Settings into Counter health ▸ technical, the same move folder 1 makes from the footer — do 1 first and 4 inherits it. And folder 5 replaces folder 4's single "Listener" switch with a **pair**, hearing and speaking; if you build 4 first, build the pair, not the single.

## The rules all seven share

1. **Mobile-first.** Phone layout first, widen with `min-width` only. Nothing is dropped as it narrows — it folds.
2. **Red is only for a stopped sale or work at risk.** Advisory is amber, structural is grey. No black fills, no capitals.
3. **A warning belongs at the moment of the act**, never standing on the screen beforehand.
4. **Say the consequence, not the adjective.** Name every button with its verb; never OK.
5. **Counts everywhere.** A list without numbers reads as chaos. Say the unit once, at the top.
6. **One registry per fact.** If a panel and a badge can disagree, they will — drive both from one list.
7. **Every empty field or blocked path carries the one action that resolves it.**
8. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1, and colour never carries meaning alone.
9. Nothing in the product explains the roadmap to a shopkeeper.

## Two earlier packages these lean on

- `without-the-line` — the capability registry in its §7 is the **same registry** folder 3 needs. Build one, not two.
- `counter-hub` — folder 1's three actions move into the header's person block, the day card and Counter health ▸ technical, all of which are designed there. Folder 1 is still buildable without it.

---

## What actually changes behaviour

Most of this package is presentation and can ship without touching how anything works. Some of it is not. **Read this table before you plan the work**, and treat C and D as separate conversations rather than part of a styling pass.

| | Band | Meaning |
|---|---|---|
| **A** | Look only | Display layer. No stored value changes, no new writes, no new paths. Ship it. |
| **B** | Additive | A new thing beside the old one. The existing path keeps working untouched. Low risk. |
| **C** | Changes behaviour | Something that works today works differently afterwards. Needs approval and a test. |
| **D** | Not fine-tuning | A new capability or a data migration. Plan it on its own. |

### Folder by folder

| # | Item | Band |
|---|---|---|
| 1 | Restyle the strip, drop the colour and the word CAREFUL | **A** |
| 1 | Confirm sheets on the three existing buttons | **B** |
| 1 | Live readiness numbers in the close sheet (96 of 96 sent, none waiting) | **B** |
| 1 | Moving Sign out / Close the day / Repair to new homes | **C** — the buttons are not where hands expect them |
| 1 | "Send 3 first, then close" replacing a plain close | **C** — reorders a destructive path |
| 2 | Chip strip preview, fold line, moved marker, save count, footnote, 44 px arrows, column header | **A** |
| 2 | Drag, tap-to-place, type-the-rank | **B** |
| 2 | "Most used first" as a live mode | **C** — needs a 30-day sales rank and a nightly recompute; check one exists |
| 2 | Hide a category | **C** — it must leave the chips and the keys and **nothing else**; search, barcode and code entry must still sell it |
| 2 | Per-counter order + hidden list stored | **D** — new fields |
| 3 | Legend position, icons, bands, counts, colours, wording, lit column | **A** |
| 3 | The five level cards with numbers, feel and the computed multiplier | **B** |
| 3 | Real reading + "usual here" strip | **B** — new read, nothing else changes |
| 3 | Line state from the last 20 real sends instead of `navigator.onLine` | **C** — this changes *when the app believes it is offline*, which changes what queues. Test it hard |
| 3 | Simulation: auto-stop, header banner, day-log line, blocked mid-bill | **C** — it really throttles; today it can be left on |
| 4 | Sections, find box, scope words, sub-lines, read-only styling | **A** |
| 4 | The switch tray and its shortcuts | **B** |
| 4 | Per-row saving instead of one Save | **C** — if any setting today needs a batch or atomic save, this breaks it. Check before building |
| 4 | Moving Quick keys, the shop block and Clear and reload out | **C** — navigation changes; make sure each new home is reachable first |
| 4 | Pins, the tray's modes, the shop default | **D** — new state, new permission question |
| 4 | Scope per setting (this counter / the shop / just me) | **D** — some values may sit in the wrong scope today; that is a migration |
| 4 | Test ₹1 | **D** — a real outbound action. Decide exactly what it does before designing the button |
| 5 | Identity order, short date, 12-hour clock, pill colours and words, today's take, panel card icons | **A** |
| 5 | The fold behaviour at five widths | **A** |
| 5 | One header registry feeding both headers | **B** — a refactor that should be behaviour-neutral; prove it |
| 5 | Voice **out** — the counter speaking back | **D** — a new capability, not a tune-up |
| 6 | The card shape itself, its states and the shape row in the control | **B** — added beside the tiles, which stay |
| 6 | Automatic picking a shape by orientation | **C** — what people see changes when they rotate |
| 6 | `minWidth` replacing a stored column count | **C** — only if a column count is stored today |
| — | The operator bug (`desktop3`, the shop shown as the person) | **D** — a fix, plus a decision about existing rows |

### How to ship it

1. **All of A first, in one pass.** It is the majority of the package, it needs no approval, and the product looks different by the end of the day.
2. **Then B**, folder by folder. Each one is a new thing beside an old one; if it goes wrong, the old path is still there.
3. **Then C, one at a time**, each with a before/after and a test. Never two C items in one change.
4. **D items are not part of this package's schedule.** Bring each one back as its own piece of work with its own plan.

If you only have time for one thing: do all of A. Nothing in it can break a sale.

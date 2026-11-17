# Handover — one thread

Everything in this package, in the order to build it, with every known contradiction already resolved.

**Read this file first, then `00-CORRECTIONS.md`, then the folder you are working on.** Nothing else needs reading up front.

Everything is here — there is no second package to find.

```
design-handoff/
  HANDOVER.md            ← you are here
  00-CORRECTIONS.md      ← read second. It wins over every spec below.
  A-screens/             ← the screens, as designed
    00-foundations/        the rules the whole product follows, and the backlog
    01-combo-chooser/      04-todays-bills/
    02-screen-style-and-key-size/   05-without-the-line/
    03-counter-health/     06-counter-hub/
  B-fine-tuning/         ← this week's corrections to those screens
    01-footer/  02-category-order/  03-the-line/  04-settings/
    05-headers/ 06-card-shape/      07-picture-mode/
```

**A is what each screen should be. B is what is wrong with them now and how to fix it.** Where a B folder covers the same screen as an A folder, B is newer and wins — except where `00-CORRECTIONS.md` says otherwise, which beats both.

---

## The three things that govern everything

1. **`00-CORRECTIONS.md` wins.** A full review found 30 contradictions across these specs. Where any spec disagrees with that file, the correction is right and the spec is stale.
2. **Picture mode is the harder default** (`07-picture-mode/`). The seller may not be able to read the screen. That constraint overturns several decisions made elsewhere in this package, and every one of those reversals is listed in its §7. Build for it even where the counter is not in picture mode — anything that carries meaning in words alone is wrong either way.
3. **Never break a sale.** Everything else — every warning, every setting, every panel — yields to that.

---

## Phase 0 · Decide, before any code

These four cannot be inferred from the specs. Get an answer, write it down, then build.

| | Decision | Where |
|---|---|---|
| 0.1 | Confirm the keyboard map — new keys are **F5**, **Shift F5**, **F11**, **F12**; nothing touches F2/F4/F6/F7/F8/F9/F10/Esc | corrections §1 |
| 0.2 | Confirm config precedence: `app → country → shop → counter → device type → device → person` | corrections §2 |
| 0.3 | Decide the storage model: **`minWidth`, never `keysPerRow`** | corrections §3 |
| 0.4 | Decide what `Test ₹1` actually does before anyone designs the button | folder 04 |

Then answer one product question: **how many of these counters have a reader?** If the answer is "most do not", picture mode is not folder 7 — it is the whole build, and the phases below reorder around it.

---

## Phase 1 · The two data bugs

Neither is design. Both are writing wrong data to bills right now.

1. **The operator field falls back to whatever is nearest.** It wrote `desktop3` onto four of ten bills and shows the shop's name as the person in the hub header. **Never fall back.** Nobody signed in → write nothing, render *no person recorded*, and list those bills separately at day close.
2. **Decide what happens to the rows already written that way.** Leave them and label them, or migrate them. Either is fine; silently keeping them is not.

Specs: `A-screens/04-todays-bills/todays-bills-spec.md` §6, `A-screens/06-counter-hub/counter-hub-spec.md` §6, `B-fine-tuning/05-headers/headers-spec.md` §4.

---

## Phase 2 · Everything that is look-only

The majority of this package. No stored value changes, no new writes, no new paths. It needs no approval and nothing in it can break a sale. Do it in one pass.

| | Folder | What |
|---|---|---|
| 2.1 | 05 | One header component, five zones, shop leading, three pills, the colour ladder, the words table, the fold |
| 2.2 | 05 | The panel's cards: one icon family, a number on every card, a badge only when non-zero |
| 2.3 | 03 | The line grid: legend above, icons on every row, three bands with counts, grey for no line |
| 2.4 | 02 | The category modal: chip strip preview, the fold line, moved marks, save count, the footnote, 44 px arrows |
| 2.5 | 04 | Settings as one scrolling list with sections, scope words and working sub-lines |
| 2.6 | 01 | The footer loses its colour and the word CAREFUL |

By the end of this phase the product looks different and behaves identically.

---

## Phase 3 · Additive — a new thing beside the old one

The old path stays. If one goes wrong, nothing is lost.

| | Folder | What |
|---|---|---|
| 3.1 | 05 | **Voice out.** Do this first in the phase: on a picture-mode counter it is the only way to check a total |
| 3.2 | 06 | The card shape at 5 : 7, all five states, added beside the tiles |
| 3.3 | 01 | Confirm sheets wired to the existing three footer buttons — nothing moves yet |
| 3.4 | 03 | The real line reading and the "usual here" strip; the five level cards with the computed multiplier |
| 3.5 | 02 | Drag, tap-to-place and type-the-rank alongside the arrows |
| 3.6 | 04 | The switch tray and its shortcuts |
| 3.7 | 07 | Hold-to-hear, quantity pips, thumbnails on bill lines, change as notes |

---

## Phase 4 · Changes behaviour — one at a time, each with a test

Never two of these in one change. Each needs a before/after and someone watching.

| | What | The risk |
|---|---|---|
| 4.1 | Line state from the last 20 real sends instead of `navigator.onLine` | Changes *when the app believes it is offline*, which changes what queues |
| 4.2 | Per-row saving in Settings | Breaks anything that needs a batch or atomic save — check first |
| 4.3 | Hiding a category | Must leave the chips and the keys and **nothing else**; search, barcode and code entry must still sell it |
| 4.4 | Moving the footer's three actions to their homes | Hands expect them where they are |
| 4.5 | Moving Quick keys, the shop block and Clear and reload out of Settings | Each new home must exist first |
| 4.6 | "Most used first" as a live mode — **and off by default in picture mode** | Needs a 30-day sales rank that may not exist |
| 4.7 | Simulation that really throttles, with auto-stop and a header banner | It can be left on today; after this it cannot |
| 4.8 | Automatic picking a shape by orientation | Columns may change on a turn; **shape and size must not** |

---

## Phase 5 · Its own piece of work

Not part of this package's schedule. Bring each back with its own plan.

- **Picture mode as a whole** (folder 07) — if most counters have no reader, this is phase 1, not phase 5.
- **Scope per setting** — a migration if any value sits in the wrong scope today.
- **`Test ₹1`** — a real outbound action.
- **Pins and the tray's modes** — new state, new permission question.
- **The six gaps in corrections §30** — the panel-sizes screen, the day log, the "database damaged" verdict, the line state between "1 in 2" and "nothing", the quick-keys toolbar, and the missing index entry.

---

## The folders

**A · the screens**

| Folder | Screen |
|---|---|
| `00-foundations/` | The rules the whole product follows, the device matrix, the data model, the backlog |
| `01-combo-chooser/` | The combo modal, two ways to say "choose" |
| `02-screen-style-and-key-size/` | The screen-style preview, and the five key sizes |
| `03-counter-health/` | Why nothing is reaching the shop |
| `04-todays-bills/` | The bill list and the `desktop3` bug |
| `05-without-the-line/` | Working offline — what still works, what to do instead |
| `06-counter-hub/` | The shop, the day, and what needs you |

**B · the fine tuning**

| Folder | Screen |
|---|---|
| `01-footer/` | The CAREFUL footer at the bottom of the hub |
| `02-category-order/` | The "Order the categories" modal |
| `03-the-line/` | The line — levels, simulator and the 19-row grid |
| `04-settings/` | The seven-tab Settings modal |
| `05-headers/` | The sell header and the panel header, plus voice both ways |
| `06-card-shape/` | The playing-card shape for keys and the product list |
| `07-picture-mode/` | For a seller who cannot read the screen |

Every folder has its own README with a read order and a paste-ready prompt. Use those once you are inside a folder; use this file to decide which folder you are in.

**Phases 2, 3 and 4 below name B folders.** Open the matching A folder whenever you need the screen those corrections apply to.

---

## The rules every folder shares

1. **Never break a sale.** No modal, no full-screen warning, no disabled Save.
2. **Mobile-first.** Phone layout first, widen with `min-width` only. Nothing is dropped as it narrows — it folds.
3. **Red is only for a stopped sale or work at risk.** Advisory is amber, structural is grey. No black fills, no capitals.
4. **A warning belongs at the moment of the act**, never standing on the screen — and where the seller may not read, it is a hold, not a sentence.
5. **Say the consequence, not the adjective.** Name every button with its verb; never OK.
6. **Counts and units everywhere.** The unit is said once, at the top.
7. **One registry per fact.** A panel and a badge that can disagree will.
8. **Every empty field or blocked path carries the one action that resolves it.**
9. **Colour never carries meaning alone** — and neither does text. Position, icon, number, voice.
10. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.
11. **Nothing explains the roadmap to a shopkeeper.**

---

## Paste-ready start

```
Read design-handoff/HANDOVER.md and design-handoff/00-CORRECTIONS.md in full before anything else.
Then read EVERY file in the folder you are about to work on — every .md and every .png — plus the
matching A-screens folder when the work is a correction to a screen designed there.

Start with Phase 0: confirm the four decisions and tell me which ones you cannot answer from
the repo. Do not write code yet.

Then Phase 1: find where a bill's operator is recorded, show me why it falls back to the device
name and to the shop name, propose the fix and the migration, and wait for my approval.

Then Phase 2 in one pass — it is look-only and needs no approval. Show me before/after
screenshots at 390, 820 and 1440 px when it is done.

Stop before Phase 3 and tell me what you found.
```

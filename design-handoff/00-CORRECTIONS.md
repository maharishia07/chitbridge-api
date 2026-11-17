# Corrections — this file wins

A full adversarial review of every spec in this package and the earlier `quick-keys` package found **30 contradictions**. They are listed here with a decision on each.

**Paths below are relative to `design-handoff/`.** `A-screens/` holds the screens as designed; `B-fine-tuning/` holds this week's corrections to them.

> **Where any spec disagrees with this file, this file is correct.** Read this before you write code and again whenever a spec surprises you. Several of the specs were written weeks apart and contradict each other in ways that would ship as bugs.

Some have already been patched in the spec files; all of them are binding whether patched or not.

---

## A · Things that would ship as bugs

### 1. Keyboard shortcuts collide
The app already owns: `F2` search · `PgUp/PgDn` choose · `Enter` add · `Ctrl ↑↓` change line · `3*` quantity · `F4` re-read the shop · `F6` park · `F7` who · `F8` bills · `F9` save & print · `F10` day close · `Esc` clear. Two specs then reassigned `F4`, `F6` and `F9`.

**Decision.** The existing bar is untouchable. New assignments:

| Action | Key |
|---|---|
| Voice — hearing you | **F5** |
| Voice — speaking back | **Shift F5** |
| Switch tray | **F12** |
| Photos on keys | **F11** |
| Kitchen ticket | `F3` *(already in use for this)* |

No spec may assign a key without checking this table.

### 2. Config precedence is stated three different ways
`device → counter → outlet`, `counter → device type → shop → app`, and `org → country → shop → counter → device → user`.

**Decision.** One order, most general to most specific, last wins:

```
app default → country pack → shop → counter → device type → device → person
```

A value set on a device beats the counter. A person-scoped value with nobody signed in falls back to the counter's, and the row says so.

### 3. Two incompatible schemas for screen style
`keysPerRow: 6` in one, `minWidth: 150` in another; different enum spellings for tile and picker; `density` with two different value sets.

**Decision.** Keep the `minWidth` model and delete `keysPerRow` everywhere — a column count breaks the moment a panel is resized. One enum set, from the card-shape spec: `shape: tile | card | list`, plus `minWidth`, plus `style` (the six tile styles) and `density: roomy | comfortable | tight`.

### 4. "style", "size" and "shape" are used for all three things
**Decision.** Fixed vocabulary: **six tile *styles*** (classic, colour block, monogram, compact row, hotkey, photo) · **five key *sizes*** (the width ladder) · **three *shapes*** (tile, card, list). Never swap the words.

### 5. The capability registry has 19 rows in one spec and 17 in another
Both specs insist it is one registry, then list different rows and different bucket counts (7/6/6 vs 7/5/5), and one row — "New work from the office" — appears in no bucket at all.

**Decision.** **19 rows, buckets 7 / 6 / 6**, as in `B-fine-tuning/03-the-line/the-line-spec.md` §5. Regenerate `A-screens/05-without-the-line/without-the-line-spec.md`'s lists and counts from it. Drop "New work from the office" or map it to "New offers from the shop" — decide once and write it in the registry.

### 6. Bucket size and queue depth share a label
"8" means *eight capabilities in this bucket* in one place and *eight items waiting to send* in another.

**Decision.** They are different numbers and must never share a word. Buckets are counted as **"6 things"**; the queue is **"8 waiting"**. Never "8" alone.

### 7. Three different retry policies
`2s → 4s → … → 5 min`, `5 s doubling to a 2-minute ceiling`, and `every 2 minutes`. One spec's own banner ("next try in 26 s") contradicts its own data (`120 s`).

**Decision.** **5 s, doubling, ceiling 2 minutes, forever.** Every countdown and every sample payload must be regenerated from that.

### 8. The `desktop3` bug affects five bills or four
The prose says five; the filter chips and the day-close line both say four, and four is what makes the ten add up.

**Decision.** **Four.** *(patched)*

### 9. "No line" is grey in one spec and amber-with-a-red-dot in another
**Decision.** **Grey, never red.** A shop with no line is not a broken shop. The red dot is deleted. *(patched)*

### 10. "Nothing can reach the shop" is ranked *stops a sale*
Which contradicts the promise made in four other files that the counter never stops selling.

**Decision.** Re-rank to **costs time**. The only condition that genuinely risks work is *nearly out of space*; it keeps the top rank and is the only thing in the hub that may be red.

### 11. Keys per row: 6, 8 or 9
**Decision.** Nobody states a column count. It is derived from `minWidth` and the panel width at render time, and specs quote it only as an example with the screen named.

### 12. Photo asset sizes: 96/192/384 or 128/256/512
**Decision.** **96 / 192 / 384**, WebP with a JPEG fallback — it matches the database columns and the `photoQuality` enum, which are harder to change than a table in a spec.

---

## B · Things that would ship as the wrong design

### 13. The header leads with the counter in one spec, the shop in another
**Decision.** **The shop leads**, per `B-fine-tuning/05-headers/headers-spec.md` §2 — it is what is printed on every bill and what the customer reads. *(patched)*

### 14. Two pills or three, and what may be one
**Decision.** **Up to three**, from the registry, in fixed order, all of them pressable. `113 products` leaves every header and chip strip.

### 15. The CAREFUL footer is deleted in three files and mandatory in two
**Decision.** **Deleted.** The word appears nowhere in the product. `A-screens/00-foundations/counter-hub-menu-spec.md` §2 row 9 and `A-screens/00-foundations/mobile-first-instructions.md` §4's "Careful" section are stale — ignore them.

### 16. The hub has five sections, nine sections, or eight cards
**Decision.** The nine-section list in `A-screens/00-foundations/counter-hub-menu-spec.md` §2, **with section 1 split into "The shop" and "Start the day"** per `A-screens/06-counter-hub/counter-hub-spec.md` §1 — so **ten**. The five-section list in `A-screens/00-foundations/mobile-first-instructions.md` §4 is stale.

### 17. "Settings → Bill" was renamed to "Receipt" and then not renamed
**Decision.** **Receipt**, so "Bills" only ever means documents. `B-fine-tuning/04-settings/settings-spec.md`'s "Bills" section is renamed, and its rows are unchanged.

### 18. Quick keys: a setting, or maintenance
**Decision.** **Maintenance.** Settings keeps one line and a link. `A-screens/00-foundations/counter-hub-menu-spec.md`'s claim that Settings keeps the group definition is superseded.

### 19. Printer and photos have four homes between them
Settings, the hub's "How it looks", the sell screen's ≡ Display, and the switch tray.

**Decision.** **The switch tray is the only place a switch is flipped.** Every other screen links to it. One stored value each.

### 20. Day close has three homes
**Decision.** **The day card**, opened by its own button and by `F10`. Today's bills links to it; Counter health does not mention it.

### 21. "Full speed" names two different controls
A *sending speed* (full / gentle / paused) and a *simulation level*.

**Decision.** Rename the sending control to **"Sending speed: normal / gentle / paused"**. "Full speed" only ever names the simulation level, and choosing it means *stop pretending*.

### 22. 12-hour vs 24-hour, short vs long dates
**Decision.** **12-hour with lowercase am/pm, and short dates (`Mon 21 Sep`), for everything a shopkeeper reads** — including the bills list and its hour grouping. Admin-facing time windows (`06:00–11:30`) stay 24-hour and are labelled as such. *(partly patched)*

### 23. Money formatting
**Decision.** **Two decimals everywhere** a customer or a shopkeeper sees it. Integer minor units in storage, always.

### 24. Sold-out is per counter, but one acceptance check has it arriving from another counter
**Decision.** Per counter. Delete that check from the combo spec, or restate it as *"a sold-out mark made on this counter while the sheet is open"*.

### 25. "Clear" both confirms and has no dialog
**Decision.** **Undo, not confirm.** `Esc` clears immediately and an undo bar stands for 10 seconds. Confirmation is reserved for refund, close the counter and repair. In picture mode all three become hold-to-confirm.

### 26. Automatic returns a 200 px square and a 150 × 210 card for the same screen, and rotation both must and must not change things
**Decision.** Automatic picks **shape first, then width**. On a portrait screen ≥ 900 px tall it picks `card`. **Rotation changes the number of columns, never the shape or the size** — the earlier rule that keys must not reshuffle on a turn stands, and it matters more than ever for picture mode (§ below).

### 27. "Today's largest tile is 168" — it is 200
**Decision.** 200 (Extra large). *(patched)*

### 28. Settings has six tabs or seven
**Decision.** **Seven today** — Counter · Screen · Bill · Quick keys · Pay · Voice · Device. `04-settings` silently dropped Screen. It is routed with the rest: Screen → the tray and the screen-style screen.

### 29. `9:41 pm · 2h 38m` at 10:19 pm
**Decision.** 9:41 **am**, elapsed recomputed. *(patched)* Every sample timestamp in every spec must be internally consistent — regenerate them rather than hand-editing.

### 30. Gaps — referenced but never specified
- **Panel sizes screen** — cited by four files, specified by none.
- **The day log** — required by the simulation rules, specified nowhere.
- **The "database damaged" verdict** — required by an acceptance check, missing from the verdict table.
- **A line state between "1 in 2 fail" and "nothing gets through"** — a counter failing 3 in 4 falls in no state.
- **The quick-keys toolbar** (Arrange · By category · Order them · Photos · My group · Morning) — six permanent controls in the sell screen, never designed.
- **`A-screens/02-screen-style-and-key-size/key-size-spec.md` is missing from the package index.**

**Decision.** These are backlog items, not silent gaps. Build nothing that depends on them; when one is needed, spec it first. The line-state hole is the urgent one: define **weak = 1 in 20 up to 3 in 4, or latency over 800 ms; no line = nothing lands in 60 s.**

---

## C · Two small ones

- **Money without decimals** in two specs (`₹18,420`, `cash ₹1,900`) — bring them to two decimals.
- **Timestamps in `Z` with wrong dates** in two specs — all samples are `+05:30` and fall on 20–21 Sep.

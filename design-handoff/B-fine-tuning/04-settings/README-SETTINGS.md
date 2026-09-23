# 04 · Settings — give this file to the CLI first

Rebuilds the six-tab **Settings** modal (Counter · Bill · Quick keys · Pay · Voice · Device), and moves several of its rows out of it entirely.

Unzip into the repo as `design-handoff/settings/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `settings-spec.md` | The whole spec: what is wrong today, the test that decides where a thing lives, the row-by-row routing table, the panel, the tray, who may arrange it, phone, data shape, acceptance checks. |
| 2 | `png/SetRoute.png` | Today's six tabs and their problems, the three layers, and **every row today with its destination**. Read this before moving anything. |
| 3 | `png/SetPanel.png` | The rebuilt panel, the switch tray, and the rules for arranging it. Build this. |
| 4 | `source/SetRoute.dc.html`, `source/SetPanel.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## The change in one line

**A switch and a setting are not the same animal.** Ask of every row: *would someone reach for this in the middle of a queue?* Yes → it belongs where the hand is, with its state visible and no Save. No → it belongs in one long searchable list.

## Five things, in order of value

1. **Voice comes out of the drawer.** It gets a mic button in the till header showing *listening* / *off* — tap toggles, hold changes language. Someone speaks near the till and it must stop in one tap, not in three taps through a modal and a tab.
2. **Six tabs become one searchable list.** Sections instead of tabs, a find box at the top that matches labels *and* values (so "okhdfc" finds the UPI row), per-row saving, and one **Close** in the footer. Tabs fail at 40 settings; search does not.
3. **Scope on every row, not on the modal.** *this counter* / *the shop* / *just me* — because "Kept on this device." is printed under all six tabs today and is not true of the shop's tax block.
4. **Four rows leave Settings.** Quick keys → the maintenance screen that already exists. The shop's tax block → the hub's *The shop* card, one line and a link. Printer and kitchen tickets → the switch tray. **Clear and reload → Counter health ▸ technical ▸ Repair this counter** (folder 01 in this package designs that move).
5. **A switch tray behind ⚡ / F9**, each switch saying its state in words — *off · no KOT is printed* — plus its shortcut. Turning kitchen tickets on mid-bill asks about the bill in hand.

## On "can the user design what is in the menu?"

**Yes to the tray. No to the list.** Spec §6 has the seven rules; the short version:

- A star on every settings row pins it to the tray. The tray is a *view* of the same rows, never a copy.
- Two modes, the same pattern as the category order in folder 02 — *Most used first* (counted from what actually gets flipped here) or *The set I chose*.
- Only switches may be pinned; six at most; every one also a shortcut.
- The owner sets the shop's starting set, a counter may deviate and the tray says so with one way back, a person may not.
- **The settings list itself stays in one fixed order in every shop**, or "it is under Bills, third row" stops being true and every support call gets longer.
- A new counter starts with three pins: Voice · Photos on keys · Printer.

## Rules this screen inherits from the rest of the package

1. **Mobile-first.** Phone sheet first (spec §7), widen with `min-width` only; the mic survives every width.
2. Every warning carries the button that fixes it. The bill-number warning gets **Add 26-27**; the UPI row gets **Test ₹1** and a verified date.
3. One registry per fact — one settings registry drives the list, the search, the tray and the shortcut map.
4. Dangerous things live beside the numbers that justify them, behind a confirm sheet, never in a settings row.
5. Read-only is never a dead end: it carries *Open ↗* or *Edit ↗* and says where that goes.
6. **Five states**: loading, empty, error, offline (counter settings still save), no permission (read-only with who to ask).
7. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.

## Paste-ready start

```
Read EVERY file in design-handoff/settings/ first — every .md and every .png — before writing any code.
Read design-handoff/settings/README-SETTINGS.md, then settings-spec.md and png/SetRoute.png.
First: list every settings field in the app today with where its value is stored and what scope it
really has (this counter, the shop, or the person). Show me that table before changing anything —
the routing in spec §3 depends on it being right.
Then propose the settings registry from spec §8 — one row driving the list, the search, the tray
and the shortcuts — and wait for approval.
After approval, build in this order: (1) the one-list panel with the find box and per-row saving,
(2) scope words, (3) the mic button in the header, (4) the switch tray with shortcuts,
(5) move Quick keys, the shop block and Clear and reload out.
Run the acceptance checks in settings-spec.md §10 and show me the panel with a search term typed,
the tray open, and the whole thing at 390 px.
```

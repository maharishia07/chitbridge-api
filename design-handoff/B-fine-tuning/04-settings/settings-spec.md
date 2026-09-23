# Settings — a switch and a setting are not the same animal

Replaces the six-tab **Settings** modal (Counter · Bill · Quick keys · Pay · Voice · Device).

Designs: `png/SetRoute.png` (where each row goes), `png/SetPanel.png` (the panel, the tray, and who arranges it).
Source: `source/Set*.dc.html` — reference only, never ship.

---

## 1. What is wrong today

1. **Six tabs of wildly different frequency.** Voice is touched mid-shift; the ChitBridge address is touched once in the counter's life. Same container, same weight.
2. **Switches and settings share a drawer.** A *switch* is flipped with a customer standing there. A *setting* is decided once. They need opposite homes.
3. **Tabs hide state.** Nothing tells you voice is listening without opening Settings and clicking Voice. Any on/off that matters mid-shift must be visible without opening anything.
4. **Save and Close on every tab**, and no answer to "does Save save the other five?" or "do I lose this tab by switching?"
5. **"Kept on this device." under all six** — but the shop's tax block comes from ChitBridge. Scope is per row, not per modal.
6. **"Clear and reload" sits beside the counter key.** The most dangerous control in the product, dressed as a settings row.
7. **The shop's tax identity is duplicated here**, read-only. Two places to look, and one day two different answers.
8. **Bill and Voice hold two rows each**, then 200 px of white. That is a taxonomy problem, not a content problem.
9. **Quick keys is not a setting at all** — it is maintenance, and a maintenance screen already exists.
10. **No way to find anything.** Six tabs work at 20 settings and fail at 40.

---

## 2. The test that decides where a thing lives

> **Would someone reach for this in the middle of a queue?**
>
> Yes → it is a **switch**. It lives where the hand is, its state is visible without opening anything, and it has no Save.
> No → it is a **setting**. It can afford to be two taps away, in one long searchable list.

Three layers fall out of that:

| Layer | Touched | Where | Rule |
|---|---|---|---|
| **Switches** | during a shift | the till header + a switch tray | visible state, one tap, no modal, no Save |
| **Counter settings** | once or twice | one scrolling page, searchable | saved as you go, scoped on every row |
| **The shop** | set once, elsewhere | ChitBridge | one line here, the truth there, a link that says where it goes |

---

## 3. Where every row goes

| Row today | Layer | Destination |
|---|---|---|
| What this counter is for | setting | Settings ▸ This counter — first row; it changes what everything else means |
| Kitchen tickets | **switch** | the tray — dine-in and takeaway change through the day |
| Weighing scale | setting | Settings ▸ This counter ▸ what is plugged in |
| The shop's tax block | **shop** | hub ▸ The shop. One line stays: *Mayur Bhavan · not registered · Open the shop ↗* |
| Counter · C1 | setting | Settings ▸ This counter, read-only, with who named it and when |
| Bill number · Restart · Day starts | setting | Settings ▸ Bills — one decision, three rows, together |
| Columns on the bill | setting | Settings ▸ Bills. **The Bill tab disappears** |
| Printer | **switch** | the tray — a printer dies mid-day and someone must move to another |
| Keys from · Group · products | **maintenance** | Quick keys maintenance. Settings keeps *Morning (31) · Edit ↗* |
| Hidden keys · Show all again | **maintenance** | the same screen, beside the thing it hides |
| UPI payee · Button | setting | Settings ▸ Taking money — with **Test ₹1** and a verified date |
| Listener | **switch** | the mic button in the till header — on, off and listening, always visible. **Two switches, not one: hearing you and speaking back** (folder 05, spec §5) |
| Language | setting | Settings ▸ Voice — chosen once; hold the mic to change it in place |
| Counter key · ChitBridge | setting | Settings ▸ Technical, folded shut, with copy and *paired 14 Sep* |
| Clear and reload | **health** | Counter health ▸ technical ▸ **Repair this counter**, behind a confirm sheet (see folder 01) |

Six tabs become one list. Two of them leave Settings entirely, because both already have a better home.

---

## 4. The panel

Top to bottom: **title → find box → sections → close.**

- **Find box first.** *find a setting — try "upi", "voice", "bill number".* Typing filters rows across all sections and matches on the value too, so "okhdfc" finds the UPI row. This is what replaces tabs.
- **Sections, not tabs**: This counter · Bills · Taking money · Voice · The shop · Quick keys · Technical (folded).
- **A star on every row** — the pin (§6).
- **A scope word under every label**: *this counter* (grey) · *the shop* (blue) · *just me* (purple). It replaces the blanket "Kept on this device."
- **Read-only rows** are drawn with a dashed border and carry a way out — *Open ↗*, *Edit ↗* — never a dead value.
- **Per-row saving.** The footer is one button, **Close · Esc**, beside *Everything saves as you change it. Nothing is lost by closing.* No Save, no lost tab, no "did it apply?"
- **Sub-lines do work**, not decoration: *Next: C1/26264/0003 — no tax year in the number* with an **Add 26-27** button; *checked with ₹1 on 12 Sep — the only proof that works* with **Test ₹1**.

### Rows that need fixing while you are in there

| Row | Today | Instead |
|---|---|---|
| Bill number | ⚠ *no tax year in the number* | the same warning **with the button that fixes it** |
| UPI payee | a paragraph telling you to send ₹1 yourself | a **Test ₹1** action, and a verified date once it passes |
| Printer | *the browser's print dialog* as flat text | a real control — it is a choice, and it becomes a switch |
| Listener | *Automatic* | *Automatic — starts when the bill line is empty* |
| Counter key | `••••uMRanE` | masked, with **copy**, **show**, and *paired 14 Sep* |
| Start fresh | *Clear and reload* | gone from here; it is **Repair this counter** in Counter health |

---

## 5. The tray

**Voice gets its own button in the till header** — a mic showing *listening* / *off*. Tap toggles, hold changes language. It earns that because someone speaks near the till and it must stop in one tap.

Everything else sits behind one **⚡ (F12)** in the header, as a small tray:

```
Switches                                        ⚡ or F9
  Hearing you        on · English (India)    F5   [●  ]
  Speaking back      on · totals           Sh F5  [●  ]
  Photos on keys     on · large             F11   [●  ]
  Kitchen tickets    off · no KOT is printed F3   [  ○]
  Printer            the browser's print dialog   [●  ]
  Key size           large — 9 across             [●  ]
  ★ Pin another setting here        2 changed from the shop's set
```

### What every switch must say

1. **What it is now, in words** — *off · no KOT is printed* — never a bare toggle whose meaning you have to remember.
2. **What flipping it does to the bill in hand.** Kitchen tickets turned on mid-bill asks: *Send a ticket for this bill too?*
3. **Who it applies to** — this counter, or just the person standing here. Voice language is personal; the printer is not.
4. **That it stuck.** The row states the new state immediately; nothing about a switch waits for the line.

---

## 6. Can the person decide what is in it?

**Yes to the tray. No to the list.**

The tray is personal to a counter and should be — a sweet shop flips photos, a tiffin counter flips kitchen tickets. The settings list stays in one fixed, searchable order everywhere, because the moment it differs per counter, *"it is under Bills, third row"* stops being true and every support call gets longer.

| # | Rule | |
|---|---|---|
| 1 | **A star on every settings row.** | Pinning puts it in the tray, unpinning takes it out. Nothing is duplicated — the tray is a view of the same rows. |
| 2 | **Two modes, the same two as the keys.** | *Most used first*, counted from what actually gets flipped here, or *The set I chose*. The counter arrives at its own tray without anyone arranging anything. |
| 3 | **Only switches may be arranged.** | Anything with more than an on and an off stays in the list. A tray of dropdowns is a settings page with worse manners. |
| 4 | **The owner sets the shop's starting set.** | A counter may deviate and the tray says so — *2 changed from the shop's set* — with one way back. A person may not: too many hands on one till. |
| 5 | **A pin is not a permission.** | Pin something you may not change and it shows, greyed, with who to ask. Better than hiding it and letting someone hunt. |
| 6 | **Six at most.** | Past six the tray needs scrolling and stops being faster than the list. The seventh pin asks which one to drop. |
| 7 | **Every switch is also a shortcut.** | F3, F4, F6 — printed on the row. A counter with a keyboard should never need the tray at all. |

**A new counter starts with three:** Voice · Photos on keys · Printer. A tray that starts full is a tray nobody edits, and the counter will tell you within a week what the fourth one should be.

---

## 7. Phone

- Settings is a full-height sheet: find box pinned at the top, sections scrolling, Close pinned at the bottom.
- The mic keeps its header button — it is the one control that must survive every width.
- The tray becomes a bottom sheet of full-width 48 px rows, opened from the ⚡ in the header.
- Scope words move under the value rather than the label, so the row stays two lines.

---

## 8. Data

```json
{
  "settings": [
    { "id": "voice_listening", "section": "voice", "kind": "switch",
      "scope": "person", "value": true, "shortcut": "F4",
      "state": "on · English (India)", "pinnable": true }
  ],
  "tray": {
    "mode": "most_used | chosen",
    "chosen": ["voice_listening", "photos_on_keys", "printer"],
    "shopDefault": ["voice_listening", "photos_on_keys", "printer"],
    "max": 6
  },
  "scopes": { "counter": "this counter", "shop": "the shop", "person": "just me" }
}
```

- **One registry of settings rows** drives the list, the search index, the tray and the shortcut map. A setting defined twice will disagree.
- `kind: "switch"` is the only kind that may be pinned; the UI enforces it, not the person.
- `scope` decides where the value is written and what the row's grey word says.
- `tray.mode: "most_used"` ranks by flip count on this counter over 30 days; `"chosen"` freezes `chosen`, seeded from the current effective set.
- Deviation from `shopDefault` is computed, never stored as a flag.
- Every change writes `{ settingId, from, to, by, at }` — a shared till needs to answer "who changed the bill number?"

---

## 9. Behaviour

1. Settings opens and saves offline; counter-scoped values are local, shop-scoped ones are read-only here.
2. A failed save reverts the row and says so on the row — never a toast that has gone by the time you look up.
3. Search matches label, value and section name, and shows the section as context on each hit.
4. Technical stays folded until opened, and closes again on reopen.
5. A setting the person may not change renders read-only with who to ask — never hidden.
6. Flipping a switch never blocks a sale, and never opens a modal except the one mid-bill question in §5.

---

## 10. Acceptance checks

1. No tabs. One scrolling list with a find box that matches labels **and** values.
2. Every row shows its scope; the phrase "Kept on this device." appears nowhere.
3. Nothing saves on a button — every row saves as it changes, and the footer holds only Close.
4. Voice on/off is visible and reachable from the till without opening anything, and stops in one tap.
5. The tray opens from the header, shows each switch's state in words, and lists its shortcut.
6. Turning kitchen tickets on mid-bill asks about the bill in hand.
7. Quick keys and the shop's tax block are one line each, with a link out — no second editable copy anywhere.
8. "Clear and reload" does not appear in Settings.
9. The bill-number warning carries the button that fixes it; the UPI row carries Test ₹1 and shows a verified date after it passes.
10. Pinning is limited to switches, capped at six, and the tray says when it differs from the shop's set with one way back.
11. The settings list is in the same order on every counter in the shop.
12. At 390 px everything is reachable — Settings as a sheet, the tray as a bottom sheet, the mic still in the header.

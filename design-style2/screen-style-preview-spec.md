# Screen style — spec

Replaces the current **Screen style** dialog, whose "Preview" shows six product tiles.

Designs: `png/StyleStudio.png` (wide), `png/StylePresets.png` (starting styles), `png/StylePhone.png` (phone).
Source for exact colours and sizes: `source/Style*.dc.html` — reference only, never ship.

---

## 1. Why the current preview does not work

The preview shows quick-key tiles only. Of the seven settings, **five change nothing you can see there**:

| Setting | Visible in today's preview? |
|---|---|
| Preset | no — nine text pills, no picture of what each one is |
| Layout (horizontal / vertical / compact / tablet / phone / handheld) | **no** — the preview is always the same grid |
| Tile style | partly — the only thing that does change |
| Quick keys picker (popup / drawer / full screen / …) | **no** |
| Theme | partly — tile backgrounds only, not the screen |
| Density | **no** |
| Photos | partly |

Other gaps: no before/after, no sense of real size (the preview is a fragment at an unrelated scale), no way to try it on the counter and get out again, and **Apply** does not say what it applies to. The tile prices also read "₹352.00 / each", which is list styling, not tile styling.

Rule for the rebuild: **a style preview must show the whole screen.** If a setting cannot be seen in the preview, the preview is wrong, not the setting.

---

## 2. The screen (`StyleStudio`)

Two columns under one header, one footer.

**Header** — "Screen style", then in plain words what is being changed: *Counter 1 · horizontal terminal · 1600 × 900 · you are changing only this counter*. On the right, an amber pill counting unapplied changes, and Close · Esc.

**Left column, 560 px — the settings.**

- A **starting-from** card at the top: small thumbnail, the preset's name, and **See all 9 ▸** which opens the gallery (§3).
- Then one row per setting: a short bold label with a one-line hint underneath (Layout / *where things sit*), and the options as chips that wrap. Colour options carry a real swatch; the others do not.
- Setting names are what a shopkeeper would say, not what the code calls it:
  `Layout` · `Quick keys` (how a tile looks) · `Groups open` (how you switch) · `Colours` · `Size` (text and spacing) · `Photos` (where pictures show).
- At the bottom, the **cost of the current choice** in plain numbers: *photos add about 18 MB to keep offline and roughly 0.4 s to a cold start; quick keys drop from 8 to 6 in a row.*

**Right column — the preview.**

- A toolbar: **device tabs** (Terminal / Tablet / Phone) so a style can be checked on any size from one place; a **Now | After** switch; **Full size** which opens the miniature at 100%.
- The miniature is **the whole sell screen** in a device frame: header with search, group chips with counts, the quick-key grid at the real number of columns, the bill panel with the reference basket (5 × ₹64 + 5 × ₹163 + 5 × ₹352 = ₹2,895.00, saved ₹144.75, **total ₹2,750.25**), the pay row, the shortcut bar and the sync line. Under it, the true scale: *real screen 1600 × 900 · shown at 59%*.
- Below, two cards: **What changes on this counter** — one line per change, in consequences not settings ("6 keys in a row instead of 8, so 12 fit instead of 16") — and **Stays the same**, which says that keys, shortcuts, prices and the day are untouched, plus the live note *someone is selling on this counter — the change waits until the bill in hand is finished*.

**Footer** — `Reset to the shop's style` · `Cancel · Esc` · **`Try it for 10 minutes`** (amber) · **`Apply to Counter 1 ▾`** (green). The dropdown on Apply chooses the scope: this counter · every counter of this device type · the whole shop. Scope is never implicit.

---

## 3. Starting styles (`StylePresets`)

Nine presets as **pictures, not pills**: each card is a small wireframe of that whole screen drawn in that theme's colours, so "Kiosk · vertical" and "Handheld · scan first" are recognisable at a glance. Each card carries a one-line "what it is good for", three tags (layout · picker · theme) and, where it applies, a badge — *on this counter now* or *used by 2 counters*. Filters across the top: All · For this device · Used in this shop · Easy to read. Choosing a card loads it into the preview; nothing changes on the counter until Apply.

A preset is just a set of the same settings. Choosing one then changing a setting leaves the card marked *based on Counter classic · edited*.

---

## 4. Phone (`StylePhone`)

Mobile-first, and the layout that gets written first.

- The preview sits **at the top and stays there** while the settings scroll under it — you never lose sight of what you are changing.
- Under it, a plain-words summary: *3 changes: photos on the keys · 3 in a row instead of 4 · bottom sheet for groups*.
- The settings are 56 px rows — name, hint, current value, chevron — opening a sheet of options. A row whose value has changed is tinted amber, so the diff is visible without a compare mode.
- Sticky footer: Cancel · Try 10 min · **Apply to this phone**.

---

## 5. Behaviour

1. **Nothing applies until Apply.** Changing a setting only changes the preview. The header counts what is pending.
2. **Try it for 10 minutes** applies the style to the real screen with a small floating bar: *Trying "Counter dark" · 9:41 left · Keep it · Put it back*. It reverts on its own if nobody keeps it, and reverts on a crash or a reload. This is what makes a big visual change safe on a live counter.
3. **Never mid-bill.** If a bill is in hand, the change queues and lands when that bill is saved or cleared. The screen says so before you apply.
4. **Scope is explicit** on the Apply button, and the confirmation names it: *Counter dark is now on all 3 counters of this shop.*
5. **Reset to the shop's style** returns to whatever the back office set, and says what that is.
6. The preview is the **real components at a smaller scale**, not a drawing — one renderer, one source of truth, so it cannot drift from the screen. Render it in a container-query wrapper at a fixed transform scale; never a screenshot.
7. **Full size** opens the same preview at 100% with the settings in a drawer, for checking text size on the actual panel.
8. **Style is only appearance.** It may never change what a button does, a shortcut, a price, or what is on the bill. Anything that would is a setting, not a style.
9. Five states apply here too: loading (skeleton miniature), error (say which setting failed to load), offline (styles are local — all of this works with no network), no permission (read-only, Apply hidden with one line saying who can change it).

---

## 6. Data

```json
{
  "scope": { "level": "counter | deviceType | shop", "id": "counter_1" },
  "preset": "counter_classic_light",
  "style": {
    "layout": "horizontal | vertical | compact | tablet | phone | handheld | auto",
    "tile": "name | colour | monogram | row | hotkey | photo",
    "picker": "popup | drawer | fullscreen | sheet | tabs | rail | timeline",
    "theme": "lightCream | dark | paper | navy | highContrast",
    "density": "roomy | comfortable | tight | bigText",
    "photos": "keys | list | both | none"
  },
  "trial": { "active": true, "endsAt": "2026-09-19T15:52:00Z", "revertTo": { } }
}
```

- Resolution order: **counter → device type → shop → app default.** Each screen shows which level its value came from when it is not the counter's own.
- Stored locally first and synced like everything else; a style set offline applies immediately on that counter and syncs later.
- `preset` is a shortcut that writes all six `style` keys; editing one keeps the preset name with "· edited".

---

## 7. Acceptance checks

1. Changing **any** of the six settings visibly changes the miniature.
2. Switching the device tab re-renders the miniature at that device's real proportions, with the correct scale label.
3. Now / After swaps between the applied style and the pending one, with nothing else moving.
4. Apply with scope "all counters of this type" changes exactly those counters and names them in the confirmation.
5. Try for 10 minutes reverts by itself, reverts on reload, and leaves no trace in the applied style.
6. Applying while a bill is in hand queues the change and applies it the moment that bill is saved.
7. With the network off, everything above still works.
8. A user without permission sees the preview and no Apply, with one line saying who can change it.

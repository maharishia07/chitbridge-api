# Combo chooser — spec

Replaces the current **Choose** modal (the one whose button reads *"Choose Choose a tiffin and Choose a drink"*).

Designs: `png/ComboPlate.png`, `png/ComboUsual.png`, `png/ComboPhone.png`, `png/ComboWords.png`.
Source for exact colours and sizes: `source/Combo*.dc.html` (mockup format, never ship it).

---

## 1. What is wrong with the screen today

| Today | Why it hurts |
|---|---|
| Button label built by joining group names → "Choose Choose a tiffin and Choose a drink" | Reads as a bug to the customer standing at the counter. The label must be written, never concatenated. |
| That button is pale/disabled while picks are missing | A dead button gives no way forward and no reason. |
| Title is just "Choose" | Says nothing about what is being made. |
| "must choose" in red next to every group | Scolds, repeats, and still does not say *how many*. |
| "With" as a heading | Nobody at a counter says "with". |
| "₹25.00 under separately" | Reads backwards. Show the separate price, then the saving. |
| Picks are outline pills, all identical | No sense of what is chosen, what is sold out, or what costs more. |
| No running total | The price only appears after the modal closes. |

---

## 2. Two ways to open it — pick one per shop (back office setting)

**A · Build the plate** (`ComboPlate`) — every pick made on purpose.
Numbered steps, one open at a time, a live **On the plate** panel on the right, combo price vs separate price, and a button that always names the next thing. Use where combos genuinely vary (thali, party packs, build-your-own).

**B · Ready to go** (`ComboUsual`) — the combo arrives pre-filled with what the shop sells most; the counter only **swaps** what the customer wants changed. Tapping a line opens its alternatives inline. The primary button is green and live from the first second. Use where 80% of orders take the default. This is the faster of the two and removes the disabled-button problem entirely.

Both read the same combo definition. Same words, same colours, same keys.

**Phone** (`ComboPhone`) — bottom sheet, mobile-first: step chips, finished steps folded to one line with **Change**, the open step as full-width 60 px rows, sticky footer with the running price and the same state-aware button.

---

## 3. The primary button — one button, five states

| When | Label | Style |
|---|---|---|
| Nothing picked | `Pick a tiffin to start` | amber `#E0A020`, ink `#1D1B16` |
| One step left | `Pick a drink to finish` | amber |
| Ready | `Add to bill · ₹180.00` | green `#16693F`, white ink |
| Ready, extras on | `Add to bill · ₹195.00` | green |
| A pick went sold out | `Idli is sold out — pick another tiffin` | danger tint `#FBEAE3` / `#E7B9A8`, ink `#8E3517` |

Rules:

1. **Never disabled.** In the amber states the button is live; tapping it scrolls to the unfinished step and opens it.
2. The label names **one** missing thing, singular, in plain words. If two steps are missing, name the first: *"Pick a tiffin to start"*.
3. Green means the tap really adds the line. The amount on the button is the amount that lands on the bill.
4. Build the label from a template per state — never by joining group names.

```
missing.length === 0  →  `Add to bill · ${money(total)}`
missing.length  >  0  →  `Pick ${article(missing[0].noun)} to ${picked ? 'finish' : 'start'}`
soldOutBlocking       →  `${item.name} is sold out — pick another ${group.noun}`
```

Each group therefore carries a **noun** ("tiffin", "drink", "sweet") used in the button and the step title. Not a sentence, not "Choose a tiffin".

---

## 4. Words

| Instead of | Say | Why |
|---|---|---|
| Choose | **Build the plate** (title) | Says what the customer walks away with. |
| Choose a tiffin | **The tiffin** | The step is a thing; the verb lives on the button. |
| must choose | **one of these** | Says how many without scolding. |
| (nothing on optional groups) | **skip if not** | So nobody hunts for a required pick. |
| With | **Anything with it?** | How the counter actually asks. |
| ₹25.00 under separately | **Separately ₹205.00 · they save ₹25.00** | Reads out loud to a customer. |
| Cancel | **Cancel · nothing is added** | Says the consequence. |
| (disabled grey button) | amber button naming the next pick | Always a way forward. |

Multiple picks in one group: **"as many as you like"**, or **"any 2"** / **"up to 3"** when the combo limits it. The step's right-hand state text then shows `1 of 2 picked`.

---

## 5. Behaviour

1. **Required vs optional visible on the step**, as a tag pill — no red asterisks, no repeated "must choose".
2. **Pre-picks.** A combo may mark a default per group (`defaultItemId`). Setting B always uses them; setting A may. Any pre-pick can be swapped or cleared, and is shown like any other chosen item.
3. **Sold out is shown, not hidden**: greyed card, name struck through, note "sold out today". It cannot be picked. Staff then know why a favourite is missing. Sold-out state comes from the same per-counter temporary list as the quick keys.
4. **Price moves live.** Upgrades (`+₹15.00`) and extras change the total on the button before the tap, never after. Combo price, separate price and the saving all recompute together.
5. **Editing after it is on the bill.** Tapping the combo line on the bill reopens the chooser with its picks in place; changing a pick **edits that line** — it never adds a second one. The line on the bill shows the combo name with its picks as sub-lines.
6. **Keyboard:** `1–9` pick inside the open step · `Tab` next step · `Enter` add to bill (only when ready) · `Esc` close, nothing added. A barcode scan inside the sheet picks that item if it belongs to the open step; otherwise it is ignored with a short "not part of this combo" note.
7. **Offline the same.** Combo definitions cache with the products. Picking, adding, editing and pricing all work with no network.
8. **Five states** like every other screen: loading, empty (combo has no groups → say so and offer the plain item), error, offline, no permission.

---

## 6. Data

```json
{
  "id": "combo_tiffin",
  "name": "Tiffin Combo",
  "price": 18000,
  "mode": "steps | usual",
  "groups": [
    {
      "id": "g_tiffin",
      "noun": "tiffin",
      "title": "The tiffin",
      "min": 1, "max": 1,
      "defaultItemId": "p_masala_dosa",
      "items": [
        { "itemId": "p_masala_dosa", "upcharge": 0 },
        { "itemId": "p_ven_pongal", "upcharge": 1000 }
      ]
    },
    { "id": "g_drink", "noun": "drink", "title": "The drink", "min": 1, "max": 1, "items": [] },
    { "id": "g_extras", "noun": "extra", "title": "Anything with it?", "min": 0, "max": 9, "items": [] }
  ]
}
```

- All money in **integer minor units** (paise). `price` is the combo price; `upcharge` adds to it; extras add their own price.
- "Separately" = sum of each picked item's own menu price + extras. The saving is that minus the payable total; if it is ≤ 0, hide the saving line rather than showing a negative.
- `min`/`max` drive the tag pill: `1,1` → "one of these"; `0,n` → "skip if not"; `2,2` → "any 2"; `1,n` → "one or more".
- `noun` is required and is what the button says.

---

## 7. Sizes

| | Wide (terminal) | Tablet | Phone |
|---|---|---|---|
| Sheet | centred modal 1120 px wide, scrim `rgba(29,27,22,0.55)` | same, 92% width | bottom sheet, full width |
| Item card | 4 per row, 92 px tall | 3 per row | 1 per row, 60 px rows |
| Primary button | 60 px | 56 px | 58 px, sticky |
| Finished step | stays open | folds | folds to one line + **Change** |

Targets ≥ 44 px (48 on phones). Contrast ≥ 4.5:1 — the amber button uses dark ink, never white.

---

## 8. Acceptance checks

1. The primary button never contains a group title, and never two of them.
2. With nothing picked, tapping the button opens the first unfinished step.
3. Picking the last required item turns the button green in the same frame, with the right amount.
4. Selecting an extra changes the button amount and the footer total together.
5. Marking an item sold out from another counter, while the sheet is open, clears that pick, reopens the step and shows the sold-out button state — without touching the bill.
6. Reopening a combo already on the bill shows its picks; changing one edits the line and does not add a second.
7. Esc and Cancel both close with nothing added, at any point.
8. Everything above works with the network off.

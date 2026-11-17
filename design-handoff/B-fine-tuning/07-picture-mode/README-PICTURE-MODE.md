# 07 · Picture mode — give this file to the CLI first

For a seller who cannot read the screen. Not English, not the local script, not at all.

Unzip into the repo as `design-handoff/picture-mode/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `picture-mode-spec.md` | The whole spec: what survives when reading does not, the sell screen, change as notes, hold-to-confirm, hold-to-hear, how they learn it, **what it overturns elsewhere**, data shape, acceptance checks. |
| 2 | `png/NoRead.png` | The four principles, the wordless sell screen, the three mechanisms, the six ways they learn, and the reversals. Build this. |
| 3 | `source/NoRead.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship this file.** |

## The change in one line

**Digits, pictures, position and voice. Everything else is decoration.** Four things survive when reading does not, and every decision follows from them.

## The four, and what each forces

1. **Digits** — numbers are learned long before letters and are the same in every script. → The total is the biggest thing on the screen.
2. **Pictures** — a photo is read instantly by anyone; without one a key is a word, and a word is nothing. → Photos are not a setting here. On, and large. The card shape from folder 06 is the default, not an option.
3. **Position** — the hand learns idli is top-left long before the eye learns the word. → **The keys must never move by themselves. Ever.**
4. **Voice** — speaking back is how a total is checked when it cannot be read. → Voice out is on by default and reads the total.

## Three mechanisms that replace reading

- **Hold instead of a warning.** A sentence cannot stop a hand that cannot read it; a two-second hold can. The button fills, the counter speaks the consequence, letting go cancels.
- **Hold anything to hear what it is.** One gesture replaces every help screen, tooltip and label. Hold a key → "Idli, two pieces, forty rupees." Hold a button → what it does, *without doing it*. **There is no other help in the product.**
- **Change as notes and coins.** "₹320" asks for arithmetic in front of a queue. `[₹200][₹100](₹10)(₹10)` does not — and the customer can check it too.

## How they learn it — the answer to the question

Not from a manual, a tour or a tooltip. From doing one real sale beside someone who already knows, and then from the screen never changing under them. Six things make that possible, in spec §6: someone shows them once · the first sale is the lesson · holding asks · pressing is safe · nothing moves · the owner sets it up, not the worker.

## This overturns things elsewhere in the package — read spec §7

The important one: **"most used first, recounted every night" is off here.** A grid that reorders itself overnight is the single most damaging thing you can do to someone who navigates by position — it erases a week of learning in one night. Fixed order is the default and the nightly recount is *disabled*, not merely unselected.

Also: photos stop being a tray switch, confirm sheets become holds, voice out moves from "plan it separately" to the front of the queue, and no free-text field appears on the seller's screen.

## Rules this screen inherits from the rest of the package

1. **Never break a sale.**
2. Colour never carries meaning alone — **and neither does text.** Position, icon, number and voice each carry it too.
3. Every destructive path is recoverable: one tap plus ten seconds of undo, or a hold. Never a dialog to read.
4. **Mobile-first**, and targets ≥ 44 px (48 on phones).
5. Nothing on the seller's screen opens a screen that needs reading.

## Paste-ready start

```
Read EVERY file in design-handoff/picture-mode/ first — every .md and every .png — before writing any code.
Read design-handoff/picture-mode/README-PICTURE-MODE.md, then picture-mode-spec.md and png/NoRead.png.
First: tell me every place in the app today where meaning is carried by words alone and by nothing
else — buttons, empty states, confirmations, errors, the bill lines. That list is the work.
Then propose the pictureMode flag from spec §8 and what it forces, and wait for approval.
After approval build in this order: (1) voice out reading the total, (2) thumbnails and pips on
bill lines, (3) hold-to-hear, (4) hold-to-confirm replacing the confirm sheets, (5) change as
notes, (6) the first-sale walkthrough.
Run the acceptance checks in picture-mode-spec.md §9. Then show me the sell screen with every
word removed and tell me honestly whether it is still usable.
```

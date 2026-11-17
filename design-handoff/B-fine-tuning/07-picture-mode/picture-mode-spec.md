# Picture mode — for someone who cannot read the screen

The seller may not read. Not English, not the local script, not at all. The counter still has to work, and they still have to learn it.

Design: `png/NoRead.png`. Source: `source/NoRead.dc.html` — reference only, never ship.

> This is not an accessibility afterthought bolted on at the end. It changes what the default screen is, and it **overturns several decisions made elsewhere in this package** (§7).

---

## 1. What survives when reading does not

| | Survives | Why | What follows |
|---|---|---|---|
| **1** | **Digits** | Numbers are learned long before letters and are the same in every script | The total is the biggest thing on the screen |
| **2** | **Pictures** | A photo of the dish is read instantly by anyone; without one a key is a word, and a word is nothing | Photos are not a setting here — on, and large |
| **3** | **Position** | The hand learns that idli is top-left long before the eye learns the word | **The keys must never move by themselves. Ever.** |
| **4** | **Voice** | Speaking back is how a total is checked when it cannot be read | Voice out is on by default and reads the total |

Everything else on a screen — labels, helper text, tooltips, empty-state sentences, confirmation prose — is decoration to this person. It may still be there for the half of counters that have a reader. It may never be the **only** thing carrying a meaning.

---

## 2. The sell screen

```
┌─────────────────────────────────┐
│  [photo]   [photo]   [photo]    │   product cards, 5 : 7, photo 62%
│  Idli      Dosa      Vada       │   name small and grey — for the reader
│  ₹40       ₹55       ₹30        │   price large and mono — for everyone
│  [photo]   [photo]   [photo]    │
│  Pongal    Coffee    Tea        │
│  ₹50       ₹20       ₹15        │
├─────────────────────────────────┤
│  [ID] ●● 2              ₹80  −  │   the bill: a thumbnail per line
│  [DO] ●  1              ₹55  −  │   quantity as pips AND a digit
│  [CO] ●● 2              ₹40  −  │
├─────────────────────────────────┤
│  🔊                      ₹180   │   the total, 34 px, mono, green
├─────────────────────────────────┤
│  [ 💵 cash ] [ 📱 phone ] [ 🖨 ] │   three icons, one green
└─────────────────────────────────┘
```

- **Cards, not tiles.** The card shape from folder 06 is the default presentation here, at the largest size the screen fits — not an option.
- **A picture on every bill line.** Today a line is text. Here it carries the product's thumbnail, so a wrong line is spotted without reading.
- **Quantity as pips and a digit.** Up to five dots, then the digit alone. Counting is available to everyone; "×3" is not.
- **The total is the loudest thing on the screen**, and the speaker icon beside it means "hear it".
- **No search box.** Typing is not available to this person. Navigation is the grid, the category chips (icon + photo, not words) and the microphone.
- **`−` removes a line.** One tap, with ten seconds of undo — never a confirm dialog.

---

## 3. Change, as notes and coins

"₹320 change" asks for arithmetic in front of a queue. A picture does not.

```
taken  ₹500                         give back  ₹320
[ ₹200 ] [ ₹100 ] ( ₹10 ) ( ₹10 )
```

- Notes as rectangles, coins as circles, at the denominations the shop actually holds.
- Greedy from the largest denomination, then adjusted to what the drawer has if the drawer is counted.
- The customer can check it at a glance too, which is the real win.
- Shown on the pay screen and printed on the bill.

---

## 4. Hold, instead of a warning

A sentence cannot stop a hand that cannot read it. **A two-second hold can.**

- The button fills from the bottom over 2 s. Letting go cancels. Completing acts.
- While it fills, the counter **speaks the consequence**: *"Closing the counter. Ninety-six bills sent. Nothing waiting."*
- The live numbers stay on screen as numbers — nobody has to read them, and a reader still can.
- Destructive holds (refund, repair) fill in a different colour and take 3 s.

**This replaces the confirm sheets in folder 01 on a picture-mode counter.** The sheet's content does not change; its input does.

---

## 5. Hold anything to hear what it is

One gesture replaces every help screen, every tooltip and every label nobody can read.

| Hold | It says |
|---|---|
| a key | "Idli, two pieces, forty rupees." |
| a bill line | "Two idli, eighty rupees. Let go to keep it." |
| the total | "One hundred and eighty rupees." |
| any button | what it does — **and it does not do it** |

- One second to start speaking; releasing before the action threshold never acts.
- In the shop's language, from the same voice as speaking-back.
- **There is no other help in the product.** No tour, no tips, no "?" icons.

---

## 6. How they learn it

Not from a manual, a tour or a tooltip. From doing one real sale beside someone who already knows, and then from the screen never changing under them.

1. **Someone shows them, once.** The realistic path. So every action must be visible and imitable — no hidden gesture, no long-press-only action, nothing that cannot be pointed at. (Hold-to-hear is the one exception, and it is taught in step 2.)
2. **The first sale is the lesson.** On a new counter the first bill runs with a finger outline on the next thing to press. It is a real sale, not a tour, and it ends when the bill is paid. It can be replayed from the owner's screen, never from the seller's.
3. **Holding asks, instead of a help screen.**
4. **Pressing is safe.** They learn by pressing. Nothing destructive happens on a first press; every screen has one big way back; the last action can be undone for ten seconds.
5. **Nothing moves.** Same key, same square, same colour, every morning.
6. **The owner sets it up, not the worker.** Every screen that needs reading — settings, the shop, reports, the hub — sits behind the owner's sign-in. The seller's screen has none of it.

---

## 7. What this overturns elsewhere in this package

| Was | Now, on a picture-mode counter |
|---|---|
| "Most used first, recounted every night" *(folder 02)* | **Off.** A grid that reorders itself is the single most damaging thing you can do to someone who navigates by position. **Fixed order is the default**, and the nightly recount is disabled, not just unselected. |
| Photos as a switch in the tray *(folder 04)* | Not a switch. On, at the largest size that fits. The card shape is the default presentation. |
| Confirm sheets with a sentence *(folder 01)* | Hold-to-confirm, with the sentence spoken instead of printed. Same content, different input. |
| Voice out as a capability to plan separately *(folder 05, banded D)* | **Core.** Without it there is no way to check a total. It moves to the front of the queue. |
| "Find a setting" boxes, search by typing *(folders 02, 04)* | Never on the seller's screen. |
| Careful wording as the fix *(everywhere)* | Still worth doing — half these counters have a reader — but wording can never be the only thing carrying a meaning. |

---

## 8. Data

```json
{
  "counter": {
    "pictureMode": true,
    "language": "ta-IN",
    "readingLevel": "none | numbers | full"
  }
}
```

Turning `pictureMode` on forces, and locks on the seller's screen:

- `keyStyle.shape = "card"`, `photos = on`, `minWidth` at the largest the screen fits
- `categoryOrder.mode = "fixed"`, and the nightly recount **disabled**
- `voice.speaking = true`, `voice.hearing = true`
- confirmations render as hold-to-confirm
- quantity shows pips, change shows notes
- the search box and every free-text field are hidden from the sell screen

`readingLevel: "numbers"` is the common middle case — digits yes, words no. It keeps prices and totals as they are and applies everything else in this spec.

The owner can turn each one back on individually, from the owner's screen, and the seller cannot.

---

## 9. Acceptance checks

1. With `pictureMode` on, the sell screen contains no control whose meaning is carried by words alone.
2. The keys are in the same position after a restart, after a day, and after the nightly job runs.
3. Every bill line shows a thumbnail, pips up to five, a digit, and an amount.
4. The total is the largest element on the screen and is spoken when the speaker is pressed.
5. Holding any key for one second speaks its name and price and adds nothing.
6. Holding any button speaks what it does without doing it.
7. Refund, close the counter and repair are hold-to-confirm, speak while filling, and cancel on release.
8. Removing a line takes one tap and offers ten seconds of undo — no dialog.
9. Change is shown as notes and coins on screen and on the printed bill.
10. Nothing on the seller's screen opens a screen that requires reading; those are behind the owner's sign-in.
11. The first-sale walkthrough runs once on a new counter, uses a real bill, and can be replayed only by the owner.
12. With `pictureMode` off, nothing in this spec is visible and the rest of the package is unchanged.

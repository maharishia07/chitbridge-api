# The headers — the sell screen and the panel

One header component, used in both places, at three densities. Also: the pill system, the person block, voice both ways, and the panel's card grid.

Designs: `png/HeadTwo.png` (the component and how it folds), `png/HeadRules.png` (the parts).
Source: `source/Head*.dc.html` — reference only, never ship.

---

## 1. What is wrong today

There are two headers, they carry the same facts, and they speak two dialects.

| | Sell screen | Panel |
|---|---|---|
| Leads with | the shop | the counter |
| The line | `online` | `● online · all sent` |
| Needs you | `⛔ check` (red) | `2 need you` (amber) |
| The person | `👤 nobody signed in` (red pill) | a red card floating over the header band |
| Way out | nothing | `✕` |

1. **Each leads with a different name.** The sell screen says the shop; the panel says the counter.
2. **The shop's name is 10 px grey in the panel.** It is what is printed on every bill and what the customer reads.
3. **"Nobody signed in" is red and floated over the header band.** It degrades the record; it does not stop a sale.
4. **Six pills in four colours** on the sell screen, in no order the eye can learn.
5. **`prices as at 12:28 · 74 h old`** is whispered in grey. Three-day-old prices cost money, and "74 h" is a unit nobody thinks in.
6. **`today 0 · ₹0.00`** is the most important number on the screen and the smallest thing on it.
7. **No menu anywhere**, and two different ways out.

---

## 2. The five zones

One order, everywhere, so the eye learns it once.

| | Zone | Holds |
|---|---|---|
| 1 | **Who** | the shop, then counter · mode · date · time |
| 2 | **How it is** | up to three status pills |
| 3 | **How much** | today's take and the bill count |
| 4 | **Who is on** | the person block |
| 5 | **Way out** | mic · switches · menu (sell) or ✕ (panel) |

### Zone 1 — the shop leads, the counter follows

```
Mayur Bhavan                                ← display face, 21 px, 800
Counter 1 · Sell · Mon 21 Sep · 2:14 pm     ← 12 px, muted, the clock ticks
```

- The shop's name is the title. It is what is printed on every bill and what the customer reads.
- Counter, mode, date and time are one quiet line under it — **who and where, not what**.
- 12-hour clock, live. Short date: *Mon 21 Sep*, never "Sept".
- The same block, same order, in the sell header and in every panel. **One component, not two.**
- With one counter, `Counter 1 ·` drops out of the line by itself. Nobody should read a number that never varies.

### Zone 3 — how much

```
₹8,450.00
today so far · 42 bills
```

Mono, 20 px, right-aligned, the largest number in the header. With nothing sold: **₹0.00 · no bills yet today** — a fact, not an error.

### Zone 5 — the way out

Sell: the mic, the switch tray (⚡ / F12), the menu (☰). Panel: the same, plus ✕. The mode ("Sell") lives in the subtitle and is changed from the menu, not from a dropdown in the brand slot.

---

## 3. The pills

**If pressing it does nothing, it is not a pill** — it is a label, and labels belong in the body. Three at most, always in this order.

| | May be a pill | Why |
|---|---|---|
| ✓ | The line | press it and see what still works |
| ✓ | Waiting to send | only when it is not zero, and it opens the queue |
| ✓ | Needs you | the count, opening the Check list |
| ✓ | Stale prices | only past a day old, and it carries **Re-read · F4** |
| ✕ | 113 products | not a status and not actionable — the products screen |
| ✕ | Counter 1 | who you are, not how you are — it belongs in the subtitle |

### The colour ladder

| Pill | When |
|---|---|
| `● all sent` green | nothing to do — green, and quiet |
| `3 waiting` amber | working, and waiting. Normal, not a fault |
| `prices 3 days old` amber | costs money if ignored — carries its own fix |
| `billing stopped` red | a sale cannot be taken right now. **Only this earns red** |

### The words

| Instead of | Say |
|---|---|
| 74 h old | **3 days old** |
| prices as at 12:28 | **prices 3 days old · Re-read F4** |
| online | **● all sent** (the line and the queue in one) |
| ⛔ check | **2 need you** (amber, and it says how many) |
| today 0 · ₹0.00 | **₹0.00 · no bills yet today** |
| Mon 21 Sept | **Mon 21 Sep** |
| 113 products | *(leaves the header)* |

---

## 4. The person block — four states

| State | Shows | Action |
|---|---|---|
| **Signed in** | initials, name, *on since 9:41 am · 4h 33m* | Hand over |
| **Nobody signed in** | "?" avatar, *bills say "no person recorded"* — **amber, never red** | **Sign in · F7** |
| **The shop's name as the person** | the bug the header has today | — |
| **Signing in** | initials, *signing in…* | — |

- How long they have been on is what a hand-over needs, and nothing else in the product shows it.
- The shop's name is never the person — the same hole that wrote `desktop3` onto four bills.
- A sign-in never blocks the till. It settles in the background and the bills before it keep their person.

---

## 5. Voice is two switches, not one

Hearing you and speaking back are different jobs with different reasons to stop. A noisy kitchen wants to be heard and not answered; a counter whose eyes are on the customer wants the opposite.

```
Hold the mic · or F5                                       🎤 🔊

  🎤  Hearing you      on · English (India) · starts when the line is empty   F5    [●  ]
  🔊  Speaking back    on · the total and the amount to collect              Sh F5  [●  ]

      ☑ each item added   ☑ the running total   ☑ amount to collect
      ☐ every change      ☐ the bill number
```

1. **Speaking back stops the instant the mic starts hearing.** It never talks over the person.
2. **It never reads a customer's name, phone or address aloud** — there is a queue standing there.
3. **Short form in a rush:** "forty", not "the total is forty rupees only".
4. **One language choice serves both.** Volume is remembered per counter.
5. **Muted is not off:** muted still shows on screen what it would have said, so nothing is missed.
6. **The header icon carries both** — a mic, and a small speaker beside it when it answers.
7. Tap the mic = hearing on/off. Hold = this panel. **`F5` = hearing, `Shift F5` = speaking.** F4 stays “re-read the shop”, F9 stays “save & print”, F6 stays “park”, F3 stays “kitchen ticket”.

---

## 6. How it folds

Nothing is ever removed — it moves into the panel body, where it has room to say more than a pill can.

| Width | What changes |
|---|---|
| **1280 px +** | Everything shows. Five zones, one row, 56 px tall. |
| **1024 px** | The mode ("Sell") leaves the subtitle and becomes the ☰ menu's first item. |
| **820 px** | Pills and the day's take drop to a second row under the identity; the person stays up. |
| **600 px** | The person loses their subtitle, keeping the avatar, the name and Sign in. |
| **390 px** | Pills merge into one — a coloured dot and a count. The name becomes an avatar; the take moves into the body. |

---

## 7. The panel's cards

While we are here — the hub panel's eight cards:

1. **One icon family** — 24 px grid, 1.8 stroke, one weight, on a tinted square — not eight little pictures in eight styles.
2. **Every card ends in a number**: *₹8,450 · 2 · GSTIN · not open*. A menu of nouns tells you nothing you did not already know.
3. **A badge only when it is not zero**, and its colour is the ladder's, never decoration.
4. **Three nouns in a subtitle, never four.** If it needs four, it is two cards.
5. **One inline action style or none** — "Preview" cannot be the only teal thing in the product.
6. **The panel is as tall as its cards.** Three hundred pixels of nothing reads as a screen that failed to load.

---

## 8. Data

```json
{
  "header": {
    "shop": { "name": "Mayur Bhavan" },
    "counter": { "id": "C1", "name": "Counter 1", "onlyOne": false },
    "mode": "sell",
    "now": "2026-09-21T14:14:00+05:30",
    "pills": [
      { "id": "line", "level": "ok", "label": "all sent", "action": "openQueue" },
      { "id": "prices", "level": "warn", "label": "prices 3 days old",
        "action": "rereadShop", "actionLabel": "Re-read", "shortcut": "F4" },
      { "id": "checks", "level": "warn", "label": "2 need you", "action": "openChecks" }
    ],
    "today": { "takeMinor": 845000, "bills": 42 },
    "operator": { "userId": null, "name": null, "sinceAt": null },
    "voice": { "hearing": true, "speaking": true, "language": "en-IN",
               "speaks": ["item", "total", "collect"] }
  }
}
```

- **One header registry** produces both headers. A pill defined twice will say two things.
- `pills` is capped at three and ordered by the registry, never by arrival.
- `level` is `ok | warn | stop`; only `stop` renders red, and only when a sale cannot be taken.
- `counter.onlyOne` true drops the counter from the subtitle.
- `operator.userId: null` renders the amber "Nobody signed in" block. The shop name and device name are never substituted.
- `today` is recomputed locally; it never waits for the line.

---

## 9. Acceptance checks

1. The sell header and the panel header are the same component, with the same zone order and the same words.
2. The shop's name is the title in both, in the display face, with counter · mode · date · time beneath it.
3. The clock ticks, is 12-hour, and the date reads *Mon 21 Sep*.
4. No more than three pills, in the fixed order, and every one of them does something when pressed.
5. No red in either header unless a sale has stopped. "Nobody signed in" and "N need you" are amber.
6. Stale prices appear only past a day old, say the age in days, and carry Re-read · F4.
7. "113 products" appears nowhere in a header.
8. Today's take is the largest number in the header and reads *₹0.00 · no bills yet today* when empty.
9. The person block shows time-on-shift when signed in, and never shows the shop or device name as the person.
10. The mic toggles hearing in one tap and holds open a panel with both switches; speaking stops while hearing is active.
11. At 1024, 820, 600 and 390 px everything is still reachable — folded, never removed.
12. Panel cards each carry a number, one icon family, and a badge only when non-zero.

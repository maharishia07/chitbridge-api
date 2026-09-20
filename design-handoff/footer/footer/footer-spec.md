# The CAREFUL footer — dissolve it

The pink strip pinned to the bottom of the counter hub:

> **CAREFUL** · These stop billing for a moment. Everything is sent and checked first.
> [ Sign out ] [ Clear and reload ] [ Close this counter ]

Design: `png/HubFooter.png`. Source: `source/HubFooter.dc.html` — reference only, never ship.

---

## 1. Why it fails

1. **A red box that is always there stops being seen.** It is the loudest thing on a calm screen, every second of every day. By the second day it is wallpaper — so when something is genuinely wrong, this strip has already spent the shop's attention.
2. **The three actions share nothing but the warning.** Sign out is hourly. Close this counter is once a day. Clear and reload is a repair nobody should ever need. They are grouped because they are all "scary", which is not a category a shopkeeper thinks in.
3. **The warning is not true of all three.** "These stop billing for a moment" describes Close this counter. Sign out does not stop billing — the next person signs in and carries on.
4. **"Everything is sent and checked first" is a promise made in the wrong place.** It is printed before the button is pressed, where it cannot be measured. At that moment it is a claim; at the moment of the press it could be a number.
5. **The most dangerous one sits at the far right**, where a hand lands by accident on a touch terminal.
6. It takes a permanent strip of the screen for something used three times a day.

---

## 2. Where each action belongs

**A footer is not a home. It is where actions go when nobody decided where they belong.** Each of these has an obvious home:

| Action | New home | Why |
|---|---|---|
| **Sign out** | the person block, in the header — beside **Hand over** | It belongs to whoever is standing there. Most frequent, least dangerous, and the header already names the person. |
| **Close this counter** → **Close the day** | the day card | Opening and closing the day are the same job at two ends. Once the day is open, that card's primary button becomes **Close the day**, and the day close sheet is one tap on. |
| **Clear and reload** → **Repair this counter** | Counter health ▸ Show technical detail | It is a repair, not a daily action, and it belongs beside the numbers that tell you whether it is needed. |

The warning does not disappear — **it travels with each action**, as one sentence at the moment the button is pressed, where it is actually read.

---

## 3. The confirm sheet that replaces the standing warning

This is the whole point of the change: the caution moves from a strip nobody reads to a sheet nobody can miss.

```
Close this counter?

Billing stops until someone opens it again. Nothing is lost.

✓ Bills sent to the shop      96 of 96
✓ Waiting to send             none
✓ Bills in hand               none
~ Cash counted                not yet — the sheet asks next

[ Not now ]                   [ Close the counter ]
```

Rules for all three sheets:

1. **A warning belongs at the moment of the act**, never standing on the screen beforehand.
2. **Say the consequence, not the adjective.** "Billing stops until someone opens it again" — never "CAREFUL", never "this is dangerous".
3. **Show the live numbers the promise depends on.** 96 of 96 sent, none waiting, none in hand. A tick with a number behind it is a promise that can be checked; "everything is checked first" is not.
4. **Name the button with the verb.** *Close the counter*, *Sign out*, *Repair this counter* — never OK, never Confirm.
5. **The safe way out is first and plain.** *Not now*, on the left, no fill.
6. **If a check fails, the sheet says so and the button changes.** With three bills still waiting: *3 bills have not reached the shop yet.* and the primary button becomes **Send 3 first, then close**. The destructive path is never simply blocked — it is reordered.

Per-action first lines:

| Action | Sheet title | Consequence line |
|---|---|---|
| Sign out | Sign out, Bala? | The counter stays open. The next person signs in to sell. |
| Close the day | Close the day? | Billing stops until someone opens it again. Nothing is lost. |
| Repair this counter | Repair this counter? | The counter reloads and reads the shop again. Takes about 20 seconds. Anything waiting is kept. |

Repair is the only one that may show a red-tinted primary, and only when something is actually waiting to send.

---

## 4. If a footer must stay (option B)

Some terminals want a persistent strip for orientation. Then make it **furniture, not an alarm**:

- One line high, ~40 px, **no fill**, a hairline `#E6E0D2` above it, page background below.
- It carries state, not commands: `Bala · Counter 1 · day open since 9:41 am`.
- **Sign out** plain on the right, no fill, no colour.
- The rare and risky things sit behind **⋯** — *Close this counter · Repair this counter · About this counter*.
- The word CAREFUL disappears entirely.

**Caution is shown by where a thing is, not by shouting.** A destructive action placed two taps deep, behind a sheet that states its consequence, is safer than one sitting in the open under a red banner.

---

## 5. Colour rule this change enforces

**Red is only for a stopped sale or work at risk.** Not for "be careful", not for "this is important", not for a permanent notice. Everything advisory is amber; everything structural is grey.

Applied here: the footer's pink `#FDF3EE` / `#F1C7AE` fill goes. Nothing in the hub is red unless a sale has actually stopped.

---

## 6. Data

```json
{
  "counter":  { "id": "C1", "name": "Counter 1" },
  "operator": { "userId": "u_12", "name": "Bala", "sinceAt": "2026-09-20T09:41:00+05:30" },
  "day":      { "state": "open | closed", "openedAt": "...", "openedBy": "u_12" },
  "closeReadiness": {
    "billsSent":    { "sent": 96, "total": 96 },
    "waitingToSend": 0,
    "billsInHand":   0,
    "cashCounted":   false
  }
}
```

- `closeReadiness` is read **when the sheet opens**, not cached — the ticks are only worth showing if they are current.
- Each row renders ✓ when clear, `~` grey when pending-but-not-blocking (cash), `!` amber when it blocks.
- `waitingToSend > 0` → primary button label becomes `Send {n} first, then close`.
- `operator.userId: null` → the Sign out control is not rendered at all; the person block shows **Sign in · F7** instead.

---

## 7. Acceptance checks

1. No standing warning banner appears anywhere in the hub. The word CAREFUL appears nowhere in the product.
2. Sign out sits with the person in the header; Close the day sits on the day card; Repair this counter sits in Counter health ▸ technical.
3. Each of the three opens a confirm sheet that states the consequence in plain words and shows live numbers read at open time.
4. With bills still waiting, the close sheet's primary button reads "Send N first, then close".
5. The safe way out is the left-hand, unfilled button on every sheet, and Esc / tapping outside does the same thing.
6. Nothing in the hub is red unless a sale has stopped or work is at risk.
7. The hub gains back the vertical space the strip occupied; nothing else moves.
8. If option B is chosen instead, the strip is one line, unfilled, carries state not commands, and the risky actions are behind ⋯.

---

## 8. Do this in order

1. Add the three confirm sheets (§3) and wire them to the **existing** footer buttons. Nothing moves yet — this alone makes the product safer.
2. Move Sign out into the person block; move Close this counter onto the day card as **Close the day**; move Clear and reload into Counter health as **Repair this counter**.
3. Delete the footer.

Each step ships on its own and is reversible.

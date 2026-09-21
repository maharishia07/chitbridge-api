# Why is a bill stuck? — verdict first, then the one button

Replaces the diagnostics panel that answers its own question in row fourteen.

Design: `png/StuckBill.png`. Source: `source/StuckBill.dc.html` — reference only, never ship.

---

## 1. What is wrong today

The panel **already knows the answer** — *"The shop refused this counter's key (401) … pair this counter again and the bills will go."* It prints it as the fourteenth row of a key-value dump, in the same type as *Rows tried: 1*.

1. **The answer is buried.** The title asks a question the top of the page does not answer.
2. **"Try now" is the loudest button and it cannot work.** The key was refused 13 seconds ago; retrying is guaranteed to fail.
3. **A 36-character database id** on a shopkeeper's screen.
4. **Four rows say things are fine** — online, paired, storage, bills stored. Fine needs one line, not four.
5. **"401"** is an HTTP status code shown to a person selling idli.
6. **"not refused — not yet attempted"** is a double negative describing a queue position.
7. **Forty words explaining "set aside"**, printed before anybody presses it.
8. **Nowhere does it say what the stuck bill is worth.** ₹40 of the shop's money is the point of the screen.
9. **"Day close sheet"** is in the footer of a diagnostics panel (see corrections §20 — day close lives on the day card).

**180 words today. 44 in the design.**

---

## 2. The order of the screen

**Verdict → the one button → the numbers → what is unaffected → folded detail.**

### The verdict

```
🔑  The shop does not accept this counter's key
    Pair it again and the bill goes. Nothing is lost.

    [        Pair this counter again        ]   ← green, 46 px

    [ ↻ Try now ]  will fail again until it is paired
```

- The cause is the headline, in the display face, with an icon that matches it.
- One line of consequence underneath, and it says *nothing is lost* — that is the question behind the question.
- **The primary button is the fix, not a retry.**
- The retry stays visible, greyed, **with the reason it will not help**. Hiding it makes people hunt for it.

### The numbers

Three, large, mono, in the order a shopkeeper asks them:

```
1            ₹40          2m
bill waiting  held here    oldest
```

Not "Rows tried". The money held here is the thing that matters and today's panel never says it.

### What is unaffected

One green line: **"Selling, printing and taking money are not affected."** Everything that is fine collapses into it. Only a *failing* thing earns a row of its own.

### Folded

| Row | Right-hand summary |
|---|---|
| What was tried | `13s ago · 1 row · 0 sent` |
| The bill | `C1/26264/0001 · ₹40 · 2:14 pm` |
| Show technical detail | `support code CB-7K2` |

The database id, the key fragment, the HTTP status and the field names all live behind the third one, reached by the support code.

---

## 3. The verdict table

The cause decides the line, the button and the support code. **Nothing on this screen is written by hand**, so it can never describe one fault and offer the fix for another.

| What happened | The line they read | The button |
|---|---|---|
| `key refused` | The shop does not accept this counter's key | **Pair again** |
| `no line` | Nothing is reaching the shop just now | *goes by itself* (no button) |
| `shop busy` | The shop is busy. It will go on its own | Try now |
| `bill refused` | The shop would not take this bill | See why |
| `clock wrong` | This counter's clock is 4 hours out | **Fix the clock** |
| `no space` | This counter is nearly out of space | **Free up space** |

This is the same verdict table as `A-screens/03-counter-health/counter-health-spec.md` §5 — one table, two screens. Add `key refused` and `clock wrong` to it rather than starting a second.

---

## 4. The words

| Instead of | Say |
|---|---|
| The shop refused this counter's key (401). It may have been changed or removed — pair this counter again and the bills will go. | **The shop does not accept this counter's key. Pair it again and the bill goes.** |
| Shop this database belongs to · `0e522d63-…` | behind *show technical detail*, as support code **CB-7K2** |
| Paired key yes · Online yes · Device storage writes are working | **Selling, printing and taking money are not affected.** |
| Bills stored 1 (this shop 1) · Queued to send 1 (this shop 1) | **1 bill waiting · ₹40 held here · 2m oldest** |
| When 13s ago · Rows tried 1 · Rows sent 0 | folded: *What was tried · 13s ago · 1 row · 0 sent* |
| not refused — not yet attempted | **waiting · not tried yet** |
| The 40-word note explaining "set aside" | said once, **on the confirm**, at the moment it is pressed |
| Keep selling · 1 waiting | *(the green line above covers it)* |
| Day close sheet | *(leaves this panel — see corrections §20)* |

---

## 5. Set aside

The explanation moves to the act. Pressing **Set aside** opens:

> **Set this bill aside?**
> It leaves the queue so the rest can go. The sale is not confirmed and nothing is deleted.
> It moves to *not confirmed* in today's list, with **Send it again**.
> [ Not now ] **[ Set aside ]**

In picture mode this is a hold, and the sentence is spoken while the ring fills.

---

## 6. Rules

1. **The verdict is the headline.** If the screen knows the cause, the cause is the first thing on it.
2. **One cause, one button, and the button is the fix** — never a retry that cannot work.
3. **An action that will fail stays visible and says why.**
4. **Everything that is fine collapses into one green line.**
5. **Numbers a shopkeeper cares about, large:** how many, how much, how old.
6. **No ids, no HTTP codes, no field names on the first view.** A short support code carries all of it.
7. **The explanation of a button belongs on its confirm**, never standing above it.

---

## 7. Data

```json
{
  "stuck": {
    "verdict": "key_refused",
    "waiting": { "count": 1, "amountMinor": 4000, "oldestMinutes": 2 },
    "lastAttempt": { "at": "2026-09-21T14:14:47+05:30", "tried": 1, "sent": 0,
                     "status": 401, "raw": "…" },
    "unaffected": ["selling", "printing", "taking money"],
    "supportCode": "CB-7K2",
    "technical": { "shopDbId": "0e522d63-…", "keyTail": "RanE", "storage": "ok", "online": true }
  }
}
```

- `verdict` is the only field the panel branches on. Line, button, icon and colour all come from the verdict table.
- `waiting.amountMinor` is required — a panel that cannot say what is held is not finished.
- `unaffected` is derived from the capability registry (`B-fine-tuning/03-the-line` §6), never hand-written.
- `technical` is rendered only inside the folded section, and never on first view.
- `lastAttempt.status` appears only in technical detail.

---

## 8. Acceptance checks

1. The cause is the first thing on the panel, above every number and every list.
2. The primary button is the fix for that verdict; with `key_refused` it is *Pair this counter again*.
3. Retry is shown, disabled, and states why it will not help.
4. The panel shows count, amount and age of what is waiting, in that order, large.
5. Everything healthy is one green line; no row exists to say something is fine.
6. No database id, HTTP code or field name is visible before *Show technical detail* is opened.
7. The support code is visible on the first view and is what support asks for.
8. Set aside explains itself on its confirm and nowhere else.
9. The verdict table is the same one Counter health uses — one table, two screens.
10. Day close does not appear in this panel.
11. Word count on first view is under 50.
12. At 390 px everything is reachable; the verdict card never scrolls out of the first screenful.

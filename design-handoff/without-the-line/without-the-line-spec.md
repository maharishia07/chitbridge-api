# Working without the line — spec

Replaces the panel that today reads *"The counter believes it has no internet. It keeps billing; everything that needs the server stops."* with **STOPPED RIGHT NOW** (ten items) beside **STILL WORKING** (two).

Designs: `png/OfflineWide.png`, `png/OfflineStates.png`, `png/OfflinePhone.png`.
Source: `source/Offline*.dc.html` — reference only, never ship.

---

## 1. What is wrong today

| Today | Why it hurts |
|---|---|
| Ten "stopped" against two "still working" | Reads as a catastrophe. The truth — *you can keep selling* — is the smallest thing on the screen. |
| The good news is a grey footnote | "Billing, printing and taking money are not in this list because they never touch the line" is the most reassuring sentence there, and it is last, small and grey. |
| "The counter **believes** it has no internet" | Either it has a line or it does not. Hedging makes the whole panel sound unsure. |
| No time, no length | Since when? Five minutes or two hours? That is the first thing a shopkeeper wants. |
| No count of what is waiting | "Bills queue here" — how many? Eight is fine; eight hundred is not. |
| "REFUSED outright" | Shouting at the person for something they did not do. |
| Two flat bullet lists | No order, no grouping, no sense of which items matter. |
| Jargon | "the books", "the server", "the line", "Task", "the bell", "a speech service" — four names for two things. |
| Only some rows carry a way round it | *Looking a customer up — type the name* does. *Checking bills reached the books* does not. |
| No action anywhere | No Try again, no way to see what is waiting, no way into Counter health. |

**Rule for the rebuild: lead with what still works, count everything, and give every blocked item the way round it on the same card.**

---

## 2. The panel (`OfflineWide`)

**Banner, amber:**

> **Keep selling — nothing is lost**
> No line to the shop since **1:12 pm**, that is 23 minutes. Billing, printing and taking money never needed the line, so they carry on exactly as before. **8 things are waiting here** and go by themselves the moment it returns.

Beside it: **Try the line again**, with *it is already trying every 2 minutes* underneath, so nobody feels they must keep pressing.

**Three columns, in this order** — the order is the message:

| Column | Colour | What goes in it |
|---|---|---|
| **Carries on as normal** (7 of 7) | green | Selling and billing · Printing · Taking money (cash, card, UPI QR) · Saving a bill here · Bill numbers · Quick keys and sold-out marks · Parking and taking a bill back up |
| **Works, and waits** (8 waiting) | amber | Bills reaching the shop (5 waiting, oldest 1:14 pm) · Sold-out marks and price changes (3) · New customers added here · Prices and products (as at 1:12 pm) · Today's list (this counter only) |
| **Needs the line — do this instead** (5) | neutral | Closing the counter · Checking a bill reached the shop · Sending the day's report · Looking a customer up · Speaking instead of typing |

Every card in the third column carries its workaround as a tinted line inside the card: *Save it as a file and send it yourself* · *Type the name — the sale is not affected* · *Keep the counter open — we will tell you the moment it can close*.

**When the line comes back**, a four-step strip along the bottom: the 8 waiting things go oldest first → prices and products refresh → every bill is checked against the shop → the counter can be closed, and we say so. *Nobody has to do anything.*

---

## 3. Three states, one panel (`OfflineStates`)

The second screenshot — *about one attempt in three fails and is retried* — is a **third state**, and it is not a failure.

| State | When | Pill on the sell screen | Panel headline |
|---|---|---|---|
| **Good** | fails < 1 in 20 | `all sent`, green | Everything has reached the shop |
| **Patchy** | fails 1 in 20 – 1 in 2 | `slow line · 3 waiting`, amber | The line is weak, but everything is getting through |
| **No line** | nothing reaches the shop | `no line · 8 waiting`, red dot on amber | Keep selling — nothing is lost |

**Patchy is never red.** Nothing is broken; calling it broken teaches people to ignore red. Its panel says the one thing that stops a shopkeeper worrying:

> **Nothing is lost.** A send that fails is tried again by itself, so the waiting count going up and down is normal here. It only matters if it climbs and never falls.

with the last 20 sends drawn as bars (14 first time · 6 needed a second go · **0 lost**), and an offer rather than a description: **Send gently** — one at a time on a weak line.

---

## 4. Words

| Instead of | Say |
|---|---|
| The counter believes it has no internet | **No line to the shop since 1:12 pm** |
| STOPPED RIGHT NOW | **Needs the line — do this instead** |
| STILL WORKING | **Carries on as normal** |
| Closing the counter — REFUSED outright | **Closing the counter — not until the line is back** |
| Checking bills reached the books | **Checking a bill reached the shop** |
| The work list and anything from Task | **New work from the office** |
| Live updates (the bell) | **Changes made by other counters** |
| Speaking — it needs a speech service | **Speaking instead of typing** |
| the line / the books / the server | **the line**, everywhere — one word for one thing |

---

## 5. Phone (`OfflinePhone`)

Banner with the headline, the time and the count, then **Try the line again**. Below it the three sections as folds: *Carries on as normal* folded to one line of names (nobody needs to read it, they need to know it exists), *Works and waits* and *Needs the line* open, with the workaround inside each card. A footer line — *when the line is back, the 8 go by themselves, oldest first* — and a way into Counter health.

---

## 6. Behaviour

1. **Never block a sale.** No modal, no full-screen warning, no disabled Save. The pill on the sell screen is the only thing that changes there.
2. The panel opens from the pill, and from any message that says something could not be done. Both deep-link to the right column.
3. **Every row is checked live**, and the same checks drive the pill. One source of truth — never two lists that can disagree.
4. Say the time and the length: *since 1:12 pm, that is 23 minutes*. Never "believes", never a bare "right now".
5. Counts everywhere: *7 of 7 working*, *8 waiting*, *5 need the line*, *oldest 1:14 pm*.
6. When the line returns, the panel changes **while it is open** — the waiting number falls to 0 and the banner turns green. Do not make people close and reopen it.
7. **Closing the counter** is the one genuine block. Say why (every bill must be checked against the shop), keep the counter open, and offer *tell me when it can close* rather than refusing and stopping.
8. No shouting. No caps, no "REFUSED", no red for patchy.

---

## 7. Data

```json
{
  "line": {
    "state": "good | patchy | none",
    "since": "2026-09-20T13:12:00+05:30",
    "failRate20": 0.30,
    "lastAttempts": [true, true, false, true, "…"],
    "nextTryAt": "2026-09-20T13:37:00+05:30",
    "mode": "full | gentle | paused"
  },
  "waiting": { "total": 8, "bills": 5, "oldestAt": "2026-09-20T13:14:00+05:30" },
  "capabilities": [
    { "id": "billing", "bucket": "normal" },
    { "id": "bills_to_shop", "bucket": "waits", "count": 5 },
    { "id": "close_counter", "bucket": "needs_line", "workaround": "keep_open_notify" }
  ]
}
```

- **One registry of capabilities**, each with a bucket, an optional count and an optional workaround id. The panel renders from it, and the same registry decides the pill — so a capability can never appear in the wrong list.
- `state` is computed from the last 20 attempts, not from `navigator.onLine`: a counter can be "online" and still reach nothing.
- `since` is when the state started, and the panel renders both the clock time and the elapsed length.

---

## 8. Acceptance checks

1. The first thing on the panel is what still works, and it carries a count.
2. Every item in "needs the line" has a workaround on the same card.
3. The banner states the time the line went and how long ago that was.
4. The patchy state renders amber, never red, and says a rising and falling waiting count is normal.
5. No modal or blocking dialog appears at any point; a sale can be rung, saved and printed throughout.
6. When the line returns while the panel is open, the counts fall and the banner turns green without a reload.
7. The pill and the panel are driven by the same capability registry — a test asserts they cannot disagree.
8. Closing the counter offers *tell me when it can close*; it never just refuses.
9. The words in §4 appear; "believes", "REFUSED", "the books" and "the server" appear nowhere.

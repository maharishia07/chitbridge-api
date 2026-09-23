# Today's bills — spec

Replaces the bill list that today reads *Today — 10 bills · ₹550.00* with ten rows of *C1/26-27/00NN · left this counter · 13:31 · Walk-in · desktop3 · 2 item(s)*.

Designs: `png/BillsWide.png`, `png/BillsRow.png`, `png/BillsPhone.png`.
Source: `source/Bills*.dc.html` — reference only, never ship.

---

## 1. What is wrong today

| Today | Why it hurts |
|---|---|
| The bill number is the largest thing on every row | Nobody looks for a bill by its number. They look for *the ₹105 one Anita sold around half one*. |
| **What was sold is missing** — "2 item(s)" | Two teas and two dosas are indistinguishable. The one fact that identifies a bill is not shown. |
| "· left this counter" on all ten rows | Under a banner that already says all ten left. The same fact printed twenty-one times. |
| "Walk-in" on all ten rows | The normal case, repeated. Noise. |
| **"desktop3" where a person should be** | A device name in the operator field — see §6, this is a real data bug. |
| "All 10 bill(s) have left this counter" | "bill(s)" is a placeholder that escaped; "left this counter" says where it went from, not where it got to. |
| One action per row: **print** | No way to open the bill, see what was in it, send it to the customer, or refund it. |
| "Cash ₹550.00" floating under the tabs | A payment breakdown with nowhere to sit and nothing to compare against. |
| No search, no filter, no grouping | Ten rows is fine. Two hundred is not, and this screen will see two hundred. |
| "Today · on this device" / "Earlier · from ChitBridge" | Says where the data is stored, not whose bills they are. |

---

## 2. The screen (`BillsWide`)

**Header** — "Today's bills", *Sun 20 Sep · Counter 1 · open since 7:02 am*, a search box (**bill number, amount, phone or item**), and the scope switch: **On this counter** / **The whole shop**.

**Taken today** — one strip: **₹550.00**, *10 bills · ₹55 each on average*, a payment bar (cash / UPI / card with amounts), and one pill: **All 10 reached the shop**. That pill is the only place the sync fact appears.

**Filters** as chips with counts, built from the day itself: *Everyone · Anita 2 · Bala 2 · Ravi 2 · No person recorded 4 · Cash 8 · UPI 1 · Card 1 · Not sent yet 0 · Refunded 0*. A chip with a count of 0 stays visible and disabled — its absence is information too.

**The list**, grouped by hour with a sticky sub-head carrying that hour's count and total. Row anatomy, left to right:

`13:31` · avatar `AN` · **Idli (2 pc), Filter coffee** / `C1/26-27/0006 · Anita` · [exception chip] · payment mark · **₹105.00** · ⋮

- Time in mono, 44 px column.
- The person as a coloured initial, so the column is scannable; the name appears once, in the sub-line.
- **What was sold, in words** — the first two item names, then "+2 more".
- The bill number in mono at 12 px, under the items.
- A chip **only when something is not normal** (§3).
- Payment as one 20 px mark (₹ / U / C).
- Amount mono, right-aligned, 17 px, so the column adds up by eye.
- ⋮ opens: Open · Print again · Send to customer · Copy · Refund.

Selecting a row opens **the bill itself** in the right panel: number, time, person, the lines with quantities, the total, how it was paid (*cash · ₹200 given · ₹95 returned*), when it reached the shop, and four actions. A refund needs the owner's PIN, writes its own bill, and never edits or deletes the original — said on the panel.

**Footer of the panel**: *Export today* and **Day close sheet** — this is where Day close belongs, not on the diagnostics page.

Keyboard: `↑ ↓` move · `Enter` opens · `P` prints · `/` searches · `Esc` closes.

---

## 3. Chips — only for exceptions

| State | Chip | Row |
|---|---|---|
| Sent | **none** | normal |
| Waiting to send | `waiting to send`, amber | amber tint |
| Refused by the shop | `refused`, red | red tint; opens Counter health at the reason |
| No person recorded | `no person recorded`, red | tinted, and collected by its own filter |
| Refunded | `refunded ₹105`, grey | amount struck through, link to the refund bill |
| Parked | `parked`, grey | never counted in the day total |
| Reprinted | `2 prints`, grey | quiet, but visible at day close |

**Sent is the normal case and carries no chip.** If every row has the same chip, the chip is worthless.

---

## 4. Words

| Instead of | Say |
|---|---|
| All 10 bill(s) have left this counter | **All 10 bills reached the shop** |
| · left this counter (per row) | *(nothing — that is the normal case)* |
| 2 item(s) | **Idli (2 pc), Filter coffee** |
| Walk-in | *(nothing — show only a named customer)* |
| desktop3 | **Anita** — or **no person recorded** |
| Today · on this device | **On this counter** |
| Earlier · from ChitBridge | **The whole shop** |

**"bill(s)" never appears.** The count decides the word: *1 bill* · *2 bills*. Same for item(s), print(s), customer(s).

---

## 5. Phone (`BillsPhone`)

One column: the day strip (total, payment bar, "all sent" pill), filter chips that scroll sideways, then cards — avatar, what was sold, time and person, exception chip, amount and payment on the right. Tapping a card opens the bill as a bottom sheet with the same four actions. Sticky footer: *Export* · **Day close sheet**.

---

## 6. The data bug this screen exposed

**Four of the ten bills name `desktop3` as the person.** That is a device name written into the field meant for a person, so those bills have nobody attached to them. It matters at day close, when the drawer is counted against who sold what, and it matters for any refund.

1. **Never fall back to the device name.** If nobody is signed in, write nothing.
2. Mark those bills **no person recorded** — tinted row, its own filter — so the owner can see how often it happens.
3. At day close, list them separately: *4 bills, ₹210, with no person recorded*. Never fold them into someone else's total.
4. Fix forward as well: a counter with nobody signed in should either ask who is selling, or be configured as a shared counter where "no person" is expected and stated.

---

## 7. Data

```json
{
  "bill": {
    "no": "C1/26-27/0006", "at": "2026-09-20T13:31:04+05:30",
    "counterId": "C1", "userId": "u_anita", "userName": "Anita",
    "customer": null,
    "lines": [ { "name": "Idli (2 pc)", "qty": 1, "amountMinor": 4800 } ],
    "totalMinor": 10500,
    "payment": { "method": "cash", "givenMinor": 20000, "changeMinor": 9500 },
    "sync": { "state": "sent", "at": "2026-09-20T13:31:09+05:30" },
    "prints": 1, "refundOf": null, "parked": false
  }
}
```

- `userId: null` renders **no person recorded**; the device name never enters this object.
- Money in integer minor units. Day totals are summed from `totalMinor`, excluding parked bills and net of refunds.
- `sync.state`: `sent | pending | refused`. The list never invents a fourth.
- The item summary is built from `lines`: first two names, then `+N more`.

---

## 8. Acceptance checks

1. Every row shows what was sold; no row shows "N item(s)".
2. No chip appears on a bill that is sent and complete.
3. The word "bill(s)" appears nowhere; 1 renders as "1 bill".
4. A bill with no signed-in user shows **no person recorded**, never a device name, and the filter collects exactly those.
5. The payment bar, the day total and the sum of the rows agree to the paisa; parked bills are excluded and refunds are netted.
6. Filter counts equal the number of rows the filter shows.
7. Selecting a row opens that bill with its lines; Refund asks for the owner's PIN and creates a new bill, leaving the original untouched.
8. Search finds a bill by number, by amount (`105`), by customer phone and by item name.
9. With the network off, the list, the bill panel, print and export all work; **The whole shop** says it cannot be asked.
10. 200 bills scroll at 60 fps, grouped by hour, with the hour heads sticky.

# Counter hub — the shop, the day, and what needs you

Covers the header bar, the **Start your day** card (split into two), and the **Check** panel.

Designs: `png/HubStart.png`, `png/HubCheck.png`, `png/HubHeader.png`, `png/HubStartPhone.png`.
Source: `source/Hub*.dc.html` — reference only, never ship.

---

## 1. Split "Start your day" into two cards

Today one card carries *your image · the day opened · the shop's particulars* — a picture, a daily routine and seven fields of shop set-up. Three reasons to open it, three different people, three different frequencies.

| New card | What it is | How often |
|---|---|---|
| **The shop** | Name, legal name, address, phone, GSTIN, money, counter — what a bill is printed from | checked once, rarely changes |
| **Start the day** | Who is on, the float, printer and drawer, how old the prices are, and **Open the day** | every morning |

**The shop comes first.** It is what the bill is printed from; if it is wrong, every bill that day is wrong. The picture is dropped from the card head — decoration was pushing seven fields below the fold — and "To do" moves to the day, where it belongs.

### The shop card

- Header carries a completeness count: **4 of 7 filled**. That beats a red dot: it says how much is left without calling the shop broken.
- Rows are **read from ChitBridge**, and the card says so **once**, at the bottom, with the time it was read — not on every row.
- **Open the shop's profile ↗** sits beside that line.

### A profile row has four states

| State | Looks like | Carries |
|---|---|---|
| Filled | value in ink | nothing |
| Empty, fillable here | *not set* in grey + one-line why it matters | **Add** |
| Empty, needs something outside first | *not set* + what it means for bills | **Register** (green) |
| Changed here, on its way | value in ink | *sending…* |

**"not set" is never a dead end.** Every empty row carries the one thing that fills it.

---

## 2. GSTIN

**It is GSTIN** — Goods and Services Tax *Identification Number*, the 15-character number a registered business holds. GSTN is the *Network* that runs the portal. Use GSTIN everywhere in the product.

Today the row reads *not set · no GST is charged or shown* — a fact and a dead end. Instead:

```
GSTIN    not set                                   [ Register ↗ ]
         bills show no GST — that is fine if the
         shop is not registered · 15 characters
         Already have one? Enter it
```

**Register ↗** opens the shop's profile at **Tax**, in ChitBridge — the one place these are edited. There: a short explainer, a link to the government portal for a new registration, and a box to type a number that already exists. The moment a number is saved, this row fills, the Check item disappears, and the next bill shows GST.

The same three doors appear on the Check item (§4).

---

## 3. The Check panel — rank by consequence

Today three items look equally urgent, one shouts in capitals, and the only instruction is a menu path. Instead:

- Title: **Needs you**, subtitle **3 things · none of them stops a sale** — the subtitle answers the only question that matters at a glance.
- Every item carries: a plain title, one line of why, a **tag naming the consequence** (*costs money* · *costs time* · *set once*), and **a button**. A menu path is not an action.
- **The badge counts things, not colours.** Red is only for something that has stopped a sale or risks losing work. Everything in this panel is amber or grey.

### The registry

Every check is one row, ranked **stops a sale → costs money or time → set once**. The same registry feeds the badge, so the count can never disagree with the list.

| Check | Rank | Action |
|---|---|---|
| Nothing can reach the shop | stops a sale | Counter health ▸ Pair |
| This counter is nearly out of space | stops a sale | Free up space |
| Prices are more than a day old | costs money | Read the shop again |
| The day has not been opened | costs time | Open the day |
| Bills waiting longer than an hour | costs time | Counter health |
| No GST number on the shop | set once | Register · I have one · Not registered |
| No address or phone on bills | set once | Add it |

When nothing needs you: *All clear — the day is open and everything has been sent.* No badge, no colour, one line, and the card stays in place so its absence is never read as a broken panel.

---

## 4. The GST check item

Today: **THIS SHOP IS REGISTERED BUT HAS NO GSTIN ON IT** — shouted, self-contradictory, and the instruction is *(Settings ▸ Profile)*.

Instead:

> **This shop has no GST number yet**
> Bills go out with no GST on them. That is correct for a shop that is not registered — and wrong for one that is.
> **[ Register for GST ↗ ]** · [ I already have one ] · <u>We are not registered</u>

**Three doors, because there are three shops.** "We are not registered" writes that answer into the profile and hides the item for good, so the shop is never nagged again. "Not now" is different — it brings the item back tomorrow.

---

## 5. The header bar

Today: *Counter · Mayur Bhavan · Sunday, September 20, 22:19* with four pills — `online`, `all sent`, `3 need you` (red), `113 products` — and a person block naming the shop.

| Fix | |
|---|---|
| **Counter 1**, not "Counter" | there are three |
| `Mayur Bhavan · Sun 20 Sep · 10:19 pm` | short date, 12-hour clock, live |
| Two pills, not four | `● online · all sent` and `3 need you` |
| **113 products** leaves | not a status; it belongs in the products screen |
| `3 need you` is **amber** | red is for a stopped sale or work at risk |

**What may be a pill:** the line, waiting-to-send (only when not zero), and the Check count. Nothing a shopkeeper cannot act on — if pressing it does nothing, it is not a pill. **Order is fixed** (line → waiting → needs you) so the eye learns where to look.

**As it narrows, nothing is dropped — it folds.** Tablet: the person loses their subtitle. Phone: the status pills merge into one, with the line state as a coloured dot inside it, and the name becomes initials.

---

## 6. The person block — the same bug as `desktop3`

The header shows the person as **Mayur Bhavan**, the shop's name. On the bill list the same field showed **desktop3**. Both come from one hole: when nobody is signed in, the field is filled with whatever is nearest instead of being left empty.

1. The shop's name lives in the subtitle. **It is never the person.**
2. Nobody signed in → a "?" avatar, **Nobody signed in**, *bills will say "no person recorded"*, and a **Sign in · F7** button.
3. Signed in → initials, name, and **how long they have been on** (*since 9:41 pm · 2h 38m*) — that is what a hand-over needs.
4. **Hand over** is a plain button; the shortcut sits beside it in mono, not inside the label.

---

## 7. Data

```json
{
  "counter": { "id": "C1", "name": "Counter 1" },
  "shop": {
    "name": "Mayur Bhavan", "legalName": null, "address": null, "phone": null,
    "gstin": null, "gstStatus": "unknown | registered | not_registered",
    "currency": "INR", "readAt": "2026-09-20T19:19:00+05:30"
  },
  "day": { "openedAt": null, "openedBy": null, "floatMinor": null },
  "operator": { "userId": null, "name": null, "sinceAt": null },
  "checks": [
    { "id": "no_gstin", "rank": "set_once", "actions": ["register", "have_one", "not_registered"] }
  ]
}
```

- `operator.userId: null` renders "Nobody signed in". The shop name and the device name are never substituted.
- `shop.gstStatus: "not_registered"` is what "We are not registered" writes; the check then never fires again.
- Filled-count = non-null fields in a fixed list of seven; the header shows *N of 7*.
- Checks come from one registry with a `rank`; the badge is `checks.length`.

---

## 8. Acceptance checks

1. "The shop" and "Start the day" are separate cards, in that order, and neither subtitle needs three nouns.
2. Every "not set" row carries an action; the GSTIN row carries **Register ↗** and "Already have one? Enter it".
3. **Register ↗** opens the shop profile at Tax; saving a number fills the row, clears the check, and the next bill shows GST.
4. "We are not registered" removes the check permanently and is visible in the profile as a stated choice.
5. Every check item has a button; no item's only instruction is a menu path.
6. The badge equals the number of items listed, always.
7. No red appears in Check or the header unless a sale has stopped or work is at risk.
8. The header never shows the shop name or a device name as the person; with nobody signed in it shows "?" and Sign in.
9. At tablet and phone widths every element is still reachable — folded, never removed.
10. The clock ticks and is 12-hour; the date is short.

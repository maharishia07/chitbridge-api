# Counter hub — give this file to the CLI first

Covers the hub's **header bar**, the **Start your day** card (which becomes two cards) and the **Check** panel — including the GSTIN row and its Register link.

Unzip into the repo as `design-handoff/counter-hub/`.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `counter-hub-spec.md` | The whole spec: the split, profile row states, GSTIN, the Check registry, the header, the person bug, data shape, acceptance checks. |
| 2 | `png/HubStart.png` | The two cards — **The shop** first, then **Start the day** — and the GSTIN row in detail. Build this. |
| 3 | `png/HubCheck.png` | Check ranked by consequence, the registry, and the GST item's three doors. |
| 4 | `png/HubHeader.png` | The header bar: pills, how it folds, and the person block. |
| 5 | `png/HubStartPhone.png` | Phone. **Write this layout first**, then widen. |
| 6 | `source/Hub*.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## Four changes, in order of value

1. **Split the card.** *The shop* (name, address, GSTIN — what a bill is printed from, checked once) comes **first**; *Start the day* (who is on, the float, printer, prices, **Open the day**) comes second. One card, one job: if a card's subtitle needs three "·"-separated nouns, it is two cards.
2. **GSTIN gets a way forward.** *not set* is a dead end today. It becomes *not set · bills show no GST — that is fine if the shop is not registered* with **Register ↗**, and quietly under it *Already have one? Enter it*. The link opens the shop profile at **Tax**, in ChitBridge.
3. **Check ranks by consequence.** Each item says *costs money* / *costs time* / *set once*, carries a real button (never "(Settings ▸ Profile)"), and the panel subtitle answers the only question that matters: *3 things · none of them stops a sale*. The GST item offers three doors — Register · I already have one · **We are not registered**, which writes that choice into the profile so it never nags again.
4. **The header stops mixing kinds.** Four pills become two (`● online · all sent`, `3 need you`, amber not red); *113 products* leaves; "Counter" becomes **Counter 1**; the date shortens and the clock goes 12-hour.

## Fix this bug while you are in there

**The header shows the person as "Mayur Bhavan" — the shop's name.** On the bill list the same field showed **desktop3**. One hole, two symptoms: when nobody is signed in, the field is filled with whatever is nearest.

- The shop's name is in the subtitle. It is never the person.
- Nobody signed in → "?" avatar, *Nobody signed in*, *bills will say "no person recorded"*, and **Sign in · F7**.
- Signed in → initials, name, **and how long they have been on** — that is what a hand-over needs.

## Terminology

**GSTIN**, not GSTN. GSTIN is the 15-character Goods and Services Tax *Identification Number* a business holds; GSTN is the *Network* that runs the portal. Use GSTIN in every label, message and field name.

## Rules this screen inherits from the rest of the package

1. **Mobile-first.** Phone layout first, widen with `min-width` queries only; nothing is dropped as it narrows, it folds.
2. Red is only for a stopped sale or work at risk. Everything else is amber or grey.
3. Every empty field carries the one action that fills it, and the action names what it does: Add, Register, Enter it.
4. An action that leaves the app carries ↗ and says where it goes before it is pressed.
5. **Five states**: loading, empty, error, offline (the profile still shows, from the last read, with its time), no permission.
6. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.

## Paste-ready start

```
Read design-handoff/counter-hub/README-COUNTER-HUB.md, then counter-hub-spec.md
and png/HubStart.png.
First: find where the counter's current operator is set and show me why it falls back to the
shop name in the header and to the device name on the bill list. Propose the fix and wait.
Then split the "Start your day" card per spec §1, add the GSTIN Register path per §2, and
rebuild Check from the registry in §3 — phone layout first, then widen.
Run the acceptance checks in counter-hub-spec.md §8 and show me the hub with nobody signed in,
with 3 checks, and with everything clear.
```

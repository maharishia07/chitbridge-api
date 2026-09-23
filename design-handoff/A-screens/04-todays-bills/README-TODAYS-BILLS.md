# Today's bills — give this file to the CLI first

Rebuilds the bill list that today shows ten rows of *C1/26-27/00NN · left this counter · 13:31 · Walk-in · desktop3 · 2 item(s)*.

Unzip into the repo as `design-handoff/todays-bills/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `todays-bills-spec.md` | The whole spec: what is wrong today, the screen, chips, words, the data bug, data shape, acceptance checks. |
| 2 | `png/BillsWide.png` | The screen — day strip, filters, grouped list, and the bill itself beside it. Build this. |
| 3 | `png/BillsRow.png` | Row anatomy before/after, the seven row states, the wording table, and the `desktop3` bug. Read before writing any row code. |
| 4 | `png/BillsPhone.png` | Phone, one column. **Write this layout first**, then widen. |
| 5 | `source/Bills*.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## Stop and fix this first — it is a data bug, not a design one

**Five of the ten bills say the person was `desktop3`.** A device name is being written into the field meant for a person, so those bills have nobody attached to them. That breaks day close (the drawer is counted against who sold what) and every refund.

1. Never fall back to the device name. Nobody signed in → write nothing.
2. Render those bills as **no person recorded**, tinted, with a filter that collects them.
3. At day close list them separately — *4 bills, ₹210, with no person recorded* — never folded into someone else's total.

Find where the operator is set on a bill and show me before changing it.

## The rule this screen exists for

**A row says what was sold.** The bill number, the sync state and "walk-in" are not what a shopkeeper scans for — *two teas at half one, ₹40, Bala* is. So: items first in words, person as a coloured initial, amount mono and right-aligned, bill number small underneath.

And: **a chip only when something is not normal.** Ten green "left this counter" chips under a banner that already says all ten left is the same fact printed twenty-one times.

## Rules this screen inherits from the rest of the package

1. **Mobile-first.** Phone layout first, widen with `min-width` queries only.
2. **Money in integer minor units**; parked bills excluded from totals, refunds netted.
3. **Offline is normal.** The list, the bill, print and export all work with no network; *The whole shop* says it cannot be asked.
4. **Five states**: loading, empty (*no bills yet today* — not an error), error, offline, no permission.
5. Refunds need the owner's PIN, write their own bill, and never edit or delete the original.
6. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.
7. "bill(s)" never appears — the count decides the word.

## Paste-ready start

```
Read EVERY file in design-handoff/todays-bills/ first — every .md and every .png — before writing any code.
Read design-handoff/todays-bills/README-TODAYS-BILLS.md, then todays-bills-spec.md
and png/BillsRow.png.
First: find where a bill's operator/user is recorded and show me why some bills carry the
device name (desktop3). Propose the fix and the migration for existing rows, and wait for approval.
Then rebuild the list per the spec — phone layout first, then widen.
Run the acceptance checks in todays-bills-spec.md §8 and show me the screen with 10 bills,
with 200 bills, and with one bill that has no person recorded.
```

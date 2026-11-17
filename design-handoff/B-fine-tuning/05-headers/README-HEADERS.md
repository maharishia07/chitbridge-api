# 05 · The two headers — give this file to the CLI first

Rebuilds the **sell screen header** and the **panel header** as one component, and fixes the pills, the person block and the voice control that live in them.

Unzip into the repo as `design-handoff/headers/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `headers-spec.md` | The whole spec: what is wrong today, the five zones, the pill system, the words, the person block, voice both ways, how it folds, the panel's cards, data shape, acceptance checks. |
| 2 | `png/HeadTwo.png` | Today's two headers side by side with their disagreements, then the one component at sell, panel and phone density, and the fold order. Build this. |
| 3 | `png/HeadRules.png` | The identity block, the person's four states, what may be a pill, the colour ladder, the wording table, **voice in and voice out**, and the panel's card grid. |
| 4 | `source/HeadTwo.dc.html`, `source/HeadRules.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## The change in one line

**Two headers, the same facts, two dialects.** One component with five zones in one fixed order — who · how it is · how much · who is on · the way out — used in the sell screen and in every panel, folding as it narrows instead of dropping things.

## Six things, in order of value

1. **The shop leads, the counter follows.** `Mayur Bhavan` is the title in the display face; `Counter 1 · Sell · Mon 21 Sep · 2:14 pm` is one quiet line under it. The shop's name is what is printed on every bill and what the customer reads — today it is 10 px grey in the panel. With one counter, `Counter 1 ·` drops out by itself.
2. **Three pills, fixed order, and only things you can press.** Six pills in four colours become the line, stale prices and needs-you. `113 products` leaves the header; `Counter 1` moves to the subtitle. If pressing it does nothing, it is a label, and labels belong in the body.
3. **Red only for a stopped sale.** `⛔ check` and the red "nobody signed in" card both go amber. Red is reserved for *billing stopped*.
4. **Today's take gets its weight back** — `₹8,450.00 / today so far · 42 bills`, mono, the largest number in the header. Empty reads `₹0.00 · no bills yet today`.
5. **`74 h old` becomes `prices 3 days old · Re-read F4`.** A warning with the button that fixes it, and a unit people think in.
6. **Voice is two switches** (see below), on one mic button.

## Voice in *and* voice out

Hearing you and speaking back are different jobs with different reasons to stop — a noisy kitchen wants to be heard and not answered; a counter whose eyes are on the customer wants the opposite. So: two switches behind one mic button, tap for hearing, hold for both.

- Speaking back stops the instant the mic starts hearing. It never talks over the person.
- It never reads a customer's name, phone or address aloud.
- Short form in a rush: "forty", not "the total is forty rupees only".
- One language serves both; volume is per counter; **muted is not off** — muted still shows on screen what it would have said.
- The header icon carries both: a mic, and a small speaker beside it when it answers.

This supersedes the single "Listener" switch in folder 04's tray — build the pair.

## Rules this screen inherits from the rest of the package

1. **Mobile-first.** Nothing is dropped as it narrows — it folds, in the order in spec §6.
2. One registry per fact: **one header registry** feeds both headers, or they will disagree again within a month.
3. Every warning carries the action that clears it.
4. Counts and units everywhere; the unit is said once.
5. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1, colour never alone.

## Paste-ready start

```
Read EVERY file in design-handoff/headers/ first — every .md and every .png — before writing any code.
Read design-handoff/headers/README-HEADERS.md, then headers-spec.md and png/HeadTwo.png.
First: show me the two header components as they exist today and where each pill's data comes from.
Do not change anything yet.
Then propose the single header component with the five zones and the pill registry from spec §8,
and wait for approval.
After approval, build the phone density first, then widen through 600, 820, 1024, 1280.
Add the voice pair from spec §5 — hearing and speaking as separate switches on one mic button.
Run the acceptance checks in headers-spec.md §9 and show me the header signed in, with nobody
signed in, with stale prices, and at all five widths.
```

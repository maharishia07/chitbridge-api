# Working without the line — give this file to the CLI first

Rebuilds the panel that today says *"The counter believes it has no internet"* with **STOPPED RIGHT NOW** (ten items) beside **STILL WORKING** (two).

Unzip into the repo as `design-handoff/without-the-line/`.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `without-the-line-spec.md` | The whole spec: what is wrong today, the panel, the three line states, the words, behaviour, data shape, acceptance checks. |
| 2 | `png/OfflineWide.png` | The panel — banner, three columns, and what happens when the line returns. Build this. |
| 3 | `png/OfflineStates.png` | Good / patchy / gone, the pill in each state, the wording table, the eight rules. Read before writing any copy. |
| 4 | `png/OfflinePhone.png` | Phone, folded sections. **Write this layout first**, then widen. |
| 5 | `source/Offline*.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## The rule this panel exists for

**Lead with what still works.** Ten "stopped" bullets against two "working" reads as a catastrophe, when the truth is that a shop can trade all day without the line. So the order is:

1. **Carries on as normal** — 7 of 7, in green, first.
2. **Works, and waits** — 8 waiting, in amber, with counts and ages.
3. **Needs the line — do this instead** — 5, neutral, and **every card carries its own way round it**.

And the banner says the time, the length and the count: *No line since 1:12 pm, that is 23 minutes. 8 things are waiting here and go by themselves.*

## The second screenshot is a third state

*About one attempt in three fails and is retried* is **patchy**, not broken — and it must never be red. Its panel says the thing that stops a shopkeeper worrying: *nothing is lost; a waiting count that rises and falls is normal here; it only matters if it climbs and never falls.* Show the last 20 sends as bars (14 first time, 6 second go, **0 lost**) and offer **Send gently** rather than just describing the problem.

| State | Threshold | Pill | Colour |
|---|---|---|---|
| Good | fails < 1 in 20 | `all sent` | green |
| Patchy | 1 in 20 – 1 in 2 | `slow line · 3 waiting` | amber |
| No line | nothing gets through | `no line · 8 waiting` | amber with a red dot |

## Build it from one registry

Every capability is one row — `{ id, bucket: normal | waits | needs_line, count?, workaround? }` — and **the same registry drives both the panel and the pill**. Two hand-written lists will disagree within a month. `state` is computed from the last 20 attempts, never from `navigator.onLine`: a counter can be "online" and still reach nothing.

## Rules this panel inherits from the rest of the package

1. **Never block a sale.** No modal, no full-screen warning, no disabled Save.
2. **Mobile-first.** Phone layout first, widen with `min-width` queries only.
3. **Offline is normal**, not an error state — the whole tone follows from that.
4. Counts everywhere; a list without numbers reads as chaos.
5. No shouting: no caps, no "REFUSED", no red for patchy.
6. One word for one thing — **the line**, never "the books" / "the server" / "the connection".
7. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.

## Paste-ready start

```
Read design-handoff/without-the-line/README-WITHOUT-THE-LINE.md, then
without-the-line-spec.md and png/OfflineStates.png.
Find where this panel's two lists are built today and show me: the source of each row,
how the sync pill decides its state, and whether they share any code.
Then propose the capability registry from spec §7 — one row per capability, driving both
the panel and the pill — and wait for my approval.
After approval, build the phone layout first, then widen. Run the acceptance checks in
without-the-line-spec.md §8 and show me the panel in all three line states.
```

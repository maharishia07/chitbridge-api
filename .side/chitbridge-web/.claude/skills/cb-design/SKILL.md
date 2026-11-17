---
name: cb-design
description: ChitBridge's design system and screen grammar. Load before building or changing ANY screen, panel, list, form, dashboard or empty state in chitbridge-web — including "small" changes to labels, counts, status chips and loading states. Carries the tokens, the two-pane shell, the copy rules, and the honesty rules about numbers.
---

# ChitBridge — screen design

Rules derived from real bugs in this repo. Each one is here because it shipped once.

## 1 · The shell — every screen has the same grammar

**Left is the set. Right is the selected thing.** No exceptions, no new patterns.

| screen | left rail | right pane |
|---|---|---|
| Task / Order | chits | the chit |
| Suppliers | suppliers | their catalogue |
| Catalogue | products | the product |
| MIS | bands | the band |
| Profile | sections | the section |
| Settings | sections | the section |

Markup: `.panel` → `.list` + `.divider` + `.detail`, with `--lw` for the rail width.

- **The rail carries a headline value per row**, so it is a summary in its own right, not a bare nav.
- **A mode switch that reframes everything goes ABOVE the split** (MIS's period bar, Suppliers' tabs). Anything scoped to one item lives inside that item.
- **Rail width is per-screen.** MIS/Profile/Settings default `UI.misLw = 320`; Task and Suppliers hold variable-length rows and get dragged wide. Borrowing another screen's width pushed MIS's detail pane off the edge entirely.
- **On mobile, selecting a row must call `_capShowDetail()`** — the shell hides `.detail` unless the panel carries `.showdetail`. Without it, tapping a row highlights it and shows nothing.
- **A panel that covers the only route back must carry a visible route back.** `.dback` is `display:none` outside mobile; use `.supback` or your own always-visible class.

## 2 · Numbers must be honest

- **No number without a comparison.** A bare `19` is not an insight. Every figure earns a delta, a share, or a trend — or it does not earn a tile.
- **Never invent a figure.** If the logic does not exist, say so on the screen. `netAvail` waited for `lib/availability.js` rather than shipping invented numbers; MIS's Trust band says outright that counterparty reliability is not built.
- **In a mockup, label illustrative figures.** A realistic number is one screenshot away from being mistaken for a report.
- **Do not print a number you know is wrong.** The clearance chip said "35 outstanding" from an unscoped list that demanded a pharmaceutical licence of a paint company. The count was removed; the true part ("none on file yet") stayed.
- **`met: 0` means nothing recorded — not checked and failed.** Declared ≠ verified ≠ met. Say which.
- **Part-to-whole is one bar, not N tiles.** `11 + 6 + 2 = 19` was invisible as three peer tiles.
- **Watch what a bucket hides.** `cancelled` and `rejected` sit in `close` beside `completed`, so "committed = closed" counts dead value as real.

## 3 · Status is not a count

`0 disputes` rendered in a plain tile reads exactly like `Suppliers 2` — one is a health signal, the other is inventory. Status gets its own treatment: **an icon and a label, never colour alone**, and reserved colours (`--ok --prog --disp`) that are never reused for a series.

**Three answers, not two.** When something can be unknown, say so:

| answer | meaning |
|---|---|
| has it | confirmed present |
| **can't tell** | no data — *not* "no" |
| not listed | confirmed absent |

Collapsing "can't tell" into "no" is the same lie as drawing an unreported store as `0`.

## 4 · Copy

- **Say whose.** "No certificates on file" beside your own account name reads as an accusation about you. Name the party.
- **Use the word a person recognises**, not the internal one — "certificate or licence", not "clearance".
- **One question, one name.** "Shop status" (trading) and "Is your shop open?" (visibility) are different facts asked in the same English; the screen read `open` above `Closed` and looked self-contradictory. Two names for one question is a bug even when both values are correct.
- **Role-dependent screens need role-dependent copy.** One `profile` blurb served owner and actor, and owners were told "Your shift and assignment."
- **Don't say the same thing twice.** "Showing 16 of 16 · all loaded" at the top and "16 total · end of list" at the bottom.
- **`1 supplier(s)`** — the code knows the number; pluralise it.
- **`9/9` is noise** when the pair is loaded/total and everything is loaded.

## 5 · Feedback while working

Every fetch funnels through `api()` in `app/core.js`, which drives `_netBusy()` — a labelled pill (**"Reading data… (n)"**) plus a sweep bar. It waits ~180ms so fast reads do not flash. **Do not add per-screen spinners for network reads**; the global one already covers them. A silent hairline is an animation, not feedback — if it does not say anything, it does not count.

## 6 · Mechanical rules

- **Legibility floor 11px.** `guard-static` check 4 tracks the count; **it must not grow**.
- **Anything clickable gets `cursor:pointer`.** `.tool` had none — over emoji, `cursor:auto` resolves to the I-beam.
- **Watch cascade collisions.** `.composebtn` sets `color:#fff` for a coloured background; a neighbouring rule set `background:#fff`. The button was present, sized, clickable and **invisible**.
- **Fit content to its container.** An `fr` track sizes to min-content — grid children need `min-width:0` or bars overflow the pane.
- ⚠️ **Use a container query, not a media query.** Every two-pane screen must ask how big **this pane** is, not how big the screen is. `@media(max-width:560px)` never fires for a 340px detail pane inside a 900px window — a heading truncated to `NOT CONFIGU…` while the rule sat idle. Put `container-type:inline-size` on the block and query that.
- ⚠️ **Inline styles beat your class rule.** Three separate bugs in one day: a `width:300px` list that would not collapse on mobile, and a `min-width:160px` select that hung past its pane. If a component must fit an unknown container it cannot carry a hard width — fix the component, don't paper over it with `!important`.
- **Wide content scrolls in its own box** (`overflow-x:auto`), never the page.
- **`.detail` supplies no padding**; bring your own or content runs to the window edge.

## 7 · Before calling a screen done

Run `node e2e/guard-static.cjs` — 0 failures, sub-11px count not grown. Then **look at the rendered page**: the validator checks structure, not layout. Four bugs this year were visible only in a screenshot.

`e2e/tests/design-guard.spec.js` asserts what static analysis cannot — text under 3:1 contrast, and displayed controls at zero size.

⚠️ **None of this replaces judgement.** The "Shop status" collision was found by reading two labels and being confused; no check would have caught it.

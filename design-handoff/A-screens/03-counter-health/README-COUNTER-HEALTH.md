# Counter health — give this file to the CLI first

Rebuilds the diagnostics page that today reads *Paired key · NO — nothing can be sent · Rows tried 10 · Rows sent 0*.

Unzip into the repo as `design-handoff/counter-health/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `counter-health-spec.md` | The whole spec: what is wrong today, the page, the technical view, the ten verdicts, behaviour, data shape, acceptance checks. |
| 2 | `png/HealthWide.png` | The page — verdict, four checks, the queue, the last try, what to do, support code. Build this. |
| 3 | `png/HealthPhone.png` | Phone, same order in one column. **Write this layout first**, then widen. |
| 4 | `png/HealthDetail.png` | The technical view behind one button — stores, tries, raw answer, probes, retry schedule. |
| 5 | `png/HealthActions.png` | The action hierarchy, the two tabs, the reconcile table, Sending speed — read with spec §9. |
| 6 | `source/Health*.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship these.** They use a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

Images are the visual truth; the spec is the rules. Where they disagree, ask.

## The rule this page exists for

A diagnostics page answers three questions **in this order**:

1. **Is something wrong?** — one sentence in display type, not a row in a list.
2. **Is anything lost?** — say it outright. "Nothing is lost — 10 things are waiting here" is the most important line on the page when it is true.
3. **What do I do now?** — one button that fixes the actual cause. A page that says "not paired" must carry a **Pair this counter** button.

Everything else — counts, codes, timings — comes after those three, and the raw technical dump goes behind a button.

## Four more, from the fuller screen (spec §9)

4. **Six buttons of equal weight.** One green fix, two outline checks, one split **Send the report ▾**. `Day close sheet` leaves the page; `What is being kept` moves into the technical view. No emoji.
5. **The tabs must name whose numbers they are** — *What is on this counter* vs *What the shop has*, and the second says **can't ask** with a reason rather than showing blanks that read as zeroes.
6. **"Check sent bills really arrived" gets a reconcile table** — here vs the shop, with a one-tap *Send those 3* when they differ.
7. **"Line · Full speed" becomes Sending speed** (Full speed / Gentle / Paused), explained, and it moves into the technical view.

## Three things the current page gets wrong that the code must fix

1. **The numbers contradict each other.** *Bills 0*, *queued 0*, then *10 rows tried*. Compute one headline number from `sync_state = 'pending'` across every store, always show the breakdown beside it, and say in words when no bills are among them.
2. **The support code does nothing.** Give it a label, 30 px type, a Copy button, and a **Send the report** that carries the page, the last 200 log lines and the counts — and provably no prices, names, phone numbers or bill contents.
3. **There is no verdict table.** `verdict.code` → banner line + action button + support code, one row per cause (§5 of the spec has all ten). Never assemble the sentence in the view.

## Rules this page inherits from the rest of the package

1. **Mobile-first.** Phone layout first, widen with `min-width` queries only.
2. **Offline is normal.** The whole page is local; only the probes need the network, and they say so when they fail.
3. **Five states**: loading, empty (healthy — the page is boring on purpose), error, offline, no permission.
4. Nothing on this page changes data except **Pair**, which asks for the owner's PIN.
5. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.

If you have the full package (`quick-keys-design-handoff.zip`), the reliability promises behind this page are in `NOW-reliability-usability.md` (R2 offline normal, R6 diagnostics).

## Paste-ready start

```
Read EVERY file in design-handoff/counter-health/ first — every .md and every .png — before writing any code.
Read design-handoff/counter-health/README-COUNTER-HEALTH.md, then counter-health-spec.md
and png/HealthWide.png.
Find the current diagnostics page in this repo and show me: the component file, where the sync
queue counts come from, and where sync errors are recorded.
Then propose the verdict table (cause → banner line, action, support code) from spec §5,
mapped onto the errors this codebase actually produces, and wait for my approval.
After approval, build the phone layout first, then widen. Run the acceptance checks in
counter-health-spec.md §8 — including the test that the support report carries no prices,
names or bill contents — and show me the page in the never-paired, offline and healthy states.
```

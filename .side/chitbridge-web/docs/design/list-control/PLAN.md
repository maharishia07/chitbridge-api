# PLAN — CBList: the list control as a self-sustaining unit (2026-10-02)

Athi, 2026-10-02: *"can we keep it as a control so it can be used anywhere … with its own ui/ux and as a self sustaining
unit"*, after *"the format to be reused every where so irrespective of the place, the control looks similar, and the
activites, grouping and any operations can be different"* (DECISIONS.md › "One list control, the same everywhere").

## Today (measured)
`public/app/list-ctl.js`: 653 lines, **65 global functions** (`tbl*`, `tblCols*`, `lazyWrap` …). It borrows from its host
page: `tx()` ×13, `esc()` ×28, `uk()` ×2, `UI.*` ×4, `mvBtn`. It is loaded by app.html and accounts.html. Its styles were
already moved inside (web #26, after the chooser opened unstyled on CB Accounts). It works, but a page that lacks one of
the borrowed globals breaks it quietly.

## The unit
**One file, one global: `window.CBList`.** Nothing else is exported, and nothing is read from the page.
- **Own look:** its CSS is injected once (`#cblist_css`), using only the design tokens (`--card`, `--line`, `--ink`,
  `--blue` …), with a fallback for each, so it renders correctly on a page with no app stylesheet.
- **Own words:** its strings (Shown — in this order · Available · ⚙ columns · ▤ grid · ☰ lines · Expand all · Collapse all ·
  hidden — no room · N shown · end of list) live in its own table, passed through the host's translator if one is given
  (`opts.t`), else English. Never a raw key on screen.
- **Own state:** per list key, it holds the column choice and order, the view (grid or lines), sort, filters, search and
  which rows are open. It remembers them in browser storage under its own prefix, wrapped in try/catch, with an in-memory
  fallback. Settings that belong to a person go through an optional `opts.store` (e.g. the server's per-person
  preferences), and it never reaches out on its own.
- **Own behaviour:** the shell is identical everywhere: tools bar · search · filter chips · sort · ⚙ columns · ▤/☰ · Expand
  all / Collapse all · group rows · lazy rows · phone cards below its container width (a container query, not the page
  width) · keyboard (↑ ↓ Enter, Esc closes the chooser) · ARIA (the chooser is a dialog; checkboxes are labelled; arrows say
  "move Date left").
- **Escaping is its own job:** every value it paints is escaped by its own `esc`; a declaration may hand it trusted HTML only
  through an explicit `html:` cell renderer.

## ⭐ Two rules that come WITH every grid; no list can opt out (Athi, 2026-10-02)
*"whenever such type of control established anywhere, it is a must that column adjustable should be there, and also, the
scrolling should be allowed only below the column header. that should be the standard rule … create a control in place so
i don't need to repeat."*
1. **Adjustable columns.** Every grid header cell has a drag handle on its edge (mouse, touch and keyboard: focus the
   handle, ← → in 8 px steps; double-click resets to the declared width). Widths are remembered per list key with the
   column choice. There's a minimum width per column, and the top-priority column can't be squeezed below its label. The
   Platform screen's own resizer (`platColResize*`, app.html ~9902) is MOVED into the unit and deleted there.
2. **Only the rows scroll.** The unit lays itself out as a fixed head and a scrolling body. The page header, the list's
   tools bar and the column header row stay in place, and the rows scroll beneath them. The body fills the REST OF THE
   WINDOW (its height runs to the bottom of the viewport, recalculated on resize). It's the list's own scroll area,
   never a small box, which keeps it consistent with "an inner scrollbar is truncation": nothing is hidden that a page
   scroll would show. The horizontal header and body scroll together. On a phone (cards) the same holds: tools fixed,
   cards scroll.
Both are part of the shell, not options. A list declared without them can't exist, because they aren't parameters.

3. **A compact head: everything above the rows takes ≤ 20% of the window** (Athi, 2026-10-02, on the Day book: *"this is
   almost 40% of the space, can you see how this can be reduced, to say 20%"*). Today it's 8 stacked rows (title · dates ·
   walk-ins note · supplier-bills banner · search+filters · Day/Week/Month+Expand+CSV · count · header). The shell lays it
   out in THREE:
   - **Title row:** title · period chip `[1 Apr – 2 Oct ▾]` (presets Today / This month / This FY / Custom; applies on
     pick, so there's no Show button) · notices as small chips that still open their fix ("⚠ 2 bills to accept ›",
     "⚠ walk-ins not closed ›") · shop · Home · avatar.
   - **Tools row:** 🔍 search (flex) · `Filters ▾ n` (all dropdowns in one popover; active ones as removable chips) ·
     grouping as one segmented control (Day | Week | Month, or the place's own) · ⇕ expand/collapse one toggle · ▤|☰ ·
     ⚙ · ⬇ CSV · the count. Icons carry labels on hover and for screen readers.
   - **Column header row.**
   On a phone: up to 4 rows (search full width). A check measures it: the head is ≤ 20% of a 1366×768 window and ≤ 30% of
   390×844, on every mounted list. The page's title row is the unit's `head` slot, so a place declares its period, notices
   and title rather than drawing them.

## The contract (what a place declares; everything else is the unit's)
```js
CBList.mount(el, {
  key: 'daybook',                       // remembers choices per list
  rows: [...] | () => rows,             // data the page already holds (the unit never fetches)
  columns: [{ key, label, prio, w, num?, cell?(row) }],
  view: 'grid' | 'lines',               // default; the person can switch
  group?: { by(row), label(key, rows) },  // Day/Week/Month, Open/Act/Close, none
  filters?: [...], sorts?: [...], search?: (row) => text,
  next?: (row) => html | Promise<html>, // what expanding a row shows
  actions?: [{ id, label, icon, when?(row), run(row) }],   // row actions
  bulk?:    [{ id, label, run(rows) }],                     // select-many operations
  onOpen?: (row) => void,               // e.g. CBSheet.open(id)
  t?: translator, store?: { get, set }, // optional host services
}) → { refresh(rows?), destroy() }
```
**Same everywhere:** the shell. **Different per place:** columns, grouping, actions, bulk operations, next level (Athi's
rule).

## Proof
- **`public/list-lab.html`:** a standalone page that loads ONLY `list-ctl.js` (no app.html, no app CSS) and shows every
  feature on sample data: grid / lines, chooser, groups, expand, actions, bulk, phone width, a dark theme. It's the
  unit's own gallery, and the pass mark for the look.
- **`e2e/list-unit.cjs`:** on list-lab.html: everything works with no host globals defined; storage throwing still
  renders; 390 px with no sideways scroll; keyboard and ARIA. **`e2e/list-unit-breaks.cjs`:** a page that reads `UI.` or
  calls a host `tx(` from inside the unit → caught; a second chooser builder anywhere in public/ (e.g. the Platform's
  `platColMenuHTML`) → caught; a grid header without a resize handle → caught; a list whose column header scrolls away
  with the rows → caught; a second resizer (`*ColResize*`) outside the unit → caught.
- **`e2e/list-standard.cjs`:** a GUARD over every page (app.html, accounts.html, the Labs): any element that draws a
  column-header row (`role=columnheader`, `.lhead`, or a `<thead>` in a list) must belong to a CBList mount. A hand-drawn
  table header anywhere fails the run, so the rule holds without Athi repeating it. (Reports and printed documents, such
  as the bill slip and the final accounts printout, are listed exceptions by name, each with its reason.)
- Checks on each mounted list: drag a header edge → the width changes and survives a reload; scroll the page 2,000 px →
  the column header's top is unchanged and still visible; the tools bar is still visible.
- Existing harnesses still pass: books-web, cb-accounts, list-behaviour, list-columns, list-controls, chit-sheet.

## Migration (move, never copy)
1. Wrap the 65 functions behind `CBList`, with dependencies passed in. Keep thin legacy names only while callers move,
   then delete them (dup-functions guard).
2. Move every caller to `CBList.mount`: Task (gains ▤/☰), Waiting, Day book, Dues, Ledgers, Cheques, Suppliers,
   Customers screen, and **the Platform screen (its own chooser deleted)**.
3. Expand all / Collapse all become part of the shell, for every list with a next level.
4. Later, once proven: release it from chitbridge-engines like `screen` (one codebase, adopted by web and the counter).

## Not in scope
The detail page (its own unit: docs/design/chit-detail) · server paging (`platformScreen` stays server-paged; it uses the
unit's look over its own pager).

## Built (2026-10-03) — what is in `public/app/list-ctl.js` now
**CBList is the file.** `window.CBList = { mount, nextRow, get, reset }` and nothing else; it reads nothing from its page (checked by
`e2e/list-unit.cjs`: no `UI.`, no `tx(`, no `uk(`, a global-read trap on every name the old file borrowed). Added to the contract above, each
because a real list needed it and none could be written without it:
- `head: { title, period, notices, chips }` — `chips` are information (the Day book's per-counter and by-tender strip), `notices` are warnings that
  open their fix. On a container ≤ 640 px they fold into ONE chip that opens them, so the head stays within 30% of a phone.
- `remote: { total, onQuery, foot }` + `sortNow()` — a SERVER-paged list (Platform, Task): the unit draws the page it is given, a heading click asks the
  page which sort it wants, `foot()` is the page's own pager. `tools: { search: false, csv: false }` for a page whose search lives in its own bar.
- `fill: false` — a rail (Task, Customers, Suppliers, Platform) lets its pane size the list; every other list fills the rest of the window.
- `cardMax` — on a narrow container a card carries at most N fields; the ticked ones left out are NAMED in the chooser ("hidden — no room").
- `hl: false` (the page owns the highlight), `lead: { on, cell }` (a page-drawn select column), `store` (Task keeps its cb_cols key), `tids` (a page keeps its test ids).
- `next(row, { view })` may return a Promise (the Ledger's journal is read on the first open); `CBList.nextRow(cells, widths)` is the row of a next level.
**Moved onto it:** Task · Waiting · Day book · Dues · Ledger entries · Cheques · Bills (CB Accounts) · Customers · Suppliers · Platform.
**Deleted, not moved:** the Platform's `platColMenuHTML` / `platColResize*` / `platToggleColMenu` / `platCols` (the unit's chooser and handles replace them),
Task's `colResize*` / `applyColTpl` / `rowPeek*` / `fittedCols`, the hover peek, `tblFit` (nothing is folded away any more: a column that does not fit is reached by
scrolling the rows sideways).
**Kept, thin, until their callers move** (`public/app/list-legacy.js`): `listCtl*` for the two CARD lists (Intake, Disputes) and the Ledgers tree's search box, and
`lazyWrap` for the catalogue, the message thread and the activity feeds. They borrow `tx()` / `esc()` from the page, which is why they are not in the unit.
**The guard:** `e2e/list-standard.cjs` — a column header written anywhere but the unit fails the run; the hand-drawn tables that are still outside the nine lists
are a named ratchet (it only goes down), the printed documents are named exceptions.

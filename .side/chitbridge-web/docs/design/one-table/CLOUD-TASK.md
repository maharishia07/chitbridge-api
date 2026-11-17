# Cloud task — ONE TABLE: every list is the Task table; a row's next level and details open the Task way

**Outcome (one):** the Ledger's lists in CB Accounts and the app — **Waiting, Day book, Dues** (then Cheques, Bills) — are
drawn by the SAME code that draws the Task list, with no style of their own. Athi, 2026-10-02: *"the same task header style
has to be used in other places, so the information can be a proper tabular format … if you expand the header show the next
level of information"* and *"do not create new style anywhere, the first question is how do i reuse."* Read
**CLAUDE.md rules 1–5 first** — rule 5 names every piece below. Branch `cloud/one-table` (this file is its only commit);
PR against `main`; never push to `main`.

## Reuse — exactly these, nothing new
| Need | Existing piece (file:line on main) |
|---|---|
| header + rows | `listHeader()` app.html:16796 · `rowGrid(c)` :16799 · `colTemplate()` :16772 · `visibleRows()` :16626 · `paintRowsOnly()` :16625 |
| search · filters · sort · paging · count | `public/app/list-ctl.js` (a screen DECLARES its list once) |
| a row's next level | Task's Group-sum expand: `gsToggle(i)` + `_groupSumPane()` in `public/app/cap-folders.js` (:333, :349) — accounts.html already loads cap-folders.js |
| a row's details | `openChitSheet(id)` (public/app/chit-sheet.js) for a bill; Task's `openChit` otherwise |
| hover preview | `rowPeekShow / rowPeekHide` app.html:16777/16794 |

**The one structural move:** `listHeader · rowGrid · colTemplate` (+ what they need) live inside app.html, and accounts.html
does not load app.html. MOVE them (not copy) into a file BOTH pages load — `public/app/list-ctl.js` is the natural home (it is
the shared list engine) — so the Task screen and CB Accounts call one implementation. They read `UI.*` today: give them their
inputs as arguments (the columns, the rows, the selection) so a second page can call them; the Task screen's own look and
behaviour must not change (its harnesses prove it).

## The screens
1. **Waiting** (cap-books.js `bkWaitingView`): rows = Supplier · Bill no · Amount (`summary_json.money.total` — READ, never
   summed) · Date · Step. No chit id, no "tries"; a posting that genuinely failed shows its reason and Try again. Next level =
   the bill's lines; click = `openChitSheet`.
2. **Day book** (cap-books.js `bkDaybook` + PR #9's `bkDvRowHTML` :626 and the `.bkdv-*` CSS :88–96): rows = the entry
   (date · entry no · kind · party · bill · tender · counter · amount); next level = its Dr/Cr ledger lines; the bill number
   opens `openChitSheet`. DELETE the `.bkdv-row` drawing and its CSS — keep the search, chips, Day/Week/Month groups and
   CSV, now as list-ctl declarations and the Task table's group rows. Keyboard (↑ ↓ Enter, Esc) stays.
3. **Dues** (cap-books.js `bkDuesTable` :847): rows = party · total due · oldest; next level = the age buckets and the open
   bills (this ends the 8+ columns cut off at the right edge).
4. Cheques and Bills (Received / Issued) if time allows — same pattern; list what is left in the PR.

## Proof (exit codes; commit outputs)
- `node e2e/list-controls.cjs` and `node e2e/list-behaviour.cjs` — baseline stays EMPTY (0).
- `node e2e/books-web.cjs`, `node e2e/cb-accounts.cjs`, `node e2e/chit-sheet.cjs`, `node e2e/index-page.cjs` → 0, updated
  where a selector moved; and the Task screen's own harness(es) unchanged and green (find them by grepping `listHeader`).
- NEW break in `e2e/books-web-breaks.cjs`: a ledger screen that draws its own rows (re-insert a `.bkdv-row` renderer) → caught.
- `node scripts/check-syntax.js`, `node scripts/check-app-parses.cjs`, `npm run check`, `node e2e/cb-build-guard.cjs` (bump
  CB_BUILD), `node e2e/docs-guard.cjs` (regenerate MODULES.md with tools/gen-modules-doc.cjs if a module moved).
- Screenshots: `e2e/shots/one-table-{waiting,daybook,dues}-{laptop,phone}.png` (phone: one card per row, `scrollWidth === 390`).
- Playwright: `@playwright/test` is not in the repo — install it outside (npm i @playwright/test@1.61.0 in a temp dir) and
  point NODE_PATH at it; say so in the PR.

## Do not touch
`public/till.html` and `public/engine/*` (vendored), the API repo, SQL, `e2e/tests/*.spec.js`. Never call the live site,
localhost:3000 or port 7351 (stand-in APIs on a free port, as the harnesses already do). Commit messages end with
`Co-Authored-By: Claude <noreply@anthropic.com>`.

## Added 2026-10-02 (Athi, live: "i couldn't see the folder for each of the ledger, how do i open the folders, no folder
## symbol or something to see it as a folder, or a tree structure")
5. **Ledgers = the folder tree + the Task table** — REUSE `foldersScreen()`'s layout and `_folderTree(parentId, depth)` from
   `public/app/cap-folders.js` (:54 — "a per-entity TREE … tree (left, recursive/nestable) + list", the same pattern as the
   Network tree; accounts.html already loads cap-folders.js). Left: the four bands (People · Things you hold · Income and
   expenses · Your capital) as top folders → their groups (Debtors, Cash & bank, Duties & taxes …) → each ledger as a leaf,
   with the folder look the tree already has. Right: the chosen ledger's entries in the Task table (rows = entries; next level
   = the journal's lines; a bill number opens `openChitSheet`), balance carried at the top. Replaces the chip-cloud /
   card Ledgers view for navigation; the designer's section rule lines may stay as the tree's group captions if they fit
   the tree's existing look — no new style. Phone: the tree collapses to a breadcrumb the way foldersScreen does.
   Proof: in e2e/cb-accounts.cjs — open a band → a group → a ledger → its entries → expand one → open its bill.

## Added 2026-10-02, later (Athi, live on Tally Test: "in the sundry debtors, all are come under tallytest as if tally test
## is suppose to pay, it has to be for each of the debtors and its a separate ledger for each one of them")
The books already keep every line against its party (`journal_line.party_id`) and serve each party's ledger — this is
SCREEN work only. Proven by chitbridge-engines `tests/golden-books.test.js` (branch `test/golden-books`, Part A 13/13).
6. **One ledger per party under the control accounts** — in item 5's tree, Customers (Sundry Debtors) and Suppliers
   (Sundry Creditors) are FOLDERS whose leaves are the parties (name · balance), from `GET /api/books/dues` (one read, every
   party's balance). Opening a party shows ITS ledger in the Task table from `GET /api/books/party/:id/statement` (opening ·
   each bill · receipts · closing, running balance). The control account's own view stays (its total = the sum of its
   parties — show both figures; they must agree).
7. **Every ledger and day-book row names the OTHER PARTY.** Rows of 1300/2100 (and every ledger the line has a `party_id`
   on) show the party's name in the party column. The counter and the person who rang the bill are NOT the party: show them
   as "rung by Tally Test (owner) · Counter C2" in the secondary text, never where a party name goes. Today 1300 rows read
   "On credit · Counter C2 · Tally Test (owner)" with no customer — read as if the shop owes itself.
8. **The rate in the day-book expansion** — each tax and sales line carries its rate ("Output CGST 6%", "Sales @12%"),
   read from the line / the frozen invoice, never worked out.
Proof additions in e2e/cb-accounts.cjs: Debtors folder lists ≥ 2 parties with balances summing to the 1300 total; opening
one shows only that party's bills; no 1300 row has an empty party; no row shows the owner/counter in the party column.

## Added 2026-10-02 (Athi: "each customer / supplier will have a customer id, and it should be used in ledger? and this id
## to be linked to system user id, so better we showcase a table in the CRM")
The id EXISTS: `party_no` (b274 — one series per shop, customers and suppliers share it; a party on both lists keeps one
number), on `customer_list` / `supplier_list`, and every ledger line's `party_id` is the party's ChitBridge identity (its
`user_id`, `bridge_id`). The list APIs already decorate each row with `party_no · balance_minor · oldest_due · tax_ids`
(lib/party-fields `decorate`). The API side (number at the moment a party is added; `user_id`, `bridge_id`, `on_rail` +
`one_sided.why` on each list row) is done separately on the API repo — read whatever fields the rows carry; do not touch the API.
9. **CRM Customers and Suppliers are Task tables** (same reuse as items 1–3): columns **Party no · Name · ChitBridge ID**
   (user_id, or "not on ChitBridge" for a local party) **· Balance · Oldest due · Credit terms · GSTIN**; a party whose bills
   or orders stay one-sided shows it quietly with the reason on hover. Next level = the party's open bills; click = the
   party's existing detail pane. Sort and search by party no, name or ChitBridge ID (list-ctl declarations).
10. **The party no is the ledger's key on screen:** wherever item 6/7 names a party, it reads "P0007 · Chola Auto Care";
    the tree's party leaves are ordered by party no; search finds a party by its number.
Proof additions: e2e — the CRM table shows party no and ChitBridge ID for every row; a ledger row's "P…" equals the CRM
row's for the same party.

## ⚠️ MOVED 2026-10-02 — items 6, 7 and 10 are built by `cloud/party-ledgers` (docs/design/party-ledgers/CLOUD-TASK.md)
Do NOT rebuild them. When this task runs, rebase on main after party-ledgers has merged and REUSE what it built: the party
table under 1300/2100 becomes the Debtors/Creditors folders' leaves in item 5's tree (same dues read, same statement), and the
"P-0007 · Name" party part and "rung by" stay exactly as party-ledgers made them.

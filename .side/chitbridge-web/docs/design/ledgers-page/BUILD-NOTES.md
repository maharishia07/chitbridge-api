# Ledgers redesign — what was built, what was not (cloud/ledgers-redesign, 2026-10-03)

The handoff in this folder (README · index.html · styles.css · app.js · data.js · shots) is the design; `CLOUD-TASK.md` is the brief for the
build. This file is the build's own record: where the product differs from the prototype, and every field the API lacks.
The prototype's purple "PROTOTYPE ONLY" strip is **deleted** from index.html, styles.css and app.js (nothing of it was built).

## Where it lives
| Piece | File |
|---|---|
| The two panes: tree, find box, keyboard, resize, fold, phone pages, the list declaration, the head | `public/app/cap-books.js` (the Ledgers section, `bkLt*` / `bkLg*`) |
| The page shell for the Ledgers view (header steps aside, shop · Home · avatar ride in the list's title row, the menu rests as its rail) | `public/accounts.html` |
| The kural footer, ONE unit every CB page mounts | `public/app/kural.js` (+ `public/app/kurals.json`, the copy of `docs/design/kural-kit/kurals.json`) |
| Proof | `e2e/cb-accounts.cjs`, `e2e/books-web.cjs`, `e2e/kural-footer.cjs` and their `*-breaks.cjs` |

## Reuse points (CLAUDE.md rule 1) — what was searched and what was reused
- The list is a `CBList` mount (`list-ctl.js`): period chip, search, filters, group, sort, ⚙ columns, ▤/☰, CSV, ⇣/⇡, the four states, `next`, `actions`. Nothing draws its own row.
- The opened entry is `bkDvNext` (the Day book's journal block), extended **additively** with a 5th argument that makes the open ledger's line bold.
- The period chip's presets are the Day book's (`bkDbPeriod` / `bkDbPeriodLabel`); the date helpers, `bkMoney` / `bkDrCr`, `bkPartyLabel`, `bkBillPart`, `bkRecordedHTML`, `bkHowPart`, `bkRungPart`, `counterWord`, `bkDvGroupOf`, `bkDvVals`, `enReverse` are all existing.
- Money is read: `bkBalances` (one trial-balance read), `/dues` (one read for every party), `booksLedger`, `booksStatement`. The page adds up no money except the one comparison it always made (see "parties check" below).
- The avatar is `CBAvatar`, still ONE node: `accounts.html` holds it as `WHO` and moves it into the list's title row (`BK.slotWho`) — never a copy.

## New paths (CLAUDE.md rule 4) — each with why nothing existing served
| New | Why |
|---|---|
| `CBKural` (`kural.js`) | no band like it existed; the decision says ONE unit every page mounts, like `CBAvatar`. |
| the tree (`bkLtNodes` · `bkLtTreeHTML` · `bkLtBind` …) | `_folderNode` is a folder row with an icon and an inline `onclick`, and `gsToggle` (cap-folders.js) opens a Task group's rows, not a tree; the design needs one-line nodes, one aligned figure column, roving focus and arrow keys. It still reads the same model (`bkLtModel`, grouping by code) the old tree did. |
| `bkShort` | the short display name (designer extra #2): the API sends none; this derives the display only. |
| `bkLgCsv` / `bkLgDownload` | the Day book's CSV is entry-shaped; a ledger line is not an entry. Same quoting rules. |
| `bkLgFigs` | the one figures line; the closing used to be printed three times. |
| the `cb_lt.<person>` memory | the last ledger, the tree's width and what is folded, per person, on this device. |

## What the API lacks — kept as today's behaviour, and listed (each becomes an API task)
(Confirmed against `e2e/fixtures/web-api.contract.json`, the API's own answers: none of `short_name`, `kural`, `parties_check`, `agreed_to` or month/day totals is in `/accounts`, `/dues`, `/ledger/:account` or `/party/:id/statement` today.)
1. **Per ledger and party: `short_name`** (≤ 24 letters, set once in Parties). The page derives a display name (bracket and legal-form tail dropped); the full name is the tooltip.
2. **Per ledger: `kural`** (its number). The page maps the open ledger's code to a route of kurals.json (Cash & bank → 520, GST/TDS → 733, Suspense → 436, Income and expenses → 754, Your capital → 385, else 120).
3. **Per control account, per period: the parties check** — `parties_check: { agree: true }` or `{ agree: false, amount_minor, entries }` (entries with no party). The page reads it when sent; until then it compares the `/dues` balances with the ledger's closing — the same single sum it always made — and counts the lines that name no party.
4. **Month and day totals** (count · Dr · Cr) per group. A group row says only "n shown".
5. **Per party: `agreed_to`** (the last month end both sides agreed). Drawn when sent: a ✓ beside the party in the tree and a "✓ Agreed up to 31 Aug 2026" chip in the head; hidden otherwise. (The designer's marker line *between* two entries needs a row kind CBList does not have — see the CBList gaps.)
6. **The tree's figures follow the period**: today they are the trial balance as of today (one read), not the chosen period's closing.
7. **A "send the statement" route** (designer extra #5). The **Statement** button on a party's ledger opens the party's own statement view (CB CRM's party record, whose Ledger section carries it).
8. **A `ledgers` person-preference kind** for `CBPrefs` (designer extra #6): the last ledger is remembered per person, on this device only, until it exists.
9. Designer extra #3 (block an entry on a control account that has no party, at ＋ Entry; the To-do home's "1 receipt has no party › Fix") is an **API / ＋Entry rule** — not built here.
10. Designer extra #4 (the month-end To-do "3 suppliers not agreed for September › Send statements") is an **API** item — not built here.

## CBList gaps found (list-ctl.js was not touched; its contract was used)
- The head's chips are plain text: the figures line cannot bold its figures or paint "✓ parties agree" green. On a phone CBList folds the chips and the notice into ONE "N notices ▾" chip, so when the amber notice shows, the figures are in its popover.
- A notice cannot preset a filter (the "Show it" fix): the page keeps a flag and the notice becomes a "Showing the 1 entry with no party · Show all" toggle. A `CBList` way to set a filter would let it use the Party filter.
- A row kind that is a marker (the "✓ Agreed up to" line between entries) does not exist; the head chip stands in.
- The title row lives inside the list's mount, so it cannot span both panes the way the prototype's does; the tree pane has its own find row beside it.
- `filters[].options` are read at paint, so the page refreshes the filters when the ledger arrives (it works, but is a quiet contract).

## Where the build differs from the prototype
- **Menu rail:** CB Accounts' own sidebar rests as its icon rail on this view (the prototype has no sidebar). Together with the shop name and "Home" folding to an icon, that is what keeps the head to one title row and one tools row.
- **Narrow laptops (≈1024–1200):** the tree opens folded once a ledger is open and comes back **over** the list for one pick (`☰ Ledgers`), so the list keeps the width its tools row needs. Measured: 17% at 1366×768 and at 1080×768.
- **Period chip** says the preset's name ("This FY") when the pane is under 1100 px; the dates are in its popover.
- **Party column** keeps "P-00001 · Ravi Stores" (Athi, 2026-10-02: a row names its party by number and name); the **tree** drops the number (Athi, 2026-10-03: codes stay out unless typed) — it is the node's tooltip and what the find box takes.
- **`app.html`** does not mount the kural footer: its screens are repainted from one `#root`, its Messages composer sits beside the shell, and none of its screens has a route in kurals.json. `accounts.html`, `crm.html` and `index.html` do.

## Measured (e2e/cb-accounts.cjs)
Head ≤ 20% at 1366×768 and 1080×768 (17%), ≤ 30% at 390 (24–29%), in every state, in Cream, Dark and Terminal; no sideways scroll at 1366, 1080 and 390.

## Head budget, 13 Nov 2026 (q356)
The 9 Nov tap rule (32 px controls) took the head to 26% on a laptop and 36% on a phone party ledger. Now: the list passes `foldHead: true` (list-ctl: the phone fold at every width: Group, Columns and CSV inside one **View** chip; the figures and a notice into one notices chip when there are two or more); on a pane over 620 px the title row and the tools row share ONE row (cap-books.js, `#bk_lt #lg_out`), and the column header is the second line; on a phone the search, Filters, View and count share one line. Measured (e2e/cb-accounts.cjs, sit-grund): laptop 18% (was 26%), narrow laptop 18% (was 26%), phone party 30% (was 36%), in Cream, Dark and Terminal. The Columns gear and the notice popover are one step inside their chips.

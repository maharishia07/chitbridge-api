# Cloud task — PARTY LEDGERS: one ledger per customer and supplier, and every row names its party (Sonnet)

**Outcome (one):** in CB Accounts (and the in-app Ledger, which shares the code), opening **1300 Customers (Sundry Debtors)**
or **2100 Suppliers (Sundry Creditors)** shows ONE LEDGER PER PARTY under it, and every ledger row names the other party.
Branch `cloud/party-ledgers` (this file is its only commit) → PR against `main`; never push to `main`. Web repo only.

Athi, live on Tally Test, 2026-10-02: *"in the sundry debtors, all are come under tallytest as if tally test is suppose to pay,
it has to be for each of the debtors and its a separate ledger for each one of them"* · *"each customer / supplier will have a
customer id, and it should be used in ledger"*.

**This is SCREEN work only — the data is already right.** Every journal line carries `party_id`; each party has a number
(`party_no`, e.g. `P-0007`) and its own statement. Proven by chitbridge-engines `tests/golden-books.test.js` (Part A 13/13:
debtors per customer, creditors per supplier, control = sum of parties). Read CLAUDE.md rules 1–5 first: reuse, no new style.

## Reuse — exactly these
| Need | Existing piece |
|---|---|
| every party's no · name · balance · oldest due, in ONE read | `api('booksDues', { query: { asOf } })` → `GET /api/books/dues` → `parties[{ party_id, party_no, name, side, balance_minor, oldest_due, … }]`; loader `booksDuesLoad()` cap-books.js:127 |
| one party's ledger (opening · lines · closing, running) | `partyStatementLoad(partyId)` cap-books.js:181 → `GET /api/books/party/:id/statement`; drawn by `statementHTML(r)` :245 |
| a control account's ledger | `bkLedgerShow()` cap-books.js:787 (`GET /api/books/ledger/:account`, lines carry `party_id`); opened in CB Accounts by the `ledger:open` handler, accounts.html:530 |
| the row's "where it came from" text | `bkSourceParts(s, tid, cur)` cap-books.js:207 and `bkEntryHead` :225 |
| table look | the existing `.bktab` statement table (no new CSS) |

## Build
1. **Parties under a control account.** When the opened ledger is 1300 or 2100 (`bkLedgerShow` / the `ledger:open` handler),
   draw — ABOVE the control account's own statement — a "By customer" (1300) / "By supplier" (2100) table from ONE
   `booksDues` read: **Party no · Name · Balance · Oldest due**, ordered by party no, with a total row that MUST equal the
   control account's closing (show both; if they differ, show the difference in words — never hide it). Clicking a party opens
   ITS ledger below (`partyStatementLoad` / `statementHTML`), with an "‹ All customers" / "‹ All suppliers" link back. One read
   for the list — never a statement fetch per row. The control account's own combined statement stays, under a caption
   "All entries".
2. **Every row names its party.** In `statementHTML` rows (and the day book's entry head, `bkEntryHead`), when the line/entry has
   a party, the FIRST part after the entry's word is **"P-0007 · Chola Auto Care"** (party_no · name, from the same dues map;
   name alone if no number; the bare id never). Build the map once per render from the dues read already loaded.
3. **The person who rang it up is not the party.** In `bkSourceParts` (:220) the `s.by` part reads **"rung by Tally Test
   (owner)"** (tx('rung by') + name + the existing owner mark) and comes LAST, after the counter. Today a 1300 row reads
   "Sale · Bill C2/26-27/0016 · On credit · Counter C2 · Tally Test (owner)" with no customer — read as if the shop owes itself.
   After: "Sale · P-0012 · desktop1 · Bill C2/26-27/0016 · On credit · Counter C2 · rung by Tally Test (owner)".
4. Phone (390px): the party table collapses to one line per party (name · balance), `scrollWidth === 390`.

## Proof (exit codes; commit outputs)
- `e2e/cb-accounts.cjs` (stand-in API on a free OS port — never localhost:3000, port 7351 or the live site) gains: open 1300 →
  the party table lists ≥ 2 customers with party no and balance, their total equals the 1300 closing; click one → only that
  party's bills, opening and closing right; every 1300 row has a party name; no row shows the owner/counter where the party
  goes; "rung by" present; 2100 the same for suppliers; one `/api/books/dues` request for the table (count requests).
- `e2e/cb-accounts-breaks.cjs`: a per-row statement fetch → caught; a row without its party → caught; "rung by" missing → caught.
- `node e2e/books-web.cjs` → 0 (update selectors only where a part moved). `node scripts/check-syntax.js`,
  `node scripts/check-app-parses.cjs`, `node e2e/cb-build-guard.cjs` (bump CB_BUILD).
- ⚠️ `npm run check` includes engine/adoption checks that need the sibling `chitbridge-engines` repo, which this cloud VM does
  not have — run every other `check:*` script individually and list in the PR which were skipped and why. Do not "fix" them.
- Playwright is not in the repo: `npm i @playwright/test@1.61.0` in a temp dir and point NODE_PATH at it; say so in the PR.
- Screenshots: `e2e/shots/party-ledgers-{debtors,one-party,creditors,phone}.png`.

## Do not touch
`public/till.html`, `public/engine/*` (vendored), the API repo, SQL, `e2e/tests/*.spec.js`, the Ledgers tree layout (that is
the One table task). Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

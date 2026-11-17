# Critique · R106 PR 2, web accounts (written before any code, 2026-10-24) — accept at the count, hold, note a difference

## (a) What the brief assumes, checked
- "the waiting row offers Accept-at-count from waiting[].short" — TRUE: api #425 puts `short { theirs_minor, ours_minor, short_minor }` on `GET /health waiting[]` (books-hooks waitingRow:1005), the row keeps `todo: 'accept'`; cap-books.js bkWaitCols (:5786) paints the Step cell and has the row's data.
- "the bill sheet's Accept can name the counted figure" — FALSE today: the chit read's `books_wait` (api books-store waitOfChitSql:893) selects todo · name · why · candidates, never `short`; the sheet (chit-sheet.js acceptAsk:1149) would promise THEIR ₹2,940 while the server posts ₹2,690. The page's own /health read holds the figures (BK.waiting), so the sheet asks that reader; api follow-up: add `'short', event->'short'` to waitOfChitSql (cb-accounting, 1 line).
- "the Payables row offers Release" — PARTLY: `payable.bills[]` is undisputed-only (api books-payables.js:9, datedSide 'out'), so a held bill LEAVES bills[] and a one-bill supplier leaves fpLoad's filter (cap-finance-pay.js:42). The party row keeps `disputed_minor` (routes/books.js:2483); the held bill's ref comes from the one open-bills reader the pay sheet already uses (POST /payments/preview → proposal[].disputed, FIELDS:419), read lazily when the row opens.
- "Note a difference through the ＋ Entry door" — PARTLY: cap-entry.js hosts any GET /events kind, but `debit_note`'s grid (api books-manual.js:400) names `pick: 'supplier'` (no such pick list) and `kind: 'lines'` (the web paints JOURNAL lines, ledger · Dr/Cr); the door must be widened, not copied: a party pick by side, item lines (name · qty · rate · tax %), a preset that stops at the step still to fill, and a confirm on Save.
- "CBAction's confirm, as W1a Set rate" — TRUE: `CBAction.run(btn, fn, { confirm: { title, body, yes } })` (accounts-shell.js:444); on accounts/finance pages CBConfirm is the dialog.

## (b) Conflicts with rules and constructs
- Column 13: every figure painted is the server's (short_minor, open_minor, the preview's lines, STATUS_WORDS from the dispute answer); the screen sends typed qty × rate as DATA and never sums. One hold = party_status (no `held`); one debit-note door = POST /events; one accept = the chit's own PUT /status (the same move the sheet makes).
- finance-guard.cjs:78 freezes Payables' calls to `booksDues` only; it widens to name the two new doors (booksPayPreview for the held list, booksDispute) and still forbids money arithmetic.
- The contract fixture becomes a byte copy of the api master (contract.cjs §2); `POST /parties/:id/dispute` is not in the contract (no new route), so the stand-in's answer is unchecked — the walk asserts the body it sends instead.

## (c) A simpler way
- None simpler for Hold/Accept. For the held list, the api carrying held bills in `payable.bills` with `disputed: true` would remove the preview read; filed for cb-accounting, the web reads `bill.disputed` when it comes.

## (d) Risks
- cap-books.js and chit-sheet.js are shared by app.html (CB_BUILD → g); cap-entry.js is G-MONEY (accounting's card) — same group, widened in place. Another builder is on the till master (#403/#428): till.html untouched. No SQL, no engines.

## (e) VERDICT: BUILD WITH CHANGES
1. The sheet's confirm names the counted figure from the page's /health row (api follow-up named). 2. The held bill is read from the pay sheet's one open-bills reader, never kept client-side. 3. The ＋ Entry door is widened (party pick by side, item lines, preset step, Save asks for a debit note), not a second form.

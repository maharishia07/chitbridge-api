# books-cashflow — CB Finance · cash position (card `16-finance/books-cashflow`)

Lives here until `C:/dev/docs/16-finance/functions/` exists (the docs repo was empty on the W1-FIN runner, 2026-10-15). The module header's `CARD` line points at this id.

**Owns** · the cash position: `project()` (the one running-balance calculation) · `read()` (one query per source) · `datedSide()` (which bill lands on which day, cheques covering oldest-due-first) · `gstLine()` (the return's line and its series item) · `returnDueFor()` / `returnWords()` (WHEN the tax owed falls due and what the pack calls its return — the pack's calendar, never a day typed here).
**Called by** · `routes/books.js` GET /api/books/cashflow (owner) · `lib/books-payables.js` (datedSide 'out', day · ymd · toMinor · fromMinor).
**Flow** · `read() → S.accounts · S.items ×2 · S.cheques · S.parties · B.asAtInput → P.gstPayableAt · returnDueFor · promisesOf → project() → datedSide ×2 · gstLine · the running balance`

## TRACE

| requirement | spec | design | flow step | unit test | walks | routes | tables | status |
|---|---|---|---|---|---|---|---|---|
| CB-FINANCE-PLAN §4 F3 (cash position) · FIN-R4 (W1-FIN: the return date is the country pack's) | `C:/dev/docs/16-finance/CB-FINANCE-PLAN.md` §4 | `docs/FIELDS.md` › GET /api/books/cashflow (every key) · `docs/critique/W1-FIN.md` | O2C step 8 · R2R step 8 "cash position" (web `docs/process/flows.json`) | `tests/books-cashflow.test.cjs` — project: shortfall · no-shortfall · promises · cheques · disputed · overdue payable; returnDueFor: IN · AU quarterly/monthly · AE with/without stagger · no pack; project AU (BAS counted on its 28th, the sentence says BAS) · AE (date unknown → not counted, said); route: /cashflow 7 · 30 · the clock moved | web `e2e/walk-finance-cash.cjs` C1–C13 (C8: the return chip inside the window; C8b: no date → the sentence) | GET /api/books/cashflow · GET /api/books/cheques (pdc_reminders) | reads only: account · party_item · books_payment · books_setting · account_balance | live |

## Engines it reuses (one calculation)
`CBReceivables.outstanding · fromItems · propose` · `CBLedger.balanceAsAt` · `CBPosting.gstSetOff` (via books-period.gstPayableAt) · `gst-returns.dueDate · periodsFor` (reg-in · reg-au basPeriods · reg-ae periods) · `money.round / decimals` · `accounts-packs.fiscalYearOf`.

## Decisions carried
Finance suggests, the owner decides — nothing posts. An overdue receivable nobody promised is not counted (named in `uncounted`). A disputed bill is frozen. A return date the pack will not guess (AE without its FTA stagger) is null with its sentence: a forecast dates nothing it cannot. AU's frequency defaults to quarterly, as GET /returns does, until a shop setting stores it.

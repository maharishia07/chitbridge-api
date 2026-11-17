# REQUIREMENT — CB Accounts: where everything lives (layout for the designer · 2026-10-03)

**Status:** requirement. Pass mark: docs/design/list-standard/index.html + SYSTEM.md §3a (FROZEN look). Never "accounting".
Athi, 2026-10-03: *"all the required items are in backlog … complete one after other and need to see how to represent all in the UI?"*

## Why
About fifteen abilities are landing: ＋ Entry, bank reconciliation, GSTR-2B matching, e-invoice / e-way bill, reverse charge,
assets and depreciation, closing stock, accruals and recurring entries, GST close and pay, year close, cash flow, ratios, the
audit trail, loans, plus what exists. Added one by one as menu items, CB Accounts becomes a maze. This is the ONE layout they all fit.

## 1 · The "To do" home (only a failing thing earns a row; every warning carries its fix)
Opens CB Accounts. Each row: a symbol, a count, a short sentence, ONE button. Examples, each from a real check:
"⚠ 4 bank lines not in your books › Match" · "⚠ 2 purchase bills missing from GSTR-2B › Review" · "GST for September due 20 Oct ›
Close & pay" · "September not locked › Lock" · "Closing stock not entered for September › Enter" · "3 supplier bills to accept ›
Open" · "Rent (recurring) due today › Post". All fine → one line "✓ Books up to date", nothing else. The checks come from the API
(one endpoint that lists them); the page draws, it doesn't decide.

## 2 · The sidebar: six groups, by the work
| Group | Pages |
|---|---|
| Daily | Day book (＋ Entry lives here) · Bills · Waiting · Bank (reconcile) |
| People | Dues · Cheques · Parties ↗ (opens CB CRM) |
| GST | Returns (GSTR-1 / 3B) · 2B match · e-invoice / e-way bill. Reverse charge has no page: it shows inside bills and returns |
| Month & year end | Month lock · Closing stock · Assets & depreciation · Accruals & recurring · GST close & pay · Year close |
| Reports | Trial balance · Trading + P&L · Balance sheet (proprietor or Schedule III by entity type) · Cash flow · Ratios · Audit trail |
| Setup | Opening balances · Shop ledgers · Loans · Packs for the CA |
Groups fold; the group holding today's To do items is open. Phone: the groups become a sheet.

## 3 · One door for new entries
Every new entry starts at ＋ Entry (docs/design/manual-entry/REQUIREMENT.md): a bank-only line ("Add missing"), a recurring rent,
an RCM bill, a loan EMI, a correction. One preview, one golden-rule explanation, numbered MJ.

## 4 · The frozen look everywhere
Every list is a CBList mount; the avatar is CBAvatar; a record opens in the one detail page (docs/design/chit-detail). The three-row head ≤ 20%.

## States to design
To do with many items / one / none · each group open/folded · phone sheet · a not-yet-migrated feature ("starts after an update").

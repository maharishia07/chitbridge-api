VERDICT: BUILD WITH CHANGES (critique: chitbridge-api docs/critique/PR1.md) · twin of chitbridge-api round/PR1-38350609196 · land AFTER the api PR · base integrate/1013b + main.
CB Accounts › Books › Parallel run (public/app/cap-compare.js): pick a snapshot → TB · P&L · BS · return side by side, differences first, WHY per line, our entries + chits under each, Open the ledger, Download CSV, Print (PDF). Manifest entry `compare` (AX1 reserved it; drawn in the auditor edition once AX1 lands).
Reuse: CBSteps + miRow (as Move in), CBList (defaultCols, next level), CBAction for the one write, bkMoney/bkDrCr, Ledgers view via BK.lt.sel, openChitSheet; every figure and sentence is the server's. Flow PRN steps 1–3 added to docs/process/flows.json.
Walk: e2e/walk-compare.cjs 12/12 — the api's REAL books routes in-process over its in-memory books (IN shop vs a Tally XML; AU shop vs Xero CSVs), rule 13 in Cream/Dark at 1366/390 (AA contrast, no sideways scroll, nothing clipped or floating, no app.html, copy in budget), contract-held. Not the Postgres sim stack (needs b309 run there).
Checks: guard-static · token-guard · dup-functions · contract (24/24) · check-syntax · check-app-parses · docs-guard all exit 0; cb-accounts 333 passed, the same 10 failures as the untouched base.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

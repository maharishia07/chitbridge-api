**VERDICT: BUILD WITH CHANGES** (docs/critique/WX-R2R.md) · twin of chitbridge-api round/WX-R2R-38324465694 — land the api first.
R2R walked width + depth on a real stack (IN + AU three-year shops, 21 Accounts views × 1366/390): `e2e/walk-x-r2r.cjs` (--real · --at · fixture) + findings `docs/testing/WX-R2R-2026-10-13.md` — **23 found · 13 fixed (🔴5 🟠6 🟡2) · 10 open (🔴2 engines · 🟠2 · 🟡6)**.
Fixed here: CB Accounts paints the server's year (P&L refused, Day book 1 Apr, months Apr–Mar in ₹ on an AU July shop; Year close opened before the books) · TB / P&L / BS lines open their ledger · a refused entry no longer also says "the two sides do not match" · Waiting names a stuck walk-in day.
Re-run: IN 60/60 · IN --at 5/5 · AU 58/60 (E1/E2 engines) · AU --at 5/5 · fixture 22/22 (16/22 before the fix).
Reuse: BK.year from GET /books/health (api twin) · BK.lt.sel → bkLedgers/bkLtOpen · the Day book's link idiom · the server's period rows. New: bkYearStart/bkFyFrom/bkMonths/bkFyWord/bkFyPrev/bkPeriodOfDay (one reader of the server's year, replacing five April literals) · bkOpenLedger/bkLedgerLink · bkWaitDay · peLastYear. R2R steps 1 · 3 · 4 · 5 · 6.
Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses all 0; cb-accounts/manual-entry/books-web/period-end/chit-sheet carry the same reds as main. Contract fixture = api master byte copy.
Better than Xero because the year, the months and the money are the shop's own from the server — an Australian July year is never painted as an Indian April one.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# WX-P2P · the PR bodies (the runner's token could not open PRs: 403 createPullRequest — open them from these)

## chitbridge-api · round/WX-P2P-38319755085 → main (lands FIRST)

VERDICT: BUILD WITH CHANGES (critique: chitbridge-web docs/critique/WX-P2P.md) · lands FIRST, then the web twin (its walk asserts the refusals).
WX-P2P walk fixes, api side: 02 `/api/books` "today" is the shop's day (books-hooks.dayOf) · 04 supply-purchase sentence in shopkeeper words · 15 books writes a co-assist can reach (payments · propose · confirm · cheque steps · disputes) answer the rail ladder's 403 read_only/comment_only · 18 🔴 POST /api/actors saved every new co-assist as `editor` (the INSERT dropped access_level; b173's default won) — now writes the chosen level (else the hat's, lib/access.levelOf) + whole_entity behind the b173 probe.
Reuse: lib/rail.byLevel + rail.say, lib/access.levelOf, lib/schema.hasColumn, books-hooks.dayOf — no new function, field or route. Trips: unchanged except POST /api/actors gains one cached schema probe (not in the budget's called list); no migration run.
Tests: tests/iam-access.test.cjs (createLevelCases, fails 4 without the fix) · books-payments.test.cjs · scripts/guards.cjs green.
Open for the owner: co-assists created since b173 as Viewer/Commenter still hold `editor` — a demoting migration is proposed in web docs/testing/WX-P2P-2026-10-13.md (WX-P2P-18), not written. Engines row WX-P2P-16 (tax-lines.invoiceFor TotItemVal on an inclusive line) for the coordinator.
P2P step 6 · pay / settle (payments), platform · co-assists (actors).
Better than Xero/QuickBooks because a view-only seat is refused in the rail ladder's own sentence on every money write, not just hidden buttons.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## chitbridge-web · round/WX-P2P-38319755085 → main

VERDICT: BUILD WITH CHANGES (docs/critique/WX-P2P.md) · lands AFTER the api twin (round/WX-P2P-38319755085 in chitbridge-api).
Walked P2P on a real stack (postgres:16 + sim-load simstores 3 y IN + kumartrade 1 y; e2e/lib/stack-local.cjs): `e2e/walk-x-p2p.cjs --real` — width 18/18 (15 screens + 3 sheets at 1366 & 390), depth 24/24 (PO → supplier acts → bill → goods in → accept → books → pay → TB/P&L/GST → reverse → view-only refused).
Findings docs/testing/WX-P2P-2026-10-13.md: 19 found · 13 fixed (🔴 3/3 · 🟠 6/8 · 🟡 4/8) · 6 open with proposed fixes (07 buyer row state, 08 loader plans forward, 13 date input, 16 ENGINES invoiceFor TotItemVal, 06/12 not reproduced).
Web fixes: 01 Supplies deep link · 02 dues as-of server-decided · 03 Task state tab is a server bucket · 05 supply cost as money · 09 bill opened from CB Accounts stays open · 10/11 Pay sheet names the party, "Pay anyway" · 14 sheet head/foot fixed in accounts.html · 17 head names the other party · 19 Delivered records the pending the box shows.
New function: `chitOtherParty` (app.html) — the thread's existing other-party rule lifted so the detail head uses the same one (P2P step 2 · PO). Reuse: CBAction, fmtMoney, BK.dues, the sheet's .mhd/.mbody/.mfoot rules.
Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses all exit 0.
Better than Xero because the supplier and the buyer walk the same chit — the walk proves both sides see each step, not two disconnected documents.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

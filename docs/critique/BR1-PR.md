VERDICT: BUILD WITH CHANGES (critique: chitbridge-web docs/critique/BR1.md). No migration: b319–b321 are unused.
New `GET /api/books/bank/rail?from&to` (any login with the Ledger on; keys refused). It returns my payment-advice and `bank_query` copies (`rail_chits`), the on-rail parties to ask, and `may.ask` by the rail ladder (`lib/rail byLevel`). **Trips: 1 chit read + 1 party read** (budget line added by hand, `awaiting_client` until web round/BR1 lands).
The statement never reaches the server. Only the statement's two dates are asked. The ask goes through the existing `POST /api/chits/send`, and the answer is the payer's ordinary M30 advice, so there is no new answer shape.
Better than Xero/QBO because the bank line is confirmed from the chit both parties hold, and the payer is asked on the rail when nobody explained it.
New path: `books-store.bankRailChits`. No existing read lists advices by date (M31 is not built). New key `business_json.kind 'bank_query'` + the route's keys are in docs/FIELDS.md. Contract regenerated (`--write`); the web copy is byte-identical.
Checks: new `books-bank-rail.test.cjs` (9), books-store-sql, books-payments, books-todo, contract, round-trips-all, `scripts/guards.cjs` all pass (board case added).
Landing order: engines v1.44.1 (tagged) → **this** → web round/BR1.
🤖 Generated with [Claude Code](https://claude.com/claude-code)

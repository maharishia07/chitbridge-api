# Critique l16/firm-dash (written before code) — VERDICT: BUILD WITH CHANGES
Requirement: web docs/critique/l16-firm-dash-REQUIREMENT.md. Critic: cb-critic (sonnet), 2026-11-15. Baseline cited: Xero HQ client insights (https://www.xero.com/au/xero-hq/client-insights) shows per client cash, receivables, payables, revenue, net profit, bank-reconciliation status with unreconciled count/value; BAS Ready (Xero marketplace) shows which clients have BAS due. Ours adds one plain status and a stated rule; not their layout.
Changes taken:
1. /bank/log is in GRANT_HELD_BACK (middleware/books-grant.js:31): the bank figure (bank_rec_log statement rows) is NOT in this slice; it needs cb-finance. The band shows "bank: not yet" honestly. (coordinator: cb-finance to decide)
2. list() reads both presets, LIMIT 200 (lib/books-grant.js:196): practice reads one row per grantor, picked by the caller's role, no limit truncation silently (over 500 says so).
3. can_see_costs=false => margin and profit come back null. verdictOf() is reused per grant row (no copied rules). tooMany is called once per pair.
4. No lodged store: only "next BAS due" (books-cashflow.returnDueFor by each client's pack); never "overdue" unless the due date is past and says "due date passed, lodgement not recorded".
5. Log rows: writeLogRow's two shapes reused as one multi-row insert under the firm's binding; route pattern 'GET /practice'.
6. Receivables over 60 days and bills due 30 days are read from stored party_item pending_minor + due dates and are labelled "from open items"; cb-finance owns the rule (follow-up).
7. Sales/margin/profit: stored account_balance by fiscal_period of the client's own year; currency carried; mixed currency => figure null with reason.
8. Thresholds: one module default (lib/practice-health.js), returned in the answer, labelled "our starting rule". A firm-editable setting needs a migration: follow-up for cb-settings.
Risks: 150 statements in one message; measured on SIT before any claim. Twin PR: web + api; api lands first.

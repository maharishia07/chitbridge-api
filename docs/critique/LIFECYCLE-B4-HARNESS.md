# Critique · LIFECYCLE-B4 harness twin (order() and invoice() in tests/lib/truth-harness.cjs) · 2026-10-30 · builder cb-qa, read against origin/main 308ddedd

Design: C:/dev/PM/LIFECYCLE-B4-CHECKS.md §5.2 (DECIDED by laptop1 29 Oct; cb-critic READY-after-fixes). The runner (docs repo, QA's file) is the caller; this PR only widens the shared test harness.

**(a) Assumptions checked.** #554 (the B3 widening) is MERGED (2026-10-29) and added `billOpts`, `freshShop` options and `skip`, but NOT `order()` or `invoice()`: `grep -n "function order\|function invoice" tests/lib/truth-harness.cjs` finds nothing on origin/main — true, needed. The shapes exist inline: seed-local `demoSupplierBill` (scripts/seed-local.cjs:353, purpose `invoice`, `business_json.bill_no`) and an order chit (`purpose 'order'`, `business_json.side 'buy'`, lib/open-orders.js sideOf) — true. suppliers-truth SU-02 and stock-truth ST-19 build the invoice inline; pointing them at the helper is a follow-up for cb-operations, not this PR.

**(b) Conflicts.** None: no product route, no migration, no engines change, no second tax calculation (the invoice object is passed IN, built by the caller from the adopted `determine()`; the helper never computes tax). Widen never copy: `line()` is the existing row builder; `item_data.item_id` rides on every line so GET /till/match and deliver-lines find the line ids.

**(c) Simpler way.** Keep building the two chits inline in the run: rejected, three stages would carry three copies of the same body (second call site means one helper, 14 Oct rule).

**(d) Risks.** Additive exports only; the older callers (bill, creditNote, receipt, freshShop) are untouched. Landing order: this PR first, then the docs-repo stage files call `h.order` and `h.invoice` (until then the stage files skip with the reason, never a false pass).

**(e) VERDICT: BUILD AS BRIEFED.**

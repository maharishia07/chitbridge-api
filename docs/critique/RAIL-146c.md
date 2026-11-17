# RAIL-146c critique — the till's tasks and match carry the purchase price (written before code, 2026-10-29)
Base: api #569 (RAIL-146b, 06f780b5) on #568 (RAIL-147) on #567 (RAIL-146). Read: RAIL-BACKLOG RAIL-146c, RAIL-146-DESIGN, lib/cost-view whole, the 146b diff, _learned-counter.

(a) What the brief assumes, checked
- "tasks leak line rate" — TRUE: open-orders.orderLines maps `rate: line.price` (open-orders.js:122); liveLines lays progress prices over it (:98, :105). The row also carries `order.address` / `order.remark` (typed prose).
- "match leaks ordered/received/invoiced totals, rates, landed" — TRUE: matchOrder (till.js ~3745) writes ordered_total, received_total, invoiced_total, money_gap, line rate, receipts[].landed. Only `landed` was hidden (hideLanded, ONE key, a denylist).
- "/match is an owner screen of purchase orders" — PARTLY: sideOf(head, business) is the sender-declared side, not the reader's view; a mis-listed customer order can reach it. So the side is decided per order by costSideOf, not assumed.
- "the paired till key is never blind" — TRUE: cost.isCostBlind is false for any identity that is not an actor (writeRefusal), so the key's answer is the old literal.
- "no filter or sort over money" — TRUE already: neither route reads amount_min/amount_max/sort; moneyParams still strips and names them (cost_params_ignored) so a client that sends them is told.
- home-facts also calls open-orders.tasks (ids/count only, no money) — unchanged: the new argument is optional and off by default.

(b) Conflicts: none. ONE predicate (costSideOf), ONE prune (allowlist trees TASK_KEEP / MATCH_KEEP beside WORK_ROW_KEEP), ONE can_see_costs read per request (cost.isCostBlind). hideLanded FOLDS INTO MATCH_KEEP (landed is simply not named), so it is not a second rule.
(c) Simpler way: none safe — a denylist (rate, *_total) passes the next money key; six rounds on #567 say allowlist.
(d) Risks: a blind reader pays one side read per request (two statements), the owner none; an order from a party on no list hides its rates (fail closed); `verdict` stays (the engine's word agreed/differs/open/awaited, no figure) but it is derived from money_gap, a residual named in the PR; door `reason` is typed prose and goes; subject/party/ref/line name are typed words and stay (residual). Web twin only if till.html shows the figures (the till master is the api kit's file, never edited by a web PR).
(e) VERDICT: BUILD AS BRIEFED.

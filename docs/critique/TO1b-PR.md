# PR body · TO1b (api) — gh pr create was refused (403, every token in the runner); the coordinator opens the PR from this file

**VERDICT: BUILD WITH CHANGES** (web `docs/critique/TO1b.md`) — twin of chitbridge-web round/TO1b-38324650941; **this lands FIRST**, the web PR carries the vendored copy.
The till bills an order the Tasks & Orders frame hands it: `tasksOpen` hears `{ cb:'tasks', event:'bill', chit_id }`, closes the frame and calls `orderToBill` (the ONE bill path an online order already takes from the 🛒 list — shopper's prices, Delivery/Pickup as ordered, normal series + tax, `finish()` marks it done). New function `tasksBill` (tools/tally-connector/till.html): the order comes from the till's own `GET /api/till/tasks?kind=despatch` list, read again if not held; no new route, no new read, no budget line. Flow: O2C step 5 · invoice.
Better than Zoho/Vyapar because the order queue and the bill are one chit the shop already holds: nothing is re-keyed, the counter bill freezes invoice no + tax once, and a cash sale joins the day's walk-in summary — never one journal row per order.
Checks: `node scripts/guards.cjs` 4958 checks all passed · `npx mocha tests/till-vendor.test.js` 69 ok (after `CB_WEB_DIR=<web> node scripts/vendor-till.cjs`). No SQL, no secret, no dependency.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

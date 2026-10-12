# Critique · RI1b — restore the round-trip budget on api #120 (round/RI1-38319404094), add only RI1's lines

**(a) What the brief assumes, checked**
- "RI1 regenerated round-trips.budget.json with --write; the hand notes are flattened" — TRUE. `git diff origin/main -- round-trips.budget.json` is a re-sort of main's lines plus 14 /api/repeat lines; the last commit (2dbfe3a) says "awaiting_client" but the file carries `extra: true` (round-trips.budget.json:1050–1146) and no `awaiting_client` anywhere.
- "api main supports awaiting_client once #119 lands" — TRUE. #119 (guard/awaiting-client) is OPEN, mergeable; main's tests/round-trips-all.test.cjs:171 has no such key, so on main the marked routes are not fired and the "no longer called" check (line 172) lists them as gone.
- "RI1 may have added other routes in routes/" — FALSE. `git diff origin/main -- routes/` shows only routes/repeat-supply.js (14 routes) plus merge lag in routes/chits.js (main's Y1b clock, which the merge restores).
- "merge origin/main first" — merge CONFLICTS: docs/contracts/web-api.json (13 hunks, captured timestamps only) and a migration-number clash: main has b300_chit_deliver_clock.sql + b301_created_at_timestamptz.sql, the branch has b300_repeat_supply.sql → tests/migration-numbers.test.cjs (in guards on main, scripts/guards.cjs:35) fails.

**(b) Conflicts with rules / constructs**
- `extra: true` on the repeat lines is the wrong mark: extra = "the web calls it without the registry" (test line 100). The repeat routes are not called by web main at all → `awaiting_client` is the one slot for that.
- Rule 5 (one number, one migration): b300 is taken on main → the branch's migration takes the next free number (b302).

**(c) Simpler way** — none; the brief IS the simple way (restore main's file, 14 hand lines).

**(d) Risks** — trips on the empty stub are floors (every /:id route answers 404; POST /api/repeat 400) — said in each line's why. Web #155 keeps a byte copy of web-api.json: after this merge its copy must be re-synced (timestamps). Measured with #119's test copied in locally (not committed) since main cannot fire the routes yet.

**(e) VERDICT: BUILD WITH CHANGES** — (1) renumber b300_repeat_supply → b302 (and its mentions); (2) resolve the contract conflict with main's captured values, re-verified by tests/web-api-contract.test.cjs; (3) awaiting_client, not extra, on the 14 lines.

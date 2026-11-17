# W1-RAIL critique — R1 "one status writer · one assignment route" (written before code, 2026-10-15)
Area docs: ../chitbridge-docs is EMPTY on this runner (no 01-rail-core README, no DISCIPLINES.md, no functions/ cards) — worked from the brief + code.
Base: api main (integrate/1014d landed, `git merge-base --is-ancestor` true); web main already carries #285.

(a) Brief assumptions, checked
- "5 places bypass moveStatus (chits.js:4689,:273,:4818,:3096,:4774)" — FALSE on the base: T1-RAIL (api #~200, 14 Oct) lifted the write into
  lib/rail-status.js statusGate; every door calls it (chits.js:280 auto-assign, :3700 moveStatus, :3825 sender cancel, :4994 void, :5145
  assign-bulk, actors.js:1126 pull/push). tests/rail-status.test.cjs D scans lib/+routes/ for any `SET current_status` outside it —
  27/27 green on the base. The brief's line numbers are stale. RC1 + RC5 are DONE; nothing to build, say so.
- "withdraw/auto-assign can never land on a forbidden status" — TRUE already: statusGate asks rail.move (lib/rail.js table), write() throws on a no.
- "ONE assignment route: actors.js:1158,:1233,:1106-1320 → lib/assign-chit.js" — TRUE, still open: lib/assign-chit.js owns only taskCount
  (TA1). The chit-assignment write `UPDATE chit_status SET assigned_to_actor_id …` exists NINE times: actors.js:910 (deactivate→colleague),
  :1088 (leave→colleague), :1181 (pull), :1247 (push), :1589 (admin route push — writes NO display_name, so the name shown goes stale),
  plus unassign at :899, :1078, :1297, :1553 (:1553 leaves display_name behind); chits.js:274 (auto), :5139 (bulk); connectors.js:251;
  lib/raiseticket.js:426. The "back to pending" step after an assignment is ALSO copied three times (actors.js toPending, chits.js:280, :5145).
(b) Conflicts: none. D-3 (line OR chit assignment): lib/assign.js is the per-LINE half (b143, private); chit_status.assigned_to_actor_id is
  the per-CHIT half. This round unifies the CHIT writers only; the two halves stay as today — noted for Athi, not decided here.
(c) SIMPLER: no new module — WIDEN lib/assign-chit.js (already "the one writer of a person's task count") with assignChit (one copy →
  a person or the pool, then statusGate → pending when a mover is given) and rerouteOpenTasks (everything one person holds → a colleague
  or the pool). Guard = one more line in tests/one-writer.test.cjs (zero `SET assigned_to_actor_id` outside lib/assign-chit.js).
(d) Risks: behaviour deltas are fixes, named in the PR — admin route push now writes the display name and updated_at; every unassign
  clears the name. Round-trip budgets unchanged (same statements, lifted). No migration (b649–b651 unused). No web change (responses
  unchanged). Engines untouched. Other rounds touching chits.js/actors.js merge-conflict risk: edits are small, local to the UPDATEs.
(e) VERDICT: BUILD WITH CHANGES — status half: already done, verified, not rebuilt; assignment half: widen lib/assign-chit.js, no new file.

# T1-RAIL critique — every status change goes through the one status writer (written before code)
Area docs: ../chitbridge-docs is EMPTY on this runner (no RECONCILIATION-2026-10-14, no area README/DISCIPLINES) — worked from the brief + code.

(a) Brief assumptions, checked
- "five places change status outside moveStatus" — TRUE, five: routes/chits.js:273 (auto-assign → pending), :4689 (void → cancelled),
  :4818 (assign-bulk → pending), routes/actors.js:1158 (pull → pending), :1233 (push → pending). :3530 (sender cancel) is INSIDE
  moveStatus but writes every own copy with no rail check — routed too. INSERTs at mint (chits.js:1439/1504, catalogue.js:1193/1206) are a
  copy's BIRTH, not a change — out of scope, the guard says so.
- "void allows completed→cancelled, rail.js forbids" — TRUE: lib/rail.js:57 completed → [in_progress, pending]; void writes blind.
- "route every one through moveStatus" — PARTLY POSSIBLE: moveStatus (chits.js:3391) reads ONLY the received copy (void acts on the
  SENT copy → it would 404), opens its own transaction (the assign routes hold the same row in theirs → a second transaction would wait on
  their lock forever), and fans a status_<x> row to the other party's timeline (assignment is internal by F3, chits.js:4825).
(b) Conflicts: none with "one writer" if the writer is ONE function both doors call; lib/rail.js is adopted (never edited here) — the
  sent copy is gated with the SAME rail.move over its own status (the table, not a new one).
(c) SIMPLER: lift moveStatus's own read → rail.move → UPDATE into ONE function (lib/rail-status.js `statusGate`, no new table), called by
  moveStatus and by the five doors inside THEIR transaction. One UPDATE of current_status exists in lib/ + routes/; the guard holds it there.
(d) Risks: void of a completed chit now 409s (intended); assignment of a SENT-only copy no longer rewrites its status (the rail moves
  only received copies) — the assignment itself still lands; a refused status step on assign is logged (warn), never silent.
  No migration (b424–b426 unused). No web change (web has no void caller that branches on it; 409 carries `why`). Engines untouched.
  OPEN for Athi: should an assignment move the rail status at all (accepted → pending on push)? Kept as today, now rail-gated.
(e) VERDICT: BUILD WITH CHANGES — one gated write (statusGate) inside moveStatus instead of calling moveStatus whole from the assign
  doors; void = statusGate on each own copy, 409 with why when any copy refuses.

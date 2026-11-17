# Critique · INT7d-GREEN (make integrate/1016b green)
(a) Assumptions: reds are on the existing PRs web #311 / api #264 — true (both headRef integrate/1016b, open). Each red is read from the CI logs
    before it is fixed — to be confirmed per item. Consent panel 390 px failure comes from the panel's own CSS — unknown until the walk is read.
(b) Conflicts: none — fixes use SYSTEM.md tokens, the contract --write + byte copy, readability by meaning (no ratchet edit, no baseline lowered).
(c) Simpler: none; each red is fixed at its cause, not by skipping a check.
(d) Risks: the api readability guard counts debt vs origin/main (1016a is on hold, 1016b lands alone) — fix must be real code shrink, not a baseline edit.
    Contract fixture drift: the api master stays master; web copy is byte-equal. No migration, no engines change. Other rounds may touch the same files.
(e) VERDICT: BUILD AS BRIEFED

# INT6a critique — `integrate/1014a` (api + web): SEC2 · SEC3 · T1-ORD · T2-NATDEF · WEBPRIMS · POLICY · WRITERS, written before any merge

**(a) What the brief assumes, checked**
- Every branch exists — TRUE (api 7; web T1-ORD #231 + T2-POLICY #239; the others' web halves are on main). No migrations in any of the seven (git diff --name-only … migrations/ is empty) → b514–b516 unused unless a conflict needs one.
- "Most CONFLICT with main" — PARTLY TRUE. `merge-tree` vs api origin/main (72c7e9c1): SEC2 · SEC3 · T1-ORD · WEBPRIMS clean (0 behind); NATDEF → lib/books-engines.js; POLICY → docs/FIELDS.md · routes/network-design.js; WRITERS → actors · chits · crm · network-design · tests/query-shape. Web: T1-ORD → public/app/cart.js; POLICY → e2e/guard-static.cjs.
- The rest are "RED guards" (twin / till vendor) — TRUE for NATDEF and WEBPRIMS: both change the master tools/tally-connector/till.html (WEBPRIMS also signin-ui.js) → re-vendor into web with scripts/vendor-till.cjs after each.
- Round-to-round overlaps (api): scripts/guards.cjs ×5 · docs/FIELDS.md ×4 · routes/till.js · routes/connectors.js · round-trips.budget.json · lib/country-setup.js ×3 · signin.js · otp.js · employee-code.js · actors.js (SEC2 × WRITERS) · profile.js (NATDEF × POLICY) · catalogue.js (T1-ORD × WRITERS).
- docs/contracts/web-api.json — no round edits it by hand → regenerate with `--write` only if the contract test is red after a merge; web fixture a byte copy.
- C:/dev area homes (../chitbridge-docs) — the folder is EMPTY on this runner; DISCIPLINES.md taken from the brief inline.

**(b) Rule conflicts** — one writer per thing: SEC2 (owner-only people writes, no code out) and WRITERS (one add-customer / take-task / shopper OTP) both rewrite actors · signin · otp · employee-code → keep WRITERS' single writer AND SEC2's guard in front of it. POLICY's one policy_flags writer vs SEC3/WRITERS' till.js → their edits go through POLICY's writer. NATDEF's one date reader vs main's books-engines → keep main's engines door, NATDEF's reader call. guards.cjs / FIELDS / budget: union.

**(c) Simpler way** — none; order as briefed (web half first where both exist).

**(d) Risks** — security: a merge that keeps the old code-returning path of SEC2 would leak a sign-in code → grep `code` in otp/signin answers after the WRITERS merge. Money: NATDEF's tax-lines/till edits (no INR guess) must survive. Till vendor drift (twin guard). Other rounds open on the same files (SEC4, T3-FIXES, T2-HONEST) — they rebase on this. Landing: web → api.

**(e) VERDICT: BUILD AS BRIEFED** — resolve by meaning; findings appended below while building.

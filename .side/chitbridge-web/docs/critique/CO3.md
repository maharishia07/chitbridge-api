# CO3 critique — accounting record-keeping proofs (K3 · K7 · K8 of docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md §6–7)
(a) Assumptions, checked
- Books edit trail exists and is insert-only — TRUE: api migrations/b273_books_journal.sql:201-213 (trigger) + :255 (REVOKE UPDATE, DELETE); writer lib/books-store.js:446 `logChange`. "Cannot be disabled" is NOT yet proven by any test — gap.
- Retention 90 days — TRUE and live, not just b105: 000_baseline.sql chit_status `retention_expires_at DEFAULT now()+90d`; the mint writes it from `retainDaysFor` (routes/chits.js:1124, floor = policy `retention_floor_days` def 90, lib/policy.js:149). A shop may set its floor to 0.
- reg-in has no `retentionYears` — TRUE (lib/reg-in.js is ADOPTED from engines; do not edit). reg-au/reg-ae say 5 (lib/reg-au.js:511, reg-ae.js:723); doc says companies 7 (AU s.286) / corporate tax 7 (AE Art.56).
- Daily backup in India — UNKNOWN from code: only the DB region is in config (db/index.js:28-29 `aws-*-ap-south-1` poolers; b188 header). Backup schedule/plan is a Supabase setting, not in any repo.
- `lib/retention.js` planner would list every copy past its 90-day `retire_at` — TRUE (no age floor in the query). Nothing deletes (commit not wired).
(b) Conflicts
- Engines are serial and this brief does not own them → the per-country floors (reg-in 8 y, reg-au 7 y, reg-ae 7 y) are an engines REQUEST, not built here.
- STD_COUNTRIES lacks AU/AE (cap-standards.js:503); CO1/CO2 may add them too → merge-conflict risk on that one line.
- Migration number: b302 is already claimed twice on open branches (IM1, RI1) → take b303.
(c) Simpler way
- One statutory floor, not three: 8 years (IN s.128(5), the longest of IN 8 / AU 5–7 / AE 5–7) under every copy, in the ONE place that sets it (`retainDaysFor`) and the ONE planner (`planRetirement`). Satisfies all three countries without engines; per-country precision later via pack `retentionYears`.
- ROC "service-provider facts" sheet as a doc now, not a new Settings screen (rule 5: a new look needs Athi's yes).
(d) Risks
- Data: b303 backfills chit_status (GREATEST — only lengthens; never shortens). Money: none. Security: no new route.
- Twin landing: api first (code + b303 + tests), web after (register rows cite the api test). Neither breaks without the other.
- Privacy tension: APP 11.2 / DPDP s.8(7) ask deletion when no longer needed — records law overrides for books; stated in the doc.
(e) VERDICT: BUILD WITH CHANGES — single 8-year floor (no engines edit; engines change requested); proof by test + SQL queries
   (no new route/screen); ROC facts as a doc; backup = owner action (confirm plan/PITR + restore drill).

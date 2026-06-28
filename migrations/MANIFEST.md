# Migration manifest — single ordered chain (Phase-1 consolidation, 2026-06-27)

The canonical apply order for a fresh database. Files live in two places today
(root `migration_*.sql` + `db/schema*.sql` + this `migrations/` folder); this manifest
defines the **one ordered chain** until they are physically collapsed into `migrations/`.

Apply in this order:

| # | File | Purpose |
|---|------|---------|
| 1 | `db/schema.sql` | base tables (identities, chit_header/detail/status, state_log, connections, …) |
| 2 | `db/schema_b2_migration.sql` | lifecycle |
| 3 | `db/schema_b3_pin_migration.sql` | actor PIN |
| 4 | `migration_b35.sql` | messaging + disputes |
| 5 | `migration_b36.sql` | supplier + customer lists |
| 6 | `migration_b37.sql` | public catalogue + end-customer order |
| 7 | `migration_b37a.sql` | catalogue items (products) |
| 8 | `migration_b39.sql` | storefront identity/trust |
| 9 | `migration_b310.sql` | targeted & erasure-aware disputes |
| 10 | `migration_b310a_freeze.sql` | freeze-at-send (schema_version/schema_id/created_by_actor_id) |
| 11 | `migration_b311_shop_status.sql` | shop business_status (open/closed/away) |
| 12 | `migration_gov01_protected_entity.sql` | governance substrate |
| 13 | `migrations/net01_network.sql` | cb_entity / cb_edge (network — KEPT, Q2) |
| 14 | `migrations/net02_chit.sql` | cb_chit / cb_chit_item (**DORMANT**, Q3 — table kept, chit-loop ROUTE retired) |
| 15 | `migrations/net03_full_schema.sql` | NET full-schema enhancement |
| 16 | `migrations/sim01_simulator.sql` | /tour showcase tables |
| 17 | `migration_fp01.sql` | priority (customer_priority/locked + priority_flag) + typed messages (msg_type) + identities.message_type_mode — **applied to prod 2026-06-25; reconstructed from spine v2.34** |
| 18 | `migration_user_id_identities.sql` | ATH-114 external `identities.user_id` (unique, ci) for login/lookup/connect |
| 19 | `migration_chit_header_role.sql` | per-copy role on chit_header (Compose To/CC/For fan-out) |
| 20 | `migration_chit_direction.sql` | two-copy `direction` on chit_header/status/detail |
| 21 | `migration_dispute_routing.sql` | `identities.dispute_handler_actor_id` |
| 22 | `migration_chit_reads.sql` | `chit_reads` (per-actor unread) |
| 23 | `migration_check_constraints.sql` | CHECK `direction IN ('sent','received')` (NOT VALID) |
| 24 | `migration_otp_attempts.sql` | `identities.otp_attempts` (OTP attempt cap) |
| 25 | `migration_customer_contact.sql` | `identities.otp_contact` (F2 dual-channel customer OTP) |

## Notes / open items
- **fp01 (#17):** already applied to legacy prod Supabase 2026-06-25. The canonical original file was not in the repo, so `migration_fp01.sql` here is a **faithful reconstruction from spine v2.34's documented columns** (idempotent `IF NOT EXISTS`, so re-running against prod is a safe no-op). The `files20/migrations-fixed/001_002_003` set is the **WRONG** `cb_*`-messaging version — do NOT use it. If the original surfaces from Supabase migration history, diff it against this reconstruction.
- **cb_chit (#14) is dormant:** the table stays (Q3, reversible); only the `/api/network` chit-loop *route* was retired. `src/services/chit.js` is retained because `src/services/network.js` uses `edgeHasOpenChit` for the disconnect settle-guard.
- All `migration_*.sql` are written idempotent (`IF NOT EXISTS` / safe re-run).
- Physical collapse of files into a single `migrations/NNN_*.sql` sequence is deferred to avoid churn; this manifest is the ordered source of truth meanwhile.

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

## Newer migrations (migrations/ folder — not yet chained above)
`b42_assist_qa` · `b43_help_entity` · `b44_assist_projection` · `b45_gov01help_rename` · `b46_helpdesk_blueprint` ·
`b47_mint_path` · `b48_cb_app_role` · `b49_rls_policies` · `b50/b51_rls_delivery_functions` · `b52_rls_parity_read` ·
`b53_assist_residency_qa` · `b54_disable_rls_carveout` · `b55_connector_blueprint_and_capabilities` ·
`b56_dispute_schema` (idempotent no-op safety — dispute_participants already existed) ·
`b57_connector_actor` (**NOT applied to prod yet** — connector_connection + identities.connector_type).

## ✅ BASELINE CAPTURED (2026-07-05) — repo now = prod
Prod had drifted from the repo (the ~30 `idx_*` indexes, `dispute_participants`, `chit_messages.is_dispute`/`dispute_id`
were added ad-hoc in Supabase, in no committed migration). **FIXED:** `migrations/000_baseline.sql` (tables) +
`migrations/000_baseline_part2.sql` (constraints, indexes, RLS enable, policies, triggers, functions) were captured from
prod via a catalog-reconstruction query on 2026-07-05 — the **authoritative schema, matching prod exactly**.

**Fresh-build order:** `000_baseline.sql` → `000_baseline_part2.sql` → `b48_cb_app_role` (role + GRANTs) → post-baseline
migrations in order: **`b58_dispute_msg_fk.sql`** (chit_messages.dispute_id FK, applied to prod 2026-07-05). The
pre-baseline chain below (`db/schema.sql`, root `migration_*.sql`, `net0x`, `b35..b57`) is **historical record only** —
superseded by the baseline for a clean build.

**Baseline covers:** all 50 tables, all constraints (PK/FK/UNIQUE/CHECK), all indexes, RLS enable-state + the 6 `rls_entity`
policies, 4 triggers, and our 17 functions (incl. the SECURITY DEFINER rail: `chit_deliver`, `chit_log_all/targets`,
`chit_participants`, etc.). **Does NOT cover:** the `cb_app` role + GRANTs (→ b48/b49), seed/reference data, or the `ltree`
extension's internal C functions (provided by `CREATE EXTENSION ltree`). Rule going forward: **all schema changes via a
committed `migrations/bNN_*.sql` only** — no more ad-hoc Supabase DDL.

## Notes / open items
- **fp01 (#17):** already applied to legacy prod Supabase 2026-06-25. The canonical original file was not in the repo, so `migration_fp01.sql` here is a **faithful reconstruction from spine v2.34's documented columns** (idempotent `IF NOT EXISTS`, so re-running against prod is a safe no-op). The `files20/migrations-fixed/001_002_003` set is the **WRONG** `cb_*`-messaging version — do NOT use it. If the original surfaces from Supabase migration history, diff it against this reconstruction.
- **cb_chit (#14) is dormant:** the table stays (Q3, reversible); only the `/api/network` chit-loop *route* was retired. `src/services/chit.js` is retained because `src/services/network.js` uses `edgeHasOpenChit` for the disconnect settle-guard.
- All `migration_*.sql` are written idempotent (`IF NOT EXISTS` / safe re-run).
- Physical collapse of files into a single `migrations/NNN_*.sql` sequence is deferred to avoid churn; this manifest is the ordered source of truth meanwhile.

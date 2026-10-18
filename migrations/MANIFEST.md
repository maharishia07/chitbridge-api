# Migration manifest

## ⭐ FROM 18 OCT 2026: ONE BASELINE + NUMBERED MIGRATIONS AFTER IT (DB-REBASE, Athi)

> "db baselining so we don't need to run multiple migrations … then we can note down migrations from this moment onwards" (Athi, 18 Oct 2026)

**The rule.** A new database = `migrations/000_baseline_2026-10-18.sql`, then ONLY the numbered migrations after it (`b765` onward),
in number order. Each one is logged in `migrations/MIGRATIONS-LOG.md` with **run-by / run-at** for every database it ran on.
The one runner is `tools/migrate.cjs` (it records each file in `schema_migrations`). Never edit the baseline or an applied file:
a change is a new `bNNN`.

| | |
|---|---|
| Baseline | `000_baseline_2026-10-18.sql` — schema (public · metrics · ops) + the reference rows of the 30 tables the old chain seeded + the ledger table (`schema_migrations`, was b304). Roles: makes `cb_app` / `cb_ops` if missing; stops if `cb_metrics` is missing (create it by hand first, b151 header). |
| Covers | everything up to and including **b764** (api origin/main 57d4f9fe). `tools/migrate.cjs` `BASELINE_THROUGH = 764`: a `bNNN` at or below it in `migrations/` is never run and is named as a stray. |
| Made by | `pg_dump --no-owner --no-comments --column-inserts` (PostgreSQL 16) of a scratch database built by the old chain; data only for the 30 seeded tables. Two edits, both stated in the file: `search_path` = `pg_catalog, public` (a trigger `WHEN` compares ltree values), and 5 varchar CHECKs written back as `col IN (…)` (pg_dump's spelling re-parses to a different tree). |
| Proven | `tools/schema-fingerprint.cjs`: a fresh database from the baseline equals the chain-built one on all **1224** objects (tables' columns, constraints, indexes, RLS enable/force, policies, triggers, grants; functions; views; sequences; roles) and on every seeded row (30 tables). Build: 8 s instead of 108 s. |
| Production | production already HAS this schema — **never run the baseline there**. Once `rebase-1` (sql-to-run/2026-10-18) shows prod = baseline, or its differences are reconciled, the owner records it: `node tools/migrate.cjs --db <prod> --record 000_baseline_2026-10-18.sql` (or the INSERT in the record file). |
| History | the files the baseline replaces are kept unchanged in `migrations/archive/`: `000_baseline.sql` + `000_baseline_part2.sql` (prod capture, 5 Jul 2026), `migration_b42..b57`, `b58..b764` (with their dry runs / verifies), `net01..03`, `sim01`. The static guards that read definitions out of the SQL (`tools/migrate.cjs` `writtenSqlFiles()`) read archive/ then migrations/. |
| Still here | `purge_test_entities_*` and `READ-*` — utilities, never in the chain. |

**Writing a new migration:** take the next number above the highest in `migrations/` (and above any reserved for a round), header rule as
before (what · RLS stated · idempotent · who runs it), then a row in `MIGRATIONS-LOG.md` when it runs anywhere that matters.

---

# History (before 18 Oct 2026) — kept as written

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
migrations in order: **`b58_dispute_msg_fk.sql`** (chit_messages.dispute_id FK, applied to prod 2026-07-05) →
**`b57_connector_actor.sql`** (connector_connection + connector_type — NOT yet applied) →
**`b59_delivery_lifecycle_blueprint.sql`** (mint-path options seeding + delivery-lifecycle blueprint — NOT yet applied) →
**`b60_blueprint_catalogue.sql`** (source/template catalogue + provenance/deps + register_blueprint path; seeds CMMI
standard + moves connector & delivery-lifecycle into the catalogue — the LAST blueprint-mechanism migration; NOT yet applied) →
**`b61_chit_reads.sql`** (creates the per-actor read table that was never applied — fixed a live actor 500 from
tx-poisoning; APPLIED to prod 2026-07-05). The
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

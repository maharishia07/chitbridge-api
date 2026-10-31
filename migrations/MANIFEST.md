# Migration manifest

## ⭐ FROM 21 OCT 2026: ONE BASELINE = PRODUCTION'S SCHEMA + NUMBERED MIGRATIONS AFTER IT (DB-3, Athi)

> "db baselining so we don't need to run multiple migrations … then we can note down migrations from this moment onwards" (Athi, 18 Oct 2026)
> DECISIONS 2026-10-18: "one baseline = production schema now; only numbered migrations after it".

**The rule.** A new database = `migrations/000_baseline_2026-10-21.sql`, then ONLY the numbered migrations after it (`b768` onward),
in number order. Each one is logged in `migrations/MIGRATIONS-LOG.md` with **run-by / run-at** for every database it ran on.
The one runner is `tools/migrate.cjs` (it records each file in `schema_migrations`). Never edit the baseline or an applied file:
a change is a new `bNNN`.

| | |
|---|---|
| Baseline | `000_baseline_2026-10-21.sql`: the public schema of production exactly as Athi's `pg_dump --schema-only --no-owner -n public` showed it on 21 Oct 2026 06:46 IST (server 17.6), plus the `ops` and `metrics` schemas and the reference rows of the 28 seeded tables. Roles: makes `cb_app` / `cb_ops` / `cb_metrics` / `cb_backup` if missing. |
| Covers | everything up to and including **b767**, and `RUN-2026-10-20-0..4` (backup role, public-role revokes, column grants, add-only grants). `tools/migrate.cjs` `BASELINE_THROUGH = 767`: a `bNNN` at or below it in `migrations/` is never run and is named as a stray. |
| Made by | `tools/baseline-from-snapshot.cjs` from the snapshot (kept OUTSIDE git). The edits are listed in its header: `\restrict` lines, `SET transaction_timeout`, `CREATE SCHEMA public`, Supabase-only roles' grants (service_role anon authenticated postgres supabase_*), search_path `pg_catalog, public`, and 20 varchar CHECKs written without the outer `::text[]` cast so they re-parse to the dumped tree. |
| NOT compared with live | `ops` (the app role is closed out of it by design), `metrics`, and the reference rows: the snapshot had none of them. They come from the migration files through a scratch database. |
| Left out | `RUN-2026-10-20-8..11` (test-shop purge, VACUUM FULL: they change rows, not schema). `blueprint_source` and `blueprint_template` and the other columns the old chain had and production does not (below). |
| Proven | replay on PostgreSQL 17.11: a database built from the baseline alone, dumped the same way, equals the snapshot line for line except the Supabase-role grants it leaves out. `ops` and `metrics` equal the migration-built scratch database; the reference rows equal it row for row. |
| Production | production already HAS this schema: **never run the baseline there**. The owner records it: `node tools/migrate.cjs --db <prod> --record 000_baseline_2026-10-21.sql`. |
| History | the files the baseline replaces are kept unchanged in `migrations/archive/`: `000_baseline.sql` + `000_baseline_part2.sql`, `migration_b42..b57`, `b58..b767` (with their dry runs / verifies), `net01..03`, `sim01`, `RUN-2026-10-20-0..4`. The static guards read them through `writtenSqlFiles()`. |
| Still here | `purge_test_entities_*`, `READ-*` and `RUN-2026-10-20-8..11`: utilities and data runs, never in the chain. |

**Production is not the old chain** (found by the replay, 21 Oct; the baseline follows production, so none of the chain-only objects is in it).
The old chain (b767) has, and production does not: tables `blueprint_source`, `blueprint_template` (b60); columns `blueprints.{prerequisites,provides,requires,source_key,template_keys,version}`,
`entity_governance.{blueprint_key,blueprint_version,boilerplate_version}` (b294), `cb_entity.root_path` + trigger `cb_entity_root_immutable` (b243/b244), `folder.kind` (b275), `test_result.project` (b292);
functions `register_blueprint`, `cb_entity_root_is_immutable`; policy `register_entry_isolation`; 13 indexes (b121 `idx_ci_*_trgm` x3, `cb_entity_root_path_idx`, `idx_test_result_project`, and
`account_balance_year_idx` `bt_source_idx` `catalogue_items_updated_idx` `journal_entry_page_idx` `journal_entry_reverses_idx` `journal_line_account_entry_idx`
`party_item_account_party_idx` `party_item_payment_idx` `usage_ledger_ai_day`). Production has, and the chain does not: `purge_test_entities`, indexes `journal_entry_date_idx` `journal_line_account_idx`,
policies `chit_line_raida_isolation` and `read_all`. 8 functions have older bodies in production (`chit_dispute_deliver`, `chit_log_all`, `chit_log_targets`, `chit_participant_parity`,
`chit_participants`, `chit_set_customer_priority_all`, `chit_set_status_all`, `create_from_blueprint`). Which of these production should get is Athi's call; each would be a new `bNNN` above b767.

**Needs Athi (production SQL, files only):** `b768_membership_kind_read_policy.sql`: `membership_kind` has RLS on and no policy in production, so the app role reads 0 rows (no code reads it yet). The baseline stays equal to production; b768 is the fix.

**Needs Athi · K-DB (wave W1, 21 Oct 2026; numbers b769-b775 reserved, b769-b775 written; b769-b772 RUN 21 Oct).** Run each in the Supabase SQL editor AS postgres, then
`node tools/migrate.cjs --db <prod> --record <file>` (as the owner: since K-DB `--status` and apply() refuse a role that cannot see the ledger) and a
`MIGRATIONS-LOG.md` row. The code works before each one runs (it checks the schema first).

| # | file / decision | what | to whom |
|---|---|---|---|
| 1 | `b769_local_entity_kind.sql` | `'local'` joins `identities_entity_kind_chk`; from then a minted party is `local`, not `supplier` (OPS-41) | Athi runs |
| 2 | `b770_trace_parents_gin.sql` | GIN on the trace parents (jsonb_ops), **CREATE INDEX CONCURRENTLY: paste it ALONE**, no transaction | Athi runs |
| 3 | `b771_chit_status_retention_source.sql` | each copy records which rule set its retention (SET-26) | Athi runs |
| 4 | `b772_ops_retention_flush_log.sql` | the retention flush event log in `ops` (DB-21, PM-16); closed to cb_app, one definer door | Athi runs |
| 4a | `b773_chit_status_current_status_check.sql` | DB-72: CHECK on `chit_status.current_status` = the rail's 9 statuses (NOT VALID, then VALIDATE); NULL allowed | Athi runs |
| 4b | `b774_definition_name_unique_folded.sql` | DB-44: UNIQUE (entity_id, kind, lower(btrim(name))) on `definition`; counts first and stops with the number; parent is not a column, see header | Athi runs |
| 4c | `b775_minted_parties_to_local.sql` | OPS-41: the minted `~` parties move `supplier` to `local` (expected 1); run AFTER b769 | Athi runs |
| 4d | `b778_rls_governance_exceptions.sql` | SEC-75: RLS ON + FORCE + rls_entity on `governance_exceptions`; run AFTER the api with the new-shop binding (routes/governance.js) is deployed | Athi ran 2026-10-30 (production, SQL editor); logged |
| 4e | `b779_rls_dormant_cb_tables.sql` | SEC-75: RLS ON + FORCE + rls_entity on six legacy cb_* tables no code reads (cb_device, cb_external_reference, cb_entity_supplier, cb_contact, cb_entity_employee, cb_consumer_traction) | Athi ran 2026-10-29 (production, no rows); logged |
| 4g | `b783_rls_legacy_cb_chit_catalogue.sql` | SEC-75 group A: RLS ON + FORCE + rls_entity on seven legacy cb_* tables no code reads (cb_catalogue_category, cb_catalogue_item, cb_chit, cb_chit_item, cb_chit_log, cb_task, cb_transaction_history); run AFTER b778+b779 (api #338) | Athi ran 2026-10-29 (production, no rows); logged |
| 5 | `READ-2026-10-21-1-chit-status-values.sql` | DB-72: every current_status value; the CHECK (NOT VALID, then VALIDATE) is written only from this paste | paste back |
| 6 | `READ-2026-10-21-2-db44-duplicate-names.sql` | DB-44: definitions that would break UNIQUE (entity_id, kind, parent, name); which copy survives | paste back; then cb-catalogue + cb-accounting decide |
| 7 | `READ-2026-10-21-3-db65-governance-rows.sql` | DB-65: governed identities with no entity_governance row; then the drop of identities.constitution_version / governed_by | paste back; the drop is Athi's yes |
| 8 | `READ-2026-10-21-4-local-kind-count.sql` | OPS-41: the existing `~` rows by kind; moving them from `supplier` to `local` (after b769) | paste back; the row move is Athi's yes |
| 9 | where the retention archive lives | lib/retention.js now refuses a commit without an archive receipt (`archive_ref`, `sha256`, `rows`, `at`); no table holds archived copies (quota) | Athi decides |
| 10 | `docs/27-…/census/2026-10-21-proposals-db5-db6.md` (docs repo) | DB-5 / DB-6: index and tidy proposals, one yes / no per line; nothing removed | Athi answers per line |
| 11 | `READ-2026-10-24-1-sec100-folder-fk-census.sql` | SEC-100 (api #397): rows pointing at another shop's folder (parents, rules, routing); row 0 is the count | paste back; any cleanup is Athi's yes |
| 12 | `b781_staff_code_hash.sql` | SEC-106: `identities.otp_code_hash varchar(64)` (a keyed hash of a staff first code, never the code) and `access_events.action` gains `code_issued`; numbers b778-b780 are held by #338 and #348; the code checks the column first and keeps the old way until it runs | Athi runs |
| 13 | `READ-2026-10-24-2-sec103-assignee-census.sql` | SEC-103 (api stacked on #397): routing rows whose assignee is not an actor of the row's shop (another shop, or nobody); row 0 is the count | paste back; any cleanup is Athi's yes |
| 14 | `b790_network_member.sql` | PLT-45 / RAIL-96 / RAIL-97: `installation.network_role` (standalone default), `root_handle`, `root_bridge_id`; tables `membership_certificate`, `network_revoked`, `registry_change` (the member's outbox, one trigger), `registry_entry`, `registry_cursor` (the master's mirror: ids and counts only); RLS stated; the code checks the tables and stays standalone until it runs; number chosen above b781, renumber on landing if another round took it | Athi runs |
| 15 | `b797_network_member_rls.sql` (`RUN-2026-10-25-b797-network-rls.sql` for production) | DB-85: b790's five network tables (`membership_certificate`, `network_revoked`, `registry_change`, `registry_entry`, `registry_cursor`) restated ENABLE + FORCE + owner/app policies in plain text (b790 closes them in a format() loop the file scanner cannot read); idempotent; carried from api #443 (superseded) into sit/run6 | Athi runs |

**Monthly routine (DB-8, b221 v2):** on the first maintenance night of each month, `RUN-2026-10-21-5-test-result-summarise.sql` then
`RUN-2026-10-21-6-test-result-purge.sql` then `READ-2026-10-21-5-test-result-check.sql` (paste back). They add 0 rows / delete 0 rows until
Sep 2027 (test_result starts Sep 2026, the window is 12 whole months). A purge frees quota only after `RUN-2026-10-20-9` (VACUUM FULL, alone).
Proven by `tests/test-result-routine.test.cjs` (CI fresh-db, one rolled-back transaction).

**Writing a new migration:** take the next number above the highest in `migrations/` (and above any reserved for a round), header rule as
before (what · RLS stated · idempotent · who runs it), then a row in `MIGRATIONS-LOG.md` when it runs anywhere that matters.

---

# History (before 21 Oct 2026) — kept as written

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

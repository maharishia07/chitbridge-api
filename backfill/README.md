# Legacy → Postgres backfill

Moves the legacy CodeIgniter MySQL DB (`chitbridge_v3`) into the new `cb_*` Postgres tables.

## Prerequisites
- NET-01/02/03 migrations already applied on the **target** Postgres (so the `cb_*` tables + `legacy_id` columns exist).
- The legacy MySQL reachable (a live DB or the dump `docs/DB/chitbridge_v3.sql` imported into a throwaway MySQL).
- `npm i mysql2` (the `pg` + `uuid` deps are already present).

## Run (STAGING FIRST)
```bash
npm i mysql2
LEGACY_MYSQL_URL="mysql://user:pass@host:3306/chitbridge" \
DATABASE_URL="postgresql://...staging-supabase..." \
node backfill/legacy_backfill.js
```
It prints a **row-count check (legacy → cb)** at the end. Verify each pair; `DIFF` is expected only where rows were deliberately collapsed (network_contact Sender/Receiver → one edge) or skipped (rows whose FK side wasn't migrated).

## What it does (dependency order)
`currency → city → building → industry → cb_entity (users ⋈ users_details on bridge_id) → entity_supplier/device/employee/contact → catalogue_category → catalogue_item → cb_chit (chit_header, originator/parent threaded via chit_hash) → cb_chit_item (chit_data) → chit_log / task / transaction_history / external_reference / consumer_traction`.

Conversions: bigint→uuid (mapped via each table's `legacy_id`); `bridge_id` carried as-is (the join key); MySQL enum→the text+check value; `*_json_data`→jsonb (passthrough); `0000-00-00`→null; `mode` derived from `business_type`. Every target row keeps `legacy_id` so the script is re-runnable (existing legacy_ids are skipped).

## Flags / known follow-ups
- **Passwords:** legacy MD5 hashes are copied into `cb_entity.password_hash` as-is. They are NOT usable — force a **reset / re-hash to bcrypt on first login** (ATH-86). Do not treat them as valid.
- **ltree hierarchy:** every entity is seeded as its **own root** (legacy `network_contact` was a flat peer graph with no tree). Re-deriving the live parent→child hierarchy from active edges (reparent down the tree) is a deliberate post-backfill step.
- **Column names:** mappings are taken from `docs/DB/chitbridge_v3.sql`; a few secondary columns (e.g. `user_bridge_contacts.owner_bridge_id`, `favourite_user.*`, device/traction bridge columns) vary by dump — spot-check against your actual schema and adjust the `select`/insert pairs if a column is null.
- Run on **staging**, eyeball the counts + a few rows, then run on production.

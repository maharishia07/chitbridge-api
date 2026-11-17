-- RUN-2026-10-20-9 · DB-80 · give the purged space back (after RUN-2026-10-20-8)
-- A DELETE leaves the space inside the table; only VACUUM FULL rewrites the tables smaller, so the database size drops.
-- It locks each table while it rewrites it: the app waits (seconds per table, about a minute in all). Run it at a quiet moment.
-- Run this ONE statement on its own (VACUUM cannot run inside a transaction: do not paste it together with anything else).
VACUUM (FULL, ANALYZE)
  public.definition_version, public.definition, public.catalogue_item_version, public.catalogue_items, public.usage_ledger,
  public.cb_catalogue_liveness, public.schema_fields, public.entity_schemas, public.identities, public.entity_governance,
  public.state_log, public.chit_line, public.idempotency_key, public.chit_status, public.chit_header, public.chit_detail,
  public.media_blobs, public.cb_attachment;
-- THEN run READ-2026-10-20-5-db-size.sql again and paste it: database_mb should be well under 300.

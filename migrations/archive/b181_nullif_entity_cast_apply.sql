-- b181 · APPLY · guard 12 RLS policies so a null entity returns NOTHING instead of raising 22P02
--
-- Run in the Supabase SQL editor. One transaction: all twelve change, or none do.
--
-- WHAT THE DRY RUN FOUND (2026-08-22, read from pg_policies on the live database)
--   12 UNGUARDED policies, not the 30-in-13-files the migration sources suggested. Two of those files
--   (b172_access_events, b174_identity_documents) turn out to be GUARDED live -- their policies were
--   superseded after the file was written. THE FILES ARE NOT THE DATABASE, which is the entire reason the
--   dry run came first.
--   31 policies are already guarded and are not touched.
--
-- WHY IT MATTERS
--   withEntity(null, ...) is a deliberate, live path: the PUBLIC storefront reads with no tenant bound.
--   set_config stores '', and `(current_setting('app.current_entity', true))::uuid` then evaluates ''::uuid,
--   which raises 22P02 invalid input syntax for type uuid. The anonymous read does not come back empty -- it
--   ERRORS. NULLIF makes it fail CLOSED instead: entity_id = NULL is NULL, not true, so the row is invisible.
--
-- ALTER POLICY, NOT DROP + CREATE
--   ALTER POLICY changes ONLY the USING and WITH CHECK expressions. It preserves the command, the roles, and
--   whether the policy is PERMISSIVE or RESTRICTIVE -- none of which the dry run selected, and all of which a
--   DROP + CREATE would have had to restate from memory. Getting `TO` or PERMISSIVE wrong on a tenant-isolation
--   policy is a data-exposure bug, and re-typing twelve of them from a pattern is exactly how that happens.
--   There is also no window in which the table sits without a policy.
--
-- THE EXPRESSIONS ARE COPIED FROM THE DRY RUN OUTPUT, not inferred. Eleven key on entity_id; wholesaler_store
-- keys on owner_entity_id. That one difference is the reason this is twelve hand-written statements rather
-- than a loop.

BEGIN;

ALTER POLICY catalogue_item_version_isolation ON public.catalogue_item_version
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY chit_line_isolation ON public.chit_line
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY chit_line_amendment_isolation ON public.chit_line_amendment
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY chit_line_assign_isolation ON public.chit_line_assignment
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY chit_line_cost_isolation ON public.chit_line_cost
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY chit_line_delivery_isolation ON public.chit_line_delivery
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY chit_sla_isolation ON public.chit_sla
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY chit_sla_pause_isolation ON public.chit_sla_pause
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY definition_isolation ON public.definition
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY definition_version_isolation ON public.definition_version
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER POLICY folder_rule_isolation ON public.folder_rule
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- the only one that is not entity_id
ALTER POLICY wholesaler_store_isolation ON public.wholesaler_store
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

COMMIT;

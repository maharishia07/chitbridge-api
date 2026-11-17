-- b763_schema_hygiene.sql — SCHEMA-FIX1 (16 Oct 2026): the SAFE table fixes before testing. NOT RUN — the owner runs it (Supabase editor).
-- CHECKED  looked at: pg_index / pg_constraint on a database built from migrations/ (SCHEMA-ASSESSMENT-2026-10-16 §2 §4 §7), the writers
--          of the six tables whose national DEFAULT goes (lib/books-store.js:35, lib/cost.js:75, lib/books-assets.js:39,
--          routes/identity-docs.js:251, routes/chits.js:1719/1785, routes/catalogue.js:1269/1282 — every one names the column, none
--          relies on the default), docs/FIELDS.md, b48/b212/b269 for FORCE.
-- WHY      (1) 37 live foreign keys had no index: every parent delete/update scans the child, and the joins read the same columns.
--          (2) 17 indexes only repeat another (2 exact duplicates of a UNIQUE key, the rest a prefix of a wider index): a write cost for
--          no read gain. (3) six columns answered 'IN'/'INR' for a country nobody stated. (4) FORCE on the five core chit tables is
--          true on production but in no file: a rebuild from migrations/ got ENABLE only, so the table owner bypassed the policy.
-- OWNER    cb-platform (migrations/). No new table, no new column, no data touched.
-- EDITOR-SAFE  no CONCURRENTLY, no BEGIN/COMMIT of its own. Plain CREATE INDEX takes a short write lock per table: run off-peak.
--          Idempotent: every index IF NOT EXISTS and skipped when its table or column is absent; every DROP only where the covering
--          index is present; DROP DEFAULT and FORCE are no-ops the second time.
-- ROLLBACK  indexes: DROP INDEX <name> (the names are the ix_fk_/ix_hot_ ones listed below). Defaults: ALTER COLUMN … SET DEFAULT
--          'IN'/'INR' (not advised). Dropped indexes: the definitions are in the SELECT at the end, recreate from there.
-- (its indexes are made in DO blocks that tools/schema-replay.cjs does not read — no allow header is needed.)

-- ── 1 · INDEXES — one DO block, one list: (index, table, columns, predicate) ───────────────────────────────────────────────────
-- A nullable, sparse column gets a PARTIAL index (WHERE col IS NOT NULL): the foreign-key check and every `col = $1` filter implies
-- NOT NULL, so the planner still uses it, and the index stays small.
DO $$
DECLARE
  spec text[];
  made int := 0;
  specs text[][] := ARRAY[
    -- foreign keys on live tables (ix_fk_*)
    ['ix_fk_catalogue_items_schema',        'catalogue_items',        'schema_id',               'schema_id IS NOT NULL'],
    ['ix_fk_chit_disputes_resolved_by',     'chit_disputes',          'resolved_by_entity_id',   'resolved_by_entity_id IS NOT NULL'],
    ['ix_fk_chit_messages_sender',          'chit_messages',          'sender_entity_id',        'sender_entity_id IS NOT NULL'],
    ['ix_fk_chit_messages_visibility',      'chit_messages',          'visibility_entity_id',    'visibility_entity_id IS NOT NULL'],
    ['ix_fk_customer_list_identity',        'customer_list',          'customer_identity_id',    NULL],
    ['ix_fk_supplier_list_supplier',        'supplier_list',          'supplier_entity_id',      NULL],
    ['ix_fk_actor_settings_assignee',       'entity_actor_settings',  'default_assignee_actor_id','default_assignee_actor_id IS NOT NULL'],
    ['ix_fk_identities_deactivated_by',     'identities',             'deactivated_by',          'deactivated_by IS NOT NULL'],
    ['ix_fk_identities_delegate',           'identities',             'delegate_actor_id',       'delegate_actor_id IS NOT NULL'],
    ['ix_fk_identities_dispute_handler',    'identities',             'dispute_handler_actor_id','dispute_handler_actor_id IS NOT NULL'],
    ['ix_fk_identities_removed_by',         'identities',             'removed_by',              'removed_by IS NOT NULL'],
    ['ix_fk_access_events_changed_by',      'access_events',          'changed_by',              'changed_by IS NOT NULL'],
    ['ix_fk_supplier_ready_accepted_by',    'supplier_readiness_acceptance', 'accepted_by',      'accepted_by IS NOT NULL'],
    ['ix_fk_supplier_ready_supplier',       'supplier_readiness_acceptance', 'supplier_id',      NULL],
    ['ix_fk_register_entry_closes',         'register_entry',         'closes_id',               'closes_id IS NOT NULL'],
    ['ix_fk_register_entry_revises',        'register_entry',         'revises_id',              'revises_id IS NOT NULL'],
    ['ix_fk_register_entry_to_type',        'register_entry',         'to_type',                 'to_type IS NOT NULL'],
    ['ix_fk_register_subject_type',         'register_subject',       'type_key',                NULL],
    ['ix_fk_work_routing_folder',           'entity_work_routing',    'folder_id',               'folder_id IS NOT NULL'],
    ['ix_fk_quick_key_group_entity',        'quick_key_group',        'entity_id',               NULL],
    ['ix_fk_quick_key_item_product',        'quick_key_group_item',   'product_id',              NULL],
    ['ix_fk_counter_hidden_product',        'counter_hidden_item',    'product_id',              NULL],
    ['ix_fk_device_screen_entity',          'device_screen_config',   'entity_id',               NULL],
    ['ix_fk_ledger_account_parent',         'ledger_account',         'parent_id',               'parent_id IS NOT NULL'],
    ['ix_fk_journal_entry_reverses',        'journal_entry',          'reverses_entry_id',       'reverses_entry_id IS NOT NULL'],
    ['ix_fk_journal_line_account',          'journal_line',           'account_id',              NULL],
    ['ix_fk_account_balance_account',       'account_balance',        'account_id',              NULL],
    ['ix_fk_party_item_account',            'party_item',             'account_id',              NULL],
    ['ix_fk_party_item_entry',              'party_item',             'entry_id',                NULL],
    ['ix_fk_party_item_payment',            'party_item',             'payment_id',              'payment_id IS NOT NULL'],
    ['ix_fk_party_tax_id_party',            'party_tax_id',           'party_id',                NULL],
    ['ix_fk_party_interaction_party',       'party_interaction',      'party_id',                NULL],
    ['ix_fk_party_followup_party',          'party_followup',         'party_id',                NULL],
    ['ix_fk_party_contact_pref_party',      'party_contact_pref',     'party_id',                NULL],
    ['ix_fk_privacy_request_party',         'privacy_request',        'party_id',                NULL],
    ['ix_fk_signin_events_identity',        'signin_events',          'identity_id',             NULL],
    ['ix_fk_memberships_kind',              'memberships',            'kind',                    NULL],
    -- the hottest filters of SCHEMA-ASSESSMENT §2 (ix_hot_*): a plain `user_id =` could not use lower(user_id); trash is read by deleted_at
    ['ix_hot_identities_user_id',           'identities',             'user_id',                 'user_id IS NOT NULL'],
    ['ix_hot_chit_status_trash',            'chit_status',            'entity_id',               'deleted_at IS NOT NULL'],
    ['ix_hot_chit_disputes_entity_status',  'chit_disputes',          'entity_id, status',       NULL],
    ['ix_hot_catalogue_source_owner',       'catalogue_source',       'owner_entity_id',         'owner_entity_id IS NOT NULL'],
    ['ix_hot_erp_handoff_entity',           'erp_handoff',            'entity_id',               NULL]
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    -- skip when the table or any named column is not here (production may differ from a fresh build)
    IF to_regclass('public.' || spec[2]) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM unnest(string_to_array(replace(spec[3], ' ', ''), ',')) c(col)
                WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns k
                                   WHERE k.table_schema = 'public' AND k.table_name = spec[2] AND k.column_name = c.col)) THEN CONTINUE; END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)%s', spec[1], spec[2], spec[3],
                   CASE WHEN spec[4] IS NULL THEN '' ELSE ' WHERE ' || spec[4] END);
    made := made + 1;
  END LOOP;
  RAISE NOTICE 'b763: % index statements run (existing ones were left as they are)', made;
END $$;

-- ── 2 · DROP the duplicate and the redundant indexes — only where the index that covers it is present ─────────────────────────────
-- (dropped index, the one that stays). The two exact duplicates are the first two rows: a UNIQUE constraint already holds the same
-- four columns. Every other row is a leading prefix of the one named beside it.
DO $$
DECLARE
  pair text[];
  dropped int := 0;
  pairs text[][] := ARRAY[
    ['chit_line_amendment_chit',     'chit_line_amendment_entity_id_chit_id_line_index_seq_key'],
    ['chit_line_assign_line',        'chit_line_assignment_entity_id_chit_id_line_id_seq_key'],
    ['idx_chit_detail_chit',         'chit_detail_cid_eid_dir'],
    ['idx_chit_header_chit',         'chit_header_pkey'],
    ['idx_chit_status_chit',         'chit_status_cid_eid_dir'],
    ['idx_chit_messages_chit_id',    'idx_chit_messages_thread'],
    ['idx_chit_disputes_chit_id',    'idx_chit_disputes_status'],
    ['idx_customer_list_owner',      'customer_list_owner_entity_id_customer_identity_id_key'],
    ['idx_supplier_list_owner',      'supplier_list_owner_entity_id_supplier_entity_id_key'],
    ['idx_entity_schemas_entity',    'idx_entity_schemas_default'],
    ['idx_schema_fields_schema',     'idx_schema_fields_order'],
    ['wholesaler_store_owner',       'wholesaler_store_key'],
    ['idoc_identity_idx',            'idoc_one_per_scheme'],
    ['journal_entry_date_idx',       'journal_entry_page_idx'],
    ['journal_line_account_idx',     'journal_line_account_entry_idx'],
    ['cc_actor_idx',                 'cc_actor_bridge_idx'],
    ['idx_identities_parent_entity', 'idx_identities_parent']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    IF to_regclass('public.' || pair[2]) IS NULL OR to_regclass('public.' || pair[1]) IS NULL THEN CONTINUE; END IF;
    -- never an index that backs a constraint (DROP INDEX would refuse, and the constraint is the point of it)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = to_regclass('public.' || pair[1])) THEN CONTINUE; END IF;
    EXECUTE format('DROP INDEX IF EXISTS public.%I', pair[1]);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'b763: % redundant or duplicate index(es) dropped', dropped;
END $$;

-- ── 3 · NATIONAL DEFAULTS — the DEFAULT goes, the data stays ────────────────────────────────────────────────────────────────────
-- A row that states its country/currency is unchanged; a row that does not now fails loudly instead of answering India.
DO $$
DECLARE
  d text[];
  defaults text[][] := ARRAY[
    ['books_setting', 'country'], ['books_setting', 'functional_currency'], ['chit_detail', 'currency_code'],
    ['chit_line_cost', 'currency'], ['fixed_asset', 'currency'], ['identity_documents', 'country']
  ];
BEGIN
  FOREACH d SLICE 1 IN ARRAY defaults LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = d[1] AND column_name = d[2]) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT', d[1], d[2]);
    END IF;
  END LOOP;
END $$;

-- ── 4 · FORCE ROW LEVEL SECURITY on the five core chit tables (production already has it; a rebuild did not) ───────────────────────
ALTER TABLE chit_header     FORCE ROW LEVEL SECURITY;
ALTER TABLE chit_status     FORCE ROW LEVEL SECURITY;
ALTER TABLE chit_detail     FORCE ROW LEVEL SECURITY;
ALTER TABLE state_log       FORCE ROW LEVEL SECURITY;
ALTER TABLE catalogue_items FORCE ROW LEVEL SECURITY;

-- ── PROOFS (re-run the file to see them) ───────────────────────────────────────────────────────────────────────────────────────
SELECT 'forced core tables (want 5)' AS proof, count(*)::text AS value
  FROM pg_class WHERE relname IN ('chit_header','chit_status','chit_detail','state_log','catalogue_items') AND relkind = 'r' AND relforcerowsecurity
UNION ALL SELECT 'national defaults left (want 0)', count(*)::text
  FROM information_schema.columns WHERE table_schema = 'public'
   AND ((table_name, column_name) IN (('books_setting','country'),('books_setting','functional_currency'),('chit_detail','currency_code'),
                                      ('chit_line_cost','currency'),('fixed_asset','currency'),('identity_documents','country')))
   AND column_default IS NOT NULL
UNION ALL SELECT 'ix_fk_/ix_hot_ indexes present', count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname ~ '^ix_(fk|hot)_';

-- ============================================================================
-- 000_baseline_part2.sql — constraints, indexes, RLS, policies, triggers,
-- functions. Apply AFTER 000_baseline.sql. Captured from prod 2026-07-05.
-- ltree extension internal C functions are intentionally EXCLUDED (provided
-- by CREATE EXTENSION ltree in part 1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 2) CONSTRAINTS
-- ---------------------------------------------------------------------------
ALTER TABLE assist_qa ADD CONSTRAINT assist_qa_pkey PRIMARY KEY (id);
ALTER TABLE blueprints ADD CONSTRAINT blueprints_pkey PRIMARY KEY (blueprint_key);
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_pkey PRIMARY KEY (item_id);
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES identities(identity_id);
ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES entity_schemas(schema_id);
ALTER TABLE cb_attachment ADD CONSTRAINT cb_attachment_pkey PRIMARY KEY (id);
ALTER TABLE cb_building ADD CONSTRAINT cb_building_pkey PRIMARY KEY (id);
ALTER TABLE cb_building ADD CONSTRAINT cb_building_city_id_fkey FOREIGN KEY (city_id) REFERENCES cb_city(id);
ALTER TABLE cb_catalogue_category ADD CONSTRAINT cb_catalogue_category_pkey PRIMARY KEY (id);
ALTER TABLE cb_catalogue_category ADD CONSTRAINT cb_catalogue_category_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_catalogue_category ADD CONSTRAINT cb_catalogue_category_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES cb_currency(id);
ALTER TABLE cb_catalogue_item ADD CONSTRAINT cb_catalogue_item_pkey PRIMARY KEY (id);
ALTER TABLE cb_catalogue_item ADD CONSTRAINT cb_catalogue_item_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES cb_currency(id);
ALTER TABLE cb_catalogue_item ADD CONSTRAINT cb_catalogue_item_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_catalogue_item ADD CONSTRAINT cb_catalogue_item_price_type_check CHECK ((price_type = ANY (ARRAY['Personal'::text, 'Business'::text, 'Employee'::text])));
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_pkey PRIMARY KEY (id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_chit_hash_key UNIQUE (chit_hash);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES cb_chit(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_edge_id_fkey FOREIGN KEY (edge_id) REFERENCES cb_edge(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_from_entity_fkey FOREIGN KEY (from_entity) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_to_entity_fkey FOREIGN KEY (to_entity) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_for_entity_fkey FOREIGN KEY (for_entity) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_assign_to_fkey FOREIGN KEY (assign_to) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_info_entity_fkey FOREIGN KEY (info_entity) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_assign_by_fkey FOREIGN KEY (assign_by) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES cb_currency(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_created_by_fkey FOREIGN KEY (created_by) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES cb_entity(id);
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_role_check CHECK ((role = ANY (ARRAY['Act'::text, 'Info'::text, 'For'::text, 'Draft'::text])));
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_txn_status_check CHECK ((txn_status = ANY (ARRAY['Active'::text, 'Accepted'::text, 'InProgress'::text, 'Finished'::text, 'Completed'::text, 'Withdrawn'::text, 'Hold'::text, 'Closed'::text, 'Archived'::text])));
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_bridge_status_check CHECK ((bridge_status = ANY (ARRAY['Sender'::text, 'Act'::text, 'Info'::text, 'For'::text, 'Draft'::text])));
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_physical_status_check CHECK ((physical_status = ANY (ARRAY['Active'::text, 'Deleted'::text, 'Archived'::text, 'Spam'::text, 'ReplyDraft'::text, 'ForwardDraft'::text])));
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_read_status_check CHECK ((read_status = ANY (ARRAY['Read'::text, 'UnRead'::text])));
ALTER TABLE cb_chit ADD CONSTRAINT cb_chit_priority_check CHECK ((priority = ANY (ARRAY['Important'::text, 'Urgent'::text, 'No'::text])));
ALTER TABLE cb_chit_item ADD CONSTRAINT cb_chit_item_pkey PRIMARY KEY (id);
ALTER TABLE cb_chit_item ADD CONSTRAINT cb_chit_item_chit_id_fkey FOREIGN KEY (chit_id) REFERENCES cb_chit(id) ON DELETE CASCADE;
ALTER TABLE cb_chit_item ADD CONSTRAINT cb_chit_item_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Added'::text, 'Modified'::text, 'Deleted'::text, 'InActive'::text])));
ALTER TABLE cb_chit_log ADD CONSTRAINT cb_chit_log_pkey PRIMARY KEY (id);
ALTER TABLE cb_chit_log ADD CONSTRAINT cb_chit_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES cb_entity(id);
ALTER TABLE cb_chit_log ADD CONSTRAINT cb_chit_log_action_by_fkey FOREIGN KEY (action_by) REFERENCES cb_entity(id);
ALTER TABLE cb_chit_log ADD CONSTRAINT cb_chit_log_chit_id_fkey FOREIGN KEY (chit_id) REFERENCES cb_chit(id) ON DELETE CASCADE;
ALTER TABLE cb_chit_log ADD CONSTRAINT cb_chit_log_action_check CHECK ((action = ANY (ARRAY['Created'::text, 'Accepted'::text, 'Diarised'::text, 'InProgress'::text, 'Finished'::text, 'Completed'::text, 'Withdrawn'::text, 'Hold'::text, 'Closed'::text, 'Modify'::text, 'Forward'::text, 'Reply'::text, 'ReplyAll'::text, 'Deleted'::text, 'Archived'::text, 'Assignee'::text])));
ALTER TABLE cb_city ADD CONSTRAINT cb_city_pkey PRIMARY KEY (id);
ALTER TABLE cb_consumer_traction ADD CONSTRAINT cb_consumer_traction_pkey PRIMARY KEY (id);
ALTER TABLE cb_consumer_traction ADD CONSTRAINT cb_consumer_traction_consumer_id_fkey FOREIGN KEY (consumer_id) REFERENCES cb_entity(id);
ALTER TABLE cb_consumer_traction ADD CONSTRAINT cb_consumer_traction_business_id_fkey FOREIGN KEY (business_id) REFERENCES cb_entity(id);
ALTER TABLE cb_contact ADD CONSTRAINT cb_contact_pkey PRIMARY KEY (id);
ALTER TABLE cb_contact ADD CONSTRAINT cb_contact_owner_id_contact_id_key UNIQUE (owner_id, contact_id);
ALTER TABLE cb_contact ADD CONSTRAINT cb_contact_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_contact ADD CONSTRAINT cb_contact_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_currency ADD CONSTRAINT cb_currency_pkey PRIMARY KEY (id);
ALTER TABLE cb_currency ADD CONSTRAINT cb_currency_code_key UNIQUE (code);
ALTER TABLE cb_currency ADD CONSTRAINT cb_currency_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'InActive'::text])));
ALTER TABLE cb_device ADD CONSTRAINT cb_device_pkey PRIMARY KEY (id);
ALTER TABLE cb_device ADD CONSTRAINT cb_device_service_provider_id_fkey FOREIGN KEY (service_provider_id) REFERENCES cb_entity(id);
ALTER TABLE cb_device ADD CONSTRAINT cb_device_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_edge ADD CONSTRAINT cb_edge_pkey PRIMARY KEY (id);
ALTER TABLE cb_edge ADD CONSTRAINT cb_edge_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES cb_entity(id) ON DELETE RESTRICT;
ALTER TABLE cb_edge ADD CONSTRAINT cb_edge_child_id_fkey FOREIGN KEY (child_id) REFERENCES cb_entity(id) ON DELETE RESTRICT;
ALTER TABLE cb_edge ADD CONSTRAINT cb_edge_assign_to_fkey FOREIGN KEY (assign_to) REFERENCES cb_entity(id);
ALTER TABLE cb_edge ADD CONSTRAINT cb_edge_no_self CHECK ((parent_id <> child_id));
ALTER TABLE cb_edge ADD CONSTRAINT cb_edge_type_check CHECK ((type = ANY (ARRAY['governance'::text, 'commercial'::text, 'discovery'::text, 'counterparty'::text, 'agency'::text])));
ALTER TABLE cb_edge ADD CONSTRAINT cb_edge_state_check CHECK ((state = ANY (ARRAY['requested'::text, 'active'::text, 'suspended'::text, 'declined'::text, 'disconnected'::text])));
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_pkey PRIMARY KEY (id);
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_bridge_id_key UNIQUE (bridge_id);
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES cb_currency(id);
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_business_type_check CHECK ((business_type = ANY (ARRAY['Aggregator'::text, 'Circle'::text, 'Business'::text])));
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_business_status_check CHECK ((business_status = ANY (ARRAY['Open'::text, 'Closed'::text, 'Away'::text])));
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_account_type_check CHECK ((account_type = ANY (ARRAY['Personal'::text, 'Business'::text, 'Admin'::text, 'Guest'::text, 'Employee'::text])));
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_mode_check CHECK ((mode = ANY (ARRAY['b2b'::text, 'b2c'::text])));
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_owner_scope_check CHECK ((owner_scope = ANY (ARRAY['entity'::text, 'network'::text, 'platform'::text])));
ALTER TABLE cb_entity ADD CONSTRAINT cb_entity_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])));
ALTER TABLE cb_entity_employee ADD CONSTRAINT cb_entity_employee_pkey PRIMARY KEY (id);
ALTER TABLE cb_entity_employee ADD CONSTRAINT cb_entity_employee_owner_id_employee_id_key UNIQUE (owner_id, employee_id);
ALTER TABLE cb_entity_employee ADD CONSTRAINT cb_entity_employee_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_entity_employee ADD CONSTRAINT cb_entity_employee_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_entity_supplier ADD CONSTRAINT cb_entity_supplier_pkey PRIMARY KEY (id);
ALTER TABLE cb_entity_supplier ADD CONSTRAINT cb_entity_supplier_entity_id_industry_id_building_id_key UNIQUE (entity_id, industry_id, building_id);
ALTER TABLE cb_entity_supplier ADD CONSTRAINT cb_entity_supplier_industry_id_fkey FOREIGN KEY (industry_id) REFERENCES cb_industry(id);
ALTER TABLE cb_entity_supplier ADD CONSTRAINT cb_entity_supplier_building_id_fkey FOREIGN KEY (building_id) REFERENCES cb_building(id);
ALTER TABLE cb_entity_supplier ADD CONSTRAINT cb_entity_supplier_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_external_reference ADD CONSTRAINT cb_external_reference_pkey PRIMARY KEY (id);
ALTER TABLE cb_external_reference ADD CONSTRAINT cb_external_reference_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES cb_entity(id) ON DELETE CASCADE;
ALTER TABLE cb_external_reference ADD CONSTRAINT cb_external_reference_priority_check CHECK ((priority = ANY (ARRAY['VeryLow'::text, 'Low'::text, 'Medium'::text, 'High'::text, 'VeryHigh'::text])));
ALTER TABLE cb_industry ADD CONSTRAINT cb_industry_pkey PRIMARY KEY (id);
ALTER TABLE cb_task ADD CONSTRAINT cb_task_pkey PRIMARY KEY (id);
ALTER TABLE cb_task ADD CONSTRAINT cb_task_to_chit_id_fkey FOREIGN KEY (to_chit_id) REFERENCES cb_chit(id);
ALTER TABLE cb_task ADD CONSTRAINT cb_task_from_chit_id_fkey FOREIGN KEY (from_chit_id) REFERENCES cb_chit(id);
ALTER TABLE cb_task ADD CONSTRAINT cb_task_from_entity_fkey FOREIGN KEY (from_entity) REFERENCES cb_entity(id);
ALTER TABLE cb_task ADD CONSTRAINT cb_task_to_entity_fkey FOREIGN KEY (to_entity) REFERENCES cb_entity(id);
ALTER TABLE cb_task ADD CONSTRAINT cb_task_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'InActive'::text, 'Blocked'::text, 'Suspended'::text, 'Deleted'::text, 'Link'::text, 'Delink'::text, 'Complete'::text, 'Issue'::text])));
ALTER TABLE cb_task ADD CONSTRAINT cb_task_link_flag_check CHECK ((link_flag = ANY (ARRAY['Internal'::text, 'External'::text])));
ALTER TABLE cb_transaction_history ADD CONSTRAINT cb_transaction_history_pkey PRIMARY KEY (id);
ALTER TABLE cb_transaction_history ADD CONSTRAINT cb_transaction_history_to_entity_fkey FOREIGN KEY (to_entity) REFERENCES cb_entity(id);
ALTER TABLE cb_transaction_history ADD CONSTRAINT cb_transaction_history_info_entity_fkey FOREIGN KEY (info_entity) REFERENCES cb_entity(id);
ALTER TABLE chit_detail ADD CONSTRAINT chit_detail_pkey PRIMARY KEY (detail_id);
ALTER TABLE chit_detail ADD CONSTRAINT chit_detail_cid_eid_dir UNIQUE (chit_id, entity_id, direction);
ALTER TABLE chit_detail ADD CONSTRAINT chit_detail_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES identities(identity_id);
ALTER TABLE chit_disputes ADD CONSTRAINT chit_disputes_pkey PRIMARY KEY (dispute_id);
ALTER TABLE chit_disputes ADD CONSTRAINT chit_disputes_raised_by_entity_id_fkey FOREIGN KEY (raised_by_entity_id) REFERENCES identities(identity_id);
ALTER TABLE chit_disputes ADD CONSTRAINT chit_disputes_resolved_by_entity_id_fkey FOREIGN KEY (resolved_by_entity_id) REFERENCES identities(identity_id);
ALTER TABLE chit_disputes ADD CONSTRAINT chit_disputes_target_entity_id_fkey FOREIGN KEY (target_entity_id) REFERENCES identities(identity_id);
ALTER TABLE chit_disputes ADD CONSTRAINT chit_disputes_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'resolved'::character varying])::text[])));
ALTER TABLE chit_disputes ADD CONSTRAINT chit_disputes_category_check CHECK (((category)::text = ANY ((ARRAY['quality'::character varying, 'quantity'::character varying, 'delivery'::character varying, 'payment'::character varying, 'docs'::character varying, 'other'::character varying])::text[])));
ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_parity CHECK (((parity_state IS NULL) OR ((parity_state)::text = ANY ((ARRAY['present'::character varying, 'archived'::character varying, 'erased'::character varying, 'defunct'::character varying, 'absent'::character varying])::text[]))));
ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_via CHECK (((via)::text = ANY ((ARRAY['chit'::character varying, 'mailbox'::character varying])::text[])));
ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_mode CHECK (((mode)::text = ANY ((ARRAY['two_sided'::character varying, 'one_sided'::character varying])::text[])));
ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_scope CHECK (((scope)::text = ANY ((ARRAY['targeted'::character varying, 'chit_wide'::character varying])::text[])));
ALTER TABLE chit_header ADD CONSTRAINT chit_header_pkey PRIMARY KEY (chit_id, entity_id, direction);
ALTER TABLE chit_header ADD CONSTRAINT chit_header_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES identities(identity_id);
ALTER TABLE chit_header ADD CONSTRAINT chit_header_role_check CHECK (((role)::text = ANY ((ARRAY['Act'::character varying, 'Info'::character varying, 'For'::character varying, 'Draft'::character varying])::text[])));
ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_pkey PRIMARY KEY (message_id);
ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_visibility_entity_id_fkey FOREIGN KEY (visibility_entity_id) REFERENCES identities(identity_id);
ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_sender_entity_id_fkey FOREIGN KEY (sender_entity_id) REFERENCES identities(identity_id);
ALTER TABLE chit_messages ADD CONSTRAINT chit_messages_thread_type_check CHECK (((thread_type)::text = ANY ((ARRAY['external'::character varying, 'internal'::character varying])::text[])));
ALTER TABLE chit_messages ADD CONSTRAINT chk_chit_messages_msg_type CHECK (((msg_type)::text = ANY ((ARRAY['info'::character varying, 'query'::character varying, 'action'::character varying, 'risk'::character varying, 'assumption'::character varying, 'issue'::character varying, 'dependency'::character varying, 'decision'::character varying])::text[])));
ALTER TABLE chit_status ADD CONSTRAINT chit_status_pkey PRIMARY KEY (status_id);
ALTER TABLE chit_status ADD CONSTRAINT chit_status_cid_eid_dir UNIQUE (chit_id, entity_id, direction);
ALTER TABLE chit_status ADD CONSTRAINT chit_status_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES identities(identity_id);
ALTER TABLE connections ADD CONSTRAINT connections_pkey PRIMARY KEY (connection_id);
ALTER TABLE connections ADD CONSTRAINT connections_from_entity_id_to_entity_id_key UNIQUE (from_entity_id, to_entity_id);
ALTER TABLE connections ADD CONSTRAINT connections_from_entity_id_fkey FOREIGN KEY (from_entity_id) REFERENCES identities(identity_id);
ALTER TABLE connections ADD CONSTRAINT connections_to_entity_id_fkey FOREIGN KEY (to_entity_id) REFERENCES identities(identity_id);
ALTER TABLE customer_list ADD CONSTRAINT customer_list_pkey PRIMARY KEY (customer_list_id);
ALTER TABLE customer_list ADD CONSTRAINT customer_list_owner_entity_id_customer_identity_id_key UNIQUE (owner_entity_id, customer_identity_id);
ALTER TABLE customer_list ADD CONSTRAINT customer_list_customer_identity_id_fkey FOREIGN KEY (customer_identity_id) REFERENCES identities(identity_id);
ALTER TABLE customer_list ADD CONSTRAINT customer_list_owner_entity_id_fkey FOREIGN KEY (owner_entity_id) REFERENCES identities(identity_id);
ALTER TABLE customer_list ADD CONSTRAINT customer_list_segment_override_check CHECK (((segment_override)::text = ANY ((ARRAY['high_value'::character varying, 'regular'::character varying, 'new'::character varying, 'inactive'::character varying])::text[])));
ALTER TABLE customer_list ADD CONSTRAINT customer_list_customer_type_check CHECK (((customer_type)::text = ANY ((ARRAY['entity'::character varying, 'end_customer'::character varying])::text[])));
ALTER TABLE customer_list ADD CONSTRAINT customer_list_added_via_check CHECK (((added_via)::text = ANY ((ARRAY['transaction'::character varying, 'manual'::character varying, 'import'::character varying, 'catalogue'::character varying])::text[])));
ALTER TABLE dispute_participants ADD CONSTRAINT dispute_participants_pkey PRIMARY KEY (dispute_id, entity_id);
ALTER TABLE dispute_participants ADD CONSTRAINT dispute_participants_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES chit_disputes(dispute_id) ON DELETE CASCADE;
ALTER TABLE dispute_participants ADD CONSTRAINT dispute_participants_role_check CHECK (((role)::text = ANY ((ARRAY['raiser'::character varying, 'party'::character varying])::text[])));
ALTER TABLE dispute_participants ADD CONSTRAINT dispute_participants_dispute_status_check CHECK (((dispute_status)::text = ANY ((ARRAY['open'::character varying, 'acknowledged'::character varying, 'resolved'::character varying])::text[])));
ALTER TABLE entity_actor_settings ADD CONSTRAINT entity_actor_settings_pkey PRIMARY KEY (setting_id);
ALTER TABLE entity_actor_settings ADD CONSTRAINT uq_entity_actor_settings UNIQUE (entity_id);
ALTER TABLE entity_actor_settings ADD CONSTRAINT entity_actor_settings_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES identities(identity_id);
ALTER TABLE entity_actor_settings ADD CONSTRAINT entity_actor_settings_default_assignee_actor_id_fkey FOREIGN KEY (default_assignee_actor_id) REFERENCES identities(identity_id);
ALTER TABLE entity_actor_settings ADD CONSTRAINT entity_actor_settings_auto_assign_mode_check CHECK (((auto_assign_mode)::text = ANY ((ARRAY['off'::character varying, 'default_assignee'::character varying, 'least_loaded'::character varying])::text[])));
ALTER TABLE entity_actor_settings ADD CONSTRAINT entity_actor_settings_assignment_model_check CHECK (((assignment_model)::text = ANY ((ARRAY['pull'::character varying, 'push'::character varying, 'both'::character varying])::text[])));
ALTER TABLE entity_schemas ADD CONSTRAINT entity_schemas_pkey PRIMARY KEY (schema_id);
ALTER TABLE entity_schemas ADD CONSTRAINT entity_schemas_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES identities(identity_id);
ALTER TABLE entity_schemas ADD CONSTRAINT entity_schemas_source_check CHECK (((source)::text = ANY ((ARRAY['manual'::character varying, 'template'::character varying, 'import'::character varying, 'sync'::character varying])::text[])));
ALTER TABLE entity_schemas ADD CONSTRAINT entity_schemas_schema_type_check CHECK (((schema_type)::text = ANY ((ARRAY['product'::character varying, 'service'::character varying, 'custom'::character varying, 'general'::character varying])::text[])));
ALTER TABLE entity_schemas ADD CONSTRAINT entity_schemas_visibility_chk CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'restricted'::character varying, 'public'::character varying])::text[])));
ALTER TABLE entity_schemas ADD CONSTRAINT entity_schemas_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'draft'::character varying, 'archived'::character varying])::text[])));
ALTER TABLE governance_exceptions ADD CONSTRAINT governance_exceptions_pkey PRIMARY KEY (exception_id);
ALTER TABLE identities ADD CONSTRAINT identities_pkey PRIMARY KEY (identity_id);
ALTER TABLE identities ADD CONSTRAINT identities_bridge_id_key UNIQUE (bridge_id);
ALTER TABLE identities ADD CONSTRAINT identities_email_key UNIQUE (email);
ALTER TABLE identities ADD CONSTRAINT uq_actor_key_per_entity UNIQUE (actor_key, parent_entity_id);
ALTER TABLE identities ADD CONSTRAINT identities_parent_entity_id_fkey FOREIGN KEY (parent_entity_id) REFERENCES identities(identity_id);
ALTER TABLE identities ADD CONSTRAINT identities_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES identities(identity_id);
ALTER TABLE identities ADD CONSTRAINT identities_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES identities(identity_id);
ALTER TABLE identities ADD CONSTRAINT identities_dispute_handler_actor_id_fkey FOREIGN KEY (dispute_handler_actor_id) REFERENCES identities(identity_id);
ALTER TABLE identities ADD CONSTRAINT identities_delegate_actor_id_fkey FOREIGN KEY (delegate_actor_id) REFERENCES identities(identity_id);
ALTER TABLE identities ADD CONSTRAINT identities_hat_check CHECK (((hat)::text = ANY ((ARRAY['view_only'::character varying, 'act'::character varying, 'audit'::character varying, 'mis'::character varying, 'manager'::character varying])::text[])));
ALTER TABLE identities ADD CONSTRAINT identities_break_status_check CHECK (((break_status)::text = ANY ((ARRAY['active'::character varying, 'short_break'::character varying, 'leave'::character varying, 'deactivated'::character varying, 'removed'::character varying])::text[])));
ALTER TABLE identities ADD CONSTRAINT identities_break_type_check CHECK (((break_type)::text = ANY ((ARRAY['short_break'::character varying, 'leave'::character varying])::text[])));
ALTER TABLE identities ADD CONSTRAINT chk_identities_msg_mode CHECK (((message_type_mode)::text = ANY ((ARRAY['lean'::character varying, 'governance'::character varying, 'custom'::character varying])::text[])));
ALTER TABLE identities ADD CONSTRAINT identities_self_copy_pref_check CHECK (((self_copy_pref)::text = ANY ((ARRAY['both'::character varying, 'sent'::character varying, 'received'::character varying])::text[])));
ALTER TABLE identities ADD CONSTRAINT identities_owner_scope_chk CHECK (((owner_scope)::text = ANY ((ARRAY['entity'::character varying, 'platform'::character varying])::text[])));
ALTER TABLE identities ADD CONSTRAINT identities_business_status_chk CHECK (((business_status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying, 'away'::character varying])::text[])));
ALTER TABLE platform_constitution ADD CONSTRAINT platform_constitution_pkey PRIMARY KEY (constitution_id);
ALTER TABLE platform_constitution ADD CONSTRAINT platform_constitution_root_id_version_key UNIQUE (root_id, version);
ALTER TABLE platform_constitution ADD CONSTRAINT platform_constitution_root_id_fkey FOREIGN KEY (root_id) REFERENCES platform_root(root_id);
ALTER TABLE platform_root ADD CONSTRAINT platform_root_pkey PRIMARY KEY (root_id);
ALTER TABLE schema_fields ADD CONSTRAINT schema_fields_pkey PRIMARY KEY (field_id);
ALTER TABLE schema_fields ADD CONSTRAINT schema_fields_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES entity_schemas(schema_id);
ALTER TABLE schema_fields ADD CONSTRAINT schema_fields_field_type_check CHECK (((field_type)::text = ANY ((ARRAY['text'::character varying, 'number'::character varying, 'radio'::character varying, 'checkbox'::character varying, 'boolean'::character varying, 'date'::character varying, 'dropdown'::character varying, 'range'::character varying])::text[])));
ALTER TABLE sim_compare ADD CONSTRAINT sim_compare_pkey PRIMARY KEY (id);
ALTER TABLE sim_feedback ADD CONSTRAINT sim_feedback_pkey PRIMARY KEY (id);
ALTER TABLE sim_feedback ADD CONSTRAINT sim_feedback_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES sim_leads(id);
ALTER TABLE sim_items ADD CONSTRAINT sim_items_pkey PRIMARY KEY (id);
ALTER TABLE sim_items ADD CONSTRAINT sim_items_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES sim_layers(id);
ALTER TABLE sim_items ADD CONSTRAINT sim_items_readiness_check CHECK ((readiness = ANY (ARRAY['working'::text, 'designed'::text, 'soon'::text])));
ALTER TABLE sim_layers ADD CONSTRAINT sim_layers_pkey PRIMARY KEY (id);
ALTER TABLE sim_leads ADD CONSTRAINT sim_leads_pkey PRIMARY KEY (id);
ALTER TABLE sim_rules ADD CONSTRAINT sim_rules_pkey PRIMARY KEY (id);
ALTER TABLE sim_rules ADD CONSTRAINT sim_rules_disposition_check CHECK ((disposition = ANY (ARRAY['exclude'::text, 'defer'::text, 'configure'::text, 'pass'::text])));
ALTER TABLE sim_shapes ADD CONSTRAINT sim_shapes_pkey PRIMARY KEY (id);
ALTER TABLE sim_usps ADD CONSTRAINT sim_usps_pkey PRIMARY KEY (id);
ALTER TABLE sim_usps ADD CONSTRAINT sim_usps_readiness_check CHECK ((readiness = ANY (ARRAY['working'::text, 'designed'::text, 'soon'::text])));
ALTER TABLE state_log ADD CONSTRAINT state_log_pkey PRIMARY KEY (log_id);
ALTER TABLE state_log ADD CONSTRAINT state_log_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES identities(identity_id);
ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_pkey PRIMARY KEY (supplier_list_id);
ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_owner_entity_id_supplier_entity_id_key UNIQUE (owner_entity_id, supplier_entity_id);
ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_supplier_entity_id_fkey FOREIGN KEY (supplier_entity_id) REFERENCES identities(identity_id);
ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_owner_entity_id_fkey FOREIGN KEY (owner_entity_id) REFERENCES identities(identity_id);
ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_added_via_check CHECK (((added_via)::text = ANY ((ARRAY['manual'::character varying, 'transaction'::character varying, 'import'::character varying])::text[])));

-- ---------------------------------------------------------------------------
-- 3) INDEXES  (constraint-backed indexes are created by section 2 above)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_assist_qa_active ON public.assist_qa USING btree (active);
CREATE INDEX idx_catalogue_items_entity ON public.catalogue_items USING btree (entity_id, is_active);
CREATE INDEX cb_attachment_msg_idx ON public.cb_attachment USING btree (message_id);
CREATE INDEX cb_attachment_chit_idx ON public.cb_attachment USING btree (chit_id) WHERE (message_id IS NULL);
CREATE INDEX cb_cat_item_entity ON public.cb_catalogue_item USING btree (entity_id);
CREATE INDEX cb_cat_item_tier ON public.cb_catalogue_item USING btree (entity_id, price_type);
CREATE INDEX cb_chit_open ON public.cb_chit USING btree (edge_id) WHERE (txn_status = ANY (ARRAY['Active'::text, 'Accepted'::text, 'InProgress'::text, 'Finished'::text, 'Hold'::text]));
CREATE INDEX cb_chit_to ON public.cb_chit USING btree (to_entity);
CREATE INDEX cb_chit_originator ON public.cb_chit USING btree (originator_id);
CREATE INDEX cb_chit_edge ON public.cb_chit USING btree (edge_id);
CREATE INDEX cb_chit_log_chit ON public.cb_chit_log USING btree (chit_id);
CREATE INDEX cb_contact_owner ON public.cb_contact USING btree (owner_id);
CREATE INDEX cb_edge_parent ON public.cb_edge USING btree (parent_id);
CREATE UNIQUE INDEX cb_edge_one_live_parent ON public.cb_edge USING btree (child_id) WHERE (state = ANY (ARRAY['active'::text, 'suspended'::text]));
CREATE INDEX cb_edge_child ON public.cb_edge USING btree (child_id);
CREATE INDEX cb_entity_path_btree ON public.cb_entity USING btree (path);
CREATE INDEX cb_entity_path_gist ON public.cb_entity USING gist (path);
CREATE INDEX cb_supplier_idx ON public.cb_entity_supplier USING btree (industry_id, building_id);
CREATE INDEX idx_chit_detail_chit ON public.chit_detail USING btree (chit_id);
CREATE INDEX idx_chit_detail_entity ON public.chit_detail USING btree (entity_id);
CREATE INDEX idx_chit_disputes_entity ON public.chit_disputes USING btree (raised_by_entity_id, status);
CREATE INDEX idx_chit_disputes_target ON public.chit_disputes USING btree (target_entity_id, status);
CREATE INDEX idx_chit_disputes_chit_id ON public.chit_disputes USING btree (chit_id);
CREATE INDEX idx_chit_disputes_status ON public.chit_disputes USING btree (chit_id, status);
CREATE INDEX idx_chit_header_entity_created ON public.chit_header USING btree (entity_id, created_at DESC);
CREATE INDEX idx_chit_header_sender ON public.chit_header USING btree (sender_entity_id, created_at DESC);
CREATE INDEX idx_chit_header_chit ON public.chit_header USING btree (chit_id);
CREATE INDEX ch_entity_dir_idx ON public.chit_header USING btree (entity_id, direction);
CREATE INDEX idx_chit_header_recipients_gin ON public.chit_header USING gin (all_recipients);
CREATE INDEX idx_chit_messages_visibility ON public.chit_messages USING btree (chit_id, visibility_entity_id);
CREATE INDEX idx_chit_messages_chit_id ON public.chit_messages USING btree (chit_id);
CREATE INDEX idx_chit_messages_thread ON public.chit_messages USING btree (chit_id, thread_type);
CREATE INDEX idx_chit_messages_type ON public.chit_messages USING btree (chit_id, msg_type);
CREATE INDEX cm_dispute_idx ON public.chit_messages USING btree (dispute_id) WHERE (dispute_id IS NOT NULL);
CREATE INDEX idx_chit_status_actor ON public.chit_status USING btree (assigned_to_actor_id) WHERE (assigned_to_actor_id IS NOT NULL);
CREATE INDEX idx_chit_status_unassigned ON public.chit_status USING btree (entity_id, assigned_to_actor_id) WHERE (assigned_to_actor_id IS NULL);
CREATE INDEX idx_chit_status_priority ON public.chit_status USING btree (entity_id, priority_flag, customer_priority);
CREATE INDEX cs_entity_live_idx ON public.chit_status USING btree (entity_id, direction) WHERE ((deleted_at IS NULL) AND (archived_at IS NULL));
CREATE INDEX idx_chit_status_archived ON public.chit_status USING btree (entity_id) WHERE (archived_at IS NOT NULL);
CREATE INDEX idx_chit_status_entity_read ON public.chit_status USING btree (entity_id, read_at);
CREATE INDEX idx_chit_status_chit ON public.chit_status USING btree (chit_id);
CREATE INDEX idx_chit_status_entity_status ON public.chit_status USING btree (entity_id, current_status);
CREATE INDEX idx_connections_from ON public.connections USING btree (from_entity_id, status);
CREATE INDEX idx_connections_to ON public.connections USING btree (to_entity_id, status);
CREATE INDEX idx_customer_list_owner ON public.customer_list USING btree (owner_entity_id);
CREATE INDEX idx_dispute_participants_entity ON public.dispute_participants USING btree (entity_id, dispute_status);
CREATE INDEX idx_dispute_participants_chit ON public.dispute_participants USING btree (chit_id);
CREATE INDEX idx_entity_schemas_default ON public.entity_schemas USING btree (entity_id, is_default);
CREATE INDEX idx_entity_schemas_entity ON public.entity_schemas USING btree (entity_id);
CREATE INDEX governance_exceptions_entity_idx ON public.governance_exceptions USING btree (entity_id);
CREATE INDEX idx_identities_display_name ON public.identities USING btree (lower((display_name)::text));
CREATE INDEX idx_identities_parent_entity ON public.identities USING btree (parent_entity_id) WHERE (parent_entity_id IS NOT NULL);
CREATE INDEX idx_identities_actor_status ON public.identities USING btree (parent_entity_id, break_status) WHERE (parent_entity_id IS NOT NULL);
CREATE INDEX identities_governed_by_idx ON public.identities USING btree (governed_by);
CREATE UNIQUE INDEX idx_identities_user_id ON public.identities USING btree (lower((user_id)::text)) WHERE (user_id IS NOT NULL);
CREATE INDEX idx_identities_parent ON public.identities USING btree (parent_entity_id);
CREATE UNIQUE INDEX platform_constitution_one_active ON public.platform_constitution USING btree (root_id) WHERE is_active;
CREATE UNIQUE INDEX platform_root_singleton ON public.platform_root USING btree (singleton);
CREATE INDEX idx_schema_fields_order ON public.schema_fields USING btree (schema_id, display_order);
CREATE INDEX idx_schema_fields_schema ON public.schema_fields USING btree (schema_id);
CREATE INDEX idx_state_log_entity ON public.state_log USING btree (entity_id, created_at DESC);
CREATE INDEX idx_state_log_chit_entity ON public.state_log USING btree (chit_id, entity_id, created_at);
CREATE INDEX idx_supplier_list_owner_pref ON public.supplier_list USING btree (owner_entity_id, preferred DESC, created_at DESC);
CREATE INDEX idx_supplier_list_owner ON public.supplier_list USING btree (owner_entity_id);
-- NOTE (2026-07-05): 9 duplicate indexes (cd_chit_status_idx, cd_dispute_idx,
-- cd_raiser_idx, ch_chit_idx, cm_chit_idx, cs_chit_idx, cs_assignee_idx,
-- id_parent_idx, sl_chit_entity_idx) were created by mistake and then dropped;
-- they are intentionally NOT in this baseline. See PERF-INDEX-REVIEW.md.

-- ---------------------------------------------------------------------------
-- 4) ROW-LEVEL SECURITY — enable state (6 Direct tables ON; rest OFF/carve-out)
-- ---------------------------------------------------------------------------
ALTER TABLE catalogue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_detail   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_header   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_status   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_log     ENABLE ROW LEVEL SECURITY;
-- (all other public tables are DISABLE ROW LEVEL SECURITY — app-layer scoped
--  carve-outs incl. identities, chit_messages, chit_disputes, dispute_participants)

-- ---------------------------------------------------------------------------
-- 5) RLS POLICIES  (rls_entity — entity isolation via app.current_entity)
-- ---------------------------------------------------------------------------
CREATE POLICY rls_entity ON catalogue_items FOR ALL TO public
  USING (((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid)
    OR (EXISTS ( SELECT 1 FROM entity_schemas es
      WHERE ((es.entity_id = catalogue_items.entity_id) AND (es.is_default = true)
        AND ((es.status)::text = 'active'::text) AND ((es.visibility)::text = 'public'::text))))))
  WITH CHECK ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid));
CREATE POLICY rls_entity ON chit_detail FOR ALL TO public
  USING ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid))
  WITH CHECK ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid));
CREATE POLICY rls_entity ON chit_header FOR ALL TO public
  USING ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid))
  WITH CHECK ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid));
CREATE POLICY rls_entity ON chit_status FOR ALL TO public
  USING ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid))
  WITH CHECK ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid));
CREATE POLICY rls_entity ON customer_list FOR ALL TO public
  USING ((owner_entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid))
  WITH CHECK ((owner_entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid));
CREATE POLICY rls_entity ON state_log FOR ALL TO public
  USING ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid))
  WITH CHECK ((entity_id = (NULLIF(current_setting('app.current_entity'::text, true), ''::text))::uuid));

-- ---------------------------------------------------------------------------
-- 7) FUNCTIONS (ours only — ltree extension internals excluded)
--    Declared BEFORE triggers that reference them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_touch_updated_at()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ begin new.updated_at = now(); return new; end; $function$;

CREATE OR REPLACE FUNCTION public.generate_bridge_id()
 RETURNS character varying LANGUAGE plpgsql
AS $function$
DECLARE chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result TEXT := 'CB'; i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1); END LOOP;
  RETURN result;
END; $function$;

CREATE OR REPLACE FUNCTION public.activate_constitution(p_root uuid, p_version text)
 RETURNS void LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE platform_constitution SET is_active = false WHERE root_id = p_root AND is_active;
  UPDATE platform_constitution SET is_active = true  WHERE root_id = p_root AND version = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'constitution % not found for root %', p_version, p_root; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.assist_project_from_catalogue()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
DECLARE d jsonb; ctx text[]; tpc text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (OLD.item_data ? 'qa_id') THEN
      UPDATE assist_qa SET active = false, updated_at = now() WHERE id = OLD.item_data->>'qa_id';
    END IF;
    RETURN OLD;
  END IF;
  d := NEW.item_data;
  IF NOT (d ? 'qa_id') THEN RETURN NEW; END IF;
  ctx := CASE WHEN jsonb_typeof(d->'context') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(d->'context')) ELSE '{}'::text[] END;
  tpc := CASE WHEN jsonb_typeof(d->'topics') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(d->'topics')) ELSE '{}'::text[] END;
  INSERT INTO assist_qa (id, context, topics, question, answer, fit, media, sort, active, updated_at)
  VALUES (d->>'qa_id', ctx, tpc, d->>'question', d->>'answer', NULLIF(d->>'fit',''),
    CASE WHEN jsonb_typeof(d->'media') = 'object' THEN d->'media' ELSE NULL END,
    COALESCE((SELECT sort FROM assist_qa WHERE id = d->>'qa_id'), 1000), COALESCE(NEW.is_active, true), now())
  ON CONFLICT (id) DO UPDATE SET context = EXCLUDED.context, topics = EXCLUDED.topics,
    question = EXCLUDED.question, answer = EXCLUDED.answer, fit = EXCLUDED.fit, media = EXCLUDED.media,
    active = EXCLUDED.active, updated_at = now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.chit_deliver(p_chit_id uuid, p_clear_first boolean, p_copies jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sender uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid; c jsonb;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'chit_deliver: no entity context (call inside withEntity(sender))'; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    IF (c->>'sender_entity_id')::uuid IS DISTINCT FROM v_sender THEN
      RAISE EXCEPTION 'chit_deliver: copy sender % <> caller %', c->>'sender_entity_id', v_sender;
    END IF;
  END LOOP;
  IF p_clear_first THEN
    DELETE FROM state_log   WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_detail WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_sender;
  END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    INSERT INTO chit_header
      (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
       all_recipients, purpose, auto_subject, manual_subject, summary_json, business_json,
       schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, v_sender, c->>'sender_entity_bridge_id', c->>'sender_entity_display_name',
       COALESCE(c->'all_recipients', '[]'::jsonb), c->>'purpose', c->>'auto_subject', c->>'manual_subject',
       c->'summary_json', c->'business_json', c->>'schema_version', (c->>'schema_id')::uuid, (c->>'created_by_actor_id')::uuid,
       c->>'role', p_chit_id, c->>'direction', NOW(), NOW());
    INSERT INTO chit_detail
      (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items, direction, payload_delivered_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, c->>'detail_type', COALESCE((c->>'line_item_count')::int, 0),
       COALESCE((c->>'total_value')::numeric, 0), COALESCE(c->>'currency_code', 'INR'), c->'line_items',
       c->>'direction', CASE WHEN (c->>'payload_delivered') = 'true' THEN NOW() ELSE NULL END);
    INSERT INTO chit_status (chit_id, entity_id, current_status, direction, priority_flag)
    VALUES (p_chit_id, (c->>'entity_id')::uuid, c->>'current_status', c->>'direction', COALESCE(c->>'priority_flag', 'normal'));
    IF c ? 'log' AND c->'log' IS NOT NULL THEN
      INSERT INTO state_log
        (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
      VALUES
        (p_chit_id, (c->>'entity_id')::uuid, c->'log'->>'action', (c->'log'->>'action_by_identity_id')::uuid,
         c->'log'->>'action_by_display_name', c->'log'->>'new_status', c->'log'->>'detail');
    END IF;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.chit_log_all(p_chit_id uuid, p_action text, p_actor_id uuid, p_actor_name text, p_prev_status text, p_new_status text, p_detail text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_log_all: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_log_all: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, previous_status, new_status, detail)
  SELECT p_chit_id, cs.entity_id, p_action, p_actor_id, p_actor_name, p_prev_status, p_new_status, p_detail
    FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = p_chit_id) cs;
END $function$;

CREATE OR REPLACE FUNCTION public.chit_log_targets(p_chit_id uuid, p_entity_ids uuid[], p_action text, p_actor_id uuid, p_actor_name text, p_detail text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_log_targets: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_log_targets: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
  SELECT p_chit_id, t.entity_id, p_action, p_actor_id, p_actor_name, p_detail
    FROM (SELECT DISTINCT unnest(p_entity_ids) AS entity_id) t
   WHERE EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = t.entity_id);
END $function$;

CREATE OR REPLACE FUNCTION public.chit_participant_parity(p_chit_id uuid, p_target uuid)
 RETURNS TABLE(present boolean, deleted_at timestamp without time zone) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_participant_parity: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_participant_parity: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  RETURN QUERY SELECT true, cs.deleted_at FROM chit_status cs WHERE cs.chit_id = p_chit_id AND cs.entity_id = p_target;
END $function$;

CREATE OR REPLACE FUNCTION public.chit_participants(p_chit_id uuid)
 RETURNS TABLE(entity_id uuid, current_status character varying, read_at timestamp without time zone, assigned_to_actor_display_name character varying, updated_at timestamp without time zone, display_name character varying, bridge_id character varying)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_participants: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_participants: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  RETURN QUERY
    SELECT cs.entity_id, cs.current_status, cs.read_at, cs.assigned_to_actor_display_name, cs.updated_at, i.display_name, i.bridge_id
      FROM chit_status cs JOIN identities i ON i.identity_id = cs.entity_id WHERE cs.chit_id = p_chit_id;
END $function$;

CREATE OR REPLACE FUNCTION public.chit_set_customer_priority_all(p_chit_id uuid, p_flag boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_set_customer_priority_all: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_status s WHERE s.chit_id = p_chit_id AND s.entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_set_customer_priority_all: caller % is not a participant of %', v_caller, p_chit_id;
  END IF;
  UPDATE chit_status SET customer_priority = p_flag, customer_priority_locked = true, updated_at = NOW() WHERE chit_id = p_chit_id;
END $function$;

CREATE OR REPLACE FUNCTION public.chit_set_status_all(p_chit_id uuid, p_new_status text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'chit_set_status_all: no entity context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chit_header h WHERE h.chit_id = p_chit_id AND h.entity_id = v_caller AND h.sender_entity_id = v_caller) THEN
    RAISE EXCEPTION 'chit_set_status_all: caller % is not the sender of %', v_caller, p_chit_id;
  END IF;
  UPDATE chit_status SET current_status = p_new_status, updated_at = NOW() WHERE chit_id = p_chit_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_from_blueprint(p_name text, p_email text, p_pack jsonb)
 RETURNS uuid LANGUAGE plpgsql
AS $function$
DECLARE v_id uuid; v_schema uuid; v_sname text; v_stype text; f jsonb;
BEGIN
  v_sname := coalesce(p_pack->>'schema_name', 'Blueprint');
  v_stype := coalesce(p_pack->>'schema_type', 'custom');
  SELECT identity_id INTO v_id FROM identities WHERE email = lower(p_email);
  IF v_id IS NULL THEN
    INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed)
    VALUES ('BP' || upper(substr(md5(random()::text), 1, 8)), p_name, lower(p_email), 'entity', 'active', true)
    RETURNING identity_id INTO v_id;
    IF to_regclass('public.platform_root') IS NOT NULL THEN
      UPDATE identities SET
        governed_by          = (SELECT root_id FROM platform_root LIMIT 1),
        constitution_version = (SELECT version FROM platform_constitution WHERE is_active LIMIT 1),
        plan                 = 'enterprise'
      WHERE identity_id = v_id AND governed_by IS NULL;
    END IF;
  END IF;
  SELECT schema_id INTO v_schema FROM entity_schemas WHERE entity_id = v_id AND schema_name = v_sname AND is_default = true LIMIT 1;
  IF v_schema IS NULL THEN
    INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default)
    VALUES (v_id, v_sname, v_stype, 'template', 'active', true) RETURNING schema_id INTO v_schema;
    FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p_pack->'fields', '[]'::jsonb)) LOOP
      INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
      VALUES (v_schema, f->>'name', f->>'key', coalesce(f->>'type','text'),
              coalesce((f->>'required')::boolean, false), coalesce((f->>'order')::int, 0));
    END LOOP;
  END IF;
  UPDATE identities SET capabilities = coalesce(p_pack->'capabilities', '[]'::jsonb)
   WHERE identity_id = v_id AND capabilities IS NULL;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_from_blueprint_key(p_name text, p_email text, p_key text)
 RETURNS uuid LANGUAGE plpgsql
AS $function$
DECLARE v_pack jsonb;
BEGIN
  SELECT pack INTO v_pack FROM blueprints WHERE blueprint_key=p_key AND active;
  IF v_pack IS NULL THEN RAISE EXCEPTION 'unknown or inactive blueprint: %', p_key; END IF;
  RETURN create_from_blueprint(p_name, p_email, v_pack);
END $function$;

CREATE OR REPLACE FUNCTION public.create_helpdesk(p_name text, p_email text)
 RETURNS uuid LANGUAGE sql
AS $function$ SELECT create_from_blueprint_key(p_name, p_email, 'helpdesk'); $function$;

CREATE OR REPLACE FUNCTION public.is_instance_of(p_entity uuid, p_schema_name text)
 RETURNS boolean LANGUAGE sql STABLE
AS $function$ SELECT EXISTS (SELECT 1 FROM entity_schemas WHERE entity_id=p_entity AND schema_name=p_schema_name AND status='active'); $function$;

CREATE OR REPLACE FUNCTION public.is_helpdesk(p_entity uuid)
 RETURNS boolean LANGUAGE sql STABLE
AS $function$ SELECT is_instance_of(p_entity, 'Assistant Q&A'); $function$;

-- ---------------------------------------------------------------------------
-- 6) TRIGGERS  (after the functions they reference)
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_assist_project AFTER INSERT OR DELETE OR UPDATE ON public.catalogue_items FOR EACH ROW EXECUTE FUNCTION assist_project_from_catalogue();
CREATE TRIGGER t_item_upd BEFORE UPDATE ON public.cb_catalogue_item FOR EACH ROW EXECUTE FUNCTION cb_touch_updated_at();
CREATE TRIGGER t_entity_upd BEFORE UPDATE ON public.cb_entity FOR EACH ROW EXECUTE FUNCTION cb_touch_updated_at();
CREATE TRIGGER t_task_upd BEFORE UPDATE ON public.cb_task FOR EACH ROW EXECUTE FUNCTION cb_touch_updated_at();

-- ============================================================================
-- END baseline. Follow with: b48_cb_app_role (role + GRANTs), then any
-- migrations AFTER b57. Prod already reflects this state as of 2026-07-05.
-- ============================================================================

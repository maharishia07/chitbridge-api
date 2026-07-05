-- ============================================================================
-- migration_000_baseline.sql — AUTHORITATIVE schema baseline (matches PROD)
-- Captured 2026-07-05 from prod (Supabase) via a catalog-reconstruction query.
-- This file is the single source of truth for the schema. It supersedes the
-- fragmented db/schema.sql + root migration_*.sql + migrations/net0x for a
-- FRESH build. Existing prod already has this state — re-running is not needed.
--
-- SCOPE / CAVEATS:
--   * Captures: tables, constraints (PK/FK/UNIQUE/CHECK), indexes, RLS enable
--     state, RLS policies, triggers, and OUR functions (plpgsql/sql).
--   * EXCLUDES: the ltree extension's internal C functions (provided by the
--     extension below, not our code) — they were in the dump but must NOT be
--     re-declared.
--   * DOES NOT capture: the cb_app ROLE and its GRANTs (see b48_cb_app_role /
--     b49_rls_policies) — apply those AFTER this baseline for the RLS floor.
--   * After this baseline, ALL schema changes go through committed migrations.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS ltree;      -- cb_entity.path + governance tree

-- ============================================================================
-- 1) TABLES
-- ============================================================================

CREATE TABLE assist_qa (
  id text NOT NULL,
  context text[] NOT NULL DEFAULT '{}'::text[],
  topics text[] NOT NULL DEFAULT '{}'::text[],
  question text NOT NULL,
  answer text NOT NULL,
  fit text,
  media jsonb,
  sort integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE blueprints (
  blueprint_key text NOT NULL,
  label text NOT NULL,
  pack jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE catalogue_items (
  item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  schema_id uuid,
  item_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE cb_attachment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid,
  message_id uuid,
  line_index integer,
  name text,
  mime text,
  size integer,
  data bytea,
  uploaded_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_building (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  city_id uuid,
  name text NOT NULL,
  legacy_id bigint
);

CREATE TABLE cb_catalogue_category (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  name text NOT NULL,
  image text,
  currency_code character varying(3),
  currency_id uuid,
  sort_by bigint DEFAULT 0,
  legacy_id bigint
);

CREATE TABLE cb_catalogue_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  name text,
  price numeric(16,3) NOT NULL DEFAULT 0,
  currency_code character varying(3),
  currency_id uuid,
  out_of_stock boolean DEFAULT false,
  copy_flag boolean DEFAULT false,
  available_stock text,
  section text,
  category text,
  cross_reference text,
  price_type text NOT NULL DEFAULT 'Business'::text,
  offer text,
  discounted_price numeric(16,3) DEFAULT 0,
  discount_percentage numeric(7,3) DEFAULT 0,
  sort_by bigint DEFAULT 0,
  field_json_data jsonb,
  additional_json_data jsonb,
  internal_json_data jsonb,
  image_json_data jsonb,
  audio_json_data jsonb,
  video_json_data jsonb,
  tax_json_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  legacy_id bigint
);

CREATE TABLE cb_chit (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_hash text NOT NULL,
  originator_id uuid NOT NULL,
  parent_id uuid,
  edge_id uuid,
  from_entity uuid NOT NULL,
  to_entity uuid NOT NULL,
  for_entity uuid,
  assign_to uuid,
  role text NOT NULL DEFAULT 'Act'::text,
  txn_status text NOT NULL DEFAULT 'Active'::text,
  subject text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  purpose character varying(30),
  contact_number character varying(15),
  to_bridgelist jsonb,
  info_entity uuid,
  info_bridgelist jsonb,
  for_non_bridge_name text,
  assign_by uuid,
  bridge_status text DEFAULT 'Sender'::text,
  physical_status text DEFAULT 'Active'::text,
  read_status text DEFAULT 'UnRead'::text,
  priority text DEFAULT 'No'::text,
  location text,
  latitude numeric,
  longitude numeric,
  geohash character varying(32),
  template_flag boolean DEFAULT false,
  template_ver_no integer DEFAULT 0,
  folder_location text,
  header_note text,
  footer_note text,
  task_comment jsonb,
  task_flag jsonb,
  signature text,
  currency_code character varying(3),
  currency_id uuid,
  chit_item_count integer DEFAULT 0,
  total_chit_item_value numeric(40,4) DEFAULT 0,
  expected_delivery_time timestamp with time zone,
  estimated_delivery_time timestamp with time zone,
  ref_id bigint DEFAULT 0,
  case_id character varying(8),
  is_draft boolean DEFAULT false,
  created_by uuid,
  updated_by uuid,
  notify_date timestamp with time zone,
  legacy_chit_id bigint
);

CREATE TABLE cb_chit_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid NOT NULL,
  particulars text,
  qty numeric(15,3) NOT NULL DEFAULT 0,
  price numeric(15,3) NOT NULL DEFAULT 0,
  total numeric(30,6) NOT NULL DEFAULT 0,
  reply_qty numeric(15,3),
  reply_price numeric(15,3),
  reply_total numeric(30,6),
  status text NOT NULL DEFAULT 'Active'::text,
  particulars_code character varying(64),
  reply_particulars character varying(64),
  previous_status text DEFAULT 'Active'::text
);

CREATE TABLE cb_chit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid,
  originator_id uuid,
  parent_id uuid,
  created_by uuid,
  action text NOT NULL DEFAULT 'Created'::text,
  description text,
  remark text,
  action_by uuid,
  action_date timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_city (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legacy_id bigint
);

CREATE TABLE cb_consumer_traction (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid,
  consumer_id uuid,
  total_visited integer DEFAULT 0,
  field_json_data jsonb,
  status text DEFAULT 'Active'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_contact (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  role text DEFAULT ''::text,
  preference text DEFAULT 'Yes'::text,
  is_favourite boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_currency (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code character varying(3) NOT NULL,
  name text NOT NULL,
  name_plural text,
  rounding integer DEFAULT 0,
  decimal_digits integer DEFAULT 2,
  symbol text,
  symbol_native text,
  status text NOT NULL DEFAULT 'Active'::text
);

CREATE TABLE cb_device (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  service_provider_id uuid,
  device_id character varying(64),
  device_token text,
  platform text DEFAULT 'android'::text,
  priority text DEFAULT 'Low'::text,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_edge (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL,
  child_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'governance'::text,
  state text NOT NULL,
  in_flight boolean NOT NULL DEFAULT false,
  requested_by uuid,
  approved_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_at timestamp with time zone,
  archived_at timestamp with time zone,
  alias_name text,
  assign_to uuid,
  legacy_id bigint
);

CREATE TABLE cb_entity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bridge_id text NOT NULL,
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'b2b'::text,
  owner_scope text NOT NULL DEFAULT 'entity'::text,
  path ltree NOT NULL,
  claimed boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active'::text,
  app_ref text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  legacy_id bigint,
  username character varying(55),
  password_hash text,
  account_type text DEFAULT 'Business'::text,
  business_type text DEFAULT 'Business'::text,
  firstname text,
  lastname text,
  contact_no text,
  email_id text,
  company_name text,
  company_detail_short text,
  company_detail_long text,
  company_image text,
  profile_image text,
  location text,
  latitude numeric,
  longitude numeric,
  geohash character varying(32),
  city text,
  state text,
  country text,
  currency_code character varying(3) DEFAULT 'INR'::character varying,
  currency_id uuid,
  time_zone_id integer DEFAULT 0,
  time_zone_offset numeric(7,2) DEFAULT 0,
  row_per_page integer DEFAULT 50,
  licenses jsonb DEFAULT '[]'::jsonb,
  external_connection boolean DEFAULT false,
  newsletter boolean DEFAULT true,
  terms_accepted boolean DEFAULT true,
  business_status text DEFAULT 'Open'::text,
  sms_status boolean DEFAULT false,
  field_json_data jsonb DEFAULT '{}'::jsonb,
  login_status boolean DEFAULT false,
  last_activity timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_entity_employee (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  employee_name text,
  field_json_data jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE cb_entity_supplier (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  industry_id uuid,
  building_id uuid
);

CREATE TABLE cb_external_reference (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid,
  purpose text,
  purpose_type text,
  contact_number character varying(16),
  contact_name text,
  contact_visit_count bigint DEFAULT 0,
  contact_visit_value numeric(10,0) DEFAULT 0,
  source_of_reference text,
  referrer_contact_number character varying(16),
  referrer_contact_name text,
  referral_count bigint DEFAULT 0,
  referral_value numeric(10,0) DEFAULT 0,
  priority text DEFAULT 'Low'::text,
  exit_level text DEFAULT 'None'::text,
  exit_reason text,
  field_json_data jsonb,
  status text DEFAULT 'Active'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_industry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legacy_id bigint
);

CREATE TABLE cb_task (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_purpose character varying(30),
  link_flag text DEFAULT 'Internal'::text,
  from_entity uuid,
  from_chit_id uuid,
  from_ref_id bigint,
  from_case_id character varying(8),
  from_purpose character varying(30),
  from_field_json_data jsonb,
  to_entity uuid,
  to_chit_id uuid,
  to_ref_id bigint,
  to_case_id character varying(8),
  to_purpose character varying(30),
  to_field_json_data jsonb,
  status text DEFAULT 'Link'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE cb_transaction_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  info_entity uuid,
  to_entity uuid,
  txn_status text NOT NULL DEFAULT 'Active'::text,
  batch_create_date timestamp with time zone DEFAULT now(),
  batch_process_date timestamp with time zone,
  header_count bigint DEFAULT 0,
  total_chit_item_count bigint DEFAULT 0,
  sgst numeric(40,4) DEFAULT 0,
  cgst numeric(40,4) DEFAULT 0,
  amount numeric(40,4) DEFAULT 0,
  total numeric(40,4) DEFAULT 0
);

CREATE TABLE chit_detail (
  detail_id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  detail_type character varying(50) DEFAULT 'general'::character varying,
  line_item_count integer DEFAULT 0,
  total_value numeric(15,2) DEFAULT 0.00,
  currency_code character varying(3) DEFAULT 'INR'::character varying,
  line_items jsonb,
  payload_delivered_at timestamp without time zone,
  payload_deleted_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  direction character varying(10) NOT NULL DEFAULT 'received'::character varying
);

CREATE TABLE chit_disputes (
  dispute_id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid NOT NULL,
  raised_by_entity_id uuid NOT NULL,
  raised_by_display_name character varying(200) NOT NULL,
  category character varying(50) NOT NULL,
  reason text NOT NULL,
  status character varying(20) NOT NULL DEFAULT 'open'::character varying,
  resolution_note text,
  resolved_by_entity_id uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  target_entity_id uuid,
  target_display_name character varying(200),
  scope character varying(20) NOT NULL DEFAULT 'targeted'::character varying,
  mode character varying(20) NOT NULL DEFAULT 'two_sided'::character varying,
  answerable boolean NOT NULL DEFAULT true,
  parity_state character varying(20),
  via character varying(20) NOT NULL DEFAULT 'chit'::character varying,
  evidence_snapshot jsonb
);

CREATE TABLE chit_header (
  header_id uuid DEFAULT gen_random_uuid(),
  chit_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  sender_entity_id uuid NOT NULL,
  sender_entity_bridge_id character varying(32) NOT NULL,
  sender_entity_display_name character varying(255) NOT NULL,
  created_by_actor_id uuid,
  created_by_actor_display_name character varying(255),
  all_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  purpose character varying(50) NOT NULL DEFAULT 'general'::character varying,
  auto_subject character varying(255),
  manual_subject character varying(500),
  summary_json jsonb,
  business_json jsonb,
  chit_ref uuid,
  previous_chit_id uuid,
  created_at timestamp without time zone DEFAULT now(),
  sent_at timestamp without time zone,
  schema_version character varying(20) DEFAULT '1.0'::character varying,
  schema_id uuid,
  role character varying(10) NOT NULL DEFAULT 'Act'::character varying,
  direction character varying(10) NOT NULL DEFAULT 'received'::character varying
);

CREATE TABLE chit_messages (
  message_id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid NOT NULL,
  sender_entity_id uuid NOT NULL,
  sender_display_name character varying(200) NOT NULL,
  thread_type character varying(20) NOT NULL,
  visibility_entity_id uuid,
  message_text text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  msg_type character varying(16) NOT NULL DEFAULT 'info'::character varying,
  is_dispute boolean NOT NULL DEFAULT false,
  dispute_id uuid
);

CREATE TABLE chit_status (
  status_id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  current_status character varying(30) DEFAULT 'pending'::character varying,
  assigned_to_actor_id uuid,
  assigned_to_actor_display_name character varying(255),
  assignment_type character varying(20) DEFAULT 'default'::character varying,
  read_at timestamp without time zone,
  star_flag boolean DEFAULT false,
  priority_flag character varying(10) DEFAULT 'normal'::character varying,
  snoozed_until timestamp without time zone,
  deleted_at timestamp without time zone,
  retention_expires_at timestamp without time zone DEFAULT (now() + '90 days'::interval),
  legal_hold boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  assigned_at timestamp without time zone,
  customer_priority boolean NOT NULL DEFAULT false,
  customer_priority_locked boolean NOT NULL DEFAULT false,
  archived_at timestamp without time zone,
  direction character varying(10) NOT NULL DEFAULT 'received'::character varying
);

CREATE TABLE connections (
  connection_id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_entity_id uuid NOT NULL,
  from_display_name character varying(255) NOT NULL,
  from_bridge_id character varying(32) NOT NULL,
  to_entity_id uuid NOT NULL,
  to_display_name character varying(255) NOT NULL,
  to_bridge_id character varying(32) NOT NULL,
  status character varying(20) DEFAULT 'pending'::character varying,
  note text,
  responded_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE customer_list (
  customer_list_id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_entity_id uuid NOT NULL,
  customer_identity_id uuid NOT NULL,
  customer_type character varying(20) NOT NULL,
  segment_override character varying(20),
  added_via character varying(20) NOT NULL DEFAULT 'transaction'::character varying,
  txn_count integer NOT NULL DEFAULT 0,
  last_txn_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE dispute_participants (
  dispute_id uuid NOT NULL,
  chit_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  display_name text,
  role character varying(12) NOT NULL DEFAULT 'party'::character varying,
  dispute_status character varying(16) NOT NULL DEFAULT 'open'::character varying,
  added_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE entity_actor_settings (
  setting_id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  assignment_model character varying(20) NOT NULL DEFAULT 'both'::character varying,
  default_max_tasks integer NOT NULL DEFAULT 10,
  all_task_visible boolean NOT NULL DEFAULT true,
  auto_return_on_short_break boolean NOT NULL DEFAULT false,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  auto_assign_mode character varying(20) NOT NULL DEFAULT 'off'::character varying,
  default_assignee_actor_id uuid
);

CREATE TABLE entity_schemas (
  schema_id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  schema_name character varying(255) NOT NULL DEFAULT 'Product Schema'::character varying,
  schema_type character varying(50) NOT NULL DEFAULT 'product'::character varying,
  source character varying(50) NOT NULL DEFAULT 'manual'::character varying,
  status character varying(20) NOT NULL DEFAULT 'active'::character varying,
  is_default boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  visibility character varying(20) NOT NULL DEFAULT 'private'::character varying,
  schema_version integer NOT NULL DEFAULT 1
);

CREATE TABLE governance_exceptions (
  exception_id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  klass text NOT NULL,
  key text,
  detail text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  identity_id uuid NOT NULL DEFAULT gen_random_uuid(),
  bridge_id character varying(32) NOT NULL,
  display_name character varying(255) NOT NULL,
  email character varying(255),
  email_verified boolean DEFAULT false,
  phone character varying(20),
  country character varying(2) DEFAULT 'IN'::character varying,
  currency_code character varying(3) DEFAULT 'INR'::character varying,
  identity_type character varying(20) DEFAULT 'entity'::character varying,
  parent_entity_id uuid,
  auth_method character varying(30) DEFAULT 'otp'::character varying,
  status character varying(20) DEFAULT 'active'::character varying,
  otp_code character varying(6),
  otp_expires_at timestamp without time zone,
  last_active_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  created_by uuid,
  actor_key character varying(50),
  actor_type character varying(30) NOT NULL DEFAULT 'human'::character varying,
  user_id character varying(100),
  actor_role character varying(100),
  max_tasks integer NOT NULL DEFAULT 10,
  current_task_count integer NOT NULL DEFAULT 0,
  break_status character varying(20) NOT NULL DEFAULT 'active'::character varying,
  break_type character varying(20),
  break_started_at timestamp without time zone,
  return_date date,
  deactivated_at timestamp without time zone,
  removed_at timestamp without time zone,
  deactivated_by uuid,
  removed_by uuid,
  otp_attempts integer NOT NULL DEFAULT 0,
  pin_hash character varying(255),
  pin_set_at timestamp without time zone,
  pin_attempts integer NOT NULL DEFAULT 0,
  pin_locked_at timestamp without time zone,
  owner_scope character varying(20) NOT NULL DEFAULT 'entity'::character varying,
  gstn character varying(15),
  is_verified boolean NOT NULL DEFAULT false,
  logo_url text,
  address text,
  is_erased boolean NOT NULL DEFAULT false,
  erased_at timestamp with time zone,
  business_status character varying(10) NOT NULL DEFAULT 'open'::character varying,
  governed_by uuid,
  constitution_version text,
  params_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan text NOT NULL DEFAULT 'free'::text,
  message_type_mode character varying(12) NOT NULL DEFAULT 'lean'::character varying,
  self_copy_pref character varying(10) NOT NULL DEFAULT 'both'::character varying,
  dispute_handler_actor_id uuid,
  hat character varying(16) NOT NULL DEFAULT 'act'::character varying,
  delegate_actor_id uuid,
  last_assigned_at timestamp with time zone,
  sealed boolean NOT NULL DEFAULT false,
  capabilities jsonb
);

CREATE TABLE platform_constitution (
  constitution_id uuid NOT NULL DEFAULT gen_random_uuid(),
  root_id uuid NOT NULL,
  version text NOT NULL,
  as_of date NOT NULL DEFAULT CURRENT_DATE,
  params jsonb NOT NULL,
  plan_menu jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by text
);

CREATE TABLE platform_root (
  root_id uuid NOT NULL DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT 'CB protected root'::text,
  sealed boolean NOT NULL DEFAULT true,
  singleton boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE schema_fields (
  field_id uuid NOT NULL DEFAULT gen_random_uuid(),
  schema_id uuid NOT NULL,
  field_name character varying(255) NOT NULL,
  field_key character varying(100) NOT NULL,
  field_type character varying(50) NOT NULL DEFAULT 'text'::character varying,
  required boolean NOT NULL DEFAULT true,
  min_value numeric(15,2),
  max_value numeric(15,2),
  default_value text,
  options jsonb,
  placeholder character varying(255),
  display_order integer NOT NULL DEFAULT 0,
  xref character varying(255),
  created_at timestamp without time zone NOT NULL DEFAULT now()
);

CREATE TABLE sim_compare (
  id integer NOT NULL,
  ord integer NOT NULL,
  neighbour text NOT NULL,
  does text NOT NULL,
  difference text NOT NULL
);

CREATE TABLE sim_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid,
  section text,
  rating integer,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE sim_items (
  id integer NOT NULL,
  layer_id integer NOT NULL,
  name text NOT NULL,
  meaning text NOT NULL,
  readiness text NOT NULL DEFAULT 'designed'::text,
  ex_pharmacy text,
  ex_restaurant text,
  pleasure text,
  pain text,
  decisive text
);

CREATE TABLE sim_layers (
  id integer NOT NULL,
  ord integer NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL
);

CREATE TABLE sim_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  org text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE sim_rules (
  id integer NOT NULL,
  ord integer NOT NULL,
  question text NOT NULL,
  disposition text NOT NULL,
  detail text NOT NULL
);

CREATE TABLE sim_shapes (
  id integer NOT NULL,
  name text NOT NULL,
  customer_home text NOT NULL,
  discovery text NOT NULL,
  note text
);

CREATE TABLE sim_usps (
  id integer NOT NULL,
  ord integer NOT NULL,
  name text NOT NULL,
  why text NOT NULL,
  readiness text NOT NULL DEFAULT 'designed'::text,
  pleasure text,
  pain text
);

CREATE TABLE state_log (
  log_id uuid NOT NULL DEFAULT gen_random_uuid(),
  chit_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  action character varying(50) NOT NULL,
  action_by_identity_id uuid,
  action_by_display_name character varying(255),
  previous_status character varying(30),
  new_status character varying(30),
  detail text,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE supplier_list (
  supplier_list_id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_entity_id uuid NOT NULL,
  supplier_entity_id uuid NOT NULL,
  category character varying(50),
  added_via character varying(20) NOT NULL DEFAULT 'manual'::character varying,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  nickname character varying(80),
  preferred boolean NOT NULL DEFAULT false,
  notes text
);

-- ============================================================================
-- 2) CONSTRAINTS (PK / FK / UNIQUE / CHECK)  — see prod dump section 2
-- 3) INDEXES                                  — see prod dump section 3
-- 4) RLS enable/disable state                 — see prod dump section 4
-- 5) RLS policies (rls_entity on the 6 Direct tables) — section 5
-- 6) TRIGGERS (cb_touch_updated_at, assist_project_from_catalogue) — section 6
-- 7) FUNCTIONS (ours only; ltree extension internals EXCLUDED) — section 7
--
-- NOTE: sections 2–7 are transcribed in 000_baseline_part2.sql to keep this
-- file readable. Apply 000_baseline.sql then 000_baseline_part2.sql in order.
-- ============================================================================

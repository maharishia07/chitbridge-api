-- ===== 0. helpers =====
create or replace function cb_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
-- ===== 1. reference / master data =====
create table if not exists cb_currency (              -- ← currency
  id uuid primary key default gen_random_uuid(),
  code varchar(3) not null unique, name text not null, name_plural text,
  rounding int default 0, decimal_digits int default 2,
  symbol text, symbol_native text,
  status text not null default 'Active' check (status in ('Active','InActive'))
);
create table if not exists cb_city      ( id uuid primary key default gen_random_uuid(), name text not null, legacy_id bigint );          -- ← city
create table if not exists cb_industry  ( id uuid primary key default gen_random_uuid(), name text not null, legacy_id bigint );          -- ← industry
create table if not exists cb_building  ( id uuid primary key default gen_random_uuid(), city_id uuid references cb_city(id), name text not null, legacy_id bigint ); -- ← building
-- ===== 2. cb_entity — grow to carry identity + full profile (users + users_details) =====
alter table cb_entity add column if not exists legacy_id        bigint;            -- old users.id (backfill map)
alter table cb_entity add column if not exists username         varchar(55);
alter table cb_entity add column if not exists password_hash    text;              -- ← password (MD5 → bcrypt/argon2 on migrate)
alter table cb_entity add column if not exists account_type     text default 'Business'
  check (account_type in ('Personal','Business','Admin','Guest','Employee'));        -- ← users_details.account_type
-- mode/business_type already drive node-role; keep business_type for fidelity:
alter table cb_entity add column if not exists business_type    text default 'Business'
  check (business_type in ('Aggregator','Circle','Business'));                       -- ← users_details.business_type
alter table cb_entity add column if not exists firstname        text;
alter table cb_entity add column if not exists lastname         text;
alter table cb_entity add column if not exists contact_no       text;
alter table cb_entity add column if not exists email_id         text;
alter table cb_entity add column if not exists company_name     text;
alter table cb_entity add column if not exists company_detail_short text;
alter table cb_entity add column if not exists company_detail_long  text;
alter table cb_entity add column if not exists company_image    text;
alter table cb_entity add column if not exists profile_image    text;
alter table cb_entity add column if not exists location         text;
alter table cb_entity add column if not exists latitude         numeric;
alter table cb_entity add column if not exists longitude        numeric;
alter table cb_entity add column if not exists geohash          varchar(32);
alter table cb_entity add column if not exists city             text;
alter table cb_entity add column if not exists state            text;
alter table cb_entity add column if not exists country          text;
alter table cb_entity add column if not exists currency_code    varchar(3) default 'INR';
alter table cb_entity add column if not exists currency_id      uuid references cb_currency(id);
alter table cb_entity add column if not exists time_zone_id     int default 0;
alter table cb_entity add column if not exists time_zone_offset numeric(7,2) default 0;
alter table cb_entity add column if not exists row_per_page     int default 50;
alter table cb_entity add column if not exists licenses         jsonb default '[]'; -- ← lic1/2/3_* consolidated [{type,no,name,exp_date}]
alter table cb_entity add column if not exists external_connection boolean default false;
alter table cb_entity add column if not exists newsletter       boolean default true;
alter table cb_entity add column if not exists terms_accepted   boolean default true;
alter table cb_entity add column if not exists business_status  text default 'Open' check (business_status in ('Open','Closed','Away'));
alter table cb_entity add column if not exists sms_status       boolean default false;
alter table cb_entity add column if not exists field_json_data  jsonb default '{}';  -- ← field_json_data (extensible)
alter table cb_entity add column if not exists login_status     boolean default false;
alter table cb_entity add column if not exists last_activity    timestamptz;
alter table cb_entity add column if not exists created_at       timestamptz default now();
alter table cb_entity add column if not exists updated_at       timestamptz default now();
create table if not exists cb_entity_supplier (        -- ← users_industry_supplier (discovery index)
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references cb_entity(id) on delete cascade,
  industry_id uuid references cb_industry(id),
  building_id uuid references cb_building(id),
  unique (entity_id, industry_id, building_id)
);
create table if not exists cb_device (                 -- ← user_device + users_details.app_android_*
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references cb_entity(id) on delete cascade,
  service_provider_id uuid references cb_entity(id),
  device_id varchar(64), device_token text,
  platform text default 'android', priority text default 'Low',
  updated_at timestamptz default now()
);
-- ===== 3. cb_edge — carry alias + assigned handler (network_contact extras) =====
alter table cb_edge add column if not exists alias_name text;                       -- ← network_contact.alias_name
alter table cb_edge add column if not exists assign_to  uuid references cb_entity(id); -- ← assign_to_bridge_id
alter table cb_edge add column if not exists legacy_id  bigint;
create table if not exists cb_entity_employee (        -- ← users_employee (the agency edge)
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references cb_entity(id) on delete cascade,
  employee_id uuid not null references cb_entity(id) on delete cascade,
  employee_name text, field_json_data jsonb default '{}',
  unique (owner_id, employee_id)
);
create table if not exists cb_contact (                -- ← user_bridge_contacts + favourite_user
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references cb_entity(id) on delete cascade,
  contact_id uuid not null references cb_entity(id) on delete cascade,
  role text default '', preference text default 'Yes',
  is_favourite boolean default false,
  created_at timestamptz default now(),
  unique (owner_id, contact_id)
);
-- ===== 4. catalogue (pricelist + pricelist_category) =====
create table if not exists cb_catalogue_category (     -- ← pricelist_category
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references cb_entity(id) on delete cascade,
  name text not null, image text,
  currency_code varchar(3), currency_id uuid references cb_currency(id),
  sort_by bigint default 0, legacy_id bigint
);
create table if not exists cb_catalogue_item (         -- ← pricelist
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references cb_entity(id) on delete cascade,
  name text, price numeric(16,3) not null default 0,
  currency_code varchar(3), currency_id uuid references cb_currency(id),
  out_of_stock boolean default false, copy_flag boolean default false,
  available_stock text, section text, category text, cross_reference text,
  -- visibility tier (PD-032): who the price is for
  price_type text not null default 'Business' check (price_type in ('Personal','Business','Employee')),
  offer text, discounted_price numeric(16,3) default 0, discount_percentage numeric(7,3) default 0,
  sort_by bigint default 0,
  field_json_data jsonb, additional_json_data jsonb, internal_json_data jsonb,
  image_json_data jsonb, audio_json_data jsonb, video_json_data jsonb, tax_json_data jsonb,  -- ← *_json_data
  created_at timestamptz default now(), updated_at timestamptz default now(), legacy_id bigint
);
-- ===== 5. cb_chit — grow to the full chit_header (49 cols) =====
alter table cb_chit add column if not exists purpose            varchar(30);
alter table cb_chit add column if not exists contact_number     varchar(15);
alter table cb_chit add column if not exists to_bridgelist      jsonb;             -- ← to_bridgelist (multi)
alter table cb_chit add column if not exists info_entity        uuid references cb_entity(id);   -- ← info_bridge_id
alter table cb_chit add column if not exists info_bridgelist    jsonb;
alter table cb_chit add column if not exists for_non_bridge_name text;            -- ← for non-registered party
alter table cb_chit add column if not exists assign_by          uuid references cb_entity(id);   -- ← assign_by_bridge_id
alter table cb_chit add column if not exists bridge_status      text default 'Sender' check (bridge_status in ('Sender','Act','Info','For','Draft'));
alter table cb_chit add column if not exists physical_status    text default 'Active' check (physical_status in ('Active','Deleted','Archived','Spam','ReplyDraft','ForwardDraft'));
alter table cb_chit add column if not exists read_status        text default 'UnRead' check (read_status in ('Read','UnRead'));
alter table cb_chit add column if not exists priority           text default 'No' check (priority in ('Important','Urgent','No'));
alter table cb_chit add column if not exists location           text;
alter table cb_chit add column if not exists latitude           numeric;
alter table cb_chit add column if not exists longitude          numeric;
alter table cb_chit add column if not exists geohash            varchar(32);
alter table cb_chit add column if not exists template_flag      boolean default false;
alter table cb_chit add column if not exists template_ver_no    int default 0;
alter table cb_chit add column if not exists folder_location    text;
alter table cb_chit add column if not exists header_note        text;
alter table cb_chit add column if not exists footer_note        text;
alter table cb_chit add column if not exists task_comment       jsonb;
alter table cb_chit add column if not exists task_flag          jsonb;
alter table cb_chit add column if not exists signature          text;
alter table cb_chit add column if not exists currency_code      varchar(3);
alter table cb_chit add column if not exists currency_id        uuid references cb_currency(id);
alter table cb_chit add column if not exists chit_item_count    int default 0;
alter table cb_chit add column if not exists total_chit_item_value numeric(40,4) default 0;
alter table cb_chit add column if not exists expected_delivery_time  timestamptz;
alter table cb_chit add column if not exists estimated_delivery_time timestamptz;
alter table cb_chit add column if not exists ref_id             bigint default 0;
alter table cb_chit add column if not exists case_id            varchar(8);
alter table cb_chit add column if not exists is_draft           boolean default false;  -- collapses draft_chit_* into one table
alter table cb_chit add column if not exists created_by         uuid references cb_entity(id);
alter table cb_chit add column if not exists updated_by         uuid references cb_entity(id);
alter table cb_chit add column if not exists notify_date        timestamptz;
alter table cb_chit add column if not exists legacy_chit_id     bigint;
-- ===== 6. cb_chit_item — grow to full chit_data (negotiation) =====
alter table cb_chit_item add column if not exists particulars_code varchar(64);
alter table cb_chit_item add column if not exists reply_particulars varchar(64);
alter table cb_chit_item add column if not exists reply_qty   numeric(15,3);
alter table cb_chit_item add column if not exists reply_price numeric(15,3);
alter table cb_chit_item add column if not exists reply_total numeric(30,6);
alter table cb_chit_item add column if not exists previous_status text default 'Active';
-- ===== 7. cb_chit_log (chit_header_log) — audit =====
create table if not exists cb_chit_log (
  id uuid primary key default gen_random_uuid(),
  chit_id uuid references cb_chit(id) on delete cascade,
  originator_id uuid, parent_id uuid, created_by uuid references cb_entity(id),
  action text not null default 'Created'
    check (action in ('Created','Accepted','Diarised','InProgress','Finished','Completed','Withdrawn','Hold','Closed','Modify','Forward','Reply','ReplyAll','Deleted','Archived','Assignee')),
  description text, remark text,
  action_by uuid references cb_entity(id), action_date timestamptz default now()
);
-- ===== 8. cb_task (task_reference) — chit/case linkage =====
create table if not exists cb_task (
  id uuid primary key default gen_random_uuid(),
  task_purpose varchar(30), link_flag text default 'Internal' check (link_flag in ('Internal','External')),
  from_entity uuid references cb_entity(id), from_chit_id uuid references cb_chit(id),
  from_ref_id bigint, from_case_id varchar(8), from_purpose varchar(30), from_field_json_data jsonb,
  to_entity uuid references cb_entity(id),   to_chit_id uuid references cb_chit(id),
  to_ref_id bigint,   to_case_id varchar(8),   to_purpose varchar(30),   to_field_json_data jsonb,
  status text default 'Link' check (status in ('Active','InActive','Blocked','Suspended','Deleted','Link','Delink','Complete','Issue')),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
-- ===== 9. cb_transaction_history (tansaction_history) — batch totals + GST =====
create table if not exists cb_transaction_history (
  id uuid primary key default gen_random_uuid(),
  info_entity uuid references cb_entity(id), to_entity uuid references cb_entity(id),
  txn_status text not null default 'Active',
  batch_create_date timestamptz default now(), batch_process_date timestamptz,
  header_count bigint default 0, total_chit_item_count bigint default 0,
  sgst numeric(40,4) default 0, cgst numeric(40,4) default 0,           -- ← GST (tax) — now has a home
  amount numeric(40,4) default 0, total numeric(40,4) default 0
);
-- ===== 10. CRM / traction =====
create table if not exists cb_consumer_traction (      -- ← consumer_traction
  id uuid primary key default gen_random_uuid(),
  business_id uuid references cb_entity(id), consumer_id uuid references cb_entity(id),
  total_visited int default 0, field_json_data jsonb,
  status text default 'Active', created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists cb_external_reference (     -- ← external_reference
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references cb_entity(id) on delete cascade,
  purpose text, purpose_type text, contact_number varchar(16), contact_name text,
  contact_visit_count bigint default 0, contact_visit_value numeric(10,0) default 0,
  source_of_reference text, referrer_contact_number varchar(16), referrer_contact_name text,
  referral_count bigint default 0, referral_value numeric(10,0) default 0,
  priority text default 'Low' check (priority in ('VeryLow','Low','Medium','High','VeryHigh')),
  exit_level text default 'None', exit_reason text, field_json_data jsonb,
  status text default 'Active', created_at timestamptz default now(), updated_at timestamptz default now()
);
-- ===== 11. indexes + updated_at triggers =====
create index if not exists cb_cat_item_entity on cb_catalogue_item(entity_id);
create index if not exists cb_cat_item_tier   on cb_catalogue_item(entity_id, price_type);
create index if not exists cb_chit_log_chit   on cb_chit_log(chit_id);
create index if not exists cb_contact_owner   on cb_contact(owner_id);
create index if not exists cb_supplier_idx    on cb_entity_supplier(industry_id, building_id);
do $$ begin
  perform 1; -- attach updated_at triggers
  create trigger t_entity_upd  before update on cb_entity            for each row execute function cb_touch_updated_at();
  create trigger t_item_upd    before update on cb_catalogue_item    for each row execute function cb_touch_updated_at();
  create trigger t_task_upd    before update on cb_task              for each row execute function cb_touch_updated_at();
exception when duplicate_object then null; end $$;

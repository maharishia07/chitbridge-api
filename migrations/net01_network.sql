-- NET-01: network establishment & delinking
create extension if not exists ltree;
create extension if not exists pgcrypto;   -- gen_random_uuid()
create table if not exists cb_entity (
  id           uuid primary key default gen_random_uuid(),
  bridge_id    text not null unique,
  name         text not null,
  mode         text not null default 'b2b'    check (mode in ('b2b','b2c')),
  owner_scope  text not null default 'entity' check (owner_scope in ('entity','network','platform')),
  path         ltree not null,
  claimed      boolean not null default true,
  status       text not null default 'active' check (status in ('active','suspended','archived')),
  app_ref      text,                          -- optional FK to existing org/shop id (text to stay schema-agnostic)
  created_at   timestamptz not null default now()
);
create index if not exists cb_entity_path_gist  on cb_entity using gist  (path);
create index if not exists cb_entity_path_btree on cb_entity using btree (path);
create table if not exists cb_edge (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid not null references cb_entity(id) on delete restrict,
  child_id     uuid not null references cb_entity(id) on delete restrict,
  type         text not null default 'governance'
                 check (type in ('governance','commercial','discovery','counterparty','agency')),
  state        text not null
                 check (state in ('requested','active','suspended','declined','disconnected')),
  in_flight    boolean not null default false,   -- proxy for "open chit on this edge" until chits land
  requested_by uuid,
  approved_by  uuid,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  archived_at  timestamptz,
  constraint cb_edge_no_self check (parent_id <> child_id)
);
create index if not exists cb_edge_parent on cb_edge(parent_id);
create index if not exists cb_edge_child  on cb_edge(child_id);
-- tree-only: a child may have at most ONE live (active/suspended) parent
create unique index if not exists cb_edge_one_live_parent
  on cb_edge(child_id) where state in ('active','suspended');

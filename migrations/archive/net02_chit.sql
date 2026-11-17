create table if not exists cb_chit (
  id            uuid primary key default gen_random_uuid(),
  chit_hash     text not null unique,
  originator_id uuid not null,                          -- thread root (self for root)
  parent_id     uuid references cb_chit(id),            -- previous hop (null at root)
  edge_id       uuid references cb_edge(id),            -- the connection this hop runs on
  from_entity   uuid not null references cb_entity(id),
  to_entity     uuid not null references cb_entity(id),
  for_entity    uuid references cb_entity(id),          -- origin / on-behalf-of (kept opaque downstream)
  assign_to     uuid references cb_entity(id),          -- handler actor (employee)
  role          text not null default 'Act'  check (role in ('Act','Info','For','Draft')),
  txn_status    text not null default 'Active'
                  check (txn_status in ('Active','Accepted','InProgress','Finished','Completed','Withdrawn','Hold','Closed','Archived')),
  subject       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists cb_chit_edge       on cb_chit(edge_id);
create index if not exists cb_chit_originator  on cb_chit(originator_id);
create index if not exists cb_chit_to          on cb_chit(to_entity);
create index if not exists cb_chit_open        on cb_chit(edge_id) where txn_status in ('Active','Accepted','InProgress','Finished','Hold');
create table if not exists cb_chit_item (
  id          uuid primary key default gen_random_uuid(),
  chit_id     uuid not null references cb_chit(id) on delete cascade,
  particulars text,
  qty         numeric(15,3) not null default 0,
  price       numeric(15,3) not null default 0,
  total       numeric(30,6) not null default 0,
  reply_qty   numeric(15,3),
  reply_price numeric(15,3),
  reply_total numeric(30,6),
  status      text not null default 'Active' check (status in ('Active','Added','Modified','Deleted','InActive'))
);

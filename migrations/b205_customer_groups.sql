-- b205_customer_groups.sql — NAMED CUSTOMER GROUPS (Athi, 2026-09-06: "we should be having option to name them")
-- A seller names groups ("dealers", "wholesale"), places customers in them on the Customers pane, and scopes an offer "Only for" a group.
-- One column on the seller's own customer list (RLS: owner_entity_id). Idempotent; safe to re-run. Run in the Supabase SQL editor.
alter table customer_list add column if not exists groups text[] not null default '{}';
create index if not exists idx_customer_list_groups on customer_list using gin (groups);

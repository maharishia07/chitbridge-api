-- migration_dispute_routing.sql
-- Dispute notification routing (baseline-9).
-- Per-chit assignee routing reuses the EXISTING chit_status.assigned_to_actor_id (no new column).
-- This adds only the entity-level "dispute team" pointer: an actor who receives ALL disputes
-- for the entity, regardless of which actor a given chit is assigned to.
ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS dispute_handler_actor_id UUID REFERENCES identities(identity_id);

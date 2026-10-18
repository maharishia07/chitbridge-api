-- b118_entity_sort_order.sql — a deliberate arrangement, visible to everyone who can see the network.
--
-- Athi, 2026-08-08: *"yes, add the stored position so we can arrange the order."*
--
-- Sorting siblings by name (b117-era) made the operator's tree and a member's tree agree, which was the bug. It
-- did not let anyone SAY what the order should be. An arrangement that lives only in the operator's draft cannot
-- be seen by a member — the whole reason the two views disagreed in the first place — so the order has to live on
-- the entity, where every reader already looks.
--
-- `sort_order`, not `position`: POSITION is a SQL function, and a column that shadows one is a small trap left for
-- whoever writes the next query.
--
-- NULL means "not arranged". Those fall to the end and sort by name, so an existing network keeps exactly the
-- order it has today until someone actually moves something. Nothing renumbers itself behind anyone's back.
--
-- Safe to re-run. Rollback:  ALTER TABLE identities DROP COLUMN sort_order;

ALTER TABLE identities ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN identities.sort_order IS
  'Where this store sits among its siblings in its network, set by the network build. NULL = not arranged (sorts last, by name).';

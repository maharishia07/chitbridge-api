-- b117_entity_purpose.sql — what a store is FOR, carried onto the store itself.
--
-- Athi, 2026-08-08: *"if we can bring the purpose of the store as a comment or readable text under each store,
-- that makes the network tree more meaningful"* → *"yes, carry the purpose to the store at build."*
--
-- The purpose has been captured in the network DESIGN since the first day, and the design is RLS-scoped to the
-- operator — so nobody except the person who drew it could ever read it. A member store logging in saw a tree of
-- bare names. This puts it on the entity, where anyone who may see the store may read why it exists.
--
-- WHY identities AND NOT entity_profile: entity_profile is per-entity WITH RLS, so a sibling could never read it.
-- The whole point is that OTHER people read this. identities is what resolveEntity, the network storefront and the
-- subtree walk already read, so it costs no extra query anywhere.
--
-- Deliberately NOT free text of arbitrary length: it renders on one line in a tree. 200 characters is generous for
-- a line and small enough that it cannot become a description field by accident.
--
-- Safe to re-run. Rollback:  ALTER TABLE identities DROP COLUMN purpose;

ALTER TABLE identities ADD COLUMN IF NOT EXISTS purpose varchar(200);

COMMENT ON COLUMN identities.purpose IS
  'One line: what this store is for. Set by the network build from the design node; readable by anyone who may see the entity.';

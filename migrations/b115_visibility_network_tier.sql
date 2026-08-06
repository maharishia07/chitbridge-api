-- b115 — the NETWORK visibility tier
--
-- Athi, 2026-08-06: *"if there are internal departments where the entity is protected, those catalogues will not be
-- visible outside — but the entities WITHIN the network can see those. They are like their warehouse."*
--
--     public   anyone with the link
--     network  members of the same network only — the warehouse
--     private  nobody but the owner
--
-- ⚠️ I SAID THIS NEEDED NO MIGRATION. That was wrong. b114 line 38 adds
--       CHECK (catalogue_visibility IN ('public','private'))
--    and I missed it by reading only the first few grep hits. The application then accepted `network`, the UPDATE
--    failed on this constraint, and a bare `catch (_) {}` in routes/entities.js swallowed it — so the API answered
--    200 "Profile updated" and stored nothing. That catch is now narrowed to the one case it was for (42703, the
--    column absent pre-b114); a constraint violation returns 409 naming this migration.
--
-- Widening a CHECK is additive: every existing row is already 'public' or 'private', so nothing is invalidated and
-- no data moves.
--
-- Rollback:
--   UPDATE identities SET catalogue_visibility = 'private' WHERE catalogue_visibility = 'network';
--   ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_catalogue_visibility_chk;
--   ALTER TABLE identities ADD  CONSTRAINT identities_catalogue_visibility_chk
--     CHECK (catalogue_visibility IN ('public', 'private'));
--   (rollback FIRST, or the old constraint cannot be added back while a 'network' row exists)

BEGIN;

-- 1 — what is in use today. Expect only 'public' and 'private'.
SELECT catalogue_visibility, COUNT(*) AS entities
  FROM identities GROUP BY catalogue_visibility ORDER BY 2 DESC;

-- 2 — widen the constraint.
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_catalogue_visibility_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_catalogue_visibility_chk
  CHECK (catalogue_visibility IN ('public', 'network', 'private'));

-- 3 — confirm the constraint now names all three.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conname = 'identities_catalogue_visibility_chk';

COMMIT;

-- Nothing is set to 'network' by this migration. Visibility stays a per-entity CHOICE, bounded by its cap —
-- widening what MAY be chosen is not the same as choosing it, and a migration must never publish anyone.

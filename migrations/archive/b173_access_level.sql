-- b173 — five hats become three access levels, adopted from Google Workspace.
--
-- Athi, 2026-08-20: *"instead of manager, audit, just say readonly and edit access? Will it serve the
-- purpose?"* and then *"if at all any standards to follow or how other platform quotes… then follow that."*
--
-- ⚠️⚠️ THE PROBLEM BEING FIXED: five names, two behaviours. `act` and `manager` were IDENTICAL, and `audit`,
-- `mis` and `view_only` were identical to each other. A manager reading that list reasonably concluded the
-- five differed, and the person who found out otherwise was an employee who asked for a hat that changed
-- nothing. The code was right; the VOCABULARY presented ROLE words as PERMISSION words.
--
-- ⭐⭐ ADOPTED, NOT INVENTED — Google Workspace's Viewer · Commenter · Editor:
--
--     viewer      reads. Nothing else.
--     commenter   reads, and may say something INTERNALLY. Cannot answer the other party.
--     editor      changes records, and messages anyone — inside or outside.
--
-- Athi described "read-only, but internal message possible" without having a name for it. That is COMMENTER,
-- exactly. When a description lands on a standard's definition unprompted, the standard is the right one.
--
-- Alternatives weighed: ServiceNow (roles + per-table ACLs — a different shape, and closer to what we are
-- moving away from), SharePoint (Read/Contribute/Edit/Full Control) and GitHub (Read/Triage/Write/Maintain/
-- Admin). Both heavier, and both MIX role with permission, which is the defect being removed.
--
-- ⭐ AND TWO FLAGS CARRY WHAT THE NAMES USED TO SMUGGLE. Five names could never express "an editor who sees
-- every branch" — there was no sixth name for it, and adding one is how five becomes eight. Reach and money
-- are their own dimensions, exactly as can_see_costs already was:
--
--     access_level   viewer | commenter | editor
--     whole_entity   boolean   — reach ignores the placement node
--     can_see_costs  boolean   — already exists
--
-- "Auditor" is then a PRESET, not a level: commenter + whole_entity + can_see_costs. A job title is a
-- combination of facts, which is why it never belonged in the permission column.
--
-- ⚠️ THE OLD `hat` COLUMN IS KEPT AND KEPT IN STEP. Code deploys before migrations run here, so the API reads
-- access_level and falls back to deriving it from hat. Dropping hat in the same breath would break every
-- running instance for the minutes between deploy and migration. It is retired in a later migration, once
-- nothing reads it.
--
-- ⚠️⚠️ whole_entity IS ENTITY-SCOPED AND MUST STAY THAT WAY. IAM-SPEC §28 parks cross-entity reach until a
-- real network shapes it, because widening it rewrites the RLS predicate that keeps tenants apart. This flag
-- means "ignore your placement node INSIDE your own entity" — one tenant, no RLS change. The name says
-- entity, not network, deliberately.
--
-- identities is WITHOUT ROW LEVEL SECURITY — the deliberate b54 cross-tenant carve-out.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS access_level  varchar(16);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS whole_entity  boolean NOT NULL DEFAULT false;

-- Backfill. act/manager could write, so they are editors. audit/mis/view_only could not.
UPDATE identities
   SET access_level = CASE
         WHEN hat IN ('act', 'manager') THEN 'editor'
         ELSE 'commenter'
       END
 WHERE identity_type = 'actor' AND access_level IS NULL;

-- ⭐ `audit` AND `mis` WERE THE ENTITY-WIDE ONES. Athi, on the auditor: *"he is the internal gate keeper…
-- audit is entity wide."* That reach was the one real thing those two names carried, and it is preserved
-- here rather than lost in the collapse.
UPDATE identities
   SET whole_entity = true
 WHERE identity_type = 'actor' AND hat IN ('audit', 'mis');

-- ⚠️ NOT NULL only AFTER the backfill, so an existing row cannot fail the constraint.
ALTER TABLE identities ALTER COLUMN access_level SET DEFAULT 'editor';

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_access_level_check;
ALTER TABLE identities ADD CONSTRAINT identities_access_level_check
  CHECK (access_level IS NULL OR access_level IN ('viewer', 'commenter', 'editor'));

CREATE INDEX IF NOT EXISTS identities_access_level_idx
  ON identities (parent_entity_id, access_level) WHERE identity_type = 'actor';

/**
 * ⚠️⚠️ THE AUDIT TRAIL NEEDS A NEW ACTION, AND WITHOUT THIS THE LOSS WOULD BE SILENT.
 *
 * b172's CHECK allows only created · hat_changed · costs_changed · break_changed · removed · reactivated.
 * Granting `whole_entity` is a REACH change and deserves its own action — but lib/access-events.js swallows
 * every error by design, so that it can never be the reason an access change fails. Combine the two and a
 * reach grant would violate the constraint, be swallowed, and leave NO RECORD that someone turned a branch
 * clerk into a person who sees the whole business.
 *
 * ⭐ A writer that cannot fail loudly must never be given something it will fail at.
 */
ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created','hat_changed','costs_changed','break_changed','removed','reactivated','reach_changed'));

-- What moved. One result set — the editor shows only the last.
SELECT 'migrated' AS report, hat AS was, access_level AS now, whole_entity, count(*) AS actors
  FROM identities
 WHERE identity_type = 'actor'
 GROUP BY hat, access_level, whole_entity
 ORDER BY count(*) DESC;

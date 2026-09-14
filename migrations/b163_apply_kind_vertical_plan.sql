-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b163 — RE-APPLY b161 + b162. Writes only, one block, nothing to run halfway.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi ran b161 and b162 on 2026-09-14 and NEITHER took effect. Verified after:
--
--     identities.vertical column        does not exist
--     plan values                       still 'enterprise' and 'free', not 'test'
--     sealed rows still entity_kind='customer'          9
--     owner_scope='platform' still 'customer'           7
--     no user_id, still 'customer'                     75
--
-- The predicates all still match, so the statements were never executed rather than executed and refused.
-- ⚠️ MOST LIKELY CAUSE: b161 and b162 open with an exploratory SELECT ("LOOK FIRST"), and a SQL editor that
-- runs only the statement under the cursor — or a person reading the first result and stopping — applies
-- nothing. That is a fault in how I wrote them, not in how they were run: a migration whose first statement is
-- a SELECT invites exactly this.
--
-- ⭐ SO THIS FILE HAS NO EXPLORATORY SELECTS BEFORE ITS WRITES. One transaction, then one verification at the
-- end. Idempotent: safe whether b161/b162 partially applied or not at all.
--
-- Supabase → SQL Editor → SELECT ALL → Run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 · entity_kind, structural first (b161 §2) ────────────────────────────────────────────────────────────────
-- platform-owned rows are OURS: the ISO/ICC standards, system entities, IoT gateways.
UPDATE identities SET entity_kind = 'internal'
 WHERE identity_type = 'entity' AND entity_kind = 'customer'
   AND (sealed = true OR owner_scope = 'platform');

-- domains the b157 list did not know
UPDATE identities SET entity_kind = 'test'
 WHERE identity_type = 'entity' AND entity_kind = 'customer'
   AND (email LIKE '%@proof.test' OR email LIKE '%@node.cb' OR email LIKE '%@shopper.cb'
     OR email LIKE '%@kumartraders.example' OR email LIKE '%@connector.iot');

-- ⚠️ no handle = never a registration. Staff sign in as name@handle; a business without one is unusable AS a
--    business. Everything still here after the two passes above is a script artefact.
UPDATE identities SET entity_kind = 'test'
 WHERE identity_type = 'entity' AND entity_kind = 'customer' AND user_id IS NULL;

-- ── 2 · vertical (b161 §3) ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE identities ADD COLUMN IF NOT EXISTS vertical varchar(40) NOT NULL DEFAULT 'general';
UPDATE identities SET vertical = 'general' WHERE vertical IS NULL OR vertical = '';

-- ── 3 · plan (b162) ────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ 'enterprise' is in the data today and is NOT in the new vocabulary, so it must move before the CHECK is
--    added or the constraint refuses rows that already exist.
UPDATE identities SET plan = 'test'
 WHERE plan IS NULL OR plan NOT IN ('test','free','silver','gold','platinum');

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_plan_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_plan_chk CHECK (plan IN (
  'test',      -- not for sale, unlimited, no terms — every entity today
  'free',      -- a real tier at no cost, and CAPPED (caps not set yet)
  'silver', 'gold', 'platinum'
));
ALTER TABLE identities ALTER COLUMN plan SET DEFAULT 'test';

COMMIT;

CREATE INDEX IF NOT EXISTS identities_vertical_idx ON identities (vertical) WHERE vertical <> 'general';

-- ── 4 · VERIFY — all three questions in one row ────────────────────────────────────────────────────────────────
SELECT (SELECT count(*) FROM identities
         WHERE identity_type='entity' AND entity_kind='customer'
           AND coalesce(status,'active')<>'erased')                       AS customers_now,
       (SELECT count(*) FROM identities
         WHERE identity_type='entity' AND entity_kind='customer' AND user_id IS NULL
           AND coalesce(status,'active')<>'erased')                       AS customers_without_a_handle,
       (SELECT count(*) FROM identities WHERE entity_kind='internal')     AS internal_now,
       (SELECT string_agg(DISTINCT plan, ' · ') FROM identities
         WHERE identity_type='entity')                                    AS plans_now,
       (SELECT string_agg(DISTINCT vertical, ' · ') FROM identities)      AS verticals_now;

-- ⭐ EXPECTED:  customers_now 15 · customers_without_a_handle 0 · internal_now ~10
--               plans_now 'test' · verticals_now 'general'
-- ⚠️ If customers_without_a_handle is anything but 0, step 1 did not run — check for an error above rather than
--    assuming it worked.

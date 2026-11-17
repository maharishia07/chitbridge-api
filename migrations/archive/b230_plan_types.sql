-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b230 — PLAN TYPES. Name them, close the vocabulary, and put everyone on 'test'.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"what plan is? gold, silver, test and so on, we can define the plan types now and will see
-- how to set the parameters and where to set the parameters, currently all the entities are set is test plan so
-- all the access is unlimited."*
--
-- ── ⭐⭐ 'test' IS MORE HONEST THAN 'free', AND THE DIFFERENCE IS NOT COSMETIC ───────────────────────────────────
--
-- `identities.plan` defaults to 'free' and NOTHING has ever written it, so all 2,503 rows say 'free'. That
-- number is unreadable: it cannot distinguish "chose the free tier" from "nobody has ever assigned a plan".
-- Every count built on it would be wrong in a way nobody could see.
--
-- 'test' says the true thing: an account with no commercial terms and no limits, because none are enforced yet.
-- The day a real shop signs up on 'silver', the difference between them is visible in one column.
--
-- ⚠️ THE TIERS BELOW ARE NAMES ONLY. Not one quota is set here, deliberately — Athi: *"we will see how to set
--    the parameters and where to set the parameters."* Putting plausible-looking numbers in now would create an
--    invented price that later reads as an agreed one, which is the exact mistake lib/rates.js refuses to make
--    ("the numbers below are zero on purpose").
--
-- Supabase → SQL Editor → paste → Run. Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ RENUMBERED 2026-09-14. This was written as b162, and b162 WAS ALREADY TAKEN by
--    b162_enquiry_deliver.sql. Eight files written today collided the same way: I saw b151 and
--    b154 in the folder and assumed the series ended there. It is at 222.
-- ⭐ NOT YET RUN.
--

-- ── 1 · LOOK FIRST ─────────────────────────────────────────────────────────────────────────────────────────────
SELECT plan, count(*) AS entities FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased' GROUP BY 1 ORDER BY 2 DESC;

-- ── 2 · EVERYONE ONTO 'test' ───────────────────────────────────────────────────────────────────────────────────
-- ⚠️ BEFORE the CHECK is added, or the constraint would refuse the rows it is meant to describe.
BEGIN;

UPDATE identities SET plan = 'test'
 WHERE plan IS NULL OR plan NOT IN ('test','free','silver','gold','platinum');

-- ── 3 · CLOSE THE VOCABULARY ───────────────────────────────────────────────────────────────────────────────────
-- ⚠️ Closed, for the reason entity_kind is closed: free text rots into 'Gold', 'gold ', 'GOLD-2026' within a
--    month, and the first thing to break is the count nobody re-checks. A tier is also the thing an invoice
--    cites, so a typo here is a billing error later.
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_plan_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_plan_chk CHECK (plan IN (
  'test',       -- ⭐ NOT FOR SALE. No limits, no terms, no invoice. Every entity today.
  'free',       -- ⚠️ A REAL TIER AT NO COST, and it IS capped — not the absence of a plan. Athi, 2026-09-14:
                --    'free plan should have limits, test entities do not have.' The caps are not set yet;
                --    lib/plans.js records that as ABSENT rather than null, so it cannot read as unlimited.
  'silver',     -- entry commercial tier
  'gold',       -- mid commercial tier
  'platinum'    -- top commercial tier
));

ALTER TABLE identities ALTER COLUMN plan SET DEFAULT 'test';

COMMENT ON COLUMN identities.plan IS
  'Commercial tier. test = not for sale, unlimited, no terms — the state of every entity until quotas are '
  'enforced. Quotas and prices live in lib/plans.js and are NOT set yet (b230).';

COMMIT;

-- ── 4 · WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────
SELECT plan, count(*) AS entities FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased' GROUP BY 1 ORDER BY 2 DESC;
-- ⭐ EXPECTED: test = every entity. Nothing else, until somebody is sold something.

-- ── ⚠️ WHAT THIS DOES NOT DO, SO NOBODY ASSUMES IT DID ─────────────────────────────────────────────────────────
--   · it does not enforce anything — no quota check exists on any path
--   · it does not price anything — lib/rates.js is still all zeroes, on purpose
--   · it does not decide WHERE parameters live. Two candidates, and the choice is not made:
--       lib/plans.js         quotas in code, versioned by deploy
--       constitution.governance  quotas as DATA, stamped at the mint, changeable without a release
--     ⭐ The design note argues for the second, version-stamped so editing a plan cannot silently re-limit an
--       existing customer. See DESIGN-PLATFORM-OPERATIONS.md §3.

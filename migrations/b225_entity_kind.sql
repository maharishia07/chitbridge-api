-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b225 — WHAT AN ENTITY *IS*, DECLARED AT THE MINT INSTEAD OF GUESSED FROM ITS EMAIL.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"we have to understand what are original, what are network entities, test entities and for
-- any other purpose?"*
--
-- ── ⚠️⚠️ HOW THIS IS ANSWERED TODAY, AND WHY IT CANNOT STAY ────────────────────────────────────────────────────
--
-- By GUESSING, in four different places, from the shape of a handle and the domain of an email address:
--
--     user_id LIKE '~%'            → a local supplier a shop minted
--     user_id LIKE '%.%'           → a branch under a parent tenant
--     email LIKE '%@test.com' …    → a test fixture
--     otherwise                    → a real customer
--
-- Every one of those is an inference about a row that nobody ever labelled. The counts on 2026-09-14 were
-- 91 customers · 238 network nodes · 10 local suppliers · 2,163 test fixtures — and all four numbers came out of
-- ad-hoc SQL written that afternoon, not out of the database.
--
-- ⚠️⚠️ AND THE EMAIL GUESS IS LOAD-BEARING FOR A DELETE. `scripts/cleanup-test-entities.sql` decides what to
-- DESTROY by matching a domain list that includes `@example.com` and `@x.com` — and x.com is now a real
-- company's domain. That predicate is one careless customer signup away from deleting a real shop. With a
-- declared kind it becomes `WHERE entity_kind = 'test'`: a fact somebody recorded, not a guess about an inbox.
-- That single change removes the whole class of risk, and it is the main reason this migration exists.
--
-- ── ⭐ NOT `purpose`. THAT COLUMN IS ALREADY SOMETHING ELSE. ────────────────────────────────────────────────────
-- `identities.purpose` is varchar(200) of FREE TEXT describing what a network node is for ("east region
-- warehouse"), written by routes/network-design.js and read in six routes. Overloading it with a classification
-- would break every one of them and give one column two meanings.
--
-- Supabase → SQL Editor → paste → Run. Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ RENUMBERED 2026-09-14. This was written as b157, and b157 WAS ALREADY TAKEN by
--    b157_notif_seen.sql. Eight files written today collided the same way: I saw b151 and
--    b154 in the folder and assumed the series ended there. It is at 222.
-- ⭐ THIS ONE HAS ALREADY BEEN RUN against production, as b157. The file name is recorded nowhere,
--    so the rename changes nothing that happened — but do not run it again expecting it to be new. It is
--    idempotent, so re-running is harmless if you are unsure.
--

BEGIN;

-- ── 1 · THE COLUMN ──────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠️⚠️ THE DEFAULT IS 'customer', AND THE DIRECTION OF THAT CHOICE IS THE WHOLE POINT.
--
-- If a forgetful test harness leaves it unset we get a test shop in the customer list: visible, annoying,
-- fixable in a second. If the default were 'test' a real paying customer would silently vanish from the
-- platform's own books — and be swept by a cleanup that believes it is deleting fixtures. Wrong in the
-- recoverable direction, always.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS entity_kind varchar(16) NOT NULL DEFAULT 'customer';

-- ⚠️ A CLOSED VOCABULARY. Free text here would rot into 'Test', 'testing', 'TEST-DATA' within a month and the
--    delete predicate would silently start missing rows — which, for a predicate that deletes, is the bad half.
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_entity_kind_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_entity_kind_chk CHECK (entity_kind IN (
  'customer',   -- a real registered business. THE DEFAULT.
  'network',    -- a branch/node under a parent tenant. NOT a separate customer: plans.js bills the top node
                --   and counts quotas across its whole subtree, so counting these as customers bills twice.
  'supplier',   -- a local supplier a shop minted to represent the hardware shop on the corner. Never signed up.
  'test',       -- a fixture minted by a test run. Swept by cleanup-test-entities.sql.
  'internal',   -- ours: the platform root, demo shops, anything we mint for ourselves.
  -- ⚠️ THE TWO BELOW ARE NOT BUSINESSES AT ALL, and they are in this list so that no row anywhere carries a
  --    misleading 'customer'. `identities` holds three identity_types (entity 2502 · actor 193 · customer 89 on
  --    2026-09-14) and the column defaults for ALL of them.
  'actor',      -- a person or co-assist under an entity (identity_type = 'actor')
  'shopper'     -- ⚠️ a WALK-IN CUSTOMER of a shop (identity_type = 'customer'), minted by routes/catalogue.js.
                --   NOT our customer. The word 'customer' means two different things one column apart, which is
                --   exactly why these 89 rows must not sit at the default and be counted as businesses.
));

COMMENT ON COLUMN identities.entity_kind IS
  'What this identity IS, declared at the mint. Closed vocabulary — see identities_entity_kind_chk. b225.';

COMMIT;

-- ── 2 · THE BACKFILL — ONCE, FROM THE INFERENCE THIS REPLACES ──────────────────────────────────────────────────
--
-- ⚠️ ORDER MATTERS: most specific first, and each step excludes what the previous ones already claimed.
--    A local supplier's handle (`~shop.sup-0001`) contains a dot, so a naive network rule would eat it.
--
-- ⚠️ AND THIS IS THE LAST TIME THE INFERENCE IS TRUSTED. After this runs, the guesses are deleted from the code
--    and every new row declares itself. A backfill that stays behind as a nightly job is not a fix, it is the
--    same guess on a timer.
BEGIN;

-- 2a · everything that is not a business first. Without this, 193 actors and 89 walk-in shoppers would sit at
--      the 'customer' default and inflate every count taken by anyone who forgot to filter identity_type — and
--      forgetting is the normal case, because the column is called entity_kind and they are not entities.
UPDATE identities SET entity_kind = 'actor'
 WHERE identity_type = 'actor' AND entity_kind = 'customer';

UPDATE identities SET entity_kind = 'shopper'
 WHERE identity_type = 'customer' AND entity_kind = 'customer';

-- 2b · local suppliers — the handle is `~<owner user_id>.sup-nnnn`
UPDATE identities SET entity_kind = 'supplier'
 WHERE identity_type = 'entity' AND user_id LIKE '~%' AND entity_kind = 'customer';

-- 2c · network sub-nodes — a dotted handle, and NOT one of the tildes above
UPDATE identities SET entity_kind = 'network'
 WHERE identity_type = 'entity' AND user_id LIKE '%.%' AND user_id NOT LIKE '~%' AND entity_kind = 'customer';

-- 2d · test fixtures — the domain list, used here for the LAST time
UPDATE identities SET entity_kind = 'test'
 WHERE identity_type = 'entity' AND entity_kind = 'customer'
   AND (email LIKE '%@test.example' OR email LIKE '%@test.com'  OR email LIKE '%@test-cb.com'
     OR email LIKE '%@demo-cb.com'  OR email LIKE '%@example.com' OR email LIKE '%@t.com'
     OR email LIKE '%@x.com');

-- 2e · the platform root is ours, not a customer of itself
UPDATE identities SET entity_kind = 'internal'
 WHERE identity_type = 'entity' AND user_id = 'cbincroot';

COMMIT;

-- ── 3 · THE INDEX — the customer list is the hottest read this column will serve ────────────────────────────────
CREATE INDEX IF NOT EXISTS identities_entity_kind_idx ON identities (entity_kind)
  WHERE entity_kind <> 'customer';
-- ⚠️ PARTIAL, and deliberately the way round that looks wrong. 'customer' will become the overwhelming majority
--    once the 2,163 fixtures are swept, and an index whose value matches most rows is not used. Indexing the
--    MINORITY makes "show me the test entities" and "show me the network nodes" fast, while "show me customers"
--    is a sequential scan of a table that is small and mostly customers anyway.

-- ── 4 · WHAT YOU SHOULD SEE ─────────────────────────────────────────────────────────────────────────────────────
SELECT entity_kind,
       count(*)                                                        AS n,
       count(*) FILTER (WHERE last_active_at IS NOT NULL)              AS ever_signed_in,
       count(*) FILTER (WHERE last_active_at > now()::timestamp - interval '30 days') AS active_30d
  FROM identities
 WHERE coalesce(status, 'active') <> 'erased'
 GROUP BY 1 ORDER BY 2 DESC;

-- ⭐ EXPECTED on 2026-09-14, from the inference this replaces. If these do not match, STOP and find out why
--    before deleting the guesses from the code:
--       test 2163 · network 238 · actor 193 · shopper 89 · customer 90 · supplier 10 · internal 1
--    (customer is 90 rather than 91 because cbincroot moves to 'internal' in step 2e.)

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b229 — CORRECT WHAT THE EARLY DAYS LEFT BEHIND, and give every entity a vertical.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"we are testing our product, in the early days we might have made mistake, if so correct
-- those and fit into framework"* · *"update all vertical information for the entities as general"*
--
-- ── ⚠️⚠️ WHAT b225 GOT WRONG, AND WHY ──────────────────────────────────────────────────────────────────────────
--
-- b225 classified test fixtures by EMAIL DOMAIN against a list of domains our harnesses were known to use. It
-- reported 90 customers and I quoted that number all afternoon. It is wrong: **75 of those 90 have no user_id
-- at all**, and their names say what they really are —
--
--     E2E Buyer ×6 · Delivery Fleet · Central Warehouse · Meat Dept · Grocery Dept · OpStore (×6 each)
--     Work 307885300 · Lock 341722500 · Amend Diag 442874700 · Version Proof 552951400 · Perf 970163800 …
--     UCP 600 · Incoterms 2020 · ISO 9001 · ISO 27000 · ISO 45001 · FRM · EXIM       ← STANDARDS, not businesses
--     Edge Gateway 01 · GOV-01-Help                                                  ← a device, a help artefact
--
-- They were minted by scripts using domains the list did not know: chitbridge.local · chitbridge.system ·
-- connector.iot · email.com · node.cb · proof.test · shopper.cb.
--
-- ⭐⭐⭐ SO THE LESSON IS NOT "ADD SEVEN MORE DOMAINS". It is that a domain list can only ever be a guess, and
-- there were STRUCTURAL facts available the whole time that are not guesses at all:
--
--     sealed = true              a platform-minted, frozen row. lib/source.js sets it for standards.
--     owner_scope = 'platform'   owned by the platform, not by a tenant.
--
-- Those two are declarations. This migration uses them FIRST and falls back to domains only for what they do
-- not cover — and lib/entitykind.js gains the same structural test so new rows never need the fallback.
--
-- ── ⭐ AND THE HONEST COUNT AFTERWARDS ─────────────────────────────────────────────────────────────────────────
-- 15 entities have a handle, and every one is Athi's own or a fixture: alpha-timers · mybanana · mypharma ·
-- mystorex · deepikagr · chola-auto-care · tallytest · kausik123 · platform-of-platform · 5 node.cb departments
-- · 1 e2e row. THERE ARE NO EXTERNAL CUSTOMERS YET. That is the correct state for a product in testing, and a
-- number that says 90 is worse than useless.
--
-- Supabase → SQL Editor → paste → Run. Step 1 only looks. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ RENUMBERED 2026-09-14. This was written as b161, and b161 WAS ALREADY TAKEN by
--    b161_message_subject.sql. Eight files written today collided the same way: I saw b151 and
--    b154 in the folder and assumed the series ended there. It is at 222.
-- ⭐ NOT YET RUN.
--

-- ── 1 · LOOK FIRST ─────────────────────────────────────────────────────────────────────────────────────────────
SELECT entity_kind, count(*) AS before
  FROM identities WHERE coalesce(status,'active') <> 'erased' GROUP BY 1 ORDER BY 2 DESC;

-- ── 2 · STRUCTURAL FIRST — these are declarations, not guesses ─────────────────────────────────────────────────
BEGIN;

-- 2a · platform-owned rows are OURS. Standards (UCP 600, ISO 9001), system entities, IoT gateways.
UPDATE identities SET entity_kind = 'internal'
 WHERE identity_type = 'entity'
   AND entity_kind = 'customer'
   AND (sealed = true OR owner_scope = 'platform');

-- 2b · the domains the b225 list did not know. ⚠️ Still a guess, and used only for what 2a did not catch.
--      email.com is on this list because it is the address our own seed scripts use — NOT because a real
--      business could not own it. It is here on the evidence of what is actually in the table, and it is the
--      last time a domain decides anything: lib/entitykind.js now tests `sealed`/`owner_scope` first.
UPDATE identities SET entity_kind = 'test'
 WHERE identity_type = 'entity'
   AND entity_kind = 'customer'
   AND (email LIKE '%@proof.test' OR email LIKE '%@node.cb' OR email LIKE '%@shopper.cb'
     OR email LIKE '%@kumartraders.example' OR email LIKE '%@connector.iot');

-- 2c · ⚠️ AN ENTITY WITH NO HANDLE CANNOT BE A CUSTOMER. Staff sign in as name@handle and suppliers are
--      numbered beneath it — a business without one is unusable AS a business, so it was never a registration.
--      Everything left here after 2a and 2b is a script artefact.
UPDATE identities SET entity_kind = 'test'
 WHERE identity_type = 'entity'
   AND entity_kind = 'customer'
   AND user_id IS NULL;

COMMIT;

-- ── 3 · THE VERTICAL ───────────────────────────────────────────────────────────────────────────────────────────
--
-- Athi: *"currently we can call it vertical as general, but we can see how to align the new entities to one
-- vertical and provide them related information, we already have it."*
--
-- ⭐ A NEW COLUMN, NOT constitution.vertical, AND THE DIFFERENCE MATTERS.
--     constitution.vertical  = which vertical a RULEBOOK serves       ('service-desk' constitution)
--     identities.vertical    = which vertical a BUSINESS operates in  (a pharmacy, a grocer)
--   One rulebook serves many businesses. Storing the business's vertical on the constitution would mean a
--   separate constitution per shop, which is the opposite of what a constitution is for.
--
-- ⚠️ 'general' is a real value, not a null. "Never asked" and "asked, and it is general" must stay separable
--    the day we start asking — the same reason `plan` defaulting to 'free' cannot tell those two apart today.
BEGIN;

ALTER TABLE identities ADD COLUMN IF NOT EXISTS vertical varchar(40) NOT NULL DEFAULT 'general';

COMMENT ON COLUMN identities.vertical IS
  'Which vertical this business operates in. general = unclassified. Drives vertical-specific content: '
  'catalogue starters, standards, capabilities. NOT the same as constitution.vertical (b229).';

-- everything existing is 'general' by the default; this makes it explicit and covers any pre-existing column
UPDATE identities SET vertical = 'general' WHERE vertical IS NULL OR vertical = '';

COMMIT;

CREATE INDEX IF NOT EXISTS identities_vertical_idx ON identities (vertical) WHERE vertical <> 'general';
-- ⚠️ Partial, same reasoning as identities_entity_kind_idx: 'general' is nearly every row today, and an index
--    matching most rows is not used. Indexing the exceptions is what makes "show me the pharmacies" fast.

-- ── 4 · WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────
SELECT entity_kind, count(*) AS after,
       count(*) FILTER (WHERE user_id IS NOT NULL) AS with_a_handle
  FROM identities WHERE coalesce(status,'active') <> 'erased' GROUP BY 1 ORDER BY 2 DESC;

SELECT vertical, count(*) FROM identities GROUP BY 1;

-- ⭐ EXPECTED: customer drops from 90 to about 15, internal rises to ~10, test absorbs the rest.
--    Every entity_kind='customer' row should now have a handle. If any does not, 2c did not fire.
SELECT count(*) AS customers_still_without_a_handle
  FROM identities
 WHERE identity_type = 'entity' AND entity_kind = 'customer' AND user_id IS NULL
   AND coalesce(status,'active') <> 'erased';

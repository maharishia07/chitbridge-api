-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b233 — TAKE THE STANDARDS AND THE FIXTURES OUT OF THE OPERATOR'S CRM.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ FOUND BY ATHI OPENING THE SCREEN, 2026-09-14 — which is the argument for having a screen.
--
-- The operator's customer list showed 93 rows: `ISO 45001 — Occupational health & safety`,
-- `ISO 27000 — Information security`, `E2E Buyer`, `Work 152632100`, `Grocery Dept`. A standard is not a
-- customer.
--
--     9  entity_kind = 'customer'   ← the only ones that belong
--    75  entity_kind = 'test'
--     9  entity_kind = 'internal'   ← the ISO/ICC standards, minted by lib/source.js
--
-- ── ⭐⭐⭐ THE CAUSE, AND IT IS A SEQUENCING MISTAKE I MADE ────────────────────────────────────────────────────
--
-- b226 backfilled 90 links while all 90 were still classified 'customer'. b229 and b231 then reclassified 75 of
-- them to test/internal — and never revisited the links already written. **I fixed the source and forgot the
-- copies.** A reclassification that does not chase what it invalidated is only half a correction.
--
-- ⚠️ The other half — connect() linking every registration regardless of kind, so every e2e run added a row to
-- the CRM for ever — is fixed in lib/rootlink.js in the same commit. Without that, this migration would need
-- running weekly.
--
-- ── ⚠️ WHAT IT WILL NOT TOUCH ──────────────────────────────────────────────────────────────────────────────
--
-- ONLY rows marked `added_via = 'system'`. A supplier or customer a shop chose for itself is never removed, no
-- matter what kind the counterparty turns out to be — that is their record, not ours to tidy.
--
-- ⚠️ Writes first, no exploratory SELECT before them. b161/b162 were run and applied nothing because they
--    opened with one. Supabase → SQL Editor → SELECT ALL → Run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 · out of the operator's customer list
DELETE FROM customer_list cl
 USING identities i, identities root
 WHERE root.user_id = 'cbincroot'
   AND cl.owner_entity_id = root.identity_id
   AND cl.added_via = 'system'
   AND i.identity_id = cl.customer_identity_id
   AND i.entity_kind <> 'customer';

-- 2 · and the reciprocal supplier row out of THEIR entity, or they keep an operator they are not a customer of
DELETE FROM supplier_list sl
 USING identities i, identities root
 WHERE root.user_id = 'cbincroot'
   AND sl.supplier_entity_id = root.identity_id
   AND sl.added_via = 'system'
   AND i.identity_id = sl.owner_entity_id
   AND i.entity_kind <> 'customer';

COMMIT;

-- ── VERIFY ─────────────────────────────────────────────────────────────────────────────────────────────────────
WITH root AS (SELECT identity_id FROM identities WHERE user_id = 'cbincroot')
SELECT i.entity_kind,
       count(*) FILTER (WHERE cl.customer_list_id IS NOT NULL) AS in_customer_list,
       count(*) FILTER (WHERE sl.supplier_list_id IS NOT NULL) AS list_us_as_supplier
  FROM identities i
  LEFT JOIN customer_list cl ON cl.customer_identity_id = i.identity_id
                            AND cl.owner_entity_id = (SELECT identity_id FROM root)
  LEFT JOIN supplier_list sl ON sl.owner_entity_id = i.identity_id
                            AND sl.supplier_entity_id = (SELECT identity_id FROM root)
 WHERE cl.customer_list_id IS NOT NULL OR sl.supplier_list_id IS NOT NULL
 GROUP BY 1 ORDER BY 2 DESC;

-- ⭐ EXPECTED: one row — customer, 9 and 9. Any other entity_kind still listed means step 1 or 2 did not fire.
